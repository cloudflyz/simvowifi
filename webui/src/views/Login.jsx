import React, { useState } from 'react'
import { Wifi, Shield, Loader2 } from 'lucide-react'
import { api } from '../api.js'

export default function Login({ onOk, showToast }) {
  const [pwd, setPwd] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!pwd || busy) return
    setBusy(true); setErr('')
    try {
      await api.login(pwd)
      onOk()
    } catch (e2) {
      setErr(e2.message || '登录失败')
    }
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-5" style={{
      background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,.08) 0%, transparent 60%), #0a0e1a'
    }}>
      <form onSubmit={submit} className="w-full max-w-sm"
        style={{
          background: 'rgba(20,27,45,.85)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(55,65,81,.5)',
          borderRadius: 20,
          padding: 36,
          boxShadow: '0 24px 80px rgba(0,0,0,.5)',
        }}>

        {/* Logo */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Wifi className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="text-xl font-bold text-white leading-none">simvowifi</div>
            <div className="text-xs text-slate-500 mt-1">VoWiFi SIP Gateway</div>
          </div>
        </div>

        <p className="text-sm text-slate-400 mb-6">
          SIM → VoWiFi → SIP 网关 · Web 管理界面
        </p>

        <label className="block text-xs font-medium text-slate-400 mb-2">
          管理密码
        </label>
        <div className="relative mb-1">
          <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="password" value={pwd}
            onChange={(e) => { setPwd(e.target.value); setErr('') }}
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all"
            placeholder="输入密码" autoFocus />
        </div>

        {err && (
          <div className="text-xs text-red-400 mt-2 mb-1">{err}</div>
        )}

        <button type="submit" disabled={!pwd || busy}
          className="w-full mt-4 py-3 rounded-xl font-semibold text-sm text-white transition-all duration-200 flex items-center justify-center gap-2"
          style={{
            background: pwd && !busy
              ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
              : '#374151',
            opacity: pwd && !busy ? 1 : 0.6,
            cursor: pwd && !busy ? 'pointer' : 'not-allowed',
            boxShadow: pwd && !busy ? '0 4px 20px rgba(99,102,241,.3)' : 'none',
          }}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? '登录中…' : '登录'}
        </button>

        <div className="mt-6 pt-4 border-t border-slate-800/60 text-center">
          <span className="text-[10px] text-slate-600">
            SIM → VoWiFi → SIP 网关 · 由 simvowifi 驱动
          </span>
        </div>
      </form>
    </div>
  )
}
