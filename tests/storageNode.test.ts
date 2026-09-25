import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

describe('SHA-256 Integrity Verification', () => {
  it('detects mismatched SHA-256 checksums correctly', () => {
    const originalData = Buffer.from('Hello Vault Distributed System');
    const validChecksum = crypto.createHash('sha256').update(originalData).digest('hex');

    const corruptedData = Buffer.from('Hello Vault Distr!buted System');
    const corruptedChecksum = crypto.createHash('sha256').update(corruptedData).digest('hex');

    expect(validChecksum).not.toBe(corruptedChecksum);
  });
});
