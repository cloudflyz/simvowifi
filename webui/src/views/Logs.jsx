import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../api.js'

// ANSI SGR 颜色 → 主题色
const FG = {
  30: '#475569', 31: '#ef4444', 32: '#22c55e', 33: '#eab308', 34: '#3b82f6',
  35: '#a855f7', 36: '#06b6d4', 37: 'var(--text)',
  90: '#64748b', 91: '#f87171', 92: '#4ade80', 93: '#facc15', 94: '#60a5fa',
  95: '#c084fc', 96: '#22d3ee', 97: 'var(--text)',
}

// 把含 ANSI SGR 转义的字符串解析成带样式的 React span 列表
function ansi(text) {
  const out = []
  let style = {}
  let key = 0
  const re = /\x1b?\[([0-9;]*)m/g
  let last = 0
  let m
  const push = (t) => { if (t) out.push(<span key={key++} style={{ ...style }}>{t}</span>) }
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index))
    const codes = m[1].split(';').filter((s) => s !== '').map(Number)
    if (codes.length === 0) style = {}
    for (const c of codes) {
      if (c === 0) style = {}
      else if (c === 1) style = { ...style, fontWeight: 700 }
      else if (c === 3) style = { ...style, fontStyle: 'italic' }
      else if (c === 4) style = { ...style, textDecoration: 'underline' }
      else if (FG[c]) style = { ...style, color: FG[c] }
    }
    last = re.lastIndex
  }
  push(text.slice(last))
  return out
}

const TABS = [
  { id: 'entrypoint', short: '引擎', full: 'engine 入口' },
  { id: 'asterisk', short: 'Asterisk', full: 'Asterisk' },
  { id: 'charon', short: 'IKE', full: 'SWu 隧道 (IKE)' },
  { id: 'events', short: '事件', full: '事件流' },
]

export default function Logs() {
  const [logs, setLogs] = useState({})
  const [tab, setTab] = useState('entrypoint')
  const [auto, setAuto] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await api.logs(tab, 400)
      setLogs((x) => ({ ...x, [tab]: r.log }))
      setErr('')
    } catch (e) { setErr(e.message) }
  }, [tab])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 3000)
    return () => clearInterval(t)
  }, [auto, load])

  const rendered = useMemo(() => ansi(logs[tab] || '（空）'), [logs, tab])

  return (
    <div className="logs-page">
      <div className="logs-chrome">
        {err && <div className="logs-err" role="alert">
          {err}{' '}<button type="button" className="btn btn-ghost logs-small-button" onClick={load}>重试</button>
        </div>}
        <div className="logs-toolbar">
          <div className="logs-tabs" role="tablist" aria-label="日志来源">
            {TABS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
                className={`btn ${tab === item.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTab(item.id)}>
                <span className="logs-tab-full">{item.full}</span>
                <span className="logs-tab-short">{item.short}</span>
              </button>
            ))}
          </div>
          <div className="logs-actions">
            <button type="button" className="btn btn-ghost" onClick={load}>刷新</button>
            <label className="logs-auto">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 自动
            </label>
          </div>
        </div>
      </div>
      <pre className="mono card logs-body" tabIndex={0}>
        {rendered}
      </pre>
    </div>
  )
}
