import type {
  AbcReport,
  InspectErrorBody,
  QuestionnaireAnswer,
  QuestionnaireAnswers,
} from '../../shared/types';

const BASE = '/rest/deepeval-dashboard';

export interface DashboardConfig {
  mode: string;
  appUrl: string;
  stylesheets: string[];
}

export async function fetchDashboardConfig(): Promise<DashboardConfig> {
  const response = await fetch(`${BASE}/config`, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to load dashboard config (${response.status})`);
  }
  return response.json() as Promise<DashboardConfig>;
}

export async function fetchReport(workflowId: string): Promise<AbcReport> {
  const response = await fetch(`${BASE}/workflows/${workflowId}/report`, {
    credentials: 'include',
  });
  if (!response.ok) {
    const body = (await response.json()) as InspectErrorBody;
    throw Object.assign(new Error(body.error ?? `Report failed (${response.status})`), {
      body,
    });
  }
  return response.json() as Promise<AbcReport>;
}

export async function saveQuestionnaire(
  workflowId: string,
  answers: QuestionnaireAnswers,
): Promise<AbcReport> {
  const response = await fetch(`${BASE}/workflows/${workflowId}/questionnaire`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(answers),
  });
  if (!response.ok) {
    const body = (await response.json()) as InspectErrorBody;
    throw Object.assign(new Error(body.error ?? `Questionnaire save failed (${response.status})`), {
      body,
    });
  }
  return response.json() as Promise<AbcReport>;
}

export function downloadUrl(workflowId: string, kind: 'pdf' | 'zip'): string {
  return kind === 'pdf'
    ? `${BASE}/workflows/${workflowId}/report.pdf`
    : `${BASE}/workflows/${workflowId}/artifact.zip`;
}

export type { AbcReport, InspectErrorBody, QuestionnaireAnswer, QuestionnaireAnswers };
