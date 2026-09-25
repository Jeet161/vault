import { dbRepo } from '@vault/db';
import { StorageNodeModel, calculateRiskScore } from '@vault/shared';

export interface PlacementCandidate {
  node: StorageNodeModel;
  score: number;
}

export class PlacementEngine {
  /**
   * Selects N suitable storage nodes for object replica placement
   * based on health, capacity, load, failure count, and current node exclusions.
   */
  async selectNodes(count: number, excludeNodeIds: string[] = []): Promise<StorageNodeModel[]> {
    const allNodes = await dbRepo.getAllNodes();

    // Filter candidate nodes
    const eligibleNodes = allNodes.filter(node => {
      if (node.status === 'FAILED') return false;
      if (excludeNodeIds.includes(node.id)) return false;
      return true;
    });

    if (eligibleNodes.length < count) {
      console.warn(`[PlacementEngine] Requested ${count} nodes but only ${eligibleNodes.length} eligible nodes available.`);
    }

    // Calculate score for each node (lower riskScore is better)
    const scoredCandidates: PlacementCandidate[] = eligibleNodes.map(node => {
      const riskScore = calculateRiskScore(node);
      // Update node's risk score in state
      node.riskScore = riskScore;
      dbRepo.upsertNode(node);

      return {
        node,
        score: riskScore
      };
    });

    // Sort by lowest risk score first (best placement target)
    scoredCandidates.sort((a, b) => a.score - b.score);

    return scoredCandidates.slice(0, count).map(c => c.node);
  }
}

export const placementEngine = new PlacementEngine();
