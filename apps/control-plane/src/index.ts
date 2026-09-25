import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import crypto from 'node:crypto';
import fetch from 'node-fetch';
import { dbRepo } from '@vault/db';
import { placementEngine } from './placementEngine.js';
import { recoveryEngine } from './recoveryEngine.js';
import { DEFAULT_REPLICATION_FACTOR, calculateRiskScore, ObjectModel, ReplicaModel } from '@vault/shared';

const PORT = Number(process.env.PORT || 4000);
const fastify = Fastify({ logger: false, bodyLimit: 500 * 1024 * 1024 });

fastify.register(cors, { origin: '*' });
fastify.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });
import { checkAndAutoProvisionNodes, cleanupStaleAutoNodes, deprovisionExcessAutoNodes } from './nodeProvisioner.js';

// Clean up stale dead auto-node records from DB on startup
cleanupStaleAutoNodes();

// --- HEARTBEAT MONITOR LOOP ---
async function runHeartbeatCheck() {
  try {
    const nodes = await dbRepo.getAllNodes();
    for (const node of nodes) {
      if (node.status === 'FAILED') continue; // Controlled simulated failure

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const res = await fetch(`${node.address}/internal/health`, { signal: controller.signal as any });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data: any = await res.json();
          node.usedStorage = data.usedStorage || node.usedStorage;
          node.load = data.load || node.load;
          node.lastHeartbeat = new Date().toISOString();
          node.riskScore = calculateRiskScore(node);
          await dbRepo.upsertNode(node);
        } else {
          node.status = 'FAILED';
          node.failureCount += 1;
          node.riskScore = 1.0;
          await dbRepo.upsertNode(node);
          console.warn(`[Heartbeat] Node ${node.id} health returned status ${res.status}. Marked FAILED.`);
          
          await checkAndAutoProvisionNodes();
          recoveryEngine.checkAndRepairCluster();
        }
      } catch (err) {
        if (node.status !== 'FAILED') {
          node.status = 'FAILED';
          node.failureCount += 1;
          node.riskScore = 1.0;
          await dbRepo.upsertNode(node);
          console.warn(`[Heartbeat] Node ${node.id} unreachable. Marked FAILED.`);

          await checkAndAutoProvisionNodes();
          recoveryEngine.checkAndRepairCluster();
        }
      }
    }

    // Always audit cluster health & auto-provision replacement nodes if cluster is at risk (< 3 healthy nodes)
    await checkAndAutoProvisionNodes();

    // Deprovision excess empty auto-nodes when cluster is healthy and over-provisioned
    await deprovisionExcessAutoNodes();
  } catch (globalErr) {
    console.error('[Heartbeat] Error in heartbeat cycle:', globalErr);
  }
}

// Start heartbeat interval every 3 seconds
setInterval(runHeartbeatCheck, 3000);

// --- REST API ROUTES ---

