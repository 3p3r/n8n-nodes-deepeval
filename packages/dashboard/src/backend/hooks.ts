import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import debug from 'debug';
import type { Request, Response } from 'express';
import type { QuestionnaireAnswers } from '../shared/types';
import { buildArtifactZip, buildReportPdf } from './artifacts';
import { loadConfig } from './config';
import { loadQuestionnaire, saveQuestionnaire } from './questionnaire';
import { buildAbcReport } from './report';
import { loadReportTables, resolveProjectId } from './tables';
import { inspectWorkflowEntity, WorkflowInspectError } from './workflow-inspect';

const log = debug('deepeval-dashboard:backend');

type HookContext = {
  dbCollections: {
    Workflow: {
      find: () => Promise<Array<Record<string, unknown>>>;
      findById: (id: string) => Promise<Record<string, unknown> | null>;
    };
  };
};

type N8nServer = {
  app: {
    get: (
      route: string,
      ...handlers: Array<(req: Request, res: Response) => void | Promise<void>>
    ) => void;
    put: (
      route: string,
      ...handlers: Array<(req: Request, res: Response) => void | Promise<void>>
    ) => void;
    use: (route: string, handler: (req: Request, res: Response, next: () => void) => void) => void;
  };
  restEndpoint: string;
};

declare const __dirname: string;
declare const __filename: string;

const distRoot = path.join(__dirname, '..');
const bridgePath = path.join(distRoot, 'bridge', 'index.js');
const appRoot = path.join(distRoot, 'app');
const requireFromHooks = createRequire(__filename);
const config = loadConfig();

function normalizeStylesheetHref(href: string): string {
  return href.replace(/\/\{\{BASE_PATH\}\}/g, '');
}

function resolveN8nStylesheets(req: Request): string[] {
  const packageJson = requireFromHooks.resolve('n8n-editor-ui/package.json');
  const indexPath = path.join(path.dirname(packageJson), 'dist', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const stylesheets: string[] = [];
  const origin = `${req.protocol}://${req.get('host')}`;

  for (const match of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)) {
    const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
    if (!hrefMatch?.[1]) continue;
    const stylesheet = `${origin}${normalizeStylesheetHref(hrefMatch[1])}`;
    if (!stylesheets.includes(stylesheet)) stylesheets.push(stylesheet);
  }

  if (stylesheets.length === 0) {
    throw new Error(`No stylesheets found in ${indexPath}`);
  }
  return stylesheets;
}

function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

