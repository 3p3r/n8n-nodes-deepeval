import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export interface DeepEvalE2EContext {
  baseUrl: string;
  cookie: string;
  credentialId: string;
  model: string;
  inferenceBaseUrl: string;
  projectId: string;
  sourceTableId: string;
  resultsTableId: string;
  nodeTypes: Record<string, string>;
}

export interface N8nSession {
  context: DeepEvalE2EContext;
  logPath: string;
  userFolder: string;
  teardown: () => Promise<void>;
}

interface ApiResponse<T> {
  data: T;
}

const root = resolve(import.meta.dirname, '..');
const apiKey = 'sk-no-key-required';
const apeLoaderPath = resolve(root, '.llamafile/ape');
const llamafilePath = resolve(root, '.llamafile/Ministral-3-3B-Instruct-2512-Q4_K_M.llamafile');
const ownerEmail = 'e2e@example.com';
const ownerPassword = 'DeepEval-E2E-Password1';

export { ownerEmail, ownerPassword };

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate a local port'));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForServer(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`n8n exited during startup with code ${child.exitCode}`);
    }
    try {
      const health = await fetch(`${baseUrl}/healthz`);
      const settings = await fetch(`${baseUrl}/rest/settings`);
      if (
        health.ok &&
        settings.ok &&
        settings.headers.get('content-type')?.includes('application/json')
      ) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('Timed out waiting for the real n8n server to start');
}

