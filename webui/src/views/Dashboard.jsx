import React, { useState } from 'react'
import {
  Power, RotateCw, Bell, ShieldCheck, Info, PhoneOutgoing,
  MessageSquare, Stethoscope, Smartphone, CheckCircle2, AlertCircle,
  ArrowRight, Activity, Wifi, Globe, User, CreditCard, Hash
} from 'lucide-react'
import { api } from '../api.js'
import SipInfoModal from './SipInfoModal.jsx'

const GREEN = '#34d399', RED = '#f87171', AMBER = '#fbbf24'

const STEPS = [
  { key: 'provisioned', label: '开通' },
  { key: 'container',   label: '容器' },
  { key: 'tunnel',      label: 'ePDG' },
  { key: 'ims',         label: 'IMS' },
  { key: 'linphone',    label: 'Linphone' },
]

const EVENT_LABELS = {
  call_in: '来电', call_out: '外呼', call_result: '通话结果',
  sms_in: '收到短信', sms_out: '发出短信',
  tunnel_up: 'ePDG 隧道建立', tunnel_down: 'ePDG 隧道断开',
  registered: 'IMS 已注册', unregistered: 'IMS 注销',
}

function derive(o) {
  const flags = {
    provisioned: !!o?.provisioned,
    container: !!o?.container?.running,
    tunnel: o?.tunnel?.state === 'CONNECTED',
    ims: o?.ims?.state === 'Registered',
    linphone: !!o?.linphone?.online,
  }
  let state, label
  if (!flags.provisioned) { state = 'NOT_PROVISIONED'; label = '未开通' }
  else if (!flags.container) { state = 'STOPPED'; label = '已停止' }
  else if (!flags.tunnel) { state = 'TUNNEL_DOWN'; label = '隧道未连接' }
  else if (!flags.ims) { state = 'REGISTERING'; label = 'IMS 注册中' }
  else { state = 'OK'; label = '在线' }
  const rank = STEPS.findIndex(({ key }) => !flags[key])
  return { flags, state, label, rank: rank === -1 ? STEPS.length : rank }
}

function StatusBadge({ state, label, extra }) {
  const pulse = state === 'OK' ? 'pulse-green' :
    state === 'ERROR' ? 'pulse-red' :
    state === 'STOPPED' || state === 'NOT_PROVISIONED' ? 'pulse-slate' : 'pulse-amber'
  const dotColor = state === 'OK' ? GREEN :
    state === 'ERROR' ? RED :
    state === 'STOPPED' || state === 'NOT_PROVISIONED' ? '#64748b' : AMBER
  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <div className={`pulse-dot ${pulse}`} />
      </div>
      <div>
        <div className="text-base font-semibold" style={{ color: dotColor }}>{label}</div>
        {extra && <div className="text-xs text-amber-400/80 mt-0.5">{extra}</div>}
      </div>
    </div>
  )
}

function StepPipeline({ d }) {
  return (
    <div className="flex gap-1.5 mt-4">
      {STEPS.map(({ key, label }, idx) => {
        const done = d.rank > idx || d.state === 'OK'
        const cur = d.rank === idx && d.state !== 'OK'
        return (
          <div key={key} className="flex-1 text-center">
            <div className="h-1.5 rounded-full transition-all duration-300"
              style={{ background: done ? GREEN : cur ? AMBER : '#1a2238' }} />
            <div className="text-[10px] text-slate-500 mt-1.5">{label}</div>
          </div>
        )
      })}
    </div>
  )
}

function DetailRow({ k, v, icon: Icon, mono }) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />}
      <span className="text-slate-500 text-xs flex-shrink-0">{k}</span>
      <span className={`text-xs text-slate-300 ${mono ? 'font-mono' : ''} truncate`}>{v || '—'}</span>
    </div>
  )
}