// POST /objects - Upload object
fastify.post('/objects', async (request, reply) => {
  const data = await request.file();
  if (!data) {
    return reply.code(400).send({ error: 'NO_FILE_UPLOADED' });
  }

  const buffer = await data.toBuffer();
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const objectId = `obj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  // 1. Select nodes via Risk-Aware Placement Engine
  const targetNodes = await placementEngine.selectNodes(DEFAULT_REPLICATION_FACTOR);
  if (targetNodes.length === 0) {
    return reply.code(507).send({ error: 'INSUFFICIENT_STORAGE_NODES', message: 'No healthy storage nodes available' });
  }

  // 2. Upload replica data to each selected storage node
  const successfulReplicas: ReplicaModel[] = [];

  for (const node of targetNodes) {
    try {
      const putRes = await fetch(`${node.address}/internal/objects/${objectId}`, {
        method: 'PUT',
        body: buffer,
        headers: { 'Content-Type': 'application/octet-stream' }
      });

      if (!putRes.ok) {
        console.error(`Failed to store replica on node ${node.id}`);
        continue;
      }

      const putData: any = await putRes.json();

      if (putData.checksum !== checksum) {
        console.error(`Checksum mismatch during upload on node ${node.id}`);
        continue;
      }

      const replica: ReplicaModel = {
        id: `rep_${objectId.slice(0, 8)}_${node.id}`,
        objectId,
        nodeId: node.id,
        version: 1,
        checksum,
        status: 'HEALTHY'
      };

      await dbRepo.createReplica(replica);
      successfulReplicas.push(replica);
    } catch (err: any) {
      console.error(`Upload error on node ${node.id}: ${err.message}`);
    }
  }

  if (successfulReplicas.length === 0) {
    return reply.code(500).send({ error: 'UPLOAD_FAILED', message: 'Failed to write replicas to any storage node' });
  }

  // 3. Save object metadata
  const obj: ObjectModel = {
    id: objectId,
    filename: data.filename || 'file.bin',
    size: buffer.length,
    contentType: data.mimetype || 'application/octet-stream',
    checksum,
    version: 1
  };

  await dbRepo.createObject(obj);

  return reply.code(201).send({
    object: obj,
    replicas: successfulReplicas,
    placementNodes: targetNodes.map(n => ({ id: n.id, name: n.name, riskScore: n.riskScore }))
  });
});

// GET /objects - List objects
fastify.get('/objects', async () => {
  const allObjects = await dbRepo.getAllObjects();
  const allReplicas = await dbRepo.getAllReplicas();
  const allNodes = await dbRepo.getAllNodes();
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  const response = allObjects.map(obj => {
    const objReplicas = allReplicas.filter(r => r.objectId === obj.id);
    const healthyCount = objReplicas.filter(r => {
      const n = nodeMap.get(r.nodeId);
      return n && n.status !== 'FAILED' && r.status === 'HEALTHY';
    }).length;

    return {
      ...obj,
      replicationFactor: DEFAULT_REPLICATION_FACTOR,
      totalReplicas: objReplicas.length,
      healthyReplicas: healthyCount,
      replicas: objReplicas.map(r => ({
        ...r,
        nodeName: nodeMap.get(r.nodeId)?.name || r.nodeId,
        nodeStatus: nodeMap.get(r.nodeId)?.status || 'UNKNOWN'
      })),
      status: healthyCount >= DEFAULT_REPLICATION_FACTOR ? 'HEALTHY' : healthyCount > 0 ? 'DEGRADED' : 'CRITICAL'
    };
  });

  return response;
});

// GET /objects/:id - Download object
fastify.get('/objects/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const obj = await dbRepo.getObjectById(id);
  if (!obj) {
    return reply.code(404).send({ error: 'OBJECT_NOT_FOUND' });
  }

  const replicas = await dbRepo.getReplicasByObjectId(id);
  const allNodes = await dbRepo.getAllNodes();
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  const healthyReplicas = replicas.filter(r => {
    const n = nodeMap.get(r.nodeId);
    return n && n.status !== 'FAILED' && r.status === 'HEALTHY';
  });

  if (healthyReplicas.length === 0) {
    return reply.code(503).send({ error: 'OBJECT_UNAVAILABLE', message: 'No healthy nodes available to serve this object' });
  }

  // Try fetching content from healthy replicas
  for (const rep of healthyReplicas) {
    const node = nodeMap.get(rep.nodeId)!;
    try {
      const getRes = await fetch(`${node.address}/internal/objects/${id}`);
      if (getRes.ok) {
        const buffer = Buffer.from(await getRes.arrayBuffer());
        const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

        if (checksum !== obj.checksum) {
          console.warn(`[Download] Read checksum mismatch on node ${node.id}. Marking replica corrupted...`);
          await dbRepo.updateReplicaStatus(rep.id, 'CORRUPTED');
          recoveryEngine.checkAndRepairCluster();
          continue;
        }

        reply.header('Content-Type', obj.contentType);
        reply.header('Content-Disposition', `attachment; filename="${obj.filename}"`);
        return reply.send(buffer);
      }
    } catch (err) {
      console.warn(`[Download] Error reading from node ${node.id}:`, err);
    }
  }

  return reply.code(500).send({ error: 'DOWNLOAD_FAILED', message: 'Failed to retrieve object from healthy nodes' });
});

// DELETE /objects/:id - Delete object
fastify.delete('/objects/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const obj = await dbRepo.getObjectById(id);
  if (!obj) {
    return reply.code(404).send({ error: 'OBJECT_NOT_FOUND' });
  }

  const replicas = await dbRepo.getReplicasByObjectId(id);
  const allNodes = await dbRepo.getAllNodes();
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  for (const rep of replicas) {
    const node = nodeMap.get(rep.nodeId);
    if (node && node.status !== 'FAILED') {
      try {
        await fetch(`${node.address}/internal/objects/${id}`, { method: 'DELETE' });
      } catch {}
    }
  }

  await dbRepo.deleteObject(id);

  // After deletion, check if any auto-provisioned nodes are now empty & excess — deprovision them
  deprovisionExcessAutoNodes().catch(() => {});

  return { id, status: 'DELETED' };
});

// GET /nodes - List cluster nodes
fastify.get('/nodes', async () => {
  const nodes = await dbRepo.getAllNodes();
  const replicas = await dbRepo.getAllReplicas();

  return nodes.map(n => {
    const nodeReplicas = replicas.filter(r => r.nodeId === n.id);
    return {
      ...n,
      riskScore: calculateRiskScore(n),
      replicaCount: nodeReplicas.length
    };
  });
});

// GET /nodes/:id - Get single node detail
fastify.get('/nodes/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const node = await dbRepo.getNodeById(id);
  if (!node) {
    return reply.code(404).send({ error: 'NODE_NOT_FOUND' });
  }
  const replicas = await dbRepo.getReplicasByNodeId(id);
  const allObjects = await dbRepo.getAllObjects();
  const objMap = new Map(allObjects.map(o => [o.id, o]));

  const enrichedReplicas = replicas.map(r => {
    const obj = objMap.get(r.objectId);
    return {
      ...r,
      filename: obj?.filename || r.objectId,
      size: obj?.size || 0
    };
  });

  return { ...node, replicas: enrichedReplicas };
});

// POST /objects/:id/verify - Verify checksum integrity
fastify.post('/objects/:id/verify', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const result = await recoveryEngine.verifyObjectIntegrity(id);
    return result;
  } catch (err: any) {
    return reply.code(500).send({ error: 'VERIFICATION_FAILED', message: err.message });
  }
});

// GET /repairs - Get repair jobs log
fastify.get('/repairs', async () => {
  return await dbRepo.getAllRepairJobs();
});

// GET /metrics - Summary metrics
fastify.get('/metrics', async () => {
  const nodes = await dbRepo.getAllNodes();
  const objects = await dbRepo.getAllObjects();
  const replicas = await dbRepo.getAllReplicas();
  const repairJobs = await dbRepo.getAllRepairJobs();

  const healthyNodes = nodes.filter(n => n.status === 'HEALTHY').length;
  const failedNodes = nodes.filter(n => n.status === 'FAILED').length;
  const healthyReplicas = replicas.filter(r => r.status === 'HEALTHY').length;
  const corruptedReplicas = replicas.filter(r => r.status === 'CORRUPTED').length;
  const completedJobs = repairJobs.filter(j => j.status === 'COMPLETED');

  let avgRecoveryTimeSec = 0;
  if (completedJobs.length > 0) {
    const totalDuration = completedJobs.reduce((acc, j) => {
      if (j.startedAt && j.completedAt) {
        return acc + (new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime()) / 1000;
      }
      return acc;
    }, 0);
    avgRecoveryTimeSec = Number((totalDuration / completedJobs.length).toFixed(2));
  }

  const totalCapacity = nodes.reduce((acc, n) => acc + Number(n.capacity), 0);
  const usedStorage = nodes.reduce((acc, n) => acc + Number(n.usedStorage), 0);

  return {
    totalNodes: nodes.length,
    healthyNodes,
    failedNodes,
    totalObjects: objects.length,
    totalReplicas: replicas.length,
    healthyReplicas,
    corruptedReplicas,
    totalCapacity,
    usedStorage,
    activeRepairJobs: repairJobs.filter(j => j.status === 'IN_PROGRESS').length,
    completedRepairJobs: completedJobs.length,
    avgRecoveryTimeSec
  };
});

// --- CHAOS MODE ADMIN ENDPOINTS ---

// POST /admin/nodes/:id/fail
fastify.post('/admin/nodes/:id/fail', async (request, reply) => {
  const { id } = request.params as { id: string };
  const node = await dbRepo.getNodeById(id);
  if (!node) return reply.code(404).send({ error: 'NODE_NOT_FOUND' });

  // Update node in DB
  node.status = 'FAILED';
  node.failureCount += 1;
  node.riskScore = 1.0;
  await dbRepo.upsertNode(node);

  // Notify node's internal simulation endpoint
  try {
    await fetch(`${node.address}/admin/simulation/fail`, { method: 'POST' });
  } catch {}

  console.log(`[Chaos] Simulating node failure for ${node.name} (${id})`);

  // Auto-provision dynamic new storage node if cluster is at risk
  const provisionedNode = await checkAndAutoProvisionNodes();

  // Trigger self-healing recovery engine immediately
  const recoveryResult = await recoveryEngine.checkAndRepairCluster();

  return {
    nodeId: id,
    status: 'FAILED',
    recoveryTriggered: true,
    repairedJobs: recoveryResult.repairedJobs,
    errors: recoveryResult.errors
  };
});

// POST /admin/nodes/:id/recover
fastify.post('/admin/nodes/:id/recover', async (request, reply) => {
  const { id } = request.params as { id: string };
  const node = await dbRepo.getNodeById(id);
  if (!node) return reply.code(404).send({ error: 'NODE_NOT_FOUND' });

  node.status = 'HEALTHY';
  node.riskScore = calculateRiskScore(node);
  await dbRepo.upsertNode(node);

  try {
    await fetch(`${node.address}/admin/simulation/recover`, { method: 'POST' });
  } catch {}

  console.log(`[Chaos] Recovered node ${node.name} (${id})`);
  return { nodeId: id, status: 'HEALTHY' };
});

// POST /admin/replicas/:id/corrupt
fastify.post('/admin/replicas/:id/corrupt', async (request, reply) => {
  const { id } = request.params as { id: string };
  const replicas = await dbRepo.getAllReplicas();
  const rep = replicas.find(r => r.id === id);

  if (!rep) return reply.code(404).send({ error: 'REPLICA_NOT_FOUND' });

  const node = await dbRepo.getNodeById(rep.nodeId);
  if (!node) return reply.code(404).send({ error: 'NODE_NOT_FOUND' });

  // Tell node to corrupt replica file on disk
  try {
    await fetch(`${node.address}/internal/objects/${rep.objectId}/corrupt`, { method: 'POST' });
  } catch (err: any) {
    return reply.code(500).send({ error: 'CORRUPTION_FAILED', message: err.message });
  }

  // Mark replica CORRUPTED in DB
  await dbRepo.updateReplicaStatus(rep.id, 'CORRUPTED');

  console.log(`[Chaos] Corrupted replica ${rep.id} on node ${node.name}`);

  // Automatically trigger integrity verification & auto-repair
  const verificationResult = await recoveryEngine.verifyObjectIntegrity(rep.objectId);

  return {
    replicaId: id,
    status: 'CORRUPTED',
    verified: verificationResult.verified,
    repaired: verificationResult.repaired
  };
});

// POST /admin/nodes/deprovision-excess - Remove idle empty auto-provisioned nodes
fastify.post('/admin/nodes/deprovision-excess', async (request, reply) => {
  const deprovisioned = await deprovisionExcessAutoNodes();
  return {
    deprovisioned,
    message: deprovisioned > 0
      ? `Removed ${deprovisioned} idle auto-provisioned node(s)`
      : 'No excess idle nodes to remove'
  };
});

// POST /admin/nodes/provision - Dynamic Node Auto-Provisioner
fastify.post('/admin/nodes/provision', async (request, reply) => {
  const newNode = await checkAndAutoProvisionNodes();
  if (newNode) {
    const recoveryResult = await recoveryEngine.checkAndRepairCluster();
    return {
      provisioned: true,
      node: newNode,
      repairedJobs: recoveryResult.repairedJobs
    };
  }
  return { provisioned: false, message: 'Enough healthy nodes already exist' };
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`[Vault Control Plane] listening at ${address}`);
});
