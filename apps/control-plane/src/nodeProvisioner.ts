import { dbRepo } from '@vault/db';
import { StorageNodeModel } from '@vault/shared';
import { createStorageNodeServer } from '@vault/storage-node';

let nextPort = 5005;
let nextNodeIndex = 5;
let lastProvisionTime = 0;
const PROVISION_COOLDOWN_MS = 3000; // Minimum 3 seconds between auto-spawns
const MAX_AUTO_NODES = 20;          // Max 20 auto-provisioned dynamic storage nodes
const BASE_NODE_COUNT = 4;          // The 4 permanent seed nodes (node-1 … node-4)

// Track which in-process node servers were launched so we can stop re-launching them
const runningAutoNodeIds = new Set<string>();

/**
 * Startup: remove DB records for auto-provisioned nodes that are no longer reachable.
 */
export async function cleanupStaleAutoNodes() {
  try {
    const allNodes = await dbRepo.getAllNodes();
    const autoNodes = allNodes.filter(n => n.id.startsWith('node-auto-'));
    for (const node of autoNodes) {
      try {
        const res = await fetch(`${node.address}/internal/health`);
        if (!res.ok) {
          await dbRepo.deleteNode(node.id);
          console.log(`[Auto-Provisioner] Cleaned up dead auto node record ${node.id}`);
        }
      } catch {
        await dbRepo.deleteNode(node.id);
        console.log(`[Auto-Provisioner] Cleaned up unreachable auto node record ${node.id}`);
      }
    }
  } catch (err) {}
}

/**
 * Provision a new storage node in-process if the cluster has fewer than 3 healthy nodes.
 */
export async function checkAndAutoProvisionNodes(): Promise<StorageNodeModel | null> {
  const now = Date.now();
  if (now - lastProvisionTime < PROVISION_COOLDOWN_MS) {
    return null; // Cooldown active
  }

  const allNodes = await dbRepo.getAllNodes();
  const healthyNodes = allNodes.filter(n => n.status === 'HEALTHY');
  const autoNodesCount = allNodes.filter(n => n.id.startsWith('node-auto-')).length;

  if (autoNodesCount >= MAX_AUTO_NODES) {
    return null; // Safeguard limit reached
  }

  // If healthy nodes drop below 3, dynamically provision a new storage node instance!
  if (healthyNodes.length < 3) {
    lastProvisionTime = now;
    const nodeId = `node-auto-${nextNodeIndex}`;
    const nodeName = `Storage Node ${nextNodeIndex} (Auto-Provisioned)`;
    const port = nextPort;

    nextPort++;
    nextNodeIndex++;

    console.log(`[Auto-Provisioner] ⚡ Provisioning dynamic storage microservice ${nodeName} on port ${port}...`);

    try {
      // Launch storage node server in-process (no CMD windows)
      createStorageNodeServer({ port, nodeId, nodeName });
      runningAutoNodeIds.add(nodeId);

      // Poll node health endpoint briefly to ensure server is listening
      let isReady = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 100));
        try {
          const res = await fetch(`http://localhost:${port}/internal/health`);
          if (res.ok) {
            isReady = true;
            break;
          }
        } catch {}
      }

      const newNode: StorageNodeModel = {
        id: nodeId,
        name: nodeName,
        address: `http://localhost:${port}`,
        status: 'HEALTHY',
        capacity: 10 * 1024 * 1024 * 1024,
        usedStorage: 0,
        failureCount: 0,
        load: 0.05,
        riskScore: 0.02,
        lastHeartbeat: new Date().toISOString()
      };

      // Register new node in database
      await dbRepo.upsertNode(newNode);
      console.log(`[Auto-Provisioner] ✅ Registered and started ${nodeName} on ${newNode.address}!`);

      return newNode;
    } catch (err: any) {
      console.error(`[Auto-Provisioner] Failed to provision node:`, err.message);
    }
  }

  return null;
}

/**
 * Deprovision excess auto-provisioned nodes that:
 *   1. Hold ZERO replicas (no data on them), AND
 *   2. The cluster has more healthy nodes than it strictly needs (> BASE_NODE_COUNT)
 *
 * This is called after every object deletion and during each heartbeat cycle.
 */
export async function deprovisionExcessAutoNodes(): Promise<number> {
  let deprovisioned = 0;
  try {
    const allNodes = await dbRepo.getAllNodes();
    const allReplicas = await dbRepo.getAllReplicas();

    const healthyNodes = allNodes.filter(n => n.status === 'HEALTHY');

    // Only deprovision if we have more than BASE_NODE_COUNT healthy nodes
    if (healthyNodes.length <= BASE_NODE_COUNT) {
      return 0;
    }

    // Identify auto-provisioned nodes that are healthy but empty (0 replicas)
    const autoNodes = allNodes.filter(n => n.id.startsWith('node-auto-') && n.status === 'HEALTHY');

    // Build a set of node IDs that still have replicas
    const nodesWithReplicas = new Set(allReplicas.map(r => r.nodeId));

    for (const node of autoNodes) {
      // Stop deprovisioning once we're back at BASE_NODE_COUNT healthy nodes
      const currentHealthyCount = (await dbRepo.getAllNodes()).filter(n => n.status === 'HEALTHY').length;
      if (currentHealthyCount <= BASE_NODE_COUNT) break;

      // Only deprovision if this node holds zero replicas
      if (!nodesWithReplicas.has(node.id)) {
        console.log(`[Auto-Provisioner] 🗑️  Deprovisioning empty auto node ${node.id} (0 replicas, excess capacity).`);
        await dbRepo.deleteNode(node.id);
        runningAutoNodeIds.delete(node.id);
        deprovisioned++;
      }
    }

    if (deprovisioned > 0) {
      console.log(`[Auto-Provisioner] Deprovisioned ${deprovisioned} excess auto node(s). Cluster rightsized.`);
    }
  } catch (err: any) {
    console.error('[Auto-Provisioner] Error during deprovisioning:', err.message);
  }
  return deprovisioned;
}
