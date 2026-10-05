import React, { useEffect, useState, useCallback, useRef } from 'react'
import { api, setUnauthorizedHandler } from './api.js'
import Login from './views/Login.jsx'
import Dashboard from './views/Dashboard.jsx'
import Softphone from './views/Softphone.jsx'
import Messages from './views/Messages.jsx'
import Provision from './views/Provision.jsx'
import Settings from './views/Settings.jsx'
import Logs from './views/Logs.jsx'

const NAV = [
  ['dashboard', '总览', '▤'],
  ['messages', '短信', '✉'],
  ['softphone', '软电话', '☎'],
  ['provision', 'SIM 开通', '▣'],
  ['settings', '设置', '⚙'],
  ['logs', '日志', '≣'],
]

const TITLES = {
  dashboard: '总览', messages: '短信', softphone: '软电话',
  provision: 'SIM 开通', settings: '设置', logs: '日志',
}

const EVENT_LABELS = {
  call_in: '来电', call_out: '外呼', call_result: '通话结果',
  sms_in: '收到短信', sms_out: '发出短信',
  tunnel_up: 'ePDG 隧道已建立', tunnel_down: 'ePDG 隧道断开',
  registered: 'IMS 已注册', unregistered: 'IMS 注销',
}

export default function App() {
  const [authed, setAuthed] = useState(null)   // null=检查中 false=登录页 true=进入
  const [view, setView] = useState('dashboard')
  const [overview, setOverview] = useState(null)
  const [toast, setToast] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'auto')
  const lastEvents = useRef(null)              // 上次事件列表的 JSON 签名（用于增量提醒）

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  const showToast = useCallback((m) => {
    setToast(m)
    clearTimeout(showToast._t)
    showToast._t = setTimeout(() => setToast(null), 5000)
  }, [])

  const refreshOverview = useCallback(async () => {
    try {
      const r = await api.overview()
      setOverview(r)
      // 增量事件提醒（后端无 WebSocket，用轮询 diff）
      const sig = JSON.stringify(r.events || [])
      if (lastEvents.current !== null && sig !== lastEvents.current) {
        const old = new Set((lastEvents.current ? JSON.parse(lastEvents.current) : []).map((e) => JSON.stringify(e)))
        const fresh = (r.events || []).filter((e) => !old.has(JSON.stringify(e))).slice(0, 3)
        for (const e of fresh) {
          if (e.event === 'sms_in') showToast(`📩 短信：${(e.args || [])[0] || ''}`)
          else if (e.event === 'call_in') showToast(`📞 来电：${(e.args || [])[0] || ''}`)
          else if (e.event === 'tunnel_down') showToast('⚠ ePDG 隧道断开')
          else if (e.event === 'tunnel_up') showToast('✅ ePDG 隧道已建立')
          else if (e.event === 'registered') showToast('✅ IMS 已注册')
          else if (e.event === 'unregistered') showToast('⚠ IMS 已注销')
        }
      }
      lastEvents.current = sig
    } catch (e) {
      if (e.status !== 401) { /* 服务暂不可用，下轮再试 */ }
    }
  }, [showToast])

  // 会话检查
  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false))
    api.session().then((s) => setAuthed(!!s.auth)).catch(() => setAuthed(false))
  }, [])

  // 登录后轮询总览（5s；页面隐藏时跳过省资源）
  useEffect(() => {
    if (authed !== true) { lastEvents.current = null; return }
    refreshOverview()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refreshOverview()
    }, 5000)
    return () => clearInterval(t)
  }, [authed, refreshOverview])

  if (authed === null) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-mute)' }}>
      simvowifi 加载中…
    </div>
  )
  if (authed === false) return <Login onOk={() => { setAuthed(true); setOverview(null) }} showToast={showToast} />

  const View = { dashboard: Dashboard, softphone: Softphone, messages: Messages, provision: Provision, settings: Settings, logs: Logs }[view]

  const logout = async () => {
    try { await api.logout() } catch {}
    setAuthed(false)
    setOverview(null)
  }

  return (
    <div className="app-shell" style={{ display: 'flex', height: '100%' }}>
      <aside className="app-sidebar" style={{ width: 210, background: 'var(--sidebar)', borderRight: '1px solid var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="app-brand" style={{ fontWeight: 800, fontSize: 18, padding: '4px 8px 16px', letterSpacing: .5 }}>
          <span style={{ color: '#3b82f6' }}>sim</span>vowifi<span style={{ color: 'var(--text-mute)', fontWeight: 500 }}> · WebUI</span>
        </div>
        {NAV.map(([k, label, icon]) => (
          <button className="app-nav-button" key={k} onClick={() => setView(k)}
            style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
              background: view === k ? 'var(--active)' : 'transparent', color: view === k ? 'var(--primary)' : 'var(--text-dim)',
              border: 'none', fontSize: 14, fontWeight: 600, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 18, textAlign: 'center' }}>{icon}</span><span className="app-nav-label">{label}</span>
          </button>
        ))}
        <div className="app-theme-picker" style={{ marginTop: 'auto', display: 'flex', gap: 6, padding: 8 }}>
          {[['auto', '🌗'], ['light', '☀'], ['dark', '🌙']].map(([t, icon]) => (
            <button key={t} onClick={() => setTheme(t)} title={t === 'auto' ? '跟随系统' : t === 'light' ? '浅色' : '深色'}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer', fontSize: 11,
                fontWeight: 600, border: '1px solid var(--border)',
                background: theme === t ? 'var(--primary)' : 'transparent',
                color: theme === t ? '#fff' : 'var(--text-dim)',
              }}>{icon}</button>
          ))}
        </div>
        <button className="app-logout" onClick={logout}
          style={{ margin: '0 8px 8px', padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12,
            fontWeight: 600, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)' }}>
          退出登录
        </button>
      </aside>

      <main className="app-main" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="app-header" style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 16, flexShrink: 0, padding: '24px 24px 0' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{TITLES[view]}</h1>
          {overview?.line?.msisdn && (
            <span className="mono" style={{ fontSize: 13, color: 'var(--text-mute)' }}>{overview.line.msisdn}</span>
          )}
        </div>
        <div className="app-content" style={{ flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', padding: '6px 24px 24px' }}>
          <View overview={overview} refreshOverview={refreshOverview} showToast={showToast} setView={setView} />
        </div>
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1d4ed8', color: '#fff', padding: '12px 18px', borderRadius: 12, boxShadow: '0 8px 30px #0008', fontWeight: 600, zIndex: 200 }}>
          {toast}
        </div>
      )}
    </div>
  )
}
