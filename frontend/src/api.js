export async function getJSON(url) {
  const r = await fetch(url)
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(e.detail || `HTTP ${r.status}`)
  }
  return r.json()
}

export async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(e.detail || `HTTP ${r.status}`)
  }
  return r.json()
}

export async function putJSON(url, body) {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(e.detail || `HTTP ${r.status}`)
  }
  return r.json()
}

/**
 * POST /api/compare. SSE by default; Deep mode (or async_mode) returns 202 with
 * a job_id to poll. Events: started | panel_started | panel_token | panel_retry |
 * panel_completed | panel_error | panel_skipped | synthesis | recommendation |
 * done | error.
 */
export async function compareStream(payload, onEvent, signal) {
  const resp = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (resp.status === 202) return { job: await resp.json() }
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}))
    throw new Error(e.detail || `HTTP ${resp.status}`)
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)))
      }
    }
  }
  return { streamed: true }
}

/** Poll an async job until it reaches a terminal state; onSnapshot per tick. */
export async function pollJob(jobId, onSnapshot, signal, intervalMs = 500) {
  for (;;) {
    const snap = await getJSON(`/api/jobs/${jobId}`)
    onSnapshot(snap)
    if (['completed', 'failed', 'cancelled'].includes(snap.status)) return snap
    await new Promise((res, rej) => {
      const t = setTimeout(res, intervalMs)
      signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })
  }
}

export const cancelRun = (expId) => postJSON(`/api/compare/${expId}/cancel`, {})
export const cancelJob = (jobId) => postJSON(`/api/jobs/${jobId}/cancel`, {})
export const retryFailed = (expId) => postJSON(`/api/experiments/${expId}/retry-failed`, {})
export const getEstimate = (payload) => postJSON('/api/estimate', payload)
export const suggestPanel = (payload) => postJSON('/api/suggest-panel', payload)
export const getSpend = () => getJSON('/api/spend')

export function downloadExport(expId, format) {
  const a = document.createElement('a')
  a.href = `/api/experiments/${expId}/export?format=${format}`
  a.download = `model-compass-${expId}.${format === 'md' ? 'md' : 'json'}`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`)
export const fmtSec = (ms) => `${(ms / 1000).toFixed(1)}s`
export const fmtUsd = (v) => `$${(v || 0).toFixed(v && v < 0.01 ? 4 : 3)}`
export const letter = (i) => String.fromCharCode(65 + i)

/** Judge score keys vary ('id', 'Label', 'Label (id)'); match tolerantly. */
export const scoreFor = (scores, model, label) => {
  if (!scores) return undefined
  return scores[model] || scores[label]
    || Object.entries(scores).find(([k]) => k.includes(model) || (label && k.includes(label)))?.[1]
}