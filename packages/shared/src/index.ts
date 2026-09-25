export type NodeStatus = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'RECOVERING';
export type ReplicaStatus = 'HEALTHY' | 'CORRUPTED' | 'MISSING' | 'REPAIRING';
export type RepairJobStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type RepairReason = 'NODE_FAILURE' | 'CHECKSUM_MISMATCH' | 'REBALANCE' | 'MISSING_REPLICA';

export interface StorageNodeModel {
  id: string;
  name: string;
  address: string;
  status: NodeStatus;
  capacity: bigint | number;
  usedStorage: bigint | number;
  failureCount: number;
  load: number;
  riskScore: number;
  lastHeartbeat: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface ObjectModel {
  id: string;
  filename: string;
  size: number;
  contentType: string;
  checksum: string;
  version: number;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface ReplicaModel {
  id: string;
  objectId: string;
  nodeId: string;
  version: number;
  checksum: string;
  status: ReplicaStatus;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface RepairJobModel {
  id: string;
  objectId: string;
  sourceNodeId?: string | null;
  destinationNodeId: string;
  reason: RepairReason;
  priority: number;
  status: RepairJobStatus;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  createdAt?: Date | string;
}

export interface ClusterHealthSummary {
  totalNodes: number;
  healthyNodes: number;
  degradedNodes: number;
  failedNodes: number;
  totalObjects: number;
  totalReplicas: number;
  healthyReplicas: number;
  corruptedReplicas: number;
  missingReplicas: number;
  totalCapacity: number;
  usedStorage: number;
  activeRepairJobs: number;
  avgRecoveryTimeSec?: number;
}

export const DEFAULT_REPLICATION_FACTOR = 3;

/**
 * Calculates Risk Score for a Node (0.0 to 1.0, lower is better/healthier).
 * Score calculation based on:
 * - Health status penalty
 * - Failure history count
 * - Storage usage percentage
 * - Current load
 */
export function calculateRiskScore(node: {
  status: NodeStatus;
  capacity: number | bigint;
  usedStorage: number | bigint;
  failureCount: number;
  load: number;
}): number {
  if (node.status === 'FAILED') return 1.0;
  
  let healthPenalty = 0;
  if (node.status === 'DEGRADED') healthPenalty = 0.4;
  if (node.status === 'RECOVERING') healthPenalty = 0.2;

  const cap = Number(node.capacity);
  const used = Number(node.usedStorage);
  const usageRatio = cap > 0 ? used / cap : 0;
  const failurePenalty = Math.min(node.failureCount * 0.15, 0.45);
  const loadPenalty = Math.min(node.load * 0.2, 0.2);

  const rawScore = (healthPenalty * 0.4) + (usageRatio * 0.25) + (failurePenalty * 0.2) + (loadPenalty * 0.15);
  return Math.min(Math.max(Number(rawScore.toFixed(3)), 0), 1.0);
}
