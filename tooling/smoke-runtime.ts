import { evaluateDeepEval, getRuntimeDiagnostics } from '../packages/runtime/src/index.js';

const result = await evaluateDeepEval({
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
});

if (result.score !== 1 || !result.success) {
  throw new Error(`Unexpected DeepEval smoke result: ${JSON.stringify(result)}`);
}

const diagnostics = getRuntimeDiagnostics();
if (diagnostics.initializationCount !== 1) {
  throw new Error(`Expected one Pyodide initialization, got ${diagnostics.initializationCount}`);
}

console.info(JSON.stringify({ result, diagnostics }, null, 2));
