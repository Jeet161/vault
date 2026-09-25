import { describe, it, expect } from 'vitest';
import { calculateRiskScore } from '@vault/shared';

describe('Risk-Aware Placement Engine', () => {
  it('assigns maximum risk score (1.0) to FAILED nodes', () => {
    const score = calculateRiskScore({
      status: 'FAILED',
      capacity: 10000,
      usedStorage: 100,
      failureCount: 2,
      load: 0.1
    });
    expect(score).toBe(1.0);
  });

  it('calculates lower risk score for healthy nodes with low storage usage', () => {
    const scoreHealthy = calculateRiskScore({
      status: 'HEALTHY',
      capacity: 10000,
      usedStorage: 1000,
      failureCount: 0,
      load: 0.1
    });

    const scoreDegraded = calculateRiskScore({
      status: 'DEGRADED',
      capacity: 10000,
      usedStorage: 8000,
      failureCount: 3,
      load: 0.8
    });

    expect(scoreHealthy).toBeLessThan(scoreDegraded);
  });
});
