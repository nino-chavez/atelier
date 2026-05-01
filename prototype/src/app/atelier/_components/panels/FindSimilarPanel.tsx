'use client';

// "Before you start" — find_similar surface (M5 / ARCH 6.4 + ADR-006 + US-6.5).
//
// Calls the in-process server action runFindSimilar() which dispatches to
// the production handler. Renders ARCH 6.4.1's two-band response: primary
// matches above the default threshold prominently, weak suggestions in a
// labeled secondary region. Surfaces degraded=true via the same banner
// pattern other panels use, so the analyst knows when keyword fallback
// served the response (US-6.5).

import { useState, useTransition } from 'react';

import styles from './Panel.module.css';
import { runFindSimilar, type FindSimilarActionResult } from './find-similar-action.ts';

export default function FindSimilarPanel() {
  const [query, setQuery] = useState('');
  const [traceId, setTraceId] = useState('');
  const [result, setResult] = useState<FindSimilarActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: { preventDefault(): void }): void {
    e.preventDefault();
    const q = query;
    const t = traceId;
    startTransition(async () => {
      const r = await runFindSimilar(q, t);
      setResult(r);
    });
  }

  const response = result?.response ?? null;
  const primary = response?.primary_matches ?? [];
  const weak = response?.weak_suggestions ?? [];
  const degraded = response?.degraded ?? false;
  const thresholds = response?.thresholds_used ?? null;

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Before you start (find_similar)</h2>
        {response && (
          <span className={styles.count}>
            {primary.length} primary{weak.length > 0 ? ` · ${weak.length} weak` : ''}
          </span>
        )}
      </div>

      <form className={styles.findSimilarForm} onSubmit={onSubmit}>
        <div className={styles.findSimilarRow}>
          <input
            className={styles.findSimilarInput}
            type="text"
            placeholder="Describe the work you're considering"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={pending}
            aria-label="find_similar query"
          />
        </div>
        <div className={styles.findSimilarRow}>
          <input
            className={`${styles.findSimilarInput} ${styles.findSimilarTrace}`}
            type="text"
            placeholder="Trace scope"
            value={traceId}
            onChange={(e) => setTraceId(e.target.value)}
            disabled={pending}
            aria-label="optional trace_id scope"
          />
          <button
            type="submit"
            className={styles.findSimilarSubmit}
            disabled={pending || query.trim().length === 0}
          >
            {pending ? 'Running' : 'Search'}
          </button>
        </div>
      </form>

      {result?.error && (
        <div className={styles.findSimilarError}>
          {result.error.code}: {result.error.message}
        </div>
      )}

      {degraded && response && (
        <div className={styles.degraded}>
          Semantic search is degraded — keyword fallback served this response (US-6.5). Set
          <span className={styles.kbd}> OPENAI_API_KEY </span>or whichever{' '}
          <span className={styles.kbd}>find_similar.embeddings.api_key_env</span> the project
          configures, then re-run.
        </div>
      )}

      {response && primary.length === 0 && weak.length === 0 && (
        <div className={styles.empty}>
          No matches at thresholds {thresholds ? `${thresholds.default} / ${thresholds.weak}` : ''}.
          {result?.trace_id ? ` Trace scope: ${result.trace_id}.` : ''}
        </div>
      )}

      {primary.length > 0 && (
        <>
          <div className={styles.findSimilarBandHeading}>Primary matches</div>
          <ul className={styles.list}>
            {primary.map((m) => (
              <li key={`primary-${m.source_ref}`} className={styles.row}>
                <div className={styles.rowHead}>
                  <span className={styles.rowTitle}>{m.source_ref}</span>
                  <span className={styles.findSimilarScore}>{m.score.toFixed(3)}</span>
                </div>
                <div className={styles.findSimilarExcerpt}>{m.excerpt}</div>
                <div className={styles.tags}>
                  {m.trace_ids.map((tid) => (
                    <span key={tid} className={`${styles.tag} ${styles.tagAccent}`}>
                      {tid}
                    </span>
                  ))}
                  <span className={styles.tag}>{m.source_kind}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {weak.length > 0 && (
        <>
          <div className={styles.findSimilarBandHeading}>Weak suggestions</div>
          <ul className={styles.list}>
            {weak.map((m) => (
              <li key={`weak-${m.source_ref}`} className={styles.row}>
                <div className={styles.rowHead}>
                  <span className={styles.rowTitle}>{m.source_ref}</span>
                  <span className={`${styles.findSimilarScore} ${styles.findSimilarScoreWeak}`}>
                    {m.score.toFixed(3)}
                  </span>
                </div>
                <div className={styles.findSimilarExcerpt}>{m.excerpt}</div>
                <div className={styles.tags}>
                  {m.trace_ids.map((tid) => (
                    <span key={tid} className={styles.tag}>
                      {tid}
                    </span>
                  ))}
                  <span className={styles.tag}>{m.source_kind}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className={styles.affordance}>
        Per ARCH 6.4.1 thresholds and ADR-006 / ADR-041. Index repopulates from the corpus via{' '}
        <code>npm run embed:run</code>; eval gate runs via{' '}
        <code>npm run eval:find_similar</code>.
      </div>
    </section>
  );
}
