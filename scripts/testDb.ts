import { dbRepo } from '../packages/db/src/index.js';

async function test() {
  console.log('Testing VaultRepository with Neon HTTP driver...');
  const nodes = await dbRepo.getAllNodes();
  console.log('Nodes count:', nodes.length);
  process.exit(0);
}

test();