async function waitForLlamafile(baseUrl: string, child: ChildProcess): Promise<string> {
  const deadline = Date.now() + 180_000;
  let spawnError: Error | undefined;
  child.once('error', (error) => {
    spawnError = error;
  });
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) {
      throw new Error(`llamafile exited during startup with code ${child.exitCode}`);
    }
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/models`);
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      continue;
    }
    if (!response.ok) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      continue;
    }
    const models = await responseData<Array<{ id: string }>>(response);
    if (models.length !== 1 || !models[0]?.id) {
      throw new Error(`Expected exactly one model from ${baseUrl}/models`);
    }
    return models[0].id;
  }
  throw new Error('Timed out waiting for llamafile to start');
}

async function responseData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResponse<T> | T;
  if (!response.ok) throw new Error(`n8n API ${response.status}: ${JSON.stringify(body)}`);
  return body && typeof body === 'object' && 'data' in body
    ? (body as ApiResponse<T>).data
    : (body as T);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  if (child.exitCode === null) child.kill('SIGTERM');
  await new Promise<void>((resolveExit) => {
    if (child.exitCode !== null) resolveExit();
    else child.once('exit', () => resolveExit());
  });
}

export async function startN8nSession(): Promise<N8nSession> {
  const userFolder = await mkdtemp(resolve(tmpdir(), 'n8n-deepeval-e2e-'));
  const logPath = resolve(userFolder, 'n8n.log');
  const logStream = createWriteStream(logPath, { flags: 'a' });
  const inferencePort = await freePort();
  const inferenceBaseUrl = `http://127.0.0.1:${inferencePort}/v1`;
  const llamafile = spawn(
    apeLoaderPath,
    [
      llamafilePath,
      '--server',
      '--host',
      '127.0.0.1',
      '--port',
      String(inferencePort),
      '--jinja',
      '--ctx-size',
      '8192',
      '--temp',
      '0',
    ],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  llamafile.stdout?.pipe(logStream, { end: false });
  llamafile.stderr?.pipe(logStream, { end: false });

  let child: ChildProcess | undefined;
  try {
    const model = await waitForLlamafile(inferenceBaseUrl, llamafile);
    const port = await freePort();
    let runnerPort = await freePort();
    while (runnerPort === port || runnerPort === inferencePort) runnerPort = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [resolve(root, 'node_modules/n8n/bin/n8n'), 'start'], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        VITEST: '',
        VITEST_MODE: '',
        N8N_USER_FOLDER: userFolder,
        N8N_PORT: String(port),
        N8N_RUNNERS_BROKER_PORT: String(runnerPort),
        N8N_HOST: '127.0.0.1',
        N8N_SECURE_COOKIE: 'false',
        N8N_DIAGNOSTICS_ENABLED: 'false',
        N8N_PERSONALIZATION_ENABLED: 'false',
        N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
        N8N_TEMPLATES_ENABLED: 'false',
        N8N_RUNNERS_ENABLED: 'false',
        N8N_COMMUNITY_PACKAGES_ENABLED: 'true',
        N8N_CUSTOM_EXTENSIONS: resolve(root, 'packages/nodes/dist'),
        N8N_ENCRYPTION_KEY: 'deepeval-e2e-encryption-key',
        N8N_LOG_LEVEL: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });

    await waitForServer(baseUrl, child);
    const ownerResponse = await fetch(`${baseUrl}/rest/owner/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ownerEmail,
        firstName: 'DeepEval',
        lastName: 'E2E',
        password: ownerPassword,
      }),
    });
    await responseData(ownerResponse);
    const authCookie = ownerResponse.headers.getSetCookie()[0]?.split(';', 1)[0];
    if (!authCookie) throw new Error('n8n owner setup did not issue an auth cookie');

    const api = async <T>(path: string, init: RequestInit = {}): Promise<T> =>
      await responseData<T>(
        await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: {
            Cookie: authCookie,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
          },
        }),
      );

    const credential = await api<{ id: string }>('/rest/credentials', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Local OpenAI-compatible endpoint',
        type: 'openAiApi',
        data: { apiKey, organizationId: '', url: inferenceBaseUrl },
      }),
    });
    const projects = await api<Array<{ id: string; type: string }>>('/rest/projects');
    const personalProject = projects.find((candidate) => candidate.type === 'personal');
    if (!personalProject) throw new Error('n8n did not create a personal project');

    const createTable = async (
      name: string,
      columns: Array<{ name: string; type: 'string' | 'number' | 'boolean' }>,
    ) =>
      await api<{ id: string }>(`/rest/projects/${personalProject.id}/data-tables`, {
        method: 'POST',
        body: JSON.stringify({ name, columns }),
      });
    const sourceTable = await createTable('DeepEval Source', [
      { name: 'input', type: 'string' },
      { name: 'expectedOutput', type: 'string' },
    ]);
    const resultsTable = await createTable('DeepEval Results', [
      { name: 'runId', type: 'string' },
      { name: 'overallScore', type: 'number' },
      { name: 'overallSuccess', type: 'boolean' },
      { name: 'metrics', type: 'string' },
      { name: 'caseId', type: 'string' },
      { name: 'meanScore', type: 'number' },
      { name: 'overallConsistency', type: 'number' },
      { name: 'stats', type: 'string' },
    ]);
    await api(`/rest/projects/${personalProject.id}/data-tables/${sourceTable.id}/insert`, {
      method: 'POST',
      body: JSON.stringify({
        data: [
          {
            input: 'Use the calculator when appropriate, then answer: what is 2 + 2?',
            expectedOutput: 'The answer is 4.',
          },
        ],
        returnType: 'all',
      }),
    });

    const nodeDescriptions =
      await api<
        Array<{
          name: string;
          displayName: string;
          codex?: { categories?: string[]; alias?: string[] };
        }>
      >('/types/nodes.json');
    const deepevalNodes = nodeDescriptions.filter((node) =>
      node.displayName.startsWith('DeepEval'),
    );
    if (deepevalNodes.length !== 36) {
      throw new Error(`Expected 36 DeepEval nodes in n8n, found ${deepevalNodes.length}`);
    }

    const nodeTypes = Object.fromEntries(
      deepevalNodes.map((node) => [node.displayName, node.name]),
    );
    const context: DeepEvalE2EContext = {
      baseUrl,
      cookie: authCookie,
      credentialId: credential.id,
      model,
      inferenceBaseUrl,
      projectId: personalProject.id,
      sourceTableId: sourceTable.id,
      resultsTableId: resultsTable.id,
      nodeTypes,
    };

    const n8n = child;
    return {
      context,
      logPath,
      userFolder,
      teardown: async () => {
        await stopProcess(llamafile);
        await stopProcess(n8n);
        await new Promise<void>((resolveEnd) => logStream.end(resolveEnd));
        await rm(userFolder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child) await stopProcess(child);
    await stopProcess(llamafile);
    await new Promise<void>((resolveEnd) => logStream.end(resolveEnd));
    const logs = await readFile(logPath, 'utf8');
    await rm(userFolder, { recursive: true, force: true });
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${logs}`);
  }
}
