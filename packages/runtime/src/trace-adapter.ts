import type { DeepEvalToolCall } from './types.js';

interface IntermediateStep {
  action?: {
    tool?: string;
    toolInput?: unknown;
    log?: string;
  };
  observation?: unknown;
}

export interface SyntheticTrace {
  toolsCalled: DeepEvalToolCall[];
  trace: Record<string, unknown>;
}

export function intermediateStepsToTrace(
  input: string,
  actualOutput: string,
  rawSteps: unknown,
): SyntheticTrace {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new TypeError(
      'This DeepEval metric requires AI Agent intermediateSteps. Enable Return Intermediate Steps.',
    );
  }

  const toolsCalled: DeepEvalToolCall[] = [];
  const children: Record<string, unknown>[] = [];

  for (const [index, rawStep] of rawSteps.entries()) {
    const step = (rawStep ?? {}) as IntermediateStep;
    const action = step.action ?? {};
    const toolName = action.tool ?? `tool_${index + 1}`;
    const toolCall: DeepEvalToolCall = {
      name: toolName,
      inputParameters:
        action.toolInput && typeof action.toolInput === 'object'
          ? (action.toolInput as Record<string, unknown>)
          : { value: action.toolInput },
      output: step.observation,
      ...(action.log === undefined ? {} : { reasoning: action.log }),
    };
    toolsCalled.push(toolCall);

    if (action.log) {
      children.push({
        type: 'llm',
        name: `reasoning_${index + 1}`,
        input,
        output: action.log,
        children: [],
      });
    }
    children.push({
      type: 'tool',
      name: toolName,
      input: toolCall.inputParameters,
      output: step.observation,
      children: [],
    });
  }

  return {
    toolsCalled,
    trace: {
      type: 'agent',
      name: 'n8n_ai_agent',
      input,
      output: actualOutput,
      children,
    },
  };
}
