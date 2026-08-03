import type { JSX } from 'react';
import type { InspectErrorBody } from '../lib/api';

export function SetupPanel(props: {
  title: string;
  message: string;
  missing?: string[];
}): JSX.Element {
  return (
    <div className="dashboard__setup" data-testid="dashboard-setup">
      <h2>{props.title}</h2>
      <p>{props.message}</p>
      {props.missing && props.missing.length > 0 ? (
        <ul>
          {props.missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      <p>
        Wire <strong>DeepEval Trigger</strong> → metrics → <strong>DeepEval Aggregate</strong> with
        Data Table IDs, run the workflow, then reopen this tab.
      </p>
    </div>
  );
}

export function setupFromError(error: unknown): {
  title: string;
  message: string;
  missing: string[];
} | null {
  if (!error || typeof error !== 'object' || !('body' in error)) return null;
  const body = (error as { body?: InspectErrorBody }).body;
  if (!body) return null;
  return {
    title: 'Workflow not ready for ABC report',
    message: body.error,
    missing: body.missing ?? [],
  };
}
