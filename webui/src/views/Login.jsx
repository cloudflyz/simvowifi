import React, { useState } from 'react'
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
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form className="card" onSubmit={submit} style={{ padding: 36, width: 360, maxWidth: '94vw' }}>
        <div style={{ fontWeight: 800, fontSize: 24, marginBottom: 4, letterSpacing: .5 }}>
          <span style={{ color: '#3b82f6' }}>sim</span>vowifi
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-mute)', marginBottom: 24 }}>SIM → VoWiFi → SIP 网关 · Web 管理界面</div>
        <label>管理密码（data/config.yaml 的 webui.password）</label>
        <input type="password" value={pwd} autoFocus
          onChange={(e) => { setPwd(e.target.value); setErr('') }}
          placeholder="密码" style={{ marginBottom: 12 }} />
        {err && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={!pwd || busy}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
