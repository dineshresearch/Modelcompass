import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { fmtMs, fmtSec, fmtUsd, letter, timeAgo } from './api.js'

/* ------------------------------ icons ------------------------------ */
const sp = (size) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
})
export const IconSearch = ({ size = 15 }) => <svg {...sp(size)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
export const IconPlay = ({ size = 13 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>
export const IconUser = ({ size = 17 }) => <svg {...sp(size)}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></svg>
export const IconHome = ({ size = 17 }) => <svg {...sp(size)}><path d="m3 10.5 9-7.5 9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
export const IconLayers = ({ size = 17 }) => <svg {...sp(size)}><path d="m12 2 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>
export const IconBars = ({ size = 17 }) => <svg {...sp(size)}><path d="M6 20v-8" /><path d="M12 20V4" /><path d="M18 20v-5" /><path d="M3 20h18" /></svg>
export const IconSparkle = ({ size = 17 }) => <svg {...sp(size)}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" /></svg>
export const IconClock = ({ size = 17 }) => <svg {...sp(size)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
export const IconGear = ({ size = 17 }) => <svg {...sp(size)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
export const IconChat = ({ size = 14 }) => <svg {...sp(size)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
export const IconCheck = ({ size = 16, className = '' }) => <svg {...sp(size)} className={className}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5.5" /></svg>
export const IconAlert = ({ size = 16, className = '' }) => <svg {...sp(size)} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5h.01" /></svg>
export const IconCrown = ({ size = 13 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 3.5L12 4l4.5 6.5L21 7l-1.8 12H4.8z" /></svg>
export const IconInfo = ({ size = 16 }) => <svg {...sp(size)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5h.01" /></svg>
export const IconBolt = ({ size = 15 }) => <svg {...sp(size)}><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
export const IconShield = ({ size = 15 }) => <svg {...sp(size)}><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" /><path d="m9 12 2 2 4-4.5" /></svg>
export const IconCompass = ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" /></svg>

export function Markdown({ text }) {
  const html = DOMPurify.sanitize(marked.parse(text || '', { breaks: true, gfm: true }))
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}

/* ------------------------------ chrome ------------------------------ */
export function TopBar({ onRun, running, searchRef, searchQ, setSearchQ, searchOpen, setSearchOpen, results, onPickHistory, onPickModel }) {
  return (
    <header className="topbar">
      <div className="tb-left">
        <span className="logo-badge"><IconCompass /></span>
        <span className="tb-title">Model Compass</span>
      </div>
      <div className="tb-search">
        <IconSearch />
        <input
          ref={searchRef}
          value={searchQ}
          placeholder="Search runs, models, or evaluations..."
          onChange={(e) => { setSearchQ(e.target.value); setSearchOpen(true) }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
        />
        <kbd>K</kbd>
        {searchOpen && searchQ.trim() && (
          <div className="search-drop">
            {results.history.length === 0 && results.models.length === 0 && (
              <div className="sd-empty">No matches for “{searchQ}”</div>
            )}
            {results.history.length > 0 && <div className="sd-group">Runs</div>}
            {results.history.map((h) => (
              <button key={h.id} className="sd-item" onMouseDown={() => onPickHistory(h.id)}>
                <span className="sd-main">{h.prompt.slice(0, 64)}{h.prompt.length > 64 ? '…' : ''}</span>
                <span className="sd-sub">{timeAgo(h.created_at)} · {h.n_ok}/{h.n_models} ok{h.best_fit ? ` · best: ${h.best_fit}` : ''}</span>
              </button>
            ))}
            {results.models.length > 0 && <div className="sd-group">Models</div>}
            {results.models.map((m) => (
              <button key={m.id} className="sd-item" onMouseDown={() => onPickModel(m.id)}>
                <span className="sd-main">{m.label}</span>
                <span className="sd-sub">{m.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="tb-right">
        <button className="btn-primary" onClick={onRun} disabled={running}>
          <IconPlay /> {running ? 'Running…' : 'Run Comparison'}
        </button>
        <span className="tb-sep" />
        <button className="avatar-btn" title="Local PoC session — no auth in this prototype"><IconUser /></button>
      </div>
    </header>
  )
}

const NAV = [
  ['dashboard', 'Dashboard', IconHome],
  ['compare', 'Compare', IconLayers],
  ['evaluate', 'Evaluate', IconBars],
  ['recommend', 'Recommend', IconSparkle],
  ['history', 'History', IconClock],
  ['settings', 'Settings', IconGear],
]

export function SideNav({ view, setView }) {
  return (
    <nav className="sidenav">
      {NAV.map(([id, label, Icon]) => (
        <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
          <Icon /> {label}
        </button>
      ))}
    </nav>
  )
}

/* ------------------------------ dashboard ------------------------------ */
export function PromptCard({ prompt, setPrompt, models, selected, toggleModel, onCompare, running }) {
  return (
    <section className="card prompt-card">
      <div className="label-row"><IconChat /> Your prompt</div>
      <input
        className="prompt-input"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask all models the same question…"
        onKeyDown={(e) => { if (e.key === 'Enter') onCompare() }}
      />
      <div className="label-row mt"><IconLayers /> Models to compare</div>
      <div className="check-row">
        {models.map((m) => (
          <label key={m.id} className="check-chip" title={m.blurb}>
            <input
              type="checkbox"
              checked={selected.includes(m.id)}
              onChange={() => toggleModel(m.id)}
              disabled={running}
            />
            {m.label}
          </label>
        ))}
        <button className="btn-primary compare-btn" onClick={onCompare} disabled={running || selected.length < 2 || !prompt.trim()}>
          <IconPlay /> {running ? 'Comparing…' : 'Compare Models'}
        </button>
      </div>
    </section>
  )
}

export function RecommendCard({ recommendation: rec, meta }) {
  return (
    <aside className="card recommend-card">
      {rec ? (
        <>
          <div className="rec-head">
            <span className="rec-icon"><IconSparkle size={18} /></span>
            <div className="rec-title"><span className="rec-blue">Recommended:</span> <strong>{rec.strategy}</strong></div>
          </div>
          <ul className="rec-list">
            <li><IconCheck className="ok" /> {rec.strategy === 'Quality Escalation' ? 'Escalated to clear the quality threshold' : 'Best quality/cost tradeoff'}</li>
            <li><IconCheck className="ok" /> Estimated latency {rec.estimated_latency_s}s</li>
            <li><IconCheck className="ok" /> Cost per request {fmtUsd(rec.cost_per_request)}</li>
          </ul>
          <div className="rec-model">Routes to <strong style={{ color: meta[rec.model]?.color || '#2563eb' }}>{rec.model_label}</strong></div>
        </>
      ) : (
        <>
          <div className="rec-head">
            <span className="rec-icon"><IconSparkle size={18} /></span>
            <div className="rec-title"><span className="rec-blue">Recommended:</span> <strong>—</strong></div>
          </div>
          <p className="rec-empty">Run a comparison to get a routing recommendation with quality, latency and cost tradeoffs.</p>
        </>
      )}
      <svg className="rec-wave" viewBox="0 0 200 80" aria-hidden="true">
        <path d="M0 60 C 40 20, 80 70, 120 40 S 180 10, 200 30 V80 H0 Z" fill="#bfdbfe" opacity="0.55" />
        <path d="M0 70 C 50 40, 90 80, 140 55 S 190 30, 200 45 V80 H0 Z" fill="#93c5fd" opacity="0.5" />
      </svg>
    </aside>
  )
}

export function PreviewCard({ run, meta, index, best, quality, onOpen }) {
  const q = quality?.[run.model]
  const preview = run.status === 'ok'
    ? (run.output || '').replace(/[#*|>`-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
    : run.status === 'error' ? run.error : ''
  return (
    <article className={`card preview-card ${best ? 'best' : ''} state-${run.status}`} onClick={onOpen} title="Open full comparison">
      <div className="pc-head">
        <strong>Model {letter(index)}</strong>
        <span className="model-chip">{meta[run.model]?.label || run.model}</span>
        {best && <span className="best-badge"><IconCrown /> Best Fit</span>}
      </div>
      <div className="pc-label">Answer (preview)</div>
      {run.status === 'pending' ? (
        <div className="skeleton"><div /><div /><div /></div>
      ) : run.status === 'error' ? (
        <p className="pc-preview err">Isolated failure: {preview}</p>
      ) : (
        <p className="pc-preview">{preview}{(run.output || '').length > 200 ? '…' : ''}</p>
      )}
      <div className="pc-metrics">
        <div title={q == null ? 'Quality unavailable — the judge failed for this run. Re-run the comparison to retry.' : undefined}>
          <span className="m-label">Quality</span>
          <span className="m-value">{q != null ? `${q}/100` : '—'}</span>
          <div className="q-bar"><div style={{ width: `${q ?? 0}%` }} /></div>
        </div>
        <div>
          <span className="m-label">Latency</span>
          <span className="m-value">{run.status === 'ok' ? fmtSec(run.latency_ms) : '—'}</span>
        </div>
        <div>
          <span className="m-label">Cost</span>
          <span className="m-value">{run.status === 'ok' ? fmtUsd(run.est_cost_usd) : '—'}</span>
        </div>
      </div>
    </article>
  )
}

const PALETTE = ['#93c5fd', '#2563eb', '#bfdbfe', '#60a5fa']

export function TradeoffsChart({ runs, quality }) {
  const ok = runs.filter((r) => r.status === 'ok')
  if (ok.length === 0) return <p className="muted small">No successful runs to chart yet.</p>
  const groups = [
    { label: 'Quality', sub: '(higher is better)', val: (r) => (quality?.[r.model] ?? 0) / 100, fmt: (r) => quality?.[r.model] != null ? ((quality[r.model]) / 100).toFixed(2) : '—' },
    { label: 'Latency (s)', sub: '(lower is better)', val: (r) => Math.min(1, r.latency_ms / 10000), fmt: (r) => fmtSec(r.latency_ms) },
    { label: 'Cost ($)', sub: '(lower is better)', val: (r) => Math.min(1, r.est_cost_usd * 10), fmt: (r) => fmtUsd(r.est_cost_usd).slice(1) },
  ]
  const W = 640, H = 252, padL = 34, padT = 20, padB = 44
  const plotH = H - padT - padB, plotW = W - padL - 8
  const groupW = plotW / groups.length
  const n = ok.length
  const barW = Math.min(36, (groupW * 0.6) / n)
  const gap = 6
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Model tradeoffs chart">
      {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((t) => (
        <g key={t}>
          <text x={padL - 8} y={padT + plotH * (1 - t) + 3} textAnchor="end" className="tick">{t.toFixed(1)}</text>
          <line x1={padL} x2={W - 8} y1={padT + plotH * (1 - t)} y2={padT + plotH * (1 - t)} className="grid" />
        </g>
      ))}
      {groups.map((g, gi) => {
        const totalW = n * barW + (n - 1) * gap
        const x0 = padL + gi * groupW + (groupW - totalW) / 2
        return (
          <g key={g.label}>
            {ok.map((r, i) => {
              const h = Math.max(2, g.val(r) * plotH)
              const x = x0 + i * (barW + gap)
              return (
                <g key={r.model}>
                  <rect x={x} y={padT + plotH - h} width={barW} height={h} rx="2" fill={PALETTE[i % PALETTE.length]} />
                  <text x={x + barW / 2} y={padT + plotH - h - 5} textAnchor="middle" className="barval">{g.fmt(r)}</text>
                </g>
              )
            })}
            <text x={padL + gi * groupW + groupW / 2} y={H - 26} textAnchor="middle" className="xlab">{g.label}</text>
            <text x={padL + gi * groupW + groupW / 2} y={H - 12} textAnchor="middle" className="xsub">{g.sub}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function ChartLegend({ runs }) {
  const ok = runs.filter((r) => r.status === 'ok')
  return (
    <div className="legend">
      {ok.map((r, i) => (
        <span key={r.model}><i style={{ background: PALETTE[i % PALETTE.length] }} /> Model {letter(runs.indexOf(r))}</span>
      ))}
    </div>
  )
}

export function WhyCard({ recommendation: rec }) {
  return (
    <section className="card why-card">
      <div className="why-head"><IconInfo /> <h2>Why this recommendation?</h2></div>
      {rec ? (
        <ul className="why-list">
          {rec.reasons.map((r, i) => (
            <li key={i}>{r.ok ? <IconCheck className="ok" /> : <IconAlert className="warn" />} <span>{r.text}</span></li>
          ))}
        </ul>
      ) : (
        <p className="muted small">The recommendation engine explains its pick here after a comparison: latency SLO fit, cost rank among high-quality options, and judge quality.</p>
      )}
    </section>
  )
}

export function StatusBar({ settings, onToggleEscalation, confidence }) {
  const conf = confidence || '—'
  return (
    <div className="card status-bar">
      <span className="sb-item">
        <IconBolt /> Adaptive escalation:
        <button className={`pill ${settings.adaptive_escalation ? 'green' : 'gray'}`} onClick={onToggleEscalation} title="Toggle escalation for the current and future comparisons">
          {settings.adaptive_escalation ? 'ON' : 'OFF'}
        </button>
      </span>
      <span className="sb-sep" />
      <span className="sb-item">
        <IconShield /> Evaluation confidence:
        <span className={`pill ${conf === '—' ? 'gray' : 'blue'}`}>{conf === '—' ? '—' : conf[0].toUpperCase() + conf.slice(1)}</span>
      </span>
    </div>
  )
}

/* ------------------------------ compare / evaluate ------------------------------ */
export function FullCard({ run, meta, index }) {
  return (
    <article className={`card full-card state-${run.status}`}>
      <div className="pc-head">
        <strong>Model {letter(index)}</strong>
        <span className="model-chip">{meta[run.model]?.label || run.model}</span>
        <span className={`status-chip ${run.status}`}>{run.status === 'pending' ? 'running' : run.status}</span>
      </div>
      {run.status === 'ok' && (
        <div className="card-metrics">
          <span>{fmtMs(run.latency_ms)}</span>
          <span>{run.input_tokens} / {run.output_tokens} tok{run.tokens_estimated ? '*' : ''}</span>
          <span>{fmtUsd(run.est_cost_usd)}</span>
          {run.retried && <span className="retried-note" title="The model spent its first token budget on reasoning; the run was automatically retried with a doubled budget.">auto-retried (2× budget)</span>}
        </div>
      )}
      <div className="card-body">
        {run.status === 'pending' && <div className="skeleton"><div /><div /><div /><div /></div>}
        {run.status === 'error' && (
          <div className="error-box"><strong>Isolated failure</strong><p>{run.error}</p><p className="muted small">Other models are unaffected.</p></div>
        )}
        {run.status === 'ok' && <Markdown text={run.output} />}
      </div>
    </article>
  )
}

export function MetricsTable({ runs, meta, totals, judgeMetrics }) {
  const ok = runs.filter((r) => r.status === 'ok')
  const maxLat = Math.max(1, ...ok.map((r) => r.latency_ms))
  return (
    <section className="card">
      <div className="metrics-head">
        <h2>Performance comparison</h2>
        {totals && <span className="muted small">wall clock {fmtMs(totals.wall_latency_ms)} · total est. cost {fmtUsd(totals.cost_usd)}{judgeMetrics ? ' (incl. judge)' : ''}</span>}
      </div>
      <div className="table-wrap">
        <table className="light-table">
          <thead><tr><th>Model</th><th>Status</th><th>Latency</th><th>Tokens (in / out)</th><th>Est. cost</th></tr></thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.model}>
                <td><i className="dot" style={{ background: PALETTE[i % PALETTE.length] }} /> {meta[r.model]?.label || r.model}</td>
                <td><span className={`status-chip ${r.status}`}>{r.status === 'pending' ? 'running' : r.status}</span></td>
                <td className="lat-cell">
                  {r.status === 'ok' ? (<><div className="lat-bar"><div style={{ width: `${Math.max(4, (r.latency_ms / maxLat) * 100)}%` }} /></div><span>{fmtMs(r.latency_ms)}</span></>) : r.status === 'pending' ? '…' : '—'}
                </td>
                <td>{r.status === 'ok' ? `${r.input_tokens} / ${r.output_tokens}${r.tokens_estimated ? '*' : ''}` : '—'}</td>
                <td>{r.status === 'ok' ? fmtUsd(r.est_cost_usd) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">* token counts estimated (~4 chars/token) when the API omits usage. Costs use illustrative placeholder pricing.</p>
    </section>
  )
}

function ConfChip({ level }) {
  return <span className={`conf-chip ${level || 'low'}`}>{level || 'low'}</span>
}

export function SynthesisPanel({ synthesis: s, judgeMetrics }) {
  const failed = s.fallback || s.judge_error
  return (
    <section className="card">
      <div className="metrics-head">
        <h2>Combined view — synthesis</h2>
        <span className="muted small">overall confidence <ConfChip level={s.overall_confidence} /></span>
      </div>
      {failed && (
        <p className="syn-warn">Judge scoring failed{s.judge_error ? ` (${s.judge_error})` : ''} — showing a heuristic fallback with no quality scores. Re-run the comparison to retry the judge.</p>
      )}
      <p className="syn-banner">{failed
        ? 'Heuristic fallback (lexical overlap only) — no semantic judge artifact was produced. Original answers are preserved unaltered.'
        : `Separate judge artifact (${s.judge_model || 'unknown'}). Original answers are preserved unaltered — nothing was merged.`}</p>
      {s.agreements?.length > 0 && (<div className="syn-block"><h3>Agreements</h3><ul>{s.agreements.map((a, i) => <li key={i}>{a}</li>)}</ul></div>)}
      {s.differences?.length > 0 && (
        <div className="syn-block"><h3>Differences</h3>
          {s.differences.map((d, i) => (
            <div className="diff" key={i}>
              <div className="diff-topic">{d.topic}</div>
              <ul>{Object.entries(d.positions || {}).map(([m, p]) => <li key={m}><strong>{m}:</strong> {p}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {s.weaknesses?.length > 0 && (
        <div className="syn-block"><h3>Possible weaknesses</h3>
          <ul>{s.weaknesses.map((w, i) => <li key={i}><strong>{w.model}</strong> <ConfChip level={w.confidence} /> — {w.issue}</li>)}</ul>
        </div>
      )}
      {s.uncertainty_notes?.length > 0 && (
        <div className="syn-block uncertainty"><h3>Uncertainty</h3><ul>{s.uncertainty_notes.map((u, i) => <li key={i}>{u}</li>)}</ul></div>
      )}
      {judgeMetrics && judgeMetrics.est_cost_usd > 0 && (
        <p className="muted small">Judge call: {fmtMs(judgeMetrics.latency_ms)} · {judgeMetrics.input_tokens}/{judgeMetrics.output_tokens} tokens · {fmtUsd(judgeMetrics.est_cost_usd)}</p>
      )}
    </section>
  )
}

export function ScoresTable({ synthesis, meta, runs }) {
  const scores = synthesis?.scores || {}
  const ok = runs.filter((r) => r.status === 'ok')
  if (ok.length === 0) return null
  const anyScore = ok.some((r) => scores[meta[r.model]?.label] || scores[r.model])
  return (
    <section className="card">
      <h2>Judge quality scores</h2>
      {!anyScore ? (
        <p className="syn-warn">No quality scores for this run — the judge failed or synthesis was disabled. Quality shows as “—” and the recommendation falls back to latency + cost. Re-run the comparison to retry.</p>
      ) : (
      <div className="table-wrap">
        <table className="light-table">
          <thead><tr><th>Model</th><th>Quality</th><th>Rationale</th></tr></thead>
          <tbody>
            {ok.map((r) => {
              const label = meta[r.model]?.label || r.model
              const s = scores[label] || scores[r.model]
              return (
                <tr key={r.model}>
                  <td>{label}</td>
                  <td><strong>{s ? `${s.quality}/100` : '—'}</strong></td>
                  <td className="muted">{s?.rationale || 'not scored'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}
    </section>
  )
}

export function PreferencePanel({ runs, meta, preferred, setPreferred, reason, setReason, saved, onSave, onChange, onExport }) {
  const ok = runs.filter((r) => r.status === 'ok')
  return (
    <section className="card">
      <div className="metrics-head">
        <h2>Your preference</h2>
        <div className="export-row">
          <span className="muted small">Export</span>
          <button className="ghost-btn" onClick={() => onExport('json')}>JSON</button>
          <button className="ghost-btn" onClick={() => onExport('md')}>Markdown</button>
        </div>
      </div>
      {saved ? (
        <div className="saved-row">
          <p>Saved: <strong>{meta[preferred]?.label || preferred}</strong>{reason && <> — “{reason}”</>}</p>
          <button className="ghost-btn" onClick={onChange}>Change</button>
        </div>
      ) : (
        <>
          <p className="muted small">Which response do you prefer, and why? Preferences are stored as evaluation data.</p>
          <div className="pref-chips">
            {ok.map((r) => (
              <button key={r.model} className={`pref-chip ${preferred === r.model ? 'on' : ''}`} onClick={() => setPreferred(r.model)}>
                {meta[r.model]?.label || r.model}
              </button>
            ))}
          </div>
          <textarea rows={2} placeholder="Reason (optional): accuracy, structure, tone, citations…" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div><button className="btn-primary" disabled={!preferred} onClick={onSave}>Save preference</button></div>
        </>
      )}
    </section>
  )
}

/* ------------------------------ history / settings ------------------------------ */
export function HistoryTable({ history, onOpen, onExport }) {
  return (
    <section className="card">
      <h2>Experiment history</h2>
      {history.length === 0 ? <p className="muted small">No experiments yet.</p> : (
        <div className="table-wrap">
          <table className="light-table">
            <thead><tr><th>When</th><th>Prompt</th><th>Models</th><th>Best fit</th><th>Preferred</th><th>Est. cost</th><th></th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="muted">{timeAgo(h.created_at)}</td>
                  <td className="hist-prompt-cell">{h.prompt.slice(0, 60)}{h.prompt.length > 60 ? '…' : ''}</td>
                  <td>{h.n_ok}/{h.n_models} ok</td>
                  <td>{h.best_fit || '—'}{h.strategy ? <span className="muted small"> · {h.strategy}</span> : null}</td>
                  <td>{h.preferred_model ? 'yes' : '—'}</td>
                  <td>{fmtUsd(h.total_cost_usd)}</td>
                  <td className="row-actions">
                    <button className="ghost-btn" onClick={() => onOpen(h.id)}>Open</button>
                    <button className="ghost-btn" onClick={() => onExport(h.id, 'json')}>JSON</button>
                    <button className="ghost-btn" onClick={() => onExport(h.id, 'md')}>MD</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function EmptyState({ children }) {
  return <div className="empty-state">{children}</div>
}

export function Toast({ toast }) {
  if (!toast) return null
  return <div className={`toast ${toast.kind}`} role="status">{toast.msg}</div>
}