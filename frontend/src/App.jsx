import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadExport, getJSON, postJSON, putJSON, streamCompare } from './api.js'
import {
  ChartLegend, EmptyState, FullCard, HistoryTable, IconBars, MetricsTable, PreferencePanel,
  PreviewCard, PromptCard, RecommendCard, ScoresTable, SideNav, StatusBar, SynthesisPanel,
  Toast, TopBar, TradeoffsChart, WhyCard,
} from './components.jsx'

const DEFAULT_PROMPT = 'Summarize customer support tickets and recommend next actions.'

export default function App() {
  const [view, setView] = useState('dashboard')
  const [health, setHealth] = useState(null)
  const [models, setModels] = useState([])
  const [settings, setSettings] = useState(null)
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [selected, setSelected] = useState([])
  const [maxTokens, setMaxTokens] = useState(2048)
  const [synthesize, setSynthesize] = useState(true)

  const [phase, setPhase] = useState('idle')
  const [runs, setRuns] = useState([])
  const [synthesis, setSynthesis] = useState(null)
  const [judgeMetrics, setJudgeMetrics] = useState(null)
  const [recommendation, setRecommendation] = useState(null)
  const [experimentId, setExperimentId] = useState(null)
  const [totals, setTotals] = useState(null)

  const [preferred, setPreferred] = useState(null)
  const [reason, setReason] = useState('')
  const [prefSaved, setPrefSaved] = useState(false)

  const [history, setHistory] = useState([])
  const [stats, setStats] = useState(null)
  const [toast, setToast] = useState(null)
  const [connState, setConnState] = useState(null)

  const [searchQ, setSearchQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef(null)
  const toastTimer = useRef(null)

  const showToast = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])

  const refreshHistory = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([getJSON('/api/experiments?limit=50'), getJSON('/api/stats')])
      setHistory(h.experiments)
      setStats(s)
    } catch { /* backend down */ }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const [h, m, s] = await Promise.all([getJSON('/api/health'), getJSON('/api/models'), getJSON('/api/settings')])
        setHealth(h)
        setModels(m.models)
        setSelected(m.models.map((x) => x.id))
        setSettings(s)
        setMaxTokens(s.max_tokens)
        setSynthesize(s.synthesize)
        if (!h.live_configured) showToast('No API key configured — add INFERENCE_API_KEY to backend/.env', 'error')
      } catch {
        showToast('Backend unreachable — start uvicorn on port 8000', 'error')
      }
      refreshHistory()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const meta = useMemo(() => Object.fromEntries(models.map((m) => [m.id, m])), [models])
  const quality = synthesis?.scores
    ? Object.fromEntries(runs.map((r) => [r.model, (synthesis.scores[meta[r.model]?.label] || synthesis.scores[r.model])?.quality ?? null]))
    : {}
  const bestModel = recommendation?.model || null

  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase()
    if (!q) return { history: [], models: [] }
    return {
      history: history.filter((h) => h.prompt.toLowerCase().includes(q)).slice(0, 5),
      models: models.filter((m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)).slice(0, 3),
    }
  }, [searchQ, history, models])

  function toggleModel(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function runCompare() {
    const p = prompt.trim()
    if (!p) return showToast('Enter a prompt first', 'error')
    if (selected.length < 2) return showToast('Select at least 2 models', 'error')
    setView('dashboard')
    setPhase('running')
    setExperimentId(null)
    setSynthesis(null)
    setJudgeMetrics(null)
    setRecommendation(null)
    setTotals(null)
    setPreferred(null)
    setReason('')
    setPrefSaved(false)
    setRuns(selected.map((id) => ({ model: id, status: 'pending' })))
    try {
      await streamCompare({ prompt: p, models: selected, max_tokens: maxTokens, synthesize }, (ev) => {
        if (ev.type === 'run') setRuns((prev) => prev.map((r) => (r.model === ev.run.model ? ev.run : r)))
        else if (ev.type === 'synthesis') { setSynthesis(ev.synthesis); setJudgeMetrics(ev.judge_metrics) }
        else if (ev.type === 'recommendation') setRecommendation(ev.recommendation)
        else if (ev.type === 'done') {
          setExperimentId(ev.experiment_id)
          setTotals(ev.totals)
          setPhase('done')
          refreshHistory()
        } else if (ev.type === 'error') { showToast(ev.message, 'error'); setPhase('error') }
      })
      setPhase((prev) => (prev === 'running' ? 'error' : prev))
    } catch (e) {
      setPhase('error')
      showToast(e.message, 'error')
      setRuns((prev) => prev.map((r) => (r.status === 'pending' ? { ...r, status: 'error', error: `Request failed: ${e.message}` } : r)))
    }
  }

  async function loadExperiment(id, targetView = 'compare') {
    try {
      const exp = await getJSON(`/api/experiments/${id}`)
      setPrompt(exp.prompt)
      setRuns(exp.runs)
      setSynthesis(exp.synthesis)
      setJudgeMetrics(exp.judge_metrics)
      setRecommendation(exp.recommendation)
      setExperimentId(exp.id)
      setTotals({
        cost_usd: exp.total_cost_usd,
        wall_latency_ms: exp.total_latency_ms,
        models_ok: exp.runs.filter((r) => r.status === 'ok').length,
        models_failed: exp.runs.filter((r) => r.status === 'error').length,
      })
      setSelected(exp.runs.map((r) => r.model))
      setPreferred(exp.preferred_model)
      setReason(exp.preference_reason || '')
      setPrefSaved(!!exp.preferred_model)
      setPhase('done')
      setView(targetView)
      setSearchQ('')
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  async function savePreference() {
    if (!preferred || !experimentId) return
    try {
      await postJSON(`/api/experiments/${experimentId}/preference`, { model: preferred, reason })
      setPrefSaved(true)
      showToast('Preference saved', 'ok')
      refreshHistory()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  async function updateSettings(patch, recompute = false) {
    try {
      const s = await putJSON('/api/settings', patch)
      setSettings(s)
      if (patch.max_tokens != null) setMaxTokens(s.max_tokens)
      if (patch.synthesize != null) setSynthesize(s.synthesize)
      if (recompute && experimentId) {
        const r = await postJSON(`/api/experiments/${experimentId}/recommend`, {})
        setRecommendation(r.recommendation)
      }
      return s
    } catch (e) {
      showToast(e.message, 'error')
      return null
    }
  }

  async function testConnection() {
    setConnState('testing')
    try {
      const r = await postJSON('/api/test-connection', {})
      setConnState(r)
      showToast(r.ok ? `Endpoint OK — ${r.model} replied in ${r.latency_ms} ms` : r.message, r.ok ? 'ok' : 'error')
    } catch (e) {
      setConnState({ ok: false, message: e.message })
      showToast(e.message, 'error')
    }
  }

  const running = phase === 'running'
  const hasResults = runs.length > 0
  const confidence = recommendation?.confidence || synthesis?.overall_confidence || null

  return (
    <div className="shell">
      <TopBar
        onRun={runCompare}
        running={running}
        searchRef={searchRef}
        searchQ={searchQ}
        setSearchQ={setSearchQ}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        results={searchResults}
        onPickHistory={(id) => loadExperiment(id, 'compare')}
        onPickModel={(id) => { toggleModel(id); setView('dashboard'); setSearchQ('') }}
      />
      <div className="body">
        <SideNav view={view} setView={setView} />
        <main className="content">
          {view === 'dashboard' && (
            <>
              <h1 className="page-title">Find the right model for your task</h1>
              <p className="page-sub">Compare, evaluate, and get a clear recommendation—so you can pick (and route to) the best model with confidence.</p>
              <div className="dash-top">
                <PromptCard prompt={prompt} setPrompt={setPrompt} models={models} selected={selected} toggleModel={toggleModel} onCompare={runCompare} running={running} />
                <RecommendCard recommendation={recommendation} meta={meta} />
              </div>
              {hasResults ? (
                <>
                  <div className="section-head">
                    <h2>Model Comparison</h2>
                    {bestModel && <span className="best-pill"><IconCrownInline /> Best fit: Model {letterOf(runs, bestModel)}</span>}
                  </div>
                  {(synthesis?.fallback || synthesis?.judge_error) && (
                    <p className="syn-warn">Quality scores unavailable — the judge failed for this run, so cards show “—” and routing uses latency + cost only. Re-run the comparison to retry.</p>
                  )}
                  <div className="preview-grid">
                    {runs.map((r, i) => (
                      <PreviewCard key={r.model} run={r} meta={meta} index={i} best={bestModel === r.model} quality={quality} onOpen={() => setView('compare')} />
                    ))}
                  </div>
                  <div className="dash-bottom">
                    <section className="card chart-card">
                      <div className="chart-head"><IconBars /> <h2>Model Tradeoffs</h2> <ChartLegend runs={runs} /></div>
                      <TradeoffsChart runs={runs} quality={quality} />
                    </section>
                    <WhyCard recommendation={recommendation} />
                  </div>
                  <StatusBar settings={settings || {}} onToggleEscalation={() => updateSettings({ adaptive_escalation: !settings?.adaptive_escalation }, true)} confidence={confidence} />
                </>
              ) : (
                <EmptyState>
                  {running ? 'Comparison running — results stream in as each model finishes.' : 'No comparison yet. Enter a prompt, pick at least two models, and run a comparison.'}
                </EmptyState>
              )}
            </>
          )}

          {view === 'compare' && (
            <>
              <h1 className="page-title">Side-by-side comparison</h1>
              <p className="page-sub">Full, unaltered model outputs with isolated errors and per-run metrics.</p>
              {hasResults ? (
                <>
                  <div className="preview-grid full">
                    {runs.map((r, i) => <FullCard key={r.model} run={r} meta={meta} index={i} />)}
                  </div>
                  <MetricsTable runs={runs} meta={meta} totals={totals} judgeMetrics={judgeMetrics} />
                </>
              ) : <EmptyState>Nothing to compare yet — run a comparison from the Dashboard.</EmptyState>}
            </>
          )}

          {view === 'evaluate' && (
            <>
              <h1 className="page-title">Evaluation</h1>
              <p className="page-sub">Judge synthesis with explicit uncertainty, quality scores, and your preference as ground truth.</p>
              {synthesis ? <SynthesisPanel synthesis={synthesis} judgeMetrics={judgeMetrics} /> : <EmptyState>No synthesis for this run. Enable synthesis and compare again.</EmptyState>}
              {hasResults && <ScoresTable synthesis={synthesis} meta={meta} runs={runs} />}
              {experimentId && (
                <PreferencePanel
                  runs={runs} meta={meta} preferred={preferred} setPreferred={setPreferred}
                  reason={reason} setReason={setReason} saved={prefSaved} onSave={savePreference}
                  onChange={() => setPrefSaved(false)} onExport={(f) => downloadExport(experimentId, f)}
                />
              )}
            </>
          )}

          {view === 'recommend' && (
            <>
              <h1 className="page-title">Routing recommendation</h1>
              <p className="page-sub">Composite score = 0.5·quality + 0.3·cost-efficiency + 0.2·latency-efficiency. Escalation overrides the balanced pick below the quality threshold.</p>
              <div className="dash-top">
                <RecommendCard recommendation={recommendation} meta={meta} />
                <WhyCard recommendation={recommendation} />
              </div>
              {hasResults && (
                <section className="card">
                  <h2>Per-model scoring</h2>
                  <div className="table-wrap">
                    <table className="light-table">
                      <thead><tr><th>Model</th><th>Quality</th><th>Latency</th><th>Est. cost</th><th>Composite</th><th></th></tr></thead>
                      <tbody>
                        {runs.filter((r) => r.status === 'ok').map((r) => (
                          <tr key={r.model}>
                            <td>{meta[r.model]?.label || r.model}</td>
                            <td>{quality[r.model] != null ? `${quality[r.model]}/100` : '—'}</td>
                            <td>{(r.latency_ms / 1000).toFixed(1)}s</td>
                            <td>{fmtUsdLocal(r.est_cost_usd)}</td>
                            <td><strong>{recommendation?.composite?.[r.model] ?? '—'}</strong></td>
                            <td>{bestModel === r.model ? <span className="best-badge inline">Best Fit</span> : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {settings && (
                <section className="card">
                  <h2>Routing policy</h2>
                  <div className="settings-grid">
                    <label>Latency SLO (s)
                      <input type="number" step="0.5" min="0.5" value={settings.latency_slo_s} onChange={(e) => updateSettings({ latency_slo_s: +e.target.value }, true)} />
                    </label>
                    <label>Quality threshold
                      <input type="number" min="0" max="100" value={settings.quality_threshold} onChange={(e) => updateSettings({ quality_threshold: +e.target.value }, true)} />
                    </label>
                    <label className="check-line">
                      <input type="checkbox" checked={settings.adaptive_escalation} onChange={(e) => updateSettings({ adaptive_escalation: e.target.checked }, true)} />
                      Adaptive escalation
                    </label>
                  </div>
                  <p className="muted small">Changes apply to the current experiment (recomputed) and to future comparisons.</p>
                </section>
              )}
            </>
          )}

          {view === 'history' && (
            <>
              <h1 className="page-title">History</h1>
              <p className="page-sub">Every experiment with its runs, recommendation, and preference — exportable for offline analysis.</p>
              {stats && (
                <div className="stat-row">
                  <div className="card stat"><strong>{stats.experiments}</strong><span>experiments</span></div>
                  <div className="card stat"><strong>{stats.preferences_recorded}</strong><span>preferences</span></div>
                  <div className="card stat"><strong>{fmtUsdLocal(stats.total_est_cost_usd)}</strong><span>est. spend</span></div>
                </div>
              )}
              <HistoryTable history={history} onOpen={(id) => loadExperiment(id, 'compare')} onExport={downloadExport} />
            </>
          )}

          {view === 'settings' && (
            <>
              <h1 className="page-title">Settings</h1>
              <p className="page-sub">Connection and run defaults. The API key lives only in backend/.env — it is never exposed to the browser.</p>
              <section className="card">
                <h2>Connection</h2>
                <div className="kv"><span>Endpoint</span><code>{health?.base_url || '—'}</code></div>
                <div className="kv"><span>API key</span><code>{health?.live_configured ? 'configured (backend/.env)' : 'NOT configured'}</code></div>
                <div className="kv"><span>Request timeout</span><code>60s per model</code></div>
                <div className="conn-row">
                  <button className="btn-primary" onClick={testConnection} disabled={connState === 'testing'}>
                    {connState === 'testing' ? 'Testing…' : 'Test connection'}
                  </button>
                  {connState && connState !== 'testing' && (
                    <span className={`conn-result ${connState.ok ? 'ok' : 'err'}`}>
                      {connState.ok ? `OK — ${connState.model} replied “${connState.reply}” in ${connState.latency_ms} ms` : connState.message}
                    </span>
                  )}
                </div>
              </section>
              {settings && (
                <section className="card">
                  <h2>Run defaults</h2>
                  <div className="settings-grid">
                    <label>Synthesis judge
                      <select value={settings.judge_model} onChange={(e) => updateSettings({ judge_model: e.target.value })}>
                        {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </label>
                    <label>Default max tokens
                      <select value={settings.max_tokens} onChange={(e) => updateSettings({ max_tokens: +e.target.value })}>
                        {[256, 512, 1024, 2048].map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </label>
                    <label className="check-line">
                      <input type="checkbox" checked={settings.synthesize} onChange={(e) => updateSettings({ synthesize: e.target.checked })} />
                      Synthesis by default (1 extra judge call)
                    </label>
                  </div>
                  <p className="muted small">Pricing is an illustrative placeholder table — replace with DigitalOcean Model Catalog rates before real cost analysis.</p>
                </section>
              )}
            </>
          )}
        </main>
      </div>
      <Toast toast={toast} />
    </div>
  )
}

function letterOf(runs, model) {
  const i = runs.findIndex((r) => r.model === model)
  return String.fromCharCode(65 + Math.max(0, i))
}
function fmtUsdLocal(v) {
  return `$${(v || 0).toFixed(v && v < 0.01 ? 4 : 3)}`
}
function IconCrownInline() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 7l4.5 3.5L12 4l4.5 6.5L21 7l-1.8 12H4.8z" />
    </svg>
  )
}