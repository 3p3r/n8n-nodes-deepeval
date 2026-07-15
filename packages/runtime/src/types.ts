export interface DeepEvalToolCall {
  name: string;
  description?: string;
  reasoning?: string;
  inputParameters?: Record<string, unknown>;
  output?: unknown;
}

export interface DeepEvalTurn {
  role: 'user' | 'assistant';
  content: string;
  retrievalContext?: string[];
  toolsCalled?: DeepEvalToolCall[];
  metadata?: Record<string, unknown>;
}

export interface DeepEvalTestCase {
  input?: string;
  actualOutput?: string;
  expectedOutput?: string;
  context?: string[];
  retrievalContext?: string[];
  expectedTools?: DeepEvalToolCall[];
  toolsCalled?: DeepEvalToolCall[];
  turns?: DeepEvalTurn[];
  chatbotRole?: string;
  expectedOutcome?: string;
  scenario?: string;
  metadata?: Record<string, unknown>;
  trace?: Record<string, unknown>;
}

export interface DeepEvalRequest {
  metricId: string;
  pythonClass: string;
  pythonImport: string;
  config: Record<string, unknown>;
  testCase: DeepEvalTestCase;
  lowerIsBetter: boolean;
  requiresModel: boolean;
  cleanSession?: boolean;
}

export interface DeepEvalResult {
  score: number;
  reason: string | null;
  success: boolean;
  metric: string;
}

export interface JudgeRequest {
  prompt: string;
  schema: Record<string, unknown> | null;
}

export type JudgeCallback = (request: JudgeRequest) => Promise<string>;

export interface RuntimeDiagnostics {
  runtimeId: string;
  poolSize: number;
  busyCount: number;
  initializationCount: number;
  initializedAt: string | null;
  evaluationCount: number;
}
