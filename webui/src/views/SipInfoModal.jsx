import React, { useEffect, useState } from 'react'
import { Smartphone, Copy, Check, X } from 'lucide-react'
import { api } from '../api.js'

export default function SipInfoModal({ onClose }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => { api.linphone().then(setInfo).catch((e) => setErr(e.message)) }, [])

  const copy = async (label, value) => {
    try {
      // 优先用 clipboard API（需要 HTTPS）
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value)
      } else {
        // Fallback: 临时 textarea + execCommand
        const ta = document.createElement('textarea')
        ta.value = value
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(label)
      setTimeout(() => setCopied(''), 1500)
    } catch (e) {
      console.error('copy failed:', e)
    }
  }

  const Field = ({ label, value, hint }) => (
    <div className="mb-3">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="flex gap-2">
        <code className="flex-1 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700 text-sm font-mono text-slate-200 overflow-x-auto whitespace-nowrap">
          {value || <span className="text-slate-600">—</span>}
        </code>
        {value != null && value !== '' && (
          <button onClick={() => copy(label, String(value))}
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs text-slate-400 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors">
            {copied === label ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied === label ? '已复制' : '复制'}
          </button>
        )}
      </div>
      {hint && <div className="text-[11px] text-slate-600 mt-1">{hint}</div>}
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}>
      <div className="w-full max-w-lg mx-4 rounded-2xl shadow-2xl"
        style={{ background: 'rgba(20,27,45,.95)', border: '1px solid #243049', backdropFilter: 'blur(20px)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="p-6 max-h-[85vh] overflow-y-auto no-scrollbar">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-cyan-400" />
              Linphone / SIP 接入
            </h2>
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            在手机 Linphone 注册网关：来电振铃、短信推送；客户端拨出经 VoWiFi 线路出局。
          </p>

          {err && <div className="text-sm text-red-400">{err}</div>}
          {!info && !err && <div className="text-slate-500 text-sm">加载中…</div>}

          {info && (
            <>
              <Field label="服务器 / 域名" value={`${info.server}:${info.port}`}
                hint="局域网地址（config: sip.advertise_address，空=自动探测）。" />
              <Field label="用户名" value={info.username} />
              <Field label="密码" value={info.password} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="端口" value={String(info.port)} />
                <Field label="传输" value={String(info.transport).toUpperCase()} hint="iOS 建议 UDP/TCP" />
              </div>

              <div className="mt-4 p-3 rounded-xl bg-slate-800/40 border border-slate-700">
                <div className="text-xs font-semibold text-slate-300 mb-2">Linphone 设置要点</div>
                <div className="text-xs text-slate-400 leading-relaxed space-y-1">
                  <div>1. 设置 → SIP 账户 → 添加 SIP 账户（用户名/密码如上）</div>
                  <div>2. 传输选 <b>{String(info.transport).toUpperCase()}</b>，服务器 {info.server}（端口 {info.port}）</div>
                  <div>3. 拨号格式：E.164 带 +（如 +8613800138000）</div>
                  <div>4. 来电推送：保持 Linphone 在线（iOS 开启 Push 通知）</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
