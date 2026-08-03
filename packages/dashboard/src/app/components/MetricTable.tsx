import type { JSX } from 'react';
import type { AbcReport } from '../lib/api';

export function DownloadBar(props: { workflowId: string; disabled: boolean }): JSX.Element {
  const open = (kind: 'pdf' | 'zip') => {
    const path =
      kind === 'pdf'
        ? `/rest/deepeval-dashboard/workflows/${props.workflowId}/report.pdf`
        : `/rest/deepeval-dashboard/workflows/${props.workflowId}/artifact.zip`;
    window.open(path, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="dashboard__actions" data-testid="dashboard-downloads">
      <button
        type="button"
        className="dashboard__button"
        disabled={props.disabled}
        onClick={() => open('pdf')}
      >
        Download PDF
      </button>
      <button
        type="button"
        className="dashboard__button"
        disabled={props.disabled}
        onClick={() => open('zip')}
      >
        Download Zip Artifact
      </button>
    </div>
  );
}

export function MetricTable(props: { report: AbcReport }): JSX.Element {
  return (
    <section className="dashboard__section" data-testid="dashboard-metrics">
      <h2>DeepEval results (via Aggregate)</h2>
      <table className="dashboard__table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Mean</th>
            <th>Pass rate</th>
            <th>Fails</th>
          </tr>
        </thead>
        <tbody>
          {props.report.deepeval.metrics.map((metric) => (
            <tr key={metric.name}>
              <td>{metric.name}</td>
              <td>{metric.meanScore.toFixed(3)}</td>
              <td>{(metric.passRate * 100).toFixed(1)}%</td>
              <td>{metric.failCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.report.deepeval.topFailures.length > 0 ? (
        <>
          <h2>Top failures</h2>
          <table className="dashboard__table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Metric</th>
                <th>Score</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {props.report.deepeval.topFailures.map((failure) => (
                <tr key={`${failure.runId}:${failure.metric}:${failure.score}`}>
                  <td>{failure.runId}</td>
                  <td>{failure.metric}</td>
                  <td>{failure.score.toFixed(3)}</td>
                  <td>{failure.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
