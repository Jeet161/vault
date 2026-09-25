import { StorageNodeModel, ObjectModel, ReplicaModel, RepairJobModel, NodeStatus, ReplicaStatus, RepairJobStatus } from '@vault/shared';
import * as schema from './schema.js';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, desc } from 'drizzle-orm';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

export * from './schema.js';

let dbClient: any = null;
let sqlQuery: any = null;
let isDbConnected = false;

if (process.env.DATABASE_URL) {
  try {
    sqlQuery = neon(process.env.DATABASE_URL);
    dbClient = drizzle(sqlQuery, { schema });
    isDbConnected = true;
    console.log('[Database] Connected to Neon PostgreSQL via Serverless HTTP driver!');
  } catch (err: any) {
    console.warn('[Database] Neon connection setup error:', err.message);
  }
}

export class VaultRepository {
  private nodesMap: Map<string, StorageNodeModel> = new Map();
  private objectsMap: Map<string, ObjectModel> = new Map();
  private replicasMap: Map<string, ReplicaModel> = new Map();
  private repairJobsMap: Map<string, RepairJobModel> = new Map();

  constructor() {
    this.seedDefaultNodes();
    if (sqlQuery) {
      this.initDbTables();
    }
  }

  private async initDbTables() {
    if (!sqlQuery) return;
    try {
      await sqlQuery`
        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          address TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'HEALTHY',
          capacity BIGINT NOT NULL DEFAULT 10737418240,
          used_storage BIGINT NOT NULL DEFAULT 0,
          failure_count INT NOT NULL DEFAULT 0,
          load REAL NOT NULL DEFAULT 0.1,
          risk_score REAL NOT NULL DEFAULT 0.0,
          last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      await sqlQuery`
        CREATE TABLE IF NOT EXISTS objects (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          size BIGINT NOT NULL,
          content_type TEXT NOT NULL,
          checksum TEXT NOT NULL,
          version INT NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      await sqlQuery`
        CREATE TABLE IF NOT EXISTS replicas (
          id TEXT PRIMARY KEY,
          object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
          node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
          version INT NOT NULL DEFAULT 1,
          checksum TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'HEALTHY',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      await sqlQuery`
        CREATE TABLE IF NOT EXISTS repair_jobs (
          id TEXT PRIMARY KEY,
          object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
          source_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
          destination_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          priority INT NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'PENDING',
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      for (const n of this.nodesMap.values()) {
        await this.upsertNode(n);
      }
      console.log('[Database] Neon PostgreSQL cloud tables created & synchronized successfully!');
    } catch (err: any) {
      console.warn('[Database] Error initializing Neon DB tables:', err.message || err);
    }
  }

  private seedDefaultNodes() {
    const defaultNodes: StorageNodeModel[] = [
      {
        id: 'node-1',
        name: 'Storage Node 1',
        address: 'http://localhost:5001',
        status: 'HEALTHY',
        capacity: 10 * 1024 * 1024 * 1024,
        usedStorage: 0,
        failureCount: 0,
        load: 0.1,
        riskScore: 0.05,
        lastHeartbeat: new Date().toISOString()
      },
      {
        id: 'node-2',
        name: 'Storage Node 2',
        address: 'http://localhost:5002',
        status: 'HEALTHY',
        capacity: 10 * 1024 * 1024 * 1024,
        usedStorage: 0,
        failureCount: 0,
        load: 0.12,
        riskScore: 0.06,
        lastHeartbeat: new Date().toISOString()
      },
      {
        id: 'node-3',
        name: 'Storage Node 3',
        address: 'http://localhost:5003',
        status: 'HEALTHY',
        capacity: 10 * 1024 * 1024 * 1024,
        usedStorage: 0,
        failureCount: 0,
        load: 0.08,
        riskScore: 0.04,
        lastHeartbeat: new Date().toISOString()
      },
      {
        id: 'node-4',
        name: 'Storage Node 4',
        address: 'http://localhost:5004',
        status: 'HEALTHY',
        capacity: 10 * 1024 * 1024 * 1024,
        usedStorage: 0,
        failureCount: 0,
        load: 0.15,
        riskScore: 0.07,
        lastHeartbeat: new Date().toISOString()
      }
    ];

    for (const n of defaultNodes) {
      this.nodesMap.set(n.id, n);
    }
  }

  // --- NODES ---
  async getAllNodes(): Promise<StorageNodeModel[]> {
    if (isDbConnected && dbClient) {
      try {
        const rows = await dbClient.select().from(schema.nodes);
        if (rows.length > 0) {
          return rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            address: r.address,
            status: r.status as NodeStatus,
            capacity: Number(r.capacity),
            usedStorage: Number(r.usedStorage),
            failureCount: r.failureCount,
            load: r.load,
            riskScore: r.riskScore,
            lastHeartbeat: r.lastHeartbeat ? new Date(r.lastHeartbeat).toISOString() : new Date().toISOString()
          }));
        }
      } catch (err) {}
    }
    return Array.from(this.nodesMap.values());
  }

  async getNodeById(id: string): Promise<StorageNodeModel | null> {
    if (isDbConnected && dbClient) {
      try {
        const rows = await dbClient.select().from(schema.nodes).where(eq(schema.nodes.id, id));
        if (rows.length > 0) {
          const r = rows[0];
          return {
            id: r.id,
            name: r.name,
            address: r.address,
            status: r.status as NodeStatus,
            capacity: Number(r.capacity),
            usedStorage: Number(r.usedStorage),
            failureCount: r.failureCount,
            load: r.load,
            riskScore: r.riskScore,
            lastHeartbeat: r.lastHeartbeat ? new Date(r.lastHeartbeat).toISOString() : new Date().toISOString()
          };
        }
      } catch (err) {}
    }
    return this.nodesMap.get(id) || null;
  }

  async upsertNode(node: StorageNodeModel): Promise<StorageNodeModel> {
    const existing = this.nodesMap.get(node.id);
    const updated: StorageNodeModel = {
      ...existing,
      ...node,
      updatedAt: new Date().toISOString()
    };
    this.nodesMap.set(node.id, updated);

    if (isDbConnected && dbClient) {
      try {
        await dbClient.insert(schema.nodes).values({
          id: node.id,
          name: node.name,
          address: node.address,
          status: node.status,
          capacity: Number(node.capacity),
          usedStorage: Number(node.usedStorage),
          failureCount: node.failureCount,
          load: node.load,
          riskScore: node.riskScore,
          lastHeartbeat: new Date(node.lastHeartbeat)
        }).onConflictDoUpdate({
          target: schema.nodes.id,
          set: {
            status: node.status,
            usedStorage: Number(node.usedStorage),
            failureCount: node.failureCount,
            load: node.load,
            riskScore: node.riskScore,
            lastHeartbeat: new Date(node.lastHeartbeat),
            updatedAt: new Date()
          }
        });
      } catch (err) {}
    }
    return updated;
  }

  async deleteNode(id: string): Promise<boolean> {
    this.nodesMap.delete(id);
    if (isDbConnected && dbClient) {
      try {
        await dbClient.delete(schema.nodes).where(eq(schema.nodes.id, id));
      } catch (err) {}
    }
    return true;
  }

  // --- OBJECTS ---
  async getAllObjects(): Promise<ObjectModel[]> {
    if (isDbConnected && dbClient) {
      try {
        const rows = await dbClient.select().from(schema.objects);
        return rows.map((r: any) => ({
          id: r.id,
          filename: r.filename,
          size: Number(r.size),
          contentType: r.contentType,
          checksum: r.checksum,
          version: r.version
        }));
      } catch (err) {}
    }
    return Array.from(this.objectsMap.values());
  }

  async getObjectById(id: string): Promise<ObjectModel | null> {
    if (isDbConnected && dbClient) {
      try {
        const rows = await dbClient.select().from(schema.objects).where(eq(schema.objects.id, id));
        if (rows.length > 0) {
          const r = rows[0];
          return {
            id: r.id,
            filename: r.filename,
            size: Number(r.size),
            contentType: r.contentType,
            checksum: r.checksum,
            version: r.version
          };
        }
      } catch (err) {}
    }
    return this.objectsMap.get(id) || null;
  }

  async createObject(obj: ObjectModel): Promise<ObjectModel> {
    this.objectsMap.set(obj.id, obj);
    if (isDbConnected && dbClient) {
      try {
        await dbClient.insert(schema.objects).values({
          id: obj.id,
          filename: obj.filename,
          size: Number(obj.size),
          contentType: obj.contentType,
          checksum: obj.checksum,
          version: obj.version
        });
      } catch (err) {}
    }
    return obj;
  }

  async deleteObject(id: string): Promise<boolean> {
    for (const [repId, rep] of this.replicasMap.entries()) {
      if (rep.objectId === id) {
        this.replicasMap.delete(repId);
      }
    }
    this.objectsMap.delete(id);

    if (isDbConnected && dbClient) {
      try {
        await dbClient.delete(schema.objects).where(eq(schema.objects.id, id));
      } catch (err) {}
    }
    return true;
  }

  // --- REPLICAS ---
  async getAllReplicas(): Promise<ReplicaModel[]> {
    if (isDbConnected && dbClient) {
      try {
        const rows = await dbClient.select().from(schema.replicas);
        return rows.map((r: any) => ({
          id: r.id,
          objectId: r.objectId,
          nodeId: r.nodeId,
          version: r.version,
          checksum: r.checksum,
          status: r.status as ReplicaStatus
        }));
      } catch (err) {}
    }
    return Array.from(this.replicasMap.values());
  }

  async getReplicasByObjectId(objectId: string): Promise<ReplicaModel[]> {
    if (isDbConnected && dbClient) {
      try {
        const rows = await dbClient.select().from(schema.replicas).where(eq(schema.replicas.objectId, objectId));
        return rows.map((r: any) => ({
          id: r.id,
          objectId: r.objectId,
          nodeId: r.nodeId,
          version: r.version,
          checksum: r.checksum,
          status: r.status as ReplicaStatus
        }));
      } catch (err) {}
    }
    return Array.from(this.replicasMap.values()).filter(r => r.objectId === objectId);
  }

  async getReplicasByNodeId(nodeId: string): Promise<ReplicaModel[]> {
    if (isDbConnected && dbClient) {
      try {
        const rows = await dbClient.select().from(schema.replicas).where(eq(schema.replicas.nodeId, nodeId));
        return rows.map((r: any) => ({
          id: r.id,
          objectId: r.objectId,
          nodeId: r.nodeId,
          version: r.version,
          checksum: r.checksum,
          status: r.status as ReplicaStatus
        }));
      } catch (err) {}
    }
    return Array.from(this.replicasMap.values()).filter(r => r.nodeId === nodeId);
  }

  async createReplica(replica: ReplicaModel): Promise<ReplicaModel> {
    this.replicasMap.set(replica.id, replica);
    if (isDbConnected && dbClient) {
      try {
        await dbClient.insert(schema.replicas).values({
          id: replica.id,
          objectId: replica.objectId,
          nodeId: replica.nodeId,
          version: replica.version,
          checksum: replica.checksum,
          status: replica.status
        });
      } catch (err) {}
    }
    return replica;
  }

  async updateReplicaStatus(id: string, status: ReplicaStatus): Promise<ReplicaModel | null> {
    const rep = this.replicasMap.get(id);
    if (rep) {
      rep.status = status;
      this.replicasMap.set(id, rep);
    }
    if (isDbConnected && dbClient) {
      try {
        await dbClient.update(schema.replicas).set({ status, updatedAt: new Date() }).where(eq(schema.replicas.id, id));
      } catch (err) {}
    }
    return rep || null;
  }

  async deleteReplica(id: string): Promise<boolean> {
    this.replicasMap.delete(id);
    if (isDbConnected && dbClient) {
      try {
        await dbClient.delete(schema.replicas).where(eq(schema.replicas.id, id));
      } catch (err) {}
    }
    return true;
  }

  // --- REPAIR JOBS ---
  async getAllRepairJobs(): Promise<RepairJobModel[]> {
    if (isDbConnected && dbClient) {
      try {
        const rows = await dbClient.select().from(schema.repairJobs).orderBy(desc(schema.repairJobs.createdAt));
        return rows.map((r: any) => ({
          id: r.id,
          objectId: r.objectId,
          sourceNodeId: r.sourceNodeId,
          destinationNodeId: r.destinationNodeId,
          reason: r.reason,
          priority: r.priority,
          status: r.status as RepairJobStatus,
          startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
          completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
          createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString()
        }));
      } catch (err) {}
    }
    return Array.from(this.repairJobsMap.values()).sort((a, b) => 
      new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime()
    );
  }

  async createRepairJob(job: RepairJobModel): Promise<RepairJobModel> {
    this.repairJobsMap.set(job.id, job);
    if (isDbConnected && dbClient) {
      try {
        await dbClient.insert(schema.repairJobs).values({
          id: job.id,
          objectId: job.objectId,
          sourceNodeId: job.sourceNodeId,
          destinationNodeId: job.destinationNodeId,
          reason: job.reason,
          priority: job.priority,
          status: job.status,
          startedAt: job.startedAt ? new Date(job.startedAt) : null
        });
      } catch (err) {}
    }
    return job;
  }

  async updateRepairJobStatus(id: string, status: RepairJobStatus): Promise<RepairJobModel | null> {
    const job = this.repairJobsMap.get(id);
    if (job) {
      job.status = status;
      if (status === 'IN_PROGRESS' && !job.startedAt) job.startedAt = new Date().toISOString();
      if ((status === 'COMPLETED' || status === 'FAILED') && !job.completedAt) job.completedAt = new Date().toISOString();
      this.repairJobsMap.set(id, job);
    }

    if (isDbConnected && dbClient) {
      try {
        await dbClient.update(schema.repairJobs).set({
          status,
          completedAt: (status === 'COMPLETED' || status === 'FAILED') ? new Date() : null
        }).where(eq(schema.repairJobs.id, id));
      } catch (err) {}
    }
    return job || null;
  }
}

export const dbRepo = new VaultRepository();
