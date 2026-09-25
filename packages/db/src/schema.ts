import { pgTable, text, integer, bigint, real, timestamp } from 'drizzle-orm/pg-core';

export const nodes = pgTable('nodes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  status: text('status').notNull().default('HEALTHY'),
  capacity: bigint('capacity', { mode: 'number' }).notNull().default(10737418240), // 10 GB
  usedStorage: bigint('used_storage', { mode: 'number' }).notNull().default(0),
  failureCount: integer('failure_count').notNull().default(0),
  load: real('load').notNull().default(0.1),
  riskScore: real('risk_score').notNull().default(0.0),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const objects = pgTable('objects', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  contentType: text('content_type').notNull(),
  checksum: text('checksum').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const replicas = pgTable('replicas', {
  id: text('id').primaryKey(),
  objectId: text('object_id').notNull().references(() => objects.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  checksum: text('checksum').notNull(),
  status: text('status').notNull().default('HEALTHY'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const repairJobs = pgTable('repair_jobs', {
  id: text('id').primaryKey(),
  objectId: text('object_id').notNull().references(() => objects.id, { onDelete: 'cascade' }),
  sourceNodeId: text('source_node_id').references(() => nodes.id, { onDelete: 'set null' }),
  destinationNodeId: text('destination_node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  priority: integer('priority').notNull().default(1),
  status: text('status').notNull().default('PENDING'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
