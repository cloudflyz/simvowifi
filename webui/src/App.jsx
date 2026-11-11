import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  LayoutDashboard, MessageSquare, Phone, CardSim, Settings, ScrollText,
  Smartphone, Sun, Moon, Monitor, LogOut, Wifi, Bell
} from 'lucide-react'
import { api, setUnauthorizedHandler } from './api.js'
import Login from './views/Login.jsx'
import Dashboard from './views/Dashboard.jsx'
import Softphone from './views/Softphone.jsx'
import Messages from './views/Messages.jsx'
import Provision from './views/Provision.jsx'
import SettingsView from './views/Settings.jsx'
import Logs from './views/Logs.jsx'
import Esim from './views/Esim.jsx'

const NAV = [
  { key: 'dashboard', label: '总览',     icon: LayoutDashboard },
  { key: 'messages',  label: '短信',     icon: MessageSquare },
  { key: 'softphone', label: '软电话',   icon: Phone },
  { key: 'provision', label: 'SIM 开通', icon: CardSim },
  { key: 'esim',      label: 'eSIM',    icon: Smartphone },
  { key: 'settings',  label: '设置',     icon: Settings },
  { key: 'logs',      label: '日志',     icon: ScrollText },
]

const TITLES = {
  dashboard: '总览', messages: '短信', softphone: '软电话',
  provision: 'SIM 开通', esim: 'eSIM', settings: '设置', logs: '日志',
}

const EVENT_LABELS = {
  call_in: '来电', call_out: '外呼', call_result: '通话结果',
  sms_in: '收到短信', sms_out: '发出短信',
  tunnel_up: 'ePDG 隧道已建立', tunnel_down: 'ePDG 隧道断开',
  registered: 'IMS 已注册', unregistered: 'IMS 注销',
}