function handleError(res: Response, error: unknown): void {
  if (error instanceof WorkflowInspectError) {
    sendJson(res, error.body.code === 'WORKFLOW_NOT_FOUND' ? 404 : 400, error.body);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  log('error %s', message);
  sendJson(res, 500, { error: message, code: 'BAD_REQUEST', missing: [] });
}

async function buildReportForWorkflow(
  ctx: HookContext,
  req: Request,
  workflowId: string,
): Promise<{
  report: ReturnType<typeof buildAbcReport>;
  sourceRows: Record<string, unknown>[];
  aggregateRows: Record<string, unknown>[];
}> {
  const entity = await ctx.dbCollections.Workflow.findById(workflowId);
  if (!entity) {
    throw new WorkflowInspectError({
      error: `Workflow ${workflowId} not found`,
      code: 'WORKFLOW_NOT_FOUND',
      missing: ['workflow'],
    });
  }
  const inspected = inspectWorkflowEntity(entity);
  if (!inspected.projectId) {
    inspected.projectId = await resolveProjectId(req, entity, workflowId);
  }
  const { sourceRows, aggregateRows, consistencyRows } = await loadReportTables(req, inspected);
  const answers = loadQuestionnaire(workflowId);
  const report = buildAbcReport({
    inspected,
    sourceRows,
    aggregateRows,
    consistencyRows,
    answers,
  });
  return { report, sourceRows, aggregateRows };
}

function registerRoutes(server: N8nServer, ctx: HookContext): void {
  const base = `/${server.restEndpoint}/deepeval-dashboard`;

  if (!fs.existsSync(bridgePath)) {
    throw new Error(`DeepEval dashboard bridge missing at ${bridgePath}. Run npm run build.`);
  }
  if (!fs.existsSync(path.join(appRoot, 'index.html'))) {
    throw new Error(`DeepEval dashboard app missing at ${appRoot}. Run npm run build.`);
  }

  server.app.get(`${base}/config`, (req, res) => {
    try {
      sendJson(res, 200, {
        mode: config.appUrl ? 'development' : 'production',
        appUrl: config.appUrl ?? `${base}/app/`,
        stylesheets: resolveN8nStylesheets(req),
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  server.app.get(`${base}/bridge.js`, (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(fs.readFileSync(bridgePath, 'utf8'));
  });

  server.app.get(`${base}/workflows/:id/report`, async (req, res) => {
    try {
      const workflowId = String(req.params.id);
      const { report } = await buildReportForWorkflow(ctx, req, workflowId);
      sendJson(res, 200, report);
    } catch (error) {
      handleError(res, error);
    }
  });

  server.app.put(`${base}/workflows/:id/questionnaire`, async (req, res) => {
    try {
      const workflowId = String(req.params.id);
      const body = (req.body ?? {}) as QuestionnaireAnswers;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new WorkflowInspectError({
          error: 'Questionnaire body must be an object map of item id → answer',
          code: 'BAD_REQUEST',
          missing: ['body'],
        });
      }
      const existing = loadQuestionnaire(workflowId);
      const merged: QuestionnaireAnswers = { ...existing, ...body };
      saveQuestionnaire(workflowId, merged);
      const { report } = await buildReportForWorkflow(ctx, req, workflowId);
      sendJson(res, 200, report);
    } catch (error) {
      handleError(res, error);
    }
  });

  server.app.get(`${base}/workflows/:id/report.pdf`, async (req, res) => {
    try {
      const workflowId = String(req.params.id);
      const { report, sourceRows, aggregateRows } = await buildReportForWorkflow(
        ctx,
        req,
        workflowId,
      );
      if (sourceRows.length === 0 || aggregateRows.length === 0) {
        throw new WorkflowInspectError({
          error: 'Source and results Data Tables must be non-empty to export PDF',
          code: 'EMPTY_TABLES',
          missing: [
            ...(sourceRows.length === 0 ? ['sourceRows'] : []),
            ...(aggregateRows.length === 0 ? ['aggregateRows'] : []),
          ],
        });
      }
      const pdf = await buildReportPdf(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="deepeval-abc-${workflowId}.pdf"`);
      res.send(pdf);
    } catch (error) {
      handleError(res, error);
    }
  });

  server.app.get(`${base}/workflows/:id/artifact.zip`, async (req, res) => {
    try {
      const workflowId = String(req.params.id);
      const { report, sourceRows, aggregateRows } = await buildReportForWorkflow(
        ctx,
        req,
        workflowId,
      );
      if (sourceRows.length === 0 || aggregateRows.length === 0) {
        throw new WorkflowInspectError({
          error: 'Source and results Data Tables must be non-empty to export zip',
          code: 'EMPTY_TABLES',
          missing: [
            ...(sourceRows.length === 0 ? ['sourceRows'] : []),
            ...(aggregateRows.length === 0 ? ['aggregateRows'] : []),
          ],
        });
      }
      const pdf = await buildReportPdf(report);
      const zip = await buildArtifactZip({ report, sourceRows, aggregateRows, pdf });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="deepeval-abc-${workflowId}.zip"`);
      res.send(zip);
    } catch (error) {
      handleError(res, error);
    }
  });

  server.app.use(`${base}/app`, (req, res, next) => {
    const relativePath = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
    const filePath = path.join(appRoot, relativePath);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(appRoot))) {
      sendJson(res, 403, { message: 'Forbidden' });
      return;
    }
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      res.sendFile(resolved);
      return;
    }
    const indexPath = path.join(appRoot, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }
    next();
  });
}

const hooks = {
  n8n: {
    ready: [
      async function (this: HookContext, server: N8nServer) {
        log('ready');
        registerRoutes(server, this);
      },
    ],
  },
};

module.exports = hooks;
