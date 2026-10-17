import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { RefreshCw, Terminal, Settings2, Wifi, Bell } from 'lucide-react'
import { api } from '../api.js'

const FG = {
  30: '#475569', 31: '#f87171', 32: '#34d399', 33: '#fbbf24', 34: '#60a5fa',
  35: '#a78bfa', 36: '#22d3ee', 37: '#e2e8f0',
  90: '#64748b', 91: '#f87171', 92: '#34d399', 93: '#fbbf24', 94: '#60a5fa',
  95: '#a78bfa', 96: '#22d3ee', 97: '#e2e8f0',
}

function ansi(text) {
  const out = []
  let style = {}
  let key = 0
  const re = /\x1b?\[([0-9;]*)m/g
  let last = 0, m
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
  { id: 'entrypoint', label: '引擎', icon: Terminal },
  { id: 'asterisk',   label: 'Asterisk', icon: Settings2 },
  { id: 'charon',     label: 'IKE', icon: Wifi },
  { id: 'events',     label: '事件', icon: Bell },
]

export default function Logs() {
  const [logs, setLogs] = useState({})
  const [tab, setTab] = useState('entrypoint')
  const [auto, setAuto] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { const r = await api.logs(tab, 400); setLogs((x) => ({ ...x, [tab]: r.log })); setErr('') }
    catch (e) { setErr(e.message) }
  }, [tab])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 3000)
    return () => clearInterval(t)
  }, [auto, load])

  const rendered = useMemo(() => ansi(logs[tab] || '（空）'), [logs, tab])

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {err && <span className="text-xs text-red-400">{err}</span>}
        <div className="flex gap-1.5 flex-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                tab === id
                  ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                  : 'text-slate-400 hover:bg-slate-800/60 border border-transparent'
              }`}>
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
        <button onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors">
          <RefreshCw className="w-3 h-3" /> 刷新
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer px-2">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-600 text-indigo-500 focus:ring-indigo-500/40" />
          自动
        </label>
      </div>

      {/* 日志正文 */}
      <pre className="flex-1 min-h-0 rounded-xl p-4 text-xs leading-relaxed overflow-auto no-scrollbar font-mono"
        style={{ background: 'rgba(10,14,26,.8)', border: '1px solid #243049' }}
        tabIndex={0}>
        {rendered}
      </pre>
    </div>
  )
}
