import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { fmtMs, fmtSec, fmtUsd, letter, scoreFor, timeAgo } from './api.js'

/* ------------------------------ icons ------------------------------ */
const sp = (size) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
})
export const IconSearch = ({ size = 15 }) => <svg {...sp(size)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
export const IconPlay = ({ size = 13 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>
export const IconStop = ({ size = 13 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
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
export const IconEye = ({ size = 15 }) => <svg {...sp(size)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
export const IconEyeOff = ({ size = 15 }) => <svg {...sp(size)}><path d="M3 3l18 18" /><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A16.7 16.7 0 0 0 2 12s3.5 7 10 7a10.7 10.7 0 0 0 4.4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
export const IconRefresh = ({ size = 14 }) => <svg {...sp(size)}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
export const IconTag = ({ size = 13 }) => <svg {...sp(size)}><path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1" /></svg>
export const IconWallet = ({ size = 16 }) => <svg {...sp(size)}><path d="M20 7H4a2 2 0 0 1 0-4h14v4" /><path d="M4 7v12a2 2 0 0 0 2 2h14V7" /><path d="M16 13h.01" /></svg>

export function Markdown({ text }) {
  const html = DOMPurify.sanitize(marked.parse(text || '', { breaks: true, gfm: true }))
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}

/* ------------------------------ shared bits ------------------------------ */
export function RevealButton({ revealed, onToggle }) {
  return (
    <button className="ghost-btn reveal-btn" onClick={onToggle} title="Blind comparison: judge answers on merit, not brand. Reveal keeps preference data unbiased until you choose.">
      {revealed ? <IconEyeOff /> : <IconEye />} {revealed ? 'Hide names' : 'Reveal model names'}
    </button>
  )
}

const STATUS_LABEL = {
  pending: 'queued', streaming: 'streaming', ok: 'ok', error: 'failed',
  skipped: 'skipped · budget', cancelled: 'cancelled',
}
export function StatusChip({ run }) {
  const label = run.status === 'error' ? (run.error_kind || 'failed') : (STATUS_LABEL[run.status] || run.status)
  const cls = run.status === 'error' ? `error ${run.error_kind || ''}` : run.status
  return <span className={`status-chip ${cls}`}>{label}</span>
}

export function CacheBadge({ run }) {
  if (!run.cache_hit) return null
  const sim = run.cache_similarity ? ` · similarity ${run.cache_similarity}` : ''
  return (
    <span className="cache-badge" title={`Free cache hit (${run.cache_hit}${sim}). Original generated ${run.cached_at || '?'}${run.original_latency_ms ? ` in ${fmtMs(run.original_latency_ms)}` : ''}.`}>
      <IconTag /> cached {run.cache_hit} · {run.cached_at ? timeAgo(run.cached_at) : 'earlier'}
    </span>
  )
}

export function StatusBanner({ status, notes }) {
  if (!status) return null
  const cls = { ok: 'ok', partial: 'warn', degraded: 'warn', failed: 'err', cancelled: 'gray' }[status] || 'gray'
  const text = {
    ok: 'All panels succeeded — full result.',
    partial: 'Partial result: some panels failed or were skipped; successful panels are shown unaltered.',
    degraded: 'Degraded result: below the synthesis quorum or the judge fell back. Read the notes before trusting this comparison.',
    failed: 'Failed: no panel produced an answer.',
    cancelled: 'Cancelled by you — partial results preserved.',
  }[status] || status
  return (
    <div className={`status-banner ${cls}`}>
      <div className="sb-line">
        <span className={`envelope-chip ${cls}`}>{status}</span>
        <span>{text}</span>
      </div>
      {notes?.length > 0 && (
        <details className="sb-notes">
          <summary>{notes.length} status note{notes.length > 1 ? 's' : ''}</summary>
          <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

/* ------------------------------ chrome ------------------------------ */
export function TopBar({ onRun, onCancel, running, searchRef, searchQ, setSearchQ, searchOpen, setSearchOpen, results, onPickHistory, onPickModel }) {
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
        {running ? (
          <button className="btn-danger" onClick={onCancel} title="Stop launching panels and abort in-flight calls; partial results are preserved and labeled.">
            <IconStop /> Cancel run
          </button>
        ) : (
          <button className="btn-primary" onClick={onRun}>
            <IconPlay /> Run Comparison
          </button>
        )}
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
const MODES = [
  ['fast', 'Fast', '2 cheapest models, no judge — streamed'],
  ['balanced', 'Balanced', '3–4 models + lightweight judge'],
  ['deep', 'Deep', 'Full panel + judge, opt-in async job'],
]

export function PromptCard({
  prompt, setPrompt, models, selected, toggleModel, onCompare, onCancel, running,
  mode, applyMode, reasoning, setReasoning, reasoningOverrides, toggleReasoning,
  estimate, budgetUsd, setBudgetUsd, onRunCheaper, onSuggest, refresh, setRefresh,
}) {
  const partialModels = models.filter((m) => selected.includes(m.id) && m.reasoning_off_effect === 'partial' && !(reasoningOverrides[m.id] ?? reasoning))
  const anyOff = !reasoning || selected.some((id) => reasoningOverrides[id] === false)
  return (
    <section className="card prompt-card">
      <div className="label-row"><IconChat /> Your prompt</div>
      <input
        className="prompt-input"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask all models the same question…"
        onKeyDown={(e) => { if (e.key === 'Enter' && !running) onCompare() }}
        disabled={running}
      />
      <div className="label-row mt"><IconBolt /> Run mode</div>
      <div className="mode-row">
        {MODES.map(([id, label, desc]) => (
          <button key={id} className={`mode-btn ${mode === id ? 'on' : ''}`} onClick={() => applyMode(id)} disabled={running} title={desc}>
            <strong>{label}</strong><span>{desc}</span>
          </button>
        ))}
        {mode === 'custom' && <span className="mode-custom">Custom</span>}
      </div>
      <div className="label-row mt"><IconLayers /> Models to compare</div>
      <div className="check-row">
        {models.map((m) => {
          const on = selected.includes(m.id)
          const rOff = on && !(reasoningOverrides[m.id] ?? reasoning)
          return (
            <label key={m.id} className={`check-chip ${on ? 'on' : ''}`} title={m.blurb}>
              <input type="checkbox" checked={on} onChange={() => toggleModel(m.id)} disabled={running} />
              {m.label}
              {on && (
                <button
                  type="button"
                  className={`r-toggle ${rOff ? 'off' : ''}`}
                  disabled={running}
                  onClick={(e) => { e.preventDefault(); toggleReasoning(m.id) }}
                  title={rOff
                    ? `Reasoning OFF for this model${m.reasoning_off_effect === 'partial' ? ' (upstream only reduces it — partial)' : ''}. Click to enable.`
                    : `Reasoning ON. Click to disable${m.reasoning_off_effect === 'partial' ? ' (this model only supports partial reduction)' : ''} for cheaper, direct answers.`}
                >R</button>
              )}
            </label>
          )
        })}
      </div>
      <div className="reason-row">
        <label className="check-line" title="Reasoning tokens can dominate spend. Off = direct answers at a fraction of the tokens, with less depth on multi-step problems.">
          <input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} disabled={running} />
          Reasoning {reasoning ? 'on' : 'off'} (per-run default; the R button overrides per model)
        </label>
        {anyOff && (
          <span className="reason-note">
            Reasoning off: expect shorter, less deliberated answers.
            {partialModels.length > 0 && ` ${partialModels.map((m) => m.label).join(', ')}: upstream only reduces reasoning (partial), it cannot fully disable it.`}
          </span>
        )}
      </div>
      <div className="run-controls">
        <label className="budget-label" title="Hard per-request cap. When the budget cannot fit the next panel, it is skipped and labeled — never overspent.">
          $ cap
          <input type="number" min="0" step="0.001" placeholder="optional" value={budgetUsd} onChange={(e) => setBudgetUsd(e.target.value)} disabled={running} />
        </label>
        <label className="check-line" title="Bypass the answer cache and re-run inference (for freshness-sensitive questions).">
          <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} disabled={running} />
          Fresh run (skip cache)
        </label>
        {running ? (
          <button className="btn-danger" onClick={onCancel}><IconStop /> Cancel</button>
        ) : (
          <button className="btn-primary compare-btn" onClick={onCompare} disabled={selected.length < 2 || !prompt.trim()}>
            <IconPlay /> {mode === 'deep' ? 'Run Deep job' : 'Compare Models'}
          </button>
        )}
      </div>
      {estimate && !running && (
        <div className="estimate-row">
          <IconWallet />
          <span>
            Est. up to <strong>{fmtUsd(estimate.total_usd)}</strong>
            <span className="muted small"> ({estimate.per_model.length} panels{estimate.judge ? ' + judge' : ''}, worst-case token caps)</span>
          </span>
          <button className="ghost-btn" onClick={onRunCheaper} title="Shrink to the two cheapest models, drop the judge, reasoning off, smaller budget — before anything is invoked.">Run cheaper</button>
          {budgetUsd > 0 && <button className="ghost-btn" onClick={onSuggest} title="Pick the cheapest panel that clears the quality floor within your budget.">Suggest panel</button>}
        </div>
      )}
    </section>
  )
}

export function RecommendCard({ recommendation: rec, meta, showNames = true, letterOf }) {
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
          <div className="rec-model">
            Routes to{' '}
            {showNames
              ? <strong style={{ color: meta[rec.model]?.color || '#2563eb' }}>{rec.model_label}</strong>
              : <strong>Model {letterOf(rec.model)}</strong>}
            {!showNames && <span className="muted small"> (blind — reveal names to see the model)</span>}
          </div>
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

function previewText(run) {
  return (run.output || '').replace(/[#*|>`-]/g, '').replace(/\s+/g, ' ').trim()
}

export function PreviewCard({ run, meta, index, best, quality, onOpen, showNames = true }) {
  const q = quality?.[run.model]
  const live = run.status === 'streaming' || run.status === 'pending'
  const preview = run.status === 'ok' || run.status === 'streaming'
    ? previewText(run).slice(0, 200)
    : run.status === 'error' || run.status === 'skipped' || run.status === 'cancelled' ? run.error : ''
  return (
    <article className={`card preview-card ${best ? 'best' : ''} state-${run.status}`} onClick={onOpen} title="Open full comparison">
      <div className="pc-head">
        <strong>Model {letter(index)}</strong>
        {showNames && <span className="model-chip">{meta[run.model]?.label || run.model}</span>}
        {best && <span className="best-badge"><IconCrown /> Best Fit</span>}
      </div>
      <div className="pc-label">
        Answer (preview)
        {run.status === 'streaming' && <span className="live-dot">streaming</span>}
        <CacheBadge run={run} />
        {run.reasoning === false && <span className="mini-badge">reasoning off</span>}
      </div>
      {run.status === 'pending' ? (
        <div className="skeleton"><div /><div /><div /></div>
      ) : run.status === 'streaming' ? (
        <p className="pc-preview">{preview || '…'}<span className="cursor" /></p>
      ) : run.status === 'ok' ? (
        <p className="pc-preview">{preview}{(run.output || '').length > 200 ? '…' : ''}</p>
      ) : (
        <p className={`pc-preview ${run.status === 'error' ? 'err' : 'warn'}`}>
          {run.status === 'skipped' ? 'Budget skip: ' : run.status === 'cancelled' ? 'Cancelled: ' : 'Isolated failure: '}{preview}
        </p>
      )}
      <div className="pc-metrics">
        <div title={q == null ? 'Quality unavailable — the judge failed or was skipped for this run.' : undefined}>
          <span className="m-label">Quality</span>
          <span className="m-value">{q != null ? `${q}/100` : '—'}</span>
          <div className="q-bar"><div style={{ width: `${q ?? 0}%` }} /></div>
        </div>
        <div>
          <span className="m-label">Latency</span>
          <span className="m-value">{run.status === 'ok' ? fmtSec(run.latency_ms) : live ? '…' : '—'}</span>
        </div>
        <div>
          <span className="m-label">Cost</span>
          <span className="m-value">{run.status === 'ok' ? (run.cache_hit ? '$0 (cached)' : fmtUsd(run.est_cost_usd)) : live ? '…' : '—'}</span>
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
    { label: 'Latency (s)', sub: '(lower is better)', val: (r) => Math.min(1, (r.original_latency_ms || r.latency_ms) / 10000), fmt: (r) => fmtSec(r.original_latency_ms || r.latency_ms) },
    { label: 'Cost ($)', sub: '(lower is better)', val: (r) => Math.min(1, r.est_cost_usd * 10), fmt: (r) => r.cache_hit ? '0' : fmtUsd(r.est_cost_usd).slice(1) },
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
  const ok = runs.filter((r) => r.status === 'ok' || r.status === 'streaming')
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
export function FullCard({ run, meta, index, showNames = true }) {
  return (
    <article className={`card full-card state-${run.status}`}>
      <div className="pc-head">
        <strong>Model {letter(index)}</strong>
        {showNames && <span className="model-chip">{meta[run.model]?.label || run.model}</span>}
        <StatusChip run={run} />
        <CacheBadge run={run} />
        {run.reasoning === false && <span className="mini-badge">reasoning off</span>}
      </div>
      {run.status === 'ok' && (
        <div className="card-metrics">
          <span>{fmtMs(run.latency_ms)}{run.cache_hit && run.original_latency_ms ? ` (generated in ${fmtMs(run.original_latency_ms)})` : ''}</span>
          <span>{run.input_tokens} / {run.output_tokens} tok{run.tokens_estimated ? '*' : ''}</span>
          <span>{run.cache_hit ? '$0 (cached)' : fmtUsd(run.est_cost_usd)}</span>
          {run.retried && <span className="retried-note" title="The model spent its first token budget on reasoning or hit a transient error; the run was automatically retried (2× budget or backoff+jitter).">auto-retried</span>}
          {run.upstream_cached_tokens > 0 && <span className="retried-note" title="Upstream prompt-prefix cache reused these input tokens (provider-side KV cache, reported in API usage).">prefix cache: {run.upstream_cached_tokens} tok</span>}
        </div>
      )}
      <div className="card-body">
        {run.status === 'pending' && <div className="skeleton"><div /><div /><div /><div /></div>}
        {run.status === 'streaming' && (
          <div className="stream-text">{run.output || ''}<span className="cursor" /></div>
        )}
        {run.status === 'error' && (
          <>
            <div className="error-box"><strong>Isolated failure ({run.error_kind || 'failed'})</strong><p>{run.error}</p><p className="muted small">Other models are unaffected. Use “Retry failed panels” to re-run just this one.</p></div>
            {(run.output_tokens > 0 || run.retried) && (
              <div className="card-metrics">
                {run.output_tokens > 0 && <span>{run.input_tokens} / {run.output_tokens} tok burned</span>}
                {run.est_cost_usd > 0 && <span>{fmtUsd(run.est_cost_usd)} (partial upstream cost)</span>}
                {run.retried && <span className="retried-note" title="Automatically retried with 2× token budget or backoff+jitter before failing.">auto-retried</span>}
              </div>
            )}
          </>
        )}
        {run.status === 'skipped' && (
          <div className="error-box warn"><strong>Skipped — budget cap</strong><p>{run.error}</p><p className="muted small">This is a labeled partial result, not a silent failure. Raise the cap or retry to include this panel.</p></div>
        )}
        {run.status === 'cancelled' && (
          <div className="error-box warn"><strong>Cancelled</strong><p>{run.error}</p><p className="muted small">Partial output (if any) was preserved at cancellation time.</p></div>
        )}
        {run.status === 'ok' && <Markdown text={run.output} />}
      </div>
    </article>
  )
}

export function MetricsTable({ runs, meta, totals, judgeMetrics, showNames = true }) {
  const ok = runs.filter((r) => r.status === 'ok')
  const maxLat = Math.max(1, ...ok.map((r) => r.original_latency_ms || r.latency_ms))
  return (
    <section className="card">
      <div className="metrics-head">
        <h2>Performance comparison</h2>
        {totals && (
          <span className="muted small">
            wall clock {fmtMs(totals.wall_latency_ms)} · total est. cost {fmtUsd(totals.cost_usd)}{judgeMetrics ? ' (incl. judge)' : ''}
            {totals.cache_hits > 0 && ` · ${totals.cache_hits} free cache hit${totals.cache_hits > 1 ? 's' : ''}`}
            {totals.budget?.cap_usd != null && ` · budget ${fmtUsd(totals.budget.cap_usd)} (spent ${fmtUsd(totals.budget.spent_usd)})`}
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table className="light-table">
          <thead><tr><th>Model</th><th>Status</th><th>Latency</th><th>Tokens (in / out)</th><th>Est. cost</th></tr></thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.model}>
                <td>
                  <i className="dot" style={{ background: PALETTE[i % PALETTE.length] }} /> Model {letter(i)}
                  {showNames && <span className="muted small"> · {meta[r.model]?.label || r.model}</span>}
                  {r.cache_hit && <CacheBadge run={r} />}
                </td>
                <td><StatusChip run={r} /></td>
                <td className="lat-cell">
                  {r.status === 'ok' ? (<><div className="lat-bar"><div style={{ width: `${Math.max(4, ((r.original_latency_ms || r.latency_ms) / maxLat) * 100)}%` }} /></div><span>{fmtMs(r.original_latency_ms || r.latency_ms)}{r.cache_hit ? ' (cached)' : ''}</span></>) : (r.status === 'streaming' || r.status === 'pending') ? '…' : '—'}
                </td>
                <td>{r.status === 'ok' || r.output_tokens > 0 ? `${r.input_tokens} / ${r.output_tokens}${r.tokens_estimated ? '*' : ''}` : '—'}</td>
                <td>{r.status === 'ok' ? (r.cache_hit ? '$0' : fmtUsd(r.est_cost_usd)) : r.est_cost_usd > 0 ? `${fmtUsd(r.est_cost_usd)} burned` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">* token counts estimated (~4 chars/token) when the API omits usage. Costs use illustrative placeholder pricing. “Burned” marks tokens a failed panel still consumed upstream (e.g. reasoning-only output). Cache hits are free and labeled with their freshness; latency bars use original generation time for cached answers.</p>
    </section>
  )
}

function ConfChip({ level }) {
  return <span className={`conf-chip ${level || 'low'}`}>{level || 'low'}</span>
}

/** Blind mode: the judge's prose references model labels; mask them to letters
 * until the user reveals, so synthesis text cannot bias the preference pick. */
function blindMask(runs, meta) {
  const pairs = runs.map((r, i) => ({ id: r.model, label: meta[r.model]?.label, repl: `Model ${letter(i)}` }))
  return (text) => {
    let t = String(text ?? '')
    for (const { id, label, repl } of pairs) {
      if (label) t = t.split(`${label} (${id})`).join(repl).split(label).join(repl)
      t = t.split(id).join(repl)
    }
    return t
  }
}

export function SynthesisPanel({ synthesis: s, judgeMetrics, runs = [], meta = {}, showNames = true }) {
  const failed = s.fallback || s.judge_error
  const mask = showNames ? (t) => t : blindMask(runs, meta)
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
        : `Separate judge artifact (${showNames ? (s.judge_model || 'unknown') : 'hidden until reveal'}). Original answers are preserved unaltered — nothing was merged.`}</p>
      {s.agreements?.length > 0 && (<div className="syn-block"><h3>Agreements</h3><ul>{s.agreements.map((a, i) => <li key={i}>{mask(a)}</li>)}</ul></div>)}
      {s.differences?.length > 0 && (
        <div className="syn-block"><h3>Differences</h3>
          {s.differences.map((d, i) => (
            <div className="diff" key={i}>
              <div className="diff-topic">{mask(d.topic)}</div>
              <ul>{Object.entries(d.positions || {}).map(([m, p]) => <li key={m}><strong>{mask(m)}:</strong> {mask(p)}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {s.weaknesses?.length > 0 && (
        <div className="syn-block"><h3>Possible weaknesses</h3>
          <ul>{s.weaknesses.map((w, i) => <li key={i}><strong>{mask(w.model)}</strong> <ConfChip level={w.confidence} /> — {mask(w.issue)}</li>)}</ul>
        </div>
      )}
      {s.uncertainty_notes?.length > 0 && (
        <div className="syn-block uncertainty"><h3>Uncertainty</h3><ul>{s.uncertainty_notes.map((u, i) => <li key={i}>{mask(u)}</li>)}</ul></div>
      )}
      {judgeMetrics && judgeMetrics.est_cost_usd > 0 && (
        <p className="muted small">Judge call: {fmtMs(judgeMetrics.latency_ms)} · {judgeMetrics.input_tokens}/{judgeMetrics.output_tokens} tokens · {fmtUsd(judgeMetrics.est_cost_usd)}</p>
      )}
    </section>
  )
}

export function ScoresTable({ synthesis, meta, runs, showNames = true }) {
  const scores = synthesis?.scores || {}
  const ok = runs.filter((r) => r.status === 'ok')
  const mask = showNames ? (t) => t : blindMask(runs, meta)
  if (ok.length === 0) return null
  const anyScore = ok.some((r) => scoreFor(scores, r.model, meta[r.model]?.label))
  return (
    <section className="card">
      <h2>Judge quality scores</h2>
      {!anyScore ? (
        <p className="syn-warn">No quality scores for this run — the judge failed, was skipped by the synthesis gate, or synthesis was disabled. Quality shows as “—” and the recommendation falls back to latency + cost.</p>
      ) : (
      <div className="table-wrap">
        <table className="light-table">
          <thead><tr><th>Model</th><th>Quality</th><th>Rationale</th></tr></thead>
          <tbody>
            {ok.map((r, i) => {
              const label = meta[r.model]?.label || r.model
              const s = scoreFor(scores, r.model, label)
              return (
                <tr key={r.model}>
                  <td>Model {letter(runs.indexOf(r))}{showNames && <span className="muted small"> · {label}</span>}</td>
                  <td><strong>{s ? `${s.quality}/100` : '—'}</strong></td>
                  <td className="muted">{s?.rationale ? mask(s.rationale) : 'not scored'}</td>
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

export function PreferencePanel({ runs, meta, preferred, setPreferred, reason, setReason, saved, onSave, onChange, onExport, showNames = true }) {
  const ok = runs.filter((r) => r.status === 'ok')
  const nameOf = (r) => showNames ? (meta[r.model]?.label || r.model) : `Model ${letter(runs.indexOf(r))}`
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
          <p>Saved: <strong>{showNames ? (meta[preferred]?.label || preferred) : `Model ${letter(runs.findIndex((r) => r.model === preferred))}`}</strong>{reason && <> — “{reason}”</>}</p>
          <button className="ghost-btn" onClick={onChange}>Change</button>
        </div>
      ) : (
        <>
          <p className="muted small">Which response do you prefer, and why? {showNames ? '' : 'Names are hidden (blind) so the pick stays unbiased. '}Preferences are stored as evaluation data.</p>
          <div className="pref-chips">
            {ok.map((r) => (
              <button key={r.model} className={`pref-chip ${preferred === r.model ? 'on' : ''}`} onClick={() => setPreferred(r.model)}>
                {nameOf(r)}
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
            <thead><tr><th>When</th><th>Prompt</th><th>Mode</th><th>Models</th><th>Status</th><th>Best fit</th><th>Preferred</th><th>Est. cost</th><th></th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="muted">{timeAgo(h.created_at)}</td>
                  <td className="hist-prompt-cell">{h.prompt.slice(0, 60)}{h.prompt.length > 60 ? '…' : ''}</td>
                  <td className="muted">{h.run_mode || '—'}</td>
                  <td>{h.n_ok}/{h.n_models} ok</td>
                  <td><span className={`envelope-chip ${{ ok: 'ok', partial: 'warn', degraded: 'warn', failed: 'err', cancelled: 'gray' }[h.overall_status] || 'gray'}`}>{h.overall_status || 'ok'}</span></td>
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

export function SpendCard({ spend, settings, onUpdate }) {
  if (!spend || !settings) return null
  const bar = (p) => {
    const pct = p.cap_usd > 0 ? Math.min(100, (p.spend_usd / p.cap_usd) * 100) : 0
    return (
      <div className="spend-period">
        <div className="spend-line">
          <strong>{p.label}</strong>
          <span>{fmtUsd(p.spend_usd)}{p.cap_usd > 0 ? ` / ${fmtUsd(p.cap_usd)} cap` : ' (no cap)'} · {p.runs} runs</span>
          {p.alert !== 'off' && <span className={`envelope-chip ${p.alert === 'blocked' ? 'err' : p.alert === 'warn' ? 'warn' : 'ok'}`}>{p.alert}</span>}
        </div>
        {p.cap_usd > 0 && <div className="spend-bar"><div className={p.alert === 'blocked' ? 'err' : p.alert === 'warn' ? 'warn' : ''} style={{ width: `${pct}%` }} /></div>}
      </div>
    )
  }
  return (
    <section className="card">
      <h2>Spend guardrails</h2>
      <p className="muted small">Per-user daily/monthly caps (UTC). Runs whose worst-case estimate would breach a cap are blocked before anything is invoked; 80% raises an alert. Estimated spend uses illustrative pricing.</p>
      {bar({ ...spend.day, label: 'Today' })}
      {bar({ ...spend.month, label: 'This month' })}
      <div className="settings-grid">
        <label>Daily cap ($)
          <input type="number" min="0" step="0.5" value={settings.daily_budget_usd} onChange={(e) => onUpdate({ daily_budget_usd: +e.target.value })} />
        </label>
        <label>Monthly cap ($)
          <input type="number" min="0" step="5" value={settings.monthly_budget_usd} onChange={(e) => onUpdate({ monthly_budget_usd: +e.target.value })} />
        </label>
      </div>
      <p className="muted small">0 = no cap.</p>
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