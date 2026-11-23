import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelJob, cancelRun, compareStream, downloadExport, getEstimate, getJSON, getSpend,
  postJSON, putJSON, retryFailed, scoreFor, suggestPanel, pollJob,
} from './api.js'
import {
  ChartLegend, EmptyState, FullCard, HistoryTable, IconBars, MetricsTable, PreferencePanel,
  PreviewCard, PromptCard, RecommendCard, RevealButton, ScoresTable, SideNav, SpendCard,
  StatusBar, StatusBanner, SynthesisPanel, Toast, TopBar, TradeoffsChart, WhyCard,
} from './components.jsx'

const DEFAULT_PROMPT = 'Summarize customer support tickets and recommend next actions.'
const TERMINAL = ['panel_completed', 'panel_error', 'panel_skipped']

export default function App() {
  const [view, setView] = useState('dashboard')
  const [health, setHealth] = useState(null)
  const [models, setModels] = useState([])
  const [settings, setSettings] = useState(null)
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [selected, setSelected] = useState([])
  const [maxTokens, setMaxTokens] = useState(2048)
  const [synthesize, setSynthesize] = useState(false)
  const [mode, setMode] = useState('fast')
  const [reasoning, setReasoning] = useState(true)
  const [reasoningOverrides, setReasoningOverrides] = useState({})
  const [refresh, setRefresh] = useState(false)
  const [budgetUsd, setBudgetUsd] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [estimate, setEstimate] = useState(null)
  const [spend, setSpend] = useState(null)

  const [phase, setPhase] = useState('idle')
  const [runs, setRuns] = useState([])
  const [synthesis, setSynthesis] = useState(null)
  const [judgeMetrics, setJudgeMetrics] = useState(null)
  const [recommendation, setRecommendation] = useState(null)
  const [experimentId, setExperimentId] = useState(null)
  const [totals, setTotals] = useState(null)
  const [overallStatus, setOverallStatus] = useState(null)
  const [statusNotes, setStatusNotes] = useState([])
  const [jobId, setJobId] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [retrying, setRetrying] = useState(false)

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
  const abortRef = useRef(null)
  const expIdRef = useRef(null)
  const cancellingRef = useRef(false)

  const showToast = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 5200)
  }, [])

  const refreshHistory = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([getJSON('/api/experiments?limit=50'), getJSON('/api/stats')])
      setHistory(h.experiments)
      setStats(s)
    } catch { /* backend down */ }
  }, [])

  const refreshSpend = useCallback(async (alert = false) => {
    try {
      const s = await getSpend()
      setSpend(s)
      if (alert) {
        for (const [period, p] of [['daily', s.day], ['monthly', s.month]]) {
          if (p.alert === 'blocked') showToast(`${period} spend cap reached (${p.cap_usd.toFixed(2)}). New runs are blocked until the cap is raised or spend resets.`, 'error')
          else if (p.alert === 'warn') showToast(`${period} spend alert: ${Math.round((p.spend_usd / p.cap_usd) * 100)}% of the $${p.cap_usd.toFixed(2)} cap used.`, 'info')
        }
      }
    } catch { /* backend down */ }
  }, [showToast])

  const cheapestTwo = useCallback((list) => [...list]
    .sort((a, b) => (a.input_usd_per_m + a.output_usd_per_m) - (b.input_usd_per_m + b.output_usd_per_m))
    .slice(0, 2).map((m) => m.id), [])

  const applyMode = useCallback((m, list) => {
    const ms = list || models
    if (!ms.length) return
    setMode(m)
    setReasoningOverrides({})
    if (m === 'fast') {
      setSelected(cheapestTwo(ms)); setMaxTokens(2048); setSynthesize(false)
    } else if (m === 'balanced') {
      setSelected(ms.map((x) => x.id)); setMaxTokens(4096); setSynthesize(true)
    } else if (m === 'deep') {
      setSelected(ms.map((x) => x.id)); setMaxTokens(8192); setSynthesize(true)
    }
  }, [models, cheapestTwo])

  useEffect(() => {
    ;(async () => {
      try {
        const [h, m, s] = await Promise.all([getJSON('/api/health'), getJSON('/api/models'), getJSON('/api/settings')])
        setHealth(h)
        setModels(m.models)
        setSettings(s)
        applyMode('fast', m.models) // doc default: fast and cheap; judge is opt-in
        if (!h.live_configured) showToast('No API key configured — add INFERENCE_API_KEY to backend/.env', 'error')
      } catch {
        showToast('Backend unreachable — start uvicorn on port 8000', 'error')
      }
      refreshHistory()
      refreshSpend()
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

  // Pre-run cost estimate (debounced) — shown before anything is invoked.
  useEffect(() => {
    if (phase === 'running' || selected.length < 2 || !settings) { setEstimate(null); return }
    const t = setTimeout(async () => {
      try {
        const est = await getEstimate({ prompt, models: selected, max_tokens: maxTokens, synthesize, judge_model: settings.judge_model })
        setEstimate(est)
      } catch { setEstimate(null) }
    }, 400)
    return () => clearTimeout(t)
  }, [prompt, selected, maxTokens, synthesize, settings, phase])

  const meta = useMemo(() => Object.fromEntries(models.map((m) => [m.id, m])), [models])
  const quality = synthesis?.scores
    ? Object.fromEntries(runs.map((r) => [r.model, scoreFor(synthesis.scores, r.model, meta[r.model]?.label)?.quality ?? null]))
    : {}
  const bestModel = recommendation?.model || null
  const showNames = revealed
  const letterOf = (model) => {
    const i = runs.findIndex((r) => r.model === model)
    return String.fromCharCode(65 + Math.max(0, i))
  }

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
    setMode('custom')
  }

  function toggleReasoning(id) {
    setReasoningOverrides((prev) => ({ ...prev, [id]: !(prev[id] ?? reasoning) }))
  }

  function resetResults() {
    setExperimentId(null); expIdRef.current = null
    setSynthesis(null); setJudgeMetrics(null); setRecommendation(null)
    setTotals(null); setOverallStatus(null); setStatusNotes([])
    setPreferred(null); setReason(''); setPrefSaved(false)
    setRevealed(false); setJobId(null)
  }

  function applySnapshot(snap) {
    const order = snap.panel_order || Object.keys(snap.panels)
    setRuns(order.map((m) => {
      const p = snap.panels[m] || { model: m, status: 'pending' }
      if (p.status === 'running') return { model: m, status: p.partial_output ? 'streaming' : 'pending', output: p.partial_output || '', cache_hit: p.cache_hit }
      return p
    }))
    if (snap.synthesis) { setSynthesis(snap.synthesis); setJudgeMetrics(snap.judge_metrics) }
    if (snap.recommendation) setRecommendation(snap.recommendation)
    if (['completed', 'failed', 'cancelled'].includes(snap.status)) {
      setExperimentId(snap.experiment_id)
      setTotals(snap.totals)
      setOverallStatus(snap.overall_status || (snap.status === 'failed' ? 'failed' : 'cancelled'))
      setStatusNotes(snap.status_notes || [])
      setPhase(snap.status === 'failed' ? 'error' : 'done')
      setCancelling(false); cancellingRef.current = false
      if (snap.error) showToast(snap.error, 'error')
      refreshHistory()
      refreshSpend(true)
    }
  }

  async function runCompare() {
    const p = prompt.trim()
    if (!p) return showToast('Enter a prompt first', 'error')
    if (selected.length < 2) return showToast('Select at least 2 models', 'error')
    setView('dashboard')
    setPhase('running')
    setCancelling(false); cancellingRef.current = false
    resetResults()
    setRuns(selected.map((id) => ({ model: id, status: 'pending' })))
    const payload = {
      prompt: p, models: selected, max_tokens: maxTokens, synthesize, mode,
      budget_usd: budgetUsd !== '' && +budgetUsd > 0 ? +budgetUsd : null,
      reasoning,
      reasoning_overrides: Object.fromEntries(Object.entries(reasoningOverrides).filter(([m]) => selected.includes(m))),
      refresh,
      async_mode: mode === 'deep',
    }
    abortRef.current = new AbortController()
    const onEvent = (ev) => {
      if (ev.type === 'started') { expIdRef.current = ev.experiment_id; setExperimentId(ev.experiment_id) }
      else if (ev.type === 'panel_started') setRuns((prev) => prev.map((r) => (r.model === ev.model ? { ...r, status: 'streaming', output: '', cache_hit: ev.cache_hit, reasoning: ev.reasoning } : r)))
      else if (ev.type === 'panel_token') setRuns((prev) => prev.map((r) => (r.model === ev.model ? { ...r, output: (r.output || '') + ev.text } : r)))
      else if (ev.type === 'panel_retry') setRuns((prev) => prev.map((r) => (r.model === ev.model ? { ...r, retry_note: ev.reason } : r)))
      else if (TERMINAL.includes(ev.type)) setRuns((prev) => prev.map((r) => (r.model === ev.run.model ? ev.run : r)))
      else if (ev.type === 'synthesis') { setSynthesis(ev.synthesis); setJudgeMetrics(ev.judge_metrics) }
      else if (ev.type === 'recommendation') setRecommendation(ev.recommendation)
      else if (ev.type === 'done') {
        setExperimentId(ev.experiment_id)
        setTotals(ev.totals)
        setOverallStatus(ev.overall_status)
        setStatusNotes(ev.status_notes || [])
        setPhase('done')
        setCancelling(false); cancellingRef.current = false
        if (ev.overall_status === 'cancelled') showToast('Run cancelled — partial results preserved and labeled.', 'info')
        refreshHistory()
        refreshSpend(true)
      } else if (ev.type === 'error') { showToast(ev.message, 'error'); setPhase('error'); setCancelling(false); cancellingRef.current = false }
    }
    try {
      const res = await compareStream(payload, onEvent, abortRef.current.signal)
      if (res.job) {
        setJobId(res.job.job_id)
        expIdRef.current = res.job.experiment_id
        await pollJob(res.job.job_id, applySnapshot, abortRef.current.signal)
      } else {
        setPhase((prev) => (prev === 'running' ? 'error' : prev))
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        if (cancellingRef.current) await recoverCancelled()
        return
      }
      setPhase('error')
      showToast(e.message, 'error')
      setRuns((prev) => prev.map((r) => (r.status === 'pending' || r.status === 'streaming' ? { ...r, status: 'error', error: `Request failed: ${e.message}`, error_kind: 'failed' } : r)))
    }
  }

  async function recoverCancelled() {
    // The SSE reader was aborted; the backend still persists the partial experiment.
    const id = expIdRef.current
    if (!id) { setPhase('error'); setCancelling(false); cancellingRef.current = false; return }
    for (let i = 0; i < 60; i++) {
      try {
        const exp = await getJSON(`/api/experiments/${id}`)
        applyExperiment(exp, view)
        setCancelling(false); cancellingRef.current = false
        showToast('Run cancelled — partial results preserved and labeled.', 'info')
        return
      } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    setCancelling(false); cancellingRef.current = false
    setPhase('error')
  }

  async function onCancel() {
    if (jobId) {
      try { await cancelJob(jobId); showToast('Cancelling job — partial results will be preserved.', 'info') } catch (e) { showToast(e.message, 'error') }
      return
    }
    setCancelling(true); cancellingRef.current = true
    const id = expIdRef.current
    // Ask the backend to cancel first; the SSE stream then delivers the
    // cancelled done envelope. Abort only as a fallback if it stalls.
    if (id) { try { await cancelRun(id) } catch { /* run may already be finished */ } }
    setTimeout(() => { if (cancellingRef.current) abortRef.current?.abort() }, 5000)
  }

  function applyExperiment(exp, targetView) {
    setPrompt(exp.prompt)
    setRuns(exp.runs)
    setSynthesis(exp.synthesis)
    setJudgeMetrics(exp.judge_metrics)
    setRecommendation(exp.recommendation)
    setExperimentId(exp.id)
    expIdRef.current = exp.id
    setTotals({
      cost_usd: exp.total_cost_usd,
      wall_latency_ms: exp.total_latency_ms,
      models_ok: exp.runs.filter((r) => r.status === 'ok').length,
      models_failed: exp.runs.filter((r) => r.status === 'error').length,
      models_skipped: exp.runs.filter((r) => r.status === 'skipped').length,
      models_cancelled: exp.runs.filter((r) => r.status === 'cancelled').length,
      cache_hits: exp.runs.filter((r) => r.cache_hit).length,
      budget: exp.budget_usd ? { cap_usd: exp.budget_usd, spent_usd: exp.total_cost_usd } : undefined,
    })
    setOverallStatus(exp.overall_status || 'ok')
    setStatusNotes(exp.status_notes || [])
    setSelected(exp.runs.map((r) => r.model))
    setMode(exp.run_mode || 'custom')
    if (exp.max_tokens) setMaxTokens(exp.max_tokens)
    setSynthesize(!!exp.synthesize)
    setReasoningOverrides(Object.fromEntries(exp.runs.filter((r) => r.reasoning === false).map((r) => [r.model, false])))
    setPreferred(exp.preferred_model)
    setReason(exp.preference_reason || '')
    setPrefSaved(!!exp.preferred_model)
    setRevealed(false)
    setPhase('done')
    if (targetView) setView(targetView)
  }

  async function loadExperiment(id, targetView = 'compare') {
    try {
      const exp = await getJSON(`/api/experiments/${id}`)
      applyExperiment(exp, targetView)
      setSearchQ('')
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  async function onRetryFailed() {
    if (!experimentId) return
    const target = experimentId
    setRetrying(true)
    try {
      const exp = await retryFailed(target)
      refreshHistory()
      if (expIdRef.current !== target) {
        showToast('Retry finished in the background — open it from History.', 'info')
        return
      }
      applyExperiment(exp, view)
      const n = exp.runs.filter((r) => r.status === 'ok').length
      showToast(`Retry complete — ${n}/${exp.runs.length} panels ok (${exp.overall_status}).`, exp.overall_status === 'ok' ? 'ok' : 'info')
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setRetrying(false)
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
      if (patch.daily_budget_usd != null || patch.monthly_budget_usd != null) refreshSpend()
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

  function onRunCheaper() {
    setSelected(cheapestTwo(models))
    setSynthesize(false)
    setReasoning(false)
    setReasoningOverrides({})
    setMaxTokens((t) => Math.min(t, 2048))
    setMode('custom')
    showToast('Cheaper config applied: 2 cheapest models, no judge, reasoning off. Review the estimate, then run.', 'ok')
  }

  async function onSuggest() {
    if (!(+budgetUsd > 0)) return showToast('Set a $ cap first, then suggest a panel for it.', 'error')
    try {
      const res = await suggestPanel({ budget_usd: +budgetUsd, max_tokens: maxTokens, synthesize })
      setSelected(res.models)
      setMode('custom')
      showToast(res.rationale, res.fits_budget ? 'ok' : 'info')
    } catch (e) {
      showToast(e.message, 'error')
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
  const failedPanels = runs.filter((r) => ['error', 'skipped', 'cancelled'].includes(r.status))

  return (
    <div className="shell">
      <TopBar
        onRun={runCompare}
        onCancel={onCancel}
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
                <PromptCard
                  prompt={prompt} setPrompt={setPrompt} models={models} selected={selected} toggleModel={toggleModel}
                  onCompare={runCompare} onCancel={onCancel} running={running}
                  mode={mode} applyMode={applyMode}
                  reasoning={reasoning} setReasoning={(v) => { setReasoning(v); setMode('custom') }}
                  reasoningOverrides={reasoningOverrides} toggleReasoning={toggleReasoning}
                  estimate={estimate} budgetUsd={budgetUsd} setBudgetUsd={setBudgetUsd}
                  onRunCheaper={onRunCheaper} onSuggest={onSuggest}
                  refresh={refresh} setRefresh={setRefresh}
                />
                <RecommendCard recommendation={recommendation} meta={meta} showNames={showNames} letterOf={letterOf} />
              </div>
              {hasResults ? (
                <>
                  <StatusBanner status={overallStatus} notes={statusNotes} />
                  {jobId && running && <p className="muted small">Deep mode: async job <code>{jobId}</code> — polling for partial results.</p>}
                  <div className="section-head">
                    <h2>Model Comparison</h2>
                    <div className="head-actions">
                      {bestModel && <span className="best-pill"><IconCrownInline /> Best fit: Model {letterOf(bestModel)}</span>}
                      <RevealButton revealed={revealed} onToggle={() => setRevealed((v) => !v)} />
                    </div>
                  </div>
                  {(synthesis?.fallback || synthesis?.judge_error) && (
                    <p className="syn-warn">Quality scores unavailable — the judge failed for this run, so cards show “—” and routing uses latency + cost only. Re-run the comparison to retry.</p>
                  )}
                  <div className="preview-grid">
                    {runs.map((r, i) => (
                      <PreviewCard key={r.model} run={r} meta={meta} index={i} best={bestModel === r.model} quality={quality} onOpen={() => setView('compare')} showNames={showNames} />
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
                  {running ? 'Comparison running — answers stream in token by token as each model produces them.' : 'No comparison yet. Enter a prompt, pick at least two models, and run a comparison.'}
                </EmptyState>
              )}
            </>
          )}

          {view === 'compare' && (
            <>
              <div className="page-head-row">
                <div>
                  <h1 className="page-title">Side-by-side comparison</h1>
                  <p className="page-sub">Full, unaltered model outputs with isolated errors and per-run metrics. Answers are blind until you reveal the names.</p>
                </div>
                <div className="head-actions">
                  {failedPanels.length > 0 && experimentId && !running && (
                    <button className="btn-primary" onClick={onRetryFailed} disabled={retrying}>
                      {retrying ? 'Retrying…' : `Retry failed panels (${failedPanels.length})`}
                    </button>
                  )}
                  <RevealButton revealed={revealed} onToggle={() => setRevealed((v) => !v)} />
                </div>
              </div>
              {hasResults ? (
                <>
                  <StatusBanner status={overallStatus} notes={statusNotes} />
                  <div className="preview-grid full">
                    {runs.map((r, i) => <FullCard key={r.model} run={r} meta={meta} index={i} showNames={showNames} />)}
                  </div>
                  <MetricsTable runs={runs} meta={meta} totals={totals} judgeMetrics={judgeMetrics} showNames={showNames} />
                </>
              ) : <EmptyState>Nothing to compare yet — run a comparison from the Dashboard.</EmptyState>}
            </>
          )}

          {view === 'evaluate' && (
            <>
              <div className="page-head-row">
                <div>
                  <h1 className="page-title">Evaluation</h1>
                  <p className="page-sub">Judge synthesis with explicit uncertainty, quality scores, and your preference as ground truth.</p>
                </div>
                <RevealButton revealed={revealed} onToggle={() => setRevealed((v) => !v)} />
              </div>
              <StatusBanner status={overallStatus} notes={statusNotes} />
              {synthesis ? <SynthesisPanel synthesis={synthesis} judgeMetrics={judgeMetrics} runs={runs} meta={meta} showNames={showNames} /> : <EmptyState>No synthesis for this run. Enable synthesis (Balanced/Deep mode or the toggle) and compare again — the judge only runs when at least two panels succeed.</EmptyState>}
              {hasResults && <ScoresTable synthesis={synthesis} meta={meta} runs={runs} showNames={showNames} />}
              {experimentId && (
                <PreferencePanel
                  runs={runs} meta={meta} preferred={preferred} setPreferred={setPreferred}
                  reason={reason} setReason={setReason} saved={prefSaved} onSave={savePreference}
                  onChange={() => setPrefSaved(false)} onExport={(f) => downloadExport(experimentId, f)}
                  showNames={showNames}
                />
              )}
            </>
          )}

          {view === 'recommend' && (
            <>
              <h1 className="page-title">Routing recommendation</h1>
              <p className="page-sub">Composite score = 0.5·quality + 0.3·cost-efficiency + 0.2·latency-efficiency. Escalation overrides the balanced pick below the quality threshold.</p>
              <div className="dash-top">
                <RecommendCard recommendation={recommendation} meta={meta} showNames={showNames} letterOf={letterOf} />
                <WhyCard recommendation={recommendation} />
              </div>
              {hasResults && (
                <section className="card">
                  <div className="metrics-head">
                    <h2>Per-model scoring</h2>
                    <RevealButton revealed={revealed} onToggle={() => setRevealed((v) => !v)} />
                  </div>
                  <div className="table-wrap">
                    <table className="light-table">
                      <thead><tr><th>Model</th><th>Quality</th><th>Latency</th><th>Est. cost</th><th>Composite</th><th></th></tr></thead>
                      <tbody>
                        {runs.filter((r) => r.status === 'ok').map((r) => (
                          <tr key={r.model}>
                            <td>Model {letterOf(r.model)}{showNames && <span className="muted small"> · {meta[r.model]?.label || r.model}</span>}</td>
                            <td>{quality[r.model] != null ? `${quality[r.model]}/100` : '—'}</td>
                            <td>{fmtSecLocal(r.original_latency_ms || r.latency_ms)}{r.cache_hit ? ' (cached)' : ''}</td>
                            <td>{r.cache_hit ? '$0' : fmtUsdLocal(r.est_cost_usd)}</td>
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
              <p className="page-sub">Every experiment with its runs, status envelope, recommendation, and preference — exportable for offline analysis.</p>
              {stats && (
                <div className="stat-row">
                  <div className="card stat"><strong>{stats.experiments}</strong><span>experiments</span></div>
                  <div className="card stat"><strong>{stats.preferences_recorded}</strong><span>preferences</span></div>
                  <div className="card stat"><strong>{fmtUsdLocal(stats.total_est_cost_usd)}</strong><span>est. spend (all time)</span></div>
                  {spend && <div className="card stat"><strong>{fmtUsdLocal(spend.day.spend_usd)}</strong><span>est. spend today</span></div>}
                </div>
              )}
              <HistoryTable history={history} onOpen={(id) => loadExperiment(id, 'compare')} onExport={downloadExport} />
            </>
          )}

          {view === 'settings' && (
            <>
              <h1 className="page-title">Settings</h1>
              <p className="page-sub">Connection, run defaults, cache, and spend guardrails. The API key lives only in backend/.env — it is never exposed to the browser.</p>
              <section className="card">
                <h2>Connection</h2>
                <div className="kv"><span>Endpoint</span><code>{health?.base_url || '—'}</code></div>
                <div className="kv"><span>API key</span><code>{health?.live_configured ? 'configured (backend/.env)' : 'NOT configured'}</code></div>
                <div className="kv"><span>Request timeout</span><code>{health?.request_timeout_s ?? 120}s per model</code></div>
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
                        {[512, 1024, 2048, 4096, 8192].map((v) => <option key={v} value={v}>{v}</option>)}
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
              {settings && (
                <section className="card">
                  <h2>Answer cache</h2>
                  <div className="settings-grid">
                    <label className="check-line">
                      <input type="checkbox" checked={settings.cache_enabled} onChange={(e) => updateSettings({ cache_enabled: e.target.checked })} />
                      Cache enabled (exact + semantic tiers; hits are free and labeled)
                    </label>
                    <label>Freshness TTL
                      <select value={settings.cache_ttl_s} onChange={(e) => updateSettings({ cache_ttl_s: +e.target.value })}>
                        {[[300, '5 minutes'], [900, '15 minutes'], [3600, '1 hour'], [86400, '24 hours']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="muted small">Semantic hits use lexical similarity (labeled with the score), not embeddings. “Fresh run” on the Dashboard bypasses the cache for time-sensitive questions. Prompt-prefix caching happens upstream and is reported in token metrics.</p>
                </section>
              )}
              <SpendCard spend={spend} settings={settings} onUpdate={updateSettings} />
            </>
          )}
        </main>
      </div>
      <Toast toast={toast} />
    </div>
  )
}

function fmtUsdLocal(v) {
  return `$${(v || 0).toFixed(v && v < 0.01 ? 4 : 3)}`
}
function fmtSecLocal(ms) {
  return `${((ms || 0) / 1000).toFixed(1)}s`
}
function IconCrownInline() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 7l4.5 3.5L12 4l4.5 6.5L21 7l-1.8 12H4.8z" />
    </svg>
  )
}