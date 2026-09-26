import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createStorageNodeServer(options: { port: number; nodeId: string; nodeName?: string }) {
  const { port, nodeId } = options;
  const nodeName = options.nodeName || `Storage Node (${nodeId})`;

  const DATA_DIR = path.resolve(process.cwd(), 'data', nodeId, 'objects');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const fastify = Fastify({ logger: false, bodyLimit: 500 * 1024 * 1024 });
  fastify.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });

  // Register raw buffer parser for PUT requests
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });

  let isFailed = false;
  let isSlow = false;

  // Middleware for failure simulation
  fastify.addHook('onRequest', async (request, reply) => {
    if (isFailed && !request.url.includes('/admin/simulation')) {
      reply.code(503).send({ error: 'STORAGE_NODE_FAILED', message: `Node ${nodeId} is simulated FAILED` });
      return;
    }
    if (isSlow) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  });

  // GET /internal/health
  fastify.get('/internal/health', async () => {
    let usedStorage = 0;
    try {
      const files = fs.readdirSync(DATA_DIR);
      for (const file of files) {
        const stat = fs.statSync(path.join(DATA_DIR, file));
        if (stat.isFile()) usedStorage += stat.size;
      }
    } catch (err) {}

    return {
      nodeId,
      name: nodeName,
      status: isFailed ? 'FAILED' : 'HEALTHY',
      capacity: 10 * 1024 * 1024 * 1024, // 10 GB
      usedStorage,
      load: Math.min(0.05 + (usedStorage / (10 * 1024 * 1024 * 1024)), 1.0),
      timestamp: new Date().toISOString()
    };
  });

  // PUT /internal/objects/:objectId
  fastify.put('/internal/objects/:objectId', async (request, reply) => {
    const { objectId } = request.params as { objectId: string };
    const sanitizedId = path.basename(objectId);
    const targetPath = path.join(DATA_DIR, sanitizedId);
    const tempPath = path.join(DATA_DIR, `${sanitizedId}.${Date.now()}.tmp`);

    try {
      let rawBuffer: Buffer | null = null;

      if (Buffer.isBuffer(request.body)) {
        rawBuffer = request.body;
      } else {
        const data = await request.file();
        if (data) {
          rawBuffer = await data.toBuffer();
        }
      }

      if (!rawBuffer) {
        return reply.code(400).send({ error: 'NO_FILE_PROVIDED' });
      }

      const hash = crypto.createHash('sha256').update(rawBuffer).digest('hex');
      fs.writeFileSync(tempPath, rawBuffer);
      const stats = fs.statSync(tempPath);

      // Atomic rename
      fs.renameSync(tempPath, targetPath);

      return {
        objectId: sanitizedId,
        checksum: hash,
        size: stats.size,
        status: 'STORED'
      };
    } catch (err: any) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
      return reply.code(500).send({ error: 'WRITE_FAILED', message: err.message });
    }
  });

  // GET /internal/objects/:objectId
  fastify.get('/internal/objects/:objectId', async (request, reply) => {
    const { objectId } = request.params as { objectId: string };
    const targetPath = path.join(DATA_DIR, path.basename(objectId));

    if (!fs.existsSync(targetPath)) {
      return reply.code(404).send({ error: 'OBJECT_NOT_FOUND' });
    }

    const stream = fs.createReadStream(targetPath);
    return reply.send(stream);
  });

  // HEAD /internal/objects/:objectId
  fastify.head('/internal/objects/:objectId', async (request, reply) => {
    const { objectId } = request.params as { objectId: string };
    const targetPath = path.join(DATA_DIR, path.basename(objectId));

    if (!fs.existsSync(targetPath)) {
      return reply.code(404).send();
    }

    const stats = fs.statSync(targetPath);
    const fileBuffer = fs.readFileSync(targetPath);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    reply.header('x-checksum', checksum);
    reply.header('content-length', stats.size.toString());
    return reply.send();
  });

  // DELETE /internal/objects/:objectId
  fastify.delete('/internal/objects/:objectId', async (request, reply) => {
    const { objectId } = request.params as { objectId: string };
    const targetPath = path.join(DATA_DIR, path.basename(objectId));

    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }

    return { objectId, status: 'DELETED' };
  });

  // POST /internal/objects/:objectId/corrupt (Chaos API)
  fastify.post('/internal/objects/:objectId/corrupt', async (request, reply) => {
    const { objectId } = request.params as { objectId: string };
    const targetPath = path.join(DATA_DIR, path.basename(objectId));

    if (!fs.existsSync(targetPath)) {
      return reply.code(404).send({ error: 'OBJECT_NOT_FOUND' });
    }

    // Mutate first 8 bytes on disk to introduce bit rot
    const buffer = fs.readFileSync(targetPath);
    if (buffer.length > 0) {
      buffer[0] = buffer[0] ^ 0xFF; // Flip bits of first byte
      fs.writeFileSync(targetPath, buffer);
    } else {
      fs.writeFileSync(targetPath, Buffer.from('CORRUPTED_BYTES'));
    }

    return { objectId, status: 'CORRUPTED_ON_DISK' };
  });

  // Admin Simulation Hooks
  fastify.post('/admin/simulation/fail', async () => {
    isFailed = true;
    return { nodeId, status: 'FAILED' };
  });

  fastify.post('/admin/simulation/recover', async () => {
    isFailed = false;
    return { nodeId, status: 'HEALTHY' };
  });

  try {
    fastify.listen({ port, host: '127.0.0.1' }, (err, address) => {
      if (err) {
        console.warn(`[Storage Node] Warning listening on port ${port}: ${err.message}`);
      } else {
        console.log(`[Storage Node] ${nodeName} (${nodeId}) listening at ${address}`);
      }
    });
  } catch (err: any) {
    console.warn(`[Storage Node] Could not bind port ${port}: ${err.message}`);
  }

  return fastify;
}

// Simple zero-dependency CLI arg parser
function parseArgs(args: string[]) {
  const res: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      res[key] = val;
    }
  }
  return res;
}

// Auto-start ONLY if run explicitly via CLI with --port
const argv = parseArgs(process.argv.slice(2));
if (argv.port) {
  const PORT = Number(argv.port);
  const NODE_ID = String(argv.id || process.env.NODE_ID || 'node-1');
  const NODE_NAME = String(argv.name || process.env.NODE_NAME || `Storage Node (${NODE_ID})`);
  createStorageNodeServer({ port: PORT, nodeId: NODE_ID, nodeName: NODE_NAME });
}
