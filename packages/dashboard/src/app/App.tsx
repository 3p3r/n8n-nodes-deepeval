import { type JSX, useCallback, useEffect, useState } from 'react';
import { DownloadBar, MetricTable } from './components/MetricTable';
import { PillarSection } from './components/PillarSection';
import { SetupPanel, setupFromError } from './components/SetupPanel';
import type { AbcReport, QuestionnaireAnswer } from './lib/api';
import { fetchReport, saveQuestionnaire } from './lib/api';

function workflowIdFromQuery(): string | null {
  const value = new URLSearchParams(window.location.search).get('workflowId');
  return value && value.length > 0 ? value : null;
}

export function App(): JSX.Element {
  const [workflowId, setWorkflowId] = useState<string | null>(workflowIdFromQuery);
  const [report, setReport] = useState<AbcReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<ReturnType<typeof setupFromError>>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setSetup(null);
    try {
      const next = await fetchReport(id);
      setReport(next);
    } catch (err) {
      setReport(null);
      const panel = setupFromError(err);
      if (panel) setSetup(panel);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = workflowIdFromQuery();
    setWorkflowId(id);
    if (id) void load(id);
  }, [load]);

  const onManualSave = async (itemId: string, answer: QuestionnaireAnswer) => {
    if (!workflowId) return;
    const next = await saveQuestionnaire(workflowId, { [itemId]: answer });
    setReport(next);
  };

  if (!workflowId) {
    return (
      <div className="dashboard">
        <SetupPanel
          title="Open a workflow"
          message="Open a workflow in the n8n editor, then open the Benchmarks tab. The dashboard reads the workflow id from the URL."
        />
      </div>
    );
  }

  return (
    <div className="dashboard" data-testid="deepeval-dashboard">
      <header className="dashboard__header">
        <h1>Benchmarks</h1>
        <p className="dashboard__meta">
          {report ? report.workflowName : 'DeepEval ABC'}
          {report ? ` · ${report.generatedAt}` : ''}
          {` · ${workflowId}`}
        </p>
      </header>

      {loading ? <p>Loading report…</p> : null}
      {error ? (
        <p className="dashboard__error" data-testid="dashboard-error">
          {error}
        </p>
      ) : null}
      {setup ? (
        <SetupPanel title={setup.title} message={setup.message} missing={setup.missing} />
      ) : null}

      {report ? (
        <>
          <p className="dashboard__score" data-testid="dashboard-overall-score">
            Overall:{' '}
            {report.overallScore === null
              ? 'n/a (answer manual items)'
              : `${report.overallScore.toFixed(1)}%`}
          </p>
          <div className="dashboard__pillars">
            {[
              report.pillars.taskValidity,
              report.pillars.outcomeValidity,
              report.pillars.benchmarkReporting,
            ].map((pillar) => (
              <div className="dashboard__pillar" key={pillar.id}>
                <h2>{pillar.title}</h2>
                <p>{pillar.score === null ? 'n/a' : `${pillar.score.toFixed(1)}%`}</p>
              </div>
            ))}
          </div>
          <DownloadBar
            workflowId={workflowId}
            disabled={report.tables.sourceRowCount === 0 || report.tables.resultsRowCount === 0}
          />
          <PillarSection pillar={report.pillars.taskValidity} onManualSave={onManualSave} />
          <PillarSection pillar={report.pillars.outcomeValidity} onManualSave={onManualSave} />
          <PillarSection pillar={report.pillars.benchmarkReporting} onManualSave={onManualSave} />
          <MetricTable report={report} />
        </>
      ) : null}
    </div>
  );
}
