import type { JudgeCallback, JudgeRequest } from './types.js';

interface InvokableLanguageModel {
  invoke(input: string): Promise<unknown>;
}

function extractTextContent(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') return String(response ?? '');

  const content = Reflect.get(response, 'content');
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof Reflect.get(part, 'text') === 'string') {
          return Reflect.get(part, 'text') as string;
        }
        return '';
      })
      .join('');
  }

  const text = Reflect.get(response, 'text');
  if (typeof text === 'string') return text;
  return JSON.stringify(response);
}

function promptWithSchema(request: JudgeRequest): string {
  if (!request.schema) return request.prompt;
  return `${request.prompt}

Return only one valid JSON object matching this JSON Schema. Use escaped \\\\n and \\\\r inside string values. Do not wrap the JSON in markdown:
${JSON.stringify(request.schema)}`;
}

export function createJudgeCallback(model: unknown): JudgeCallback {
  if (!model || typeof model !== 'object' || typeof Reflect.get(model, 'invoke') !== 'function') {
    throw new TypeError('The connected Language Model does not expose an invoke() method');
  }

  const invokable = model as InvokableLanguageModel;
  return async (request) => {
    const response = await invokable.invoke(promptWithSchema(request));
    return extractTextContent(response);
  };
}