export default function App() {
  const [authed, setAuthed] = useState(null)
  const [view, setView] = useState('dashboard')
  const [overview, setOverview] = useState(null)
  const [toast, setToast] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')
  const lastEvents = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  const showToast = useCallback((m, type = 'info') => {
    setToast({ msg: m, type })
    clearTimeout(showToast._t)
    showToast._t = setTimeout(() => setToast(null), 4000)
  }, [])

  const refreshOverview = useCallback(async () => {
    try {
      const r = await api.overview()
      setOverview(r)
      const sig = JSON.stringify(r.events || [])
      if (lastEvents.current !== null && sig !== lastEvents.current) {
        const old = new Set((lastEvents.current ? JSON.parse(lastEvents.current) : []).map((e) => JSON.stringify(e)))
        const fresh = (r.events || []).filter((e) => !old.has(JSON.stringify(e))).slice(0, 3)
        for (const e of fresh) {
          if (e.event === 'sms_in') showToast(`📩 短信：${(e.args || [])[0] || ''}`, 'success')
          else if (e.event === 'call_in') showToast(`📞 来电：${(e.args || [])[0] || ''}`, 'info')
          else if (e.event === 'tunnel_down') showToast('⚠ ePDG 隧道断开', 'error')
          else if (e.event === 'tunnel_up') showToast('✅ ePDG 隧道已建立', 'success')
          else if (e.event === 'registered') showToast('✅ IMS 已注册', 'success')
          else if (e.event === 'unregistered') showToast('⚠ IMS 已注销', 'error')
        }
      }
      lastEvents.current = sig
    } catch (e) {
      if (e.status !== 401) {}
    }
  }, [showToast])

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false))
    api.session().then((s) => setAuthed(!!s.auth)).catch(() => setAuthed(false))
  }, [])

  useEffect(() => {
    if (authed !== true) { lastEvents.current = null; return }
    refreshOverview()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refreshOverview()
    }, 5000)
    return () => clearInterval(t)
  }, [authed, refreshOverview])

  if (authed === null) return (
    <div className="h-screen flex items-center justify-center text-slate-500">
      <div className="flex items-center gap-2">
        <Wifi className="w-5 h-5 animate-pulse" />
        <span className="text-sm">simvowifi 加载中…</span>
      </div>
    </div>
  )
  if (authed === false) return <Login onOk={() => { setAuthed(true); setOverview(null) }} showToast={showToast} />

  const View = { dashboard: Dashboard, softphone: Softphone, messages: Messages, provision: Provision, esim: Esim, settings: SettingsView, logs: Logs }[view]

  const logout = async () => {
    try { await api.logout() } catch {}
    setAuthed(false)
    setOverview(null)
  }

  const isDark = theme !== 'light'

  return (
    <div className="app-shell flex h-screen">
      {/* ── 侧边栏 ── */}
      <aside className={`app-sidebar w-56 flex-shrink-0 flex flex-col border-r ${
        isDark ? 'bg-slate-900/95 border-slate-800' : 'bg-white border-slate-200'
      }`} style={{ backdropFilter: 'blur(12px)' }}>
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-800/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center">
              <Wifi className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-bold text-base leading-none text-white">simvowifi</div>
              <div className="text-[10px] text-slate-500 mt-0.5 tracking-wide">VoWiFi Gateway</div>
            </div>
          </div>
        </div>

        {/* 导航 */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ key, label, icon: Icon }) => {
            const active = view === key
            return (
              <button key={key} onClick={() => setView(key)}
                className={`app-nav-button w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  active
                    ? 'bg-indigo-500/15 text-indigo-400'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}>
                <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-indigo-400' : ''}`} />
                <span className="app-nav-label">{label}</span>
                {key === 'messages' && overview?.line?.msisdn && (
                  <span className="ml-auto text-[10px] text-slate-600">{overview.line.msisdn?.slice(-4)}</span>
                )}
              </button>
            )
          })}
        </nav>

        {/* 底部 */}
        <div className="px-3 py-3 border-t border-slate-800/50 space-y-1">
          <div className="app-theme-picker flex gap-1">
            {[['dark', Moon, '深色'], ['light', Sun, '浅色'], ['auto', Monitor, '跟随系统']].map(([t, Icon, label]) => (
              <button key={t} onClick={() => setTheme(t)} title={label}
                className={`flex-1 flex items-center justify-center py-1.5 rounded-md transition-colors ${
                  theme === t ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'
                }`}>
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
          <button onClick={logout} className="app-logout w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors">
            <LogOut className="w-3.5 h-3.5" />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      {/* ── 主内容 ── */}
      <main className="app-main flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className={`app-header flex items-center gap-4 px-6 pt-6 pb-2 flex-shrink-0 ${
          isDark ? 'border-b border-slate-800/40' : 'border-b border-slate-100'
        }`}>
          <h1 className="text-xl font-bold text-white">{TITLES[view]}</h1>
          {overview?.line?.msisdn && (
            <span className="text-xs text-slate-500 font-mono">{overview.line.msisdn}</span>
          )}
        </header>
        <div className="app-content flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 py-4">
          <View overview={overview} refreshOverview={refreshOverview} showToast={showToast} setView={setView} />
        </div>
      </main>

      {/* ── Toast ── */}
      {toast && (
        <div className="toast-enter fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl shadow-black/40 text-sm font-medium"
          style={{
            background: toast.type === 'error' ? '#1e293b' : toast.type === 'success' ? '#064e3b' : '#1e1b4b',
            border: `1px solid ${toast.type === 'error' ? '#7f1d1d' : toast.type === 'success' ? '#065f46' : '#312e81'}`,
          }}>
          {toast.type === 'success' && <Bell className="w-4 h-4 text-emerald-400" />}
          {toast.type === 'error' && <Bell className="w-4 h-4 text-red-400" />}
          <span className="text-slate-200">{toast.msg}</span>
        </div>
      )}
    </div>
  )
}
