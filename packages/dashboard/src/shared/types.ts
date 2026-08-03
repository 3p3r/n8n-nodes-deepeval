export type AbcItemStatus = 'pass' | 'fail' | 'partial' | 'manual' | 'na' | 'unanswered';
export type AbcItemSource = 'auto' | 'manual';

export type AbcPillarId = 'taskValidity' | 'outcomeValidity' | 'benchmarkReporting';

export interface AbcChecklistItemDef {
  id: string;
  pillar: AbcPillarId;
  title: string;
  description: string;
  /** When true, UI requires a human answer; auto scorer leaves as unanswered/manual. */
  requiresManual: boolean;
}

export interface AbcChecklistItem {
  id: string;
  pillar: AbcPillarId;
  title: string;
  description: string;
  status: AbcItemStatus;
  source: AbcItemSource;
  evidence: string;
  score?: number;
  notes?: string;
}

export interface AbcPillar {
  id: AbcPillarId;
  title: string;
  score: number | null;
  items: AbcChecklistItem[];
}

export interface MetricSummary {
  name: string;
  meanScore: number;
  passRate: number;
  failCount: number;
}

export interface FailureRow {
  runId: string;
  metric: string;
  score: number;
  reason: string | null;
}

export interface AbcReport {
  workflowId: string;
  workflowName: string;
  generatedAt: string;
  pillars: {
    taskValidity: AbcPillar;
    outcomeValidity: AbcPillar;
    benchmarkReporting: AbcPillar;
  };
  overallScore: number | null;
  deepeval: {
    metrics: MetricSummary[];
    aggregateRows: Record<string, unknown>[];
    consistencyRows?: Record<string, unknown>[];
    topFailures: FailureRow[];
  };
  tables: {
    sourceTableId: string;
    resultsTableId: string;
    sourceRowCount: number;
    resultsRowCount: number;
    consistencyTableId?: string;
  };
  setup?: {
    complete: boolean;
    missing: string[];
  };
}

export interface QuestionnaireAnswer {
  status: 'pass' | 'fail' | 'partial' | 'na';
  notes?: string;
}

export type QuestionnaireAnswers = Record<string, QuestionnaireAnswer>;

export interface WorkflowNodeLike {
  id?: string;
  name?: string;
  type?: string;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

export interface InspectedWorkflow {
  id: string;
  name: string;
  projectId: string;
  trigger: {
    dataTableId: string;
    runsPerRow: number;
    runName: string;
  };
  aggregate: {
    dataTableId: string;
    passRule: string;
  };
  consistency?: {
    dataTableId: string;
  };
  metrics: Array<{
    type: string;
    name: string;
    cleanSession: boolean;
    threshold?: number;
    hasCredentials: boolean;
  }>;
  nodes: WorkflowNodeLike[];
}

export interface InspectErrorBody {
  error: string;
  code: 'INCOMPLETE_WORKFLOW' | 'WORKFLOW_NOT_FOUND' | 'EMPTY_TABLES' | 'BAD_REQUEST';
  missing: string[];
}

export const AGENTIC_METRIC_TYPE_FRAGMENTS = [
  'TaskCompletion',
  'ToolCorrectness',
  'ArgumentCorrectness',
  'PlanAdherence',
  'PlanQuality',
  'StepEfficiency',
  'AgentLoopDetection',
  'ToolPermission',
] as const;

export const DEEPEVAL_VERSION = '4.0.7';
