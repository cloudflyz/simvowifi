import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

// Linphone / 通用 SIP 客户端接入信息（对应 CLI 的 `simvowifi sip` 输出）
export default function SipInfoModal({ onClose }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => { api.linphone().then(setInfo).catch((e) => setErr(e.message)) }, [])

  const copy = async (label, value) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(''), 1500) } catch {}
  }

  const Field = ({ label, value, hint }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code style={{ flex: 1, background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '7px 10px', fontSize: 13, fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          {value || <span style={{ color: 'var(--text-faint)' }}>—</span>}
        </code>
        {value != null && value !== '' &&
          <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => copy(label, String(value))}>
            {copied === label ? '✓' : '复制'}
          </button>}
      </div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
      onClick={onClose}>
      <div className="card" style={{ padding: 24, width: 520, maxWidth: '92vw', maxHeight: '92vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Linphone / SIP 接入信息</h2>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.7 }}>
          在手机 Linphone（或其他 SIP 客户端）注册网关：来电振铃、短信收到推送；
          客户端拨出的号码经 VoWiFi 线路出局。
        </div>

        {err && <div style={{ color: '#ef4444', fontSize: 13 }}>{err}</div>}
        {!info && !err && <div style={{ color: 'var(--text-mute)' }}>加载中…</div>}

        {info && (
          <>
            <Field label="服务器 / 域名" value={`${info.server}:${info.port}`}
              hint="网关本机的局域网地址（config: sip.advertise_address，空=自动探测）。" />
            <Field label="用户名" value={info.username} />
            <Field label="密码" value={info.password} />
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}><Field label="端口" value={String(info.port)} /></div>
              <div style={{ flex: 1 }}><Field label="传输" value={String(info.transport).toUpperCase()}
                hint="iOS 建议 UDP/TCP。" /></div>
            </div>

            <div style={{ marginTop: 6, marginBottom: 6, fontWeight: 700, fontSize: 13 }}>Linphone 设置要点</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.9 }}>
              1. 设置 → SIP 账户 → 添加：<b>SIP 账户</b> 用户名/密码如上<br />
              2. 传输选 <b>{String(info.transport).toUpperCase()}</b>，服务器填 <span className="mono">{info.server}</span>（端口 {info.port}）<br />
              3. 拨号格式：E.164 带 <span className="mono">+</span>（如 +8613800138000）<br />
              4. 来电推送：保持 Linphone 在线（iOS 建议开启 Push 通知 / 允许后台）
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