function DoctorModal({ onClose }) {
  const [items, setItems] = useState(null)
  React.useEffect(() => { api.doctor().then((r) => setItems(r.items)).catch((e) => setItems([{ level: 'bad', msg: e.message }])) }, [])

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}>
      <div className="w-full max-w-lg mx-4 rounded-2xl shadow-2xl"
        style={{ background: 'rgba(20,27,45,.95)', border: '1px solid #243049', backdropFilter: 'blur(20px)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Stethoscope className="w-5 h-5 text-cyan-400" />
              环境诊断
            </h2>
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={2} strokeLinecap="round" /></svg>
            </button>
          </div>
          {!items && <div className="text-slate-500 text-sm">检查中…</div>}
          {items && (
            <div className="space-y-2 max-h-80 overflow-y-auto no-scrollbar">
              {items.map((it, i) => (
                <div key={i} className="flex items-start gap-2.5 text-sm">
                  {it.level === 'ok' && <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />}
                  {it.level === 'warn' && <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />}
                  {it.level === 'bad' && <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />}
                  <span className="text-slate-300">{it.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard({ overview, refreshOverview, showToast, setView }) {
  const [busy, setBusy] = useState(null)
  const [doctor, setDoctor] = useState(false)
  const [sipInfo, setSipInfo] = useState(false)
  const [callTo, setCallTo] = useState('')

  const d = derive(overview)
  const o = overview

  const act = async (action) => {
    setBusy(action)
    try {
      const r = await api.lifecycle(action)
      showToast(r.ok ? `已${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}` : (r.error || '操作失败'), r.ok ? 'success' : 'error')
      await refreshOverview()
    } catch (e) { showToast('操作失败：' + e.message, 'error') }
    setBusy(null)
  }

  const barkTest = async () => {
    setBusy('bark')
    try {
      const r = await api.bark.test()
      showToast(r.ok ? `测试推送已发送 ${r.detail || ''}` : `推送失败：${r.detail || r.error}`, r.ok ? 'success' : 'error')
    } catch (e) { showToast('推送失败：' + e.message, 'error') }
    setBusy(null)
  }

  const placeCall = async () => {
    if (!callTo.trim()) return
    setBusy('call')
    try {
      const r = await api.call(callTo.trim())
      showToast(r.ok ? `已外呼 ${callTo}` : `外呼失败：${r.detail || r.error}`, r.ok ? 'success' : 'error')
    } catch (e) { showToast('外呼失败：' + e.message, 'error') }
    setBusy(null)
  }

  const events = [...(o?.events || [])].reverse()

  return (
    <div className="flex flex-col gap-4 max-w-5xl">

      {/* ── 状态卡 ── */}
      <div className="rounded-2xl p-5 shadow-lg"
        style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <StatusBadge
            state={d.state}
            label={d.label}
            extra={o && d.state === 'OK' && !d.flags.linphone ? 'Linphone 离线——来电无人接' : null}
          />
          <div className="flex gap-2 flex-wrap">
            {!d.flags.provisioned ? (
              <button onClick={() => setView('provision')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', boxShadow: '0 2px 12px rgba(99,102,241,.25)' }}>
                前往开通 <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : !d.flags.container ? (
              <button onClick={() => act('start')} disabled={busy === 'start'}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #34d399 0%, #059669 100%)' }}>
                <Power className="w-3.5 h-3.5" /> {busy === 'start' ? '启动中…' : '启动'}
              </button>
            ) : (
              <>
                <button onClick={() => act('restart')} disabled={!!busy}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors disabled:opacity-50">
                  <RotateCw className="w-3.5 h-3.5" /> 重启
                </button>
                <button onClick={() => act('stop')} disabled={busy === 'stop'}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors disabled:opacity-50">
                  <Power className="w-3.5 h-3.5" /> {busy === 'stop' ? '停止中…' : '停止'}
                </button>
              </>
            )}
            <button onClick={barkTest} disabled={busy === 'bark'}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors disabled:opacity-50">
              <Bell className="w-3.5 h-3.5" /> 推送测试
            </button>
            <button onClick={() => setDoctor(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors">
              <Stethoscope className="w-3.5 h-3.5" /> 诊断
            </button>
            <button onClick={() => setSipInfo(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors">
              <Smartphone className="w-3.5 h-3.5" /> SIP 信息
            </button>
          </div>
        </div>

        {d.flags.provisioned && <StepPipeline d={d} />}

        {d.flags.provisioned && (
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
            <DetailRow k="号码"   v={o?.line?.msisdn} icon={PhoneOutgoing} mono />
            <DetailRow k="IMSI"   v={o?.line?.imsi}   icon={Hash} mono />
            <DetailRow k="ICCID"  v={o?.line?.iccid}  icon={CreditCard} mono />
            <DetailRow k="IMEI"   v={o?.line?.imei}   icon={Smartphone} mono />
            <DetailRow k="运营商" v={o?.line?.epdg ? o.line.epdg.replace(/epdg\.|\.pub\.3gppnetwork\.org/g, '') : ''} icon={Globe} />
            <DetailRow k="ePDG"   v={o?.line?.epdg}   icon={Wifi} mono />
            <DetailRow k="SMSC"   v={o?.line?.smsc}   icon={MessageSquare} mono />
            <DetailRow k="Linphone" v={d.flags.linphone ? '在线' : '离线'} icon={User}
              />
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-xs">隧道</span>
              <span className={`text-xs font-medium ${o?.tunnel?.state === 'CONNECTED' ? 'text-emerald-400' : 'text-slate-400'}`}>{o?.tunnel?.state || '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-xs">IMS</span>
              <span className="text-xs text-slate-300">{o?.ims?.state || '—'}</span>
            </div>
          </div>
        )}

        {!d.flags.provisioned && (
          <div className="mt-3 text-sm text-slate-500 flex items-center gap-2">
            <Info className="w-4 h-4 flex-shrink-0" />
            <span>
              尚未开通线路。把 SIM 卡插入读卡器，到
              <button className="text-indigo-400 font-medium hover:underline ml-1" onClick={() => setView('provision')}
                >SIM 开通</button>
              页完成开通，然后回来启动 engine。
            </span>
          </div>
        )}
      </div>

      {/* ── 操作卡 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 外呼 */}
        <div className="rounded-2xl p-5"
          style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <PhoneOutgoing className="w-4 h-4 text-cyan-400" /> 外呼
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            呼叫经网关从 VoWiFi 线路拨出，接听在 Linphone 客户端进行。
          </p>
          <div className="flex gap-2">
            <input className="flex-1 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500 transition-all"
              placeholder="+8613…" value={callTo}
              onChange={(e) => setCallTo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && placeCall()}
              disabled={!d.flags.provisioned} />
            <button onClick={placeCall} disabled={!d.flags.provisioned || busy === 'call' || !callTo.trim()}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)' }}>
              呼叫
            </button>
          </div>
        </div>

        {/* Bark */}
        <div className="rounded-2xl p-5"
          style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-400" /> Bark 推送
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            {o?.bark_configured
              ? (o.bark_encrypted ? '已配置端到端加密。' : '未启用加密（设置页可开启）。')
              : '尚未配置——到设置页填写 Bark key。'}
          </p>
          <div className="flex gap-2">
            <button onClick={barkTest} disabled={busy === 'bark' || !o?.bark_configured}
              className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors disabled:opacity-50">
              发送测试
            </button>
            <button onClick={() => setView('settings')}
              className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors flex items-center gap-1">
              配置 <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── 事件 ── */}
      <div className="rounded-2xl p-5"
        style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" /> 最近事件
        </h3>
        {events.length === 0 && <div className="text-sm text-slate-500">暂无事件（engine 启动后产生）。</div>}
        <div className="space-y-1">
          {events.map((e, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm"
              style={i === 0 ? { background: 'rgba(99,102,241,.06)' } : undefined}>
              <span className="text-slate-500 text-xs w-16 flex-shrink-0">{EVENT_LABELS[e.event] || e.event}</span>
              <span className="text-slate-300 text-xs font-mono truncate">
                {JSON.stringify(e.args || [])}
              </span>
            </div>
          ))}
        </div>
      </div>

      {doctor && <DoctorModal onClose={() => setDoctor(false)} />}
      {sipInfo && <SipInfoModal onClose={() => setSipInfo(false)} />}
    </div>
  )
}
