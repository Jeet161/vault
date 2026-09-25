import { dbRepo } from '@vault/db';
import { placementEngine } from './placementEngine.js';
import { ReplicaModel, RepairJobModel, DEFAULT_REPLICATION_FACTOR } from '@vault/shared';
import fetch from 'node-fetch';
import crypto from 'node:crypto';

export class RecoveryEngine {
  private isProcessing = false;

  /**
   * Scans cluster state for failed nodes or missing/corrupted replicas and triggers self-healing repairs.
   */
  async checkAndRepairCluster(): Promise<{ repairedJobs: number; errors: string[] }> {
    if (this.isProcessing) return { repairedJobs: 0, errors: [] };
    this.isProcessing = true;
    const errors: string[] = [];
    let repairedJobsCount = 0;

    try {
      const allObjects = await dbRepo.getAllObjects();
      const allNodes = await dbRepo.getAllNodes();
      const nodeMap = new Map(allNodes.map(n => [n.id, n]));

      for (const obj of allObjects) {
        const replicas = await dbRepo.getReplicasByObjectId(obj.id);
        const healthyReplicas: ReplicaModel[] = [];
        const unhealthyReplicas: ReplicaModel[] = [];

        for (const rep of replicas) {
          const node = nodeMap.get(rep.nodeId);
          if (!node || node.status === 'FAILED' || rep.status === 'CORRUPTED' || rep.status === 'MISSING') {
            unhealthyReplicas.push(rep);
          } else {
            healthyReplicas.push(rep);
          }
        }

        // Check if object needs replication repair
        const requiredNewReplicas = DEFAULT_REPLICATION_FACTOR - healthyReplicas.length;

        if (requiredNewReplicas > 0) {
          if (healthyReplicas.length === 0) {
            errors.push(`CRITICAL: Object ${obj.id} (${obj.filename}) has ZERO healthy replicas left!`);
            continue;
          }

          // Pick a source node with a healthy replica
          const sourceReplica = healthyReplicas[0];
          const sourceNode = nodeMap.get(sourceReplica.nodeId);

          if (!sourceNode) continue;

          // Exclude nodes that already have replicas of this object
          const excludeNodeIds = replicas.map(r => r.nodeId);
          const targetNodes = await placementEngine.selectNodes(requiredNewReplicas, excludeNodeIds);

          for (const targetNode of targetNodes) {
            const jobId = `repair-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const job: RepairJobModel = {
              id: jobId,
              objectId: obj.id,
              sourceNodeId: sourceNode.id,
              destinationNodeId: targetNode.id,
              reason: 'NODE_FAILURE',
              priority: 1,
              status: 'IN_PROGRESS',
              startedAt: new Date().toISOString()
            };
            await dbRepo.createRepairJob(job);

            try {
              // 1. Fetch object from healthy source node
              const getRes = await fetch(`${sourceNode.address}/internal/objects/${obj.id}`);
              if (!getRes.ok) {
                throw new Error(`Failed to fetch object from source node ${sourceNode.id}: ${getRes.statusText}`);
              }
              const buffer = Buffer.from(await getRes.arrayBuffer());

              // 2. Verify source checksum
              const computedChecksum = crypto.createHash('sha256').update(buffer).digest('hex');
              if (computedChecksum !== obj.checksum) {
                throw new Error(`Source replica on node ${sourceNode.id} checksum mismatch! Expected ${obj.checksum}, got ${computedChecksum}`);
              }

              // 3. Put replica on destination node
              const putRes = await fetch(`${targetNode.address}/internal/objects/${obj.id}`, {
                method: 'PUT',
                body: buffer,
                headers: { 'Content-Type': 'application/octet-stream' }
              });

              if (!putRes.ok) {
                throw new Error(`Failed to write replica to destination node ${targetNode.id}: ${putRes.statusText}`);
              }

              const putData: any = await putRes.json();

              // 4. Verify destination checksum match
              if (putData.checksum !== obj.checksum) {
                throw new Error(`Destination node ${targetNode.id} returned mismatched checksum ${putData.checksum}`);
              }

              // 5. Create new replica entry in metadata DB
              const newReplica: ReplicaModel = {
                id: `rep-${obj.id.slice(0, 8)}-${targetNode.id}`,
                objectId: obj.id,
                nodeId: targetNode.id,
                version: obj.version,
                checksum: obj.checksum,
                status: 'HEALTHY'
              };
              await dbRepo.createReplica(newReplica);

              // 6. Complete repair job
              await dbRepo.updateRepairJobStatus(jobId, 'COMPLETED');
              repairedJobsCount++;

              console.log(`[Self-Healing] Successfully repaired replica for object ${obj.filename} on ${targetNode.name}`);
            } catch (err: any) {
              await dbRepo.updateRepairJobStatus(jobId, 'FAILED');
              errors.push(`Repair job ${jobId} failed: ${err.message}`);
            }
          }

          // Clean up metadata of unhealthy replicas that were replaced
          for (const unrep of unhealthyReplicas) {
            await dbRepo.deleteReplica(unrep.id);
          }
        }
      }
    } catch (globalErr: any) {
      errors.push(`Recovery cycle error: ${globalErr.message}`);
    } finally {
      this.isProcessing = false;
    }

    return { repairedJobs: repairedJobsCount, errors };
  }

  /**
   * Performs SHA-256 integrity audit across all replicas of an object.
   */
  async verifyObjectIntegrity(objectId: string): Promise<{ verified: boolean; corruptedCount: number; repaired: boolean }> {
    const obj = await dbRepo.getObjectById(objectId);
    if (!obj) throw new Error('Object not found');

    const replicas = await dbRepo.getReplicasByObjectId(objectId);
    const allNodes = await dbRepo.getAllNodes();
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    let corruptedCount = 0;

    for (const rep of replicas) {
      const node = nodeMap.get(rep.nodeId);
      if (!node || node.status === 'FAILED') continue;

      try {
        const headRes = await fetch(`${node.address}/internal/objects/${obj.id}`, { method: 'HEAD' });
        if (!headRes.ok) {
          await dbRepo.updateReplicaStatus(rep.id, 'MISSING');
          corruptedCount++;
          continue;
        }

        const currentChecksum = headRes.headers.get('x-checksum');
        if (currentChecksum && currentChecksum !== obj.checksum) {
          console.warn(`[Integrity] Checksum mismatch detected on node ${node.id} for object ${obj.id}! Expected ${obj.checksum}, got ${currentChecksum}`);
          await dbRepo.updateReplicaStatus(rep.id, 'CORRUPTED');
          corruptedCount++;
        }
      } catch (err) {
        await dbRepo.updateReplicaStatus(rep.id, 'MISSING');
        corruptedCount++;
      }
    }

    let repaired = false;
    if (corruptedCount > 0) {
      console.log(`[Integrity] ${corruptedCount} corrupted/missing replicas found for ${obj.filename}. Triggering auto-repair...`);
      const repairRes = await this.checkAndRepairCluster();
      if (repairRes.repairedJobs > 0) {
        repaired = true;
      }
    }

    return {
      verified: corruptedCount === 0,
      corruptedCount,
      repaired
    };
  }
}

export const recoveryEngine = new RecoveryEngine();
