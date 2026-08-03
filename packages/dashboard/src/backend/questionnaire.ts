import fs from 'node:fs';
import path from 'node:path';
import type { QuestionnaireAnswers } from '../shared/types';

function storageRoot(): string {
  const userFolder = process.env.N8N_USER_FOLDER?.trim();
  if (userFolder) {
    return path.join(userFolder, 'deepeval-dashboard', 'questionnaire');
  }
  return path.join(process.cwd(), '.deepeval-dashboard', 'questionnaire');
}

function answersPath(workflowId: string): string {
  return path.join(storageRoot(), `${workflowId}.json`);
}

export function loadQuestionnaire(workflowId: string): QuestionnaireAnswers {
  const filePath = answersPath(workflowId);
  if (!fs.existsSync(filePath)) return {};
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as QuestionnaireAnswers;
  return raw && typeof raw === 'object' ? raw : {};
}

export function saveQuestionnaire(workflowId: string, answers: QuestionnaireAnswers): void {
  const dir = storageRoot();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(answersPath(workflowId), `${JSON.stringify(answers, null, 2)}\n`, 'utf8');
}
