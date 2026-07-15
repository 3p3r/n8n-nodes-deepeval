import {
  evaluateDeepEval,
  getPyodidePoolSize,
  getRuntimeDiagnostics,
  prewarmDeepEval,
} from '../packages/runtime/src/index.js';

const toolPermissionRequest = {
  metricId: 'toolPermission',
  pythonClass: 'ToolPermissionMetric',
  pythonImport: 'deepeval.metrics',
  config: {
    allowed_tools: ['calculator'],
    denied_tools: ['shell'],
    threshold: 1,
    include_reason: true,
    strict_mode: false,
    verbose_mode: false,
  },
  testCase: {
    input: 'Calculate 2 + 2',
    actualOutput: '4',
    toolsCalled: [{ name: 'calculator', inputParameters: { input: '2+2' }, output: '4' }],
  },
  lowerIsBetter: false,
  requiresModel: false,
};

await prewarmDeepEval();

const poolSize = getPyodidePoolSize();
const diagnosticsAfterPrewarm = getRuntimeDiagnostics();
if (diagnosticsAfterPrewarm.initializationCount !== poolSize) {
  throw new Error(
    `Expected ${poolSize} Pyodide pool initializations after prewarm, got ${diagnosticsAfterPrewarm.initializationCount}`,
  );
}

const [first, second] = await Promise.all([
  evaluateDeepEval({ ...toolPermissionRequest }),
  evaluateDeepEval({
    ...toolPermissionRequest,
    testCase: {
      ...toolPermissionRequest.testCase,
      input: 'Calculate 3 + 3',
      actualOutput: '6',
      toolsCalled: [{ name: 'calculator', inputParameters: { input: '3+3' }, output: '6' }],
    },
  }),
]);

if (first.score !== 1 || !first.success || second.score !== 1 || !second.success) {
  throw new Error(
    `Unexpected concurrent DeepEval smoke results: ${JSON.stringify({ first, second })}`,
  );
}

const diagnostics = getRuntimeDiagnostics();
if (diagnostics.evaluationCount < 2) {
  throw new Error(`Expected at least two evaluations, got ${diagnostics.evaluationCount}`);
}

console.info(JSON.stringify({ first, second, diagnostics }, null, 2));
