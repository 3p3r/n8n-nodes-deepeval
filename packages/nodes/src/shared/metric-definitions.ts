import type { INodeProperties } from 'n8n-workflow';

export interface MetricDefinition {
  id: string;
  className: string;
  displayName: string;
  description: string;
  pythonClass: string;
  pythonImport: string;
  requiresModel: boolean;
  requiresMemory: boolean;
  requiresTrace: boolean;
  lowerIsBetter: boolean;
  requiredFields: string[];
  properties: INodeProperties[];
  defaults?: Record<string, unknown>;
}

const stringProperty = (
  displayName: string,
  name: string,
  required = false,
  defaultValue = '',
): INodeProperties => ({
  displayName,
  name,
  type: 'string',
  required,
  default: defaultValue,
});

const numberProperty = (
  displayName: string,
  name: string,
  defaultValue: number,
  minimum?: number,
): INodeProperties => ({
  displayName,
  name,
  type: 'number',
  default: defaultValue,
  ...(minimum === undefined ? {} : { typeOptions: { minValue: minimum } }),
});

const booleanProperty = (
  displayName: string,
  name: string,
  defaultValue: boolean,
): INodeProperties => ({
  displayName,
  name,
  type: 'boolean',
  default: defaultValue,
});

const jsonProperty = (
  displayName: string,
  name: string,
  required = false,
  defaultValue = '[]',
): INodeProperties => ({
  displayName,
  name,
  type: 'json',
  required,
  default: defaultValue,
});

const evaluationParams = (conversational = false): INodeProperties => ({
  displayName: 'Evaluation Parameters',
  name: 'evaluationParams',
  type: 'multiOptions',
  required: true,
  default: conversational ? ['CONTENT'] : ['INPUT', 'ACTUAL_OUTPUT'],
  options: (conversational
    ? [
        'ROLE',
        'CONTENT',
        'METADATA',
        'TAGS',
        'SCENARIO',
        'EXPECTED_OUTCOME',
        'RETRIEVAL_CONTEXT',
        'TOOLS_CALLED',
      ]
    : [
        'INPUT',
        'ACTUAL_OUTPUT',
        'EXPECTED_OUTPUT',
        'CONTEXT',
        'RETRIEVAL_CONTEXT',
        'METADATA',
        'TAGS',
        'TOOLS_CALLED',
        'EXPECTED_TOOLS',
      ]
  ).map((value) => ({ name: value.replaceAll('_', ' '), value })),
});

const commonProperties = (
  threshold = 0.5,
  options: { includeReason?: boolean; asyncMode?: boolean } = {},
): INodeProperties[] => [
  numberProperty('Threshold', 'threshold', threshold, 0),
  ...(options.includeReason === false
    ? []
    : [booleanProperty('Include Reason', 'includeReason', true)]),
  booleanProperty('Strict Mode', 'strictMode', false),
  ...(options.asyncMode === false ? [] : [booleanProperty('Async Mode', 'asyncMode', true)]),
  booleanProperty('Verbose Mode', 'verboseMode', false),
  booleanProperty('Clean Session', 'cleanSession', false),
];

const metric = (
  definition: Omit<
    MetricDefinition,
    'pythonImport' | 'requiresModel' | 'requiresMemory' | 'requiresTrace' | 'lowerIsBetter'
  > &
    Partial<
      Pick<
        MetricDefinition,
        'pythonImport' | 'requiresModel' | 'requiresMemory' | 'requiresTrace' | 'lowerIsBetter'
      >
    >,
): MetricDefinition => ({
  pythonImport: 'deepeval.metrics',
  requiresModel: true,
  requiresMemory: false,
  requiresTrace: false,
  lowerIsBetter: false,
  ...definition,
});

