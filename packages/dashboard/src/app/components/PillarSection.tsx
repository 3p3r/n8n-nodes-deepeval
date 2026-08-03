import { type JSX, useState } from 'react';
import type { AbcChecklistItem, AbcPillar, QuestionnaireAnswer } from '../../shared/types';

function Badge(props: { status: AbcChecklistItem['status'] }): JSX.Element {
  return (
    <span className={`dashboard__badge dashboard__badge--${props.status}`}>{props.status}</span>
  );
}

export function ChecklistItemRow(props: {
  item: AbcChecklistItem;
  onManualSave: (id: string, answer: QuestionnaireAnswer) => Promise<void>;
}): JSX.Element {
  const [status, setStatus] = useState<QuestionnaireAnswer['status']>(
    props.item.status === 'pass' ||
      props.item.status === 'fail' ||
      props.item.status === 'partial' ||
      props.item.status === 'na'
      ? props.item.status
      : 'pass',
  );
  const [notes, setNotes] = useState(props.item.notes ?? '');
  const [saving, setSaving] = useState(false);
  const showManual =
    props.item.source === 'manual' ||
    props.item.status === 'unanswered' ||
    props.item.status === 'manual';

  return (
    <div className="dashboard__item" data-testid={`checklist-${props.item.id}`}>
      <div className="dashboard__item-head">
        <strong>
          {props.item.id} — {props.item.title}
        </strong>
        <Badge status={props.item.status} />
        <span className="dashboard__badge">{props.item.source}</span>
      </div>
      <p className="dashboard__evidence">{props.item.description}</p>
      <p className="dashboard__evidence">{props.item.evidence}</p>
      {showManual ? (
        <div className="dashboard__manual">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as QuestionnaireAnswer['status'])}
            aria-label={`${props.item.id} status`}
          >
            <option value="pass">pass</option>
            <option value="fail">fail</option>
            <option value="partial">partial</option>
            <option value="na">na</option>
          </select>
          <textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notes (optional)"
            aria-label={`${props.item.id} notes`}
          />
          <button
            type="button"
            className="dashboard__button"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void props
                .onManualSave(props.item.id, {
                  status,
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                })
                .finally(() => setSaving(false));
            }}
          >
            {saving ? 'Saving…' : 'Save answer'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PillarSection(props: {
  pillar: AbcPillar;
  onManualSave: (id: string, answer: QuestionnaireAnswer) => Promise<void>;
}): JSX.Element {
  return (
    <section className="dashboard__section" data-testid={`pillar-${props.pillar.id}`}>
      <h2>
        {props.pillar.title}{' '}
        {props.pillar.score === null ? '(n/a)' : `${props.pillar.score.toFixed(1)}%`}
      </h2>
      {props.pillar.items.map((item) => (
        <ChecklistItemRow key={item.id} item={item} onManualSave={props.onManualSave} />
      ))}
    </section>
  );
}
