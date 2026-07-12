import type { DeepEvalTurn } from './types.js';

interface MessageLike {
  content?: unknown;
  type?: string;
  role?: string;
  _getType?: () => string;
}

function normalizeContent(content: unknown): string {
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
  return content == null ? '' : JSON.stringify(content);
}

function normalizeRole(message: MessageLike): 'user' | 'assistant' | null {
  const type = message._getType?.() ?? message.type ?? message.role ?? '';
  if (['human', 'user'].includes(type)) return 'user';
  if (['ai', 'assistant'].includes(type)) return 'assistant';
  return null;
}

async function readMessages(memory: object): Promise<unknown[]> {
  const directGetMessages = Reflect.get(memory, 'getMessages');
  if (typeof directGetMessages === 'function') {
    return (await directGetMessages.call(memory)) as unknown[];
  }

  const chatHistory = Reflect.get(memory, 'chatHistory');
  if (chatHistory && typeof chatHistory === 'object') {
    const getMessages = Reflect.get(chatHistory, 'getMessages');
    if (typeof getMessages === 'function') {
      return (await getMessages.call(chatHistory)) as unknown[];
    }
  }

  const loadMemoryVariables = Reflect.get(memory, 'loadMemoryVariables');
  if (typeof loadMemoryVariables === 'function') {
    const variables = (await loadMemoryVariables.call(memory, {})) as Record<string, unknown>;
    for (const value of Object.values(variables)) {
      if (Array.isArray(value)) return value;
    }
  }

  throw new TypeError('The connected Memory node does not expose readable chat history');
}

export async function memoryToTurns(memory: unknown): Promise<DeepEvalTurn[]> {
  if (!memory || typeof memory !== 'object') {
    throw new TypeError('A connected Memory node is required');
  }

  const messages = await readMessages(memory);
  const turns = messages.flatMap((rawMessage) => {
    if (!rawMessage || typeof rawMessage !== 'object') return [];
    const message = rawMessage as MessageLike;
    const role = normalizeRole(message);
    if (!role) return [];
    return [{ role, content: normalizeContent(message.content) } satisfies DeepEvalTurn];
  });

  if (turns.length === 0) {
    throw new TypeError('The connected Memory node returned no user or assistant messages');
  }

  return turns;
}