export const metricDefinitions: MetricDefinition[] = [
  metric({
    id: 'gEval',
    className: 'DeepEvalGEval',
    displayName: 'DeepEval G-Eval',
    description: 'Evaluate output against a custom natural-language rubric',
    pythonClass: 'GEval',
    requiredFields: ['input', 'actualOutput'],
    properties: [
      stringProperty('Metric Name', 'name', true, 'Custom Correctness'),
      stringProperty('Criteria', 'criteria', true, 'Determine whether the response is correct.'),
      jsonProperty('Evaluation Steps', 'evaluationSteps'),
      evaluationParams(),
      jsonProperty('Rubric', 'rubric'),
      ...commonProperties(0.5, { includeReason: false }),
    ],
  }),
  metric({
    id: 'dag',
    className: 'DeepEvalDAG',
    displayName: 'DeepEval DAG',
    description: 'Evaluate output with a DeepEval decision graph',
    pythonClass: 'DAGMetric',
    requiredFields: ['input', 'actualOutput'],
    properties: [
      stringProperty('Metric Name', 'name', true, 'Decision Graph'),
      jsonProperty('DAG', 'dag', true, '{"root_nodes":[]}'),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'conversationalGEval',
    className: 'DeepEvalConversationalGEval',
    displayName: 'DeepEval Conversational G-Eval',
    description: 'Evaluate a conversation against a custom rubric',
    pythonClass: 'ConversationalGEval',
    requiresMemory: true,
    requiredFields: [],
    properties: [
      stringProperty('Metric Name', 'name', true, 'Conversation Quality'),
      stringProperty(
        'Criteria',
        'criteria',
        true,
        'Determine whether the conversation is helpful.',
      ),
      jsonProperty('Evaluation Steps', 'evaluationSteps'),
      evaluationParams(true),
      jsonProperty('Rubric', 'rubric'),
      ...commonProperties(0.5, { includeReason: false }),
    ],
  }),
  metric({
    id: 'conversationalDAG',
    className: 'DeepEvalConversationalDAG',
    displayName: 'DeepEval Conversational DAG',
    description: 'Evaluate a conversation with a DeepEval decision graph',
    pythonClass: 'ConversationalDAGMetric',
    requiresMemory: true,
    requiredFields: [],
    properties: [
      stringProperty('Metric Name', 'name', true, 'Conversation Decision Graph'),
      jsonProperty('DAG', 'dag', true, '{"root_nodes":[]}'),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'taskCompletion',
    className: 'DeepEvalTaskCompletion',
    displayName: 'DeepEval Task Completion',
    description: 'Judge whether an AI agent completed its task',
    pythonClass: 'TaskCompletionMetric',
    requiresTrace: true,
    requiredFields: ['input', 'actualOutput', 'intermediateSteps'],
    properties: [stringProperty('Task', 'task'), ...commonProperties()],
  }),
  metric({
    id: 'stepEfficiency',
    className: 'DeepEvalStepEfficiency',
    displayName: 'DeepEval Step Efficiency',
    description: 'Measure whether an agent used efficient execution steps',
    pythonClass: 'StepEfficiencyMetric',
    requiresTrace: true,
    requiredFields: ['input', 'actualOutput', 'intermediateSteps'],
    properties: commonProperties(),
  }),
  metric({
    id: 'argumentCorrectness',
    className: 'DeepEvalArgumentCorrectness',
    displayName: 'DeepEval Argument Correctness',
    description: 'Judge whether tool calls used correct arguments',
    pythonClass: 'ArgumentCorrectnessMetric',
    requiresTrace: true,
    requiredFields: ['input', 'actualOutput', 'intermediateSteps'],
    properties: commonProperties(),
  }),
  metric({
    id: 'toolCorrectness',
    className: 'DeepEvalToolCorrectness',
    displayName: 'DeepEval Tool Correctness',
    description: 'Compare called tools with expected tools',
    pythonClass: 'ToolCorrectnessMetric',
    requiresTrace: true,
    requiredFields: ['input', 'intermediateSteps', 'expectedTools'],
    properties: [
      jsonProperty('Available Tools', 'availableTools'),
      {
        displayName: 'Evaluation Parameters',
        name: 'evaluationParams',
        type: 'multiOptions',
        default: [],
        options: [
          { name: 'Input Parameters', value: 'INPUT_PARAMETERS' },
          { name: 'Output', value: 'OUTPUT' },
        ],
      },
      booleanProperty('Exact Match', 'shouldExactMatch', false),
      booleanProperty('Consider Ordering', 'shouldConsiderOrdering', false),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'planAdherence',
    className: 'DeepEvalPlanAdherence',
    displayName: 'DeepEval Plan Adherence',
    description: 'Measure whether an agent followed its plan',
    pythonClass: 'PlanAdherenceMetric',
    requiresTrace: true,
    requiredFields: ['input', 'actualOutput', 'intermediateSteps'],
    properties: commonProperties(),
  }),
  metric({
    id: 'planQuality',
    className: 'DeepEvalPlanQuality',
    displayName: 'DeepEval Plan Quality',
    description: 'Judge the quality of an agent plan',
    pythonClass: 'PlanQualityMetric',
    requiresTrace: true,
    requiredFields: ['input', 'actualOutput', 'intermediateSteps'],
    properties: commonProperties(),
  }),
  metric({
    id: 'turnRelevancy',
    className: 'DeepEvalTurnRelevancy',
    displayName: 'DeepEval Turn Relevancy',
    description: 'Measure relevance across conversation turns',
    pythonClass: 'TurnRelevancyMetric',
    requiresMemory: true,
    requiredFields: [],
    properties: [numberProperty('Window Size', 'windowSize', 10, 1), ...commonProperties()],
  }),
  metric({
    id: 'roleAdherence',
    className: 'DeepEvalRoleAdherence',
    displayName: 'DeepEval Role Adherence',
    description: 'Measure whether a chatbot adheres to its role',
    pythonClass: 'RoleAdherenceMetric',
    requiresMemory: true,
    requiredFields: [],
    properties: [
      stringProperty('Chatbot Role', 'chatbotRole', true, 'A helpful assistant'),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'knowledgeRetention',
    className: 'DeepEvalKnowledgeRetention',
    displayName: 'DeepEval Knowledge Retention',
    description: 'Measure whether a chatbot retains supplied knowledge',
    pythonClass: 'KnowledgeRetentionMetric',
    requiresMemory: true,
    requiredFields: [],
    properties: commonProperties(),
  }),
  metric({
    id: 'conversationCompleteness',
    className: 'DeepEvalConversationCompleteness',
    displayName: 'DeepEval Conversation Completeness',
    description: 'Measure whether a conversation satisfies user intentions',
    pythonClass: 'ConversationCompletenessMetric',
    requiresMemory: true,
    requiredFields: [],
    properties: [numberProperty('Window Size', 'windowSize', 3, 1), ...commonProperties()],
  }),
  metric({
    id: 'goalAccuracy',
    className: 'DeepEvalGoalAccuracy',
    displayName: 'DeepEval Goal Accuracy',
    description: 'Measure whether a conversational agent reached the user goal',
    pythonClass: 'GoalAccuracyMetric',
    requiresMemory: true,
    requiresTrace: true,
    requiredFields: ['intermediateSteps'],
    properties: commonProperties(),
  }),
  metric({
    id: 'toolUse',
    className: 'DeepEvalToolUse',
    displayName: 'DeepEval Tool Use',
    description: 'Measure conversational tool selection and arguments',
    pythonClass: 'ToolUseMetric',
    requiresMemory: true,
    requiresTrace: true,
    requiredFields: ['intermediateSteps'],
    properties: [jsonProperty('Available Tools', 'availableTools', true), ...commonProperties()],
  }),
  metric({
    id: 'topicAdherence',
    className: 'DeepEvalTopicAdherence',
    displayName: 'DeepEval Topic Adherence',
    description: 'Measure adherence to allowed conversation topics',
    pythonClass: 'TopicAdherenceMetric',
    requiresMemory: true,
    requiredFields: [],
    properties: [jsonProperty('Relevant Topics', 'relevantTopics', true), ...commonProperties()],
  }),
  metric({
    id: 'turnFaithfulness',
    className: 'DeepEvalTurnFaithfulness',
    displayName: 'DeepEval Turn Faithfulness',
    description: 'Measure grounding across conversational turns',
    pythonClass: 'TurnFaithfulnessMetric',
    requiresMemory: true,
    requiredFields: [],
    properties: [
      numberProperty('Window Size', 'windowSize', 10, 1),
      numberProperty('Truths Extraction Limit', 'truthsExtractionLimit', 10, 0),
      booleanProperty('Penalize Ambiguous Claims', 'penalizeAmbiguousClaims', false),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'turnContextualPrecision',
    className: 'DeepEvalTurnContextualPrecision',
    displayName: 'DeepEval Turn Contextual Precision',
    description: 'Measure retrieval ranking precision by turn',
    pythonClass: 'TurnContextualPrecisionMetric',
    requiresMemory: true,
    requiredFields: [],
    properties: [
      numberProperty('Window Size', 'windowSize', 10, 1),
      stringProperty('Expected Outcome', 'expectedOutcome', true),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'turnContextualRecall',
    className: 'DeepEvalTurnContextualRecall',
    displayName: 'DeepEval Turn Contextual Recall',
    description: 'Measure retrieval completeness by turn',
    pythonClass: 'TurnContextualRecallMetric',
    requiresMemory: true,
    requiredFields: [],
    properties: [
      numberProperty('Window Size', 'windowSize', 10, 1),
      stringProperty('Expected Outcome', 'expectedOutcome', true),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'turnContextualRelevancy',
    className: 'DeepEvalTurnContextualRelevancy',
    displayName: 'DeepEval Turn Contextual Relevancy',
    description: 'Measure retrieval signal-to-noise by turn',
    pythonClass: 'TurnContextualRelevancyMetric',
    requiresMemory: true,
    requiredFields: [],
    properties: [numberProperty('Window Size', 'windowSize', 10, 1), ...commonProperties()],
  }),
  metric({
    id: 'bias',
    className: 'DeepEvalBias',
    displayName: 'DeepEval Bias',
    description: 'Detect biased opinions in model output',
    pythonClass: 'BiasMetric',
    lowerIsBetter: true,
    requiredFields: ['input', 'actualOutput'],
    properties: commonProperties(),
  }),
  metric({
    id: 'toxicity',
    className: 'DeepEvalToxicity',
    displayName: 'DeepEval Toxicity',
    description: 'Detect toxic content in model output',
    pythonClass: 'ToxicityMetric',
    lowerIsBetter: true,
    requiredFields: ['input', 'actualOutput'],
    properties: commonProperties(),
  }),
  metric({
    id: 'nonAdvice',
    className: 'DeepEvalNonAdvice',
    displayName: 'DeepEval Non-Advice',
    description: 'Detect inappropriate professional advice',
    pythonClass: 'NonAdviceMetric',
    requiredFields: ['input', 'actualOutput'],
    properties: [jsonProperty('Advice Types', 'adviceTypes', true), ...commonProperties()],
  }),
  metric({
    id: 'misuse',
    className: 'DeepEvalMisuse',
    displayName: 'DeepEval Misuse',
    description: 'Detect responses outside an allowed domain',
    pythonClass: 'MisuseMetric',
    lowerIsBetter: true,
    requiredFields: ['input', 'actualOutput'],
    properties: [
      stringProperty('Domain', 'domain', true, 'customer support'),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'piiLeakage',
    className: 'DeepEvalPIILeakage',
    displayName: 'DeepEval PII Leakage',
    description: 'Detect personally identifiable information leakage',
    pythonClass: 'PIILeakageMetric',
    requiredFields: ['input', 'actualOutput'],
    properties: commonProperties(),
  }),
  metric({
    id: 'roleViolation',
    className: 'DeepEvalRoleViolation',
    displayName: 'DeepEval Role Violation',
    description: 'Detect violations of a required role',
    pythonClass: 'RoleViolationMetric',
    requiredFields: ['input', 'actualOutput'],
    properties: [
      stringProperty('Role', 'role', true, 'A helpful assistant'),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'summarization',
    className: 'DeepEvalSummarization',
    displayName: 'DeepEval Summarization',
    description: 'Measure summary alignment and coverage',
    pythonClass: 'SummarizationMetric',
    requiredFields: ['input', 'actualOutput'],
    properties: [
      numberProperty('Assessment Question Count', 'n', 5, 1),
      jsonProperty('Assessment Questions', 'assessmentQuestions'),
      numberProperty('Truths Extraction Limit', 'truthsExtractionLimit', 10, 0),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'promptAlignment',
    className: 'DeepEvalPromptAlignment',
    displayName: 'DeepEval Prompt Alignment',
    description: 'Measure compliance with prompt instructions',
    pythonClass: 'PromptAlignmentMetric',
    requiredFields: ['input', 'actualOutput'],
    properties: [
      jsonProperty('Prompt Instructions', 'promptInstructions', true),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'hallucination',
    className: 'DeepEvalHallucination',
    displayName: 'DeepEval Hallucination',
    description: 'Measure contradictions against supplied context',
    pythonClass: 'HallucinationMetric',
    lowerIsBetter: true,
    requiredFields: ['input', 'actualOutput', 'context'],
    properties: commonProperties(),
  }),
  metric({
    id: 'citationFaithfulness',
    className: 'DeepEvalCitationFaithfulness',
    displayName: 'DeepEval Citation Faithfulness',
    description: 'Verify that citations support their associated claims',
    pythonClass: 'CitationFaithfulnessMetric',
    pythonImport: 'deepeval.metrics.community',
    requiredFields: ['input', 'actualOutput', 'retrievalContext'],
    properties: commonProperties(1),
  }),
  metric({
    id: 'agentLoopDetection',
    className: 'DeepEvalAgentLoopDetection',
    displayName: 'DeepEval Agent Loop Detection',
    description: 'Detect loops and stagnation in agent execution traces',
    pythonClass: 'AgentLoopDetectionMetric',
    requiresModel: false,
    requiresTrace: true,
    requiredFields: ['input', 'actualOutput', 'intermediateSteps'],
    properties: [
      numberProperty('Repetition Threshold', 'repetitionThreshold', 3, 1),
      numberProperty('Similarity Threshold', 'similarityThreshold', 0.85, 0),
      booleanProperty('Check Tool Repetition', 'checkToolRepetition', true),
      booleanProperty('Check Reasoning Stagnation', 'checkReasoningStagnation', true),
      booleanProperty('Check Call Graph Cycles', 'checkCallGraphCycles', true),
      ...commonProperties(),
    ],
  }),
  metric({
    id: 'toolPermission',
    className: 'DeepEvalToolPermission',
    displayName: 'DeepEval Tool Permission',
    description: 'Enforce allowlists and denylists for agent tools',
    pythonClass: 'ToolPermissionMetric',
    requiresModel: false,
    requiresTrace: true,
    requiredFields: ['intermediateSteps'],
    properties: [
      jsonProperty('Allowed Tools', 'allowedTools'),
      jsonProperty('Denied Tools', 'deniedTools'),
      ...commonProperties(1, { asyncMode: false }),
    ],
  }),
];

export function getMetricDefinition(id: string): MetricDefinition {
  const definition = metricDefinitions.find((item) => item.id === id);
  if (!definition) throw new TypeError(`Unknown DeepEval metric: ${id}`);
  return definition;
}
