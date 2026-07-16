import { describe, expect, it } from 'vitest';
import {
  agreementRate,
  computeCaseConsistency,
  normalizedEntropy,
  shannonEntropy,
} from './consistency.js';
import {
  canonicalizeWorkflowGraph,
  hashCanonicalWorkflow,
  type WorkflowGraph,
} from './workflowCaseId.js';

describe('workflowCaseId', () => {
  const baseGraph: WorkflowGraph = {
    nodes: [
      {
        name: 'Trigger',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 0],
        id: 'node-1',
        parameters: {},
      },
      {
        name: 'Metric',
        type: 'n8n-nodes-deepeval.deepEvalGEval',
        typeVersion: 1,
        position: [240, 0],
        id: 'node-2',
        parameters: { threshold: 0.5 },
      },
    ],
    connections: {
      Trigger: {
        main: [[{ node: 'Metric', type: 'main', index: 0 }]],
      },
    },
  };

  it('ignores node position when hashing', () => {
    const moved: WorkflowGraph = {
      ...baseGraph,
      nodes: baseGraph.nodes.map((node) => ({
        ...node,
        position: [node.position[0] + 100, node.position[1] + 100],
      })),
    };
    expect(hashCanonicalWorkflow(baseGraph)).toBe(hashCanonicalWorkflow(moved));
  });

  it('changes hash when logical parameters change', () => {
    const changed: WorkflowGraph = {
      ...baseGraph,
      nodes: baseGraph.nodes.map((node) =>
        node.name === 'Metric' ? { ...node, parameters: { threshold: 0.9 } } : node,
      ),
    };
    expect(hashCanonicalWorkflow(baseGraph)).not.toBe(hashCanonicalWorkflow(changed));
  });

  it('canonicalizes nodes in stable name order', () => {
    const canonical = canonicalizeWorkflowGraph(baseGraph);
    expect(canonical.nodes.map((node) => node.name)).toEqual(['Metric', 'Trigger']);
  });
});

describe('consistency', () => {
  it('computes entropy and agreement helpers', () => {
    expect(shannonEntropy([2, 2])).toBeCloseTo(1, 5);
    expect(normalizedEntropy([2, 2])).toBeCloseTo(1, 5);
    expect(normalizedEntropy([4])).toBe(0);
    expect(agreementRate(['yes', 'yes', 'no'])).toBeCloseTo(2 / 3, 5);
  });

  it('aggregates per-case CV consistency', () => {
    const runs = [
      {
        score: 0.8,
        success: true,
        metrics: [{ metric: 'DeepEval G-Eval', score: 0.8, reason: null, success: true }],
        evalContext: { caseId: 'case-1' },
        json: {},
      },
      {
        score: 1,
        success: true,
        metrics: [{ metric: 'DeepEval G-Eval', score: 1, reason: null, success: true }],
        evalContext: { caseId: 'case-1' },
        json: {},
      },
    ];

    const result = computeCaseConsistency(runs, {
      labelField: '',
      consistencyBasis: 'cv',
    });

    expect(result.caseId).toBe('case-1');
    expect(result.runCount).toBe(2);
    expect(result.meanScore).toBeCloseTo(0.9, 5);
    expect(result.perMetric[0]?.metric).toBe('DeepEval G-Eval');
    expect(result.overallConsistency).toBeGreaterThan(0);
  });
});
