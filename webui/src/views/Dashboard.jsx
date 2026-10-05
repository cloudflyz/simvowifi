import React, { useState } from 'react'
import { api } from '../api.js'
import SipInfoModal from './SipInfoModal.jsx'

const GREEN = '#22c55e', RED = '#ef4444'

const STEPS = [
  ['provisioned', '开通'],
  ['container', '容器'],
  ['tunnel', 'ePDG 隧道'],
  ['ims', 'IMS 注册'],
  ['linphone', 'Linphone'],
]

const EVENT_LABELS = {
  call_in: '来电', call_out: '外呼', call_result: '通话结果',
  sms_in: '收到短信', sms_out: '发出短信',
  tunnel_up: 'ePDG 隧道建立', tunnel_down: 'ePDG 隧道断开',
  registered: 'IMS 已注册', unregistered: 'IMS 注销',
}

function derive(o) {
  const provisioned = !!o?.provisioned
  const running = !!o?.container?.running
  const tunnelUp = o?.tunnel?.state === 'CONNECTED'
  const imsOk = o?.ims?.state === 'Registered'
  const linOk = !!o?.linphone?.online
  const flags = { provisioned, container: running, tunnel: tunnelUp, ims: imsOk, linphone: linOk }
  let state, label
  if (!provisioned) { state = 'NOT_PROVISIONED'; label = '未开通' }
  else if (!running) { state = 'STOPPED'; label = '已停止' }
  else if (!tunnelUp) { state = 'TUNNEL_DOWN'; label = '隧道未连接' }
  else if (!imsOk) { state = 'REGISTERING'; label = 'IMS 注册中' }
  else { state = 'OK'; label = '在线' }
  const rank = STEPS.findIndex(([k]) => !flags[k])  // 第一个未完成步骤
  return { flags, state, label, rank: rank === -1 ? STEPS.length : rank }
}

function Pipeline({ d }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
      {STEPS.map(([k, label], idx) => {
        const done = d.rank > idx
        const cur = d.rank === idx && d.state !== 'OK'
        const bg = done || d.state === 'OK' ? GREEN : cur ? '#eab308' : 'var(--border-strong)'
        return (
          <div key={k} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ height: 5, borderRadius: 3, background: bg }} />
            <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>{label}</div>
          </div>
        )
      })}
    </div>
  )
}

function Detail({ k, v, mono }) {
  return (
    <>
      <span style={{ color: 'var(--text-mute)' }}>{k}</span>
      <span className={mono ? 'mono' : ''} style={mono ? { fontSize: 12, overflowWrap: 'anywhere' } : undefined}>{v || '—'}</span>
    </>
  )
}

function DoctorModal({ onClose }) {
  const [items, setItems] = useState(null)
  React.useEffect(() => { api.doctor().then((r) => setItems(r.items)).catch((e) => setItems([{ level: 'bad', msg: e.message }])) }, [])
  const COLOR = { ok: GREEN, warn: '#eab308', bad: RED }
  const ICON = { ok: '✓', warn: '⚠', bad: '✕' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}
      onClick={onClose}>
      <div className="card" style={{ padding: 24, width: 520, maxWidth: '92vw', maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>环境诊断</h2>
        {!items && <div style={{ color: 'var(--text-mute)' }}>检查中…</div>}
        {items && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13.5 }}>
                <span style={{ color: COLOR[it.level] || 'var(--text-dim)', fontWeight: 800, width: 16 }}>{ICON[it.level] || '·'}</span>
                <span style={{ color: 'var(--text-soft)' }}>{it.msg}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-primary" onClick={onClose}>关闭</button>
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

  const o = overview
  const d = derive(o)

  const act = async (action) => {
    setBusy(action)
    try {
      const r = await api.lifecycle(action)
      showToast(r.ok ? `已${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}：${r.detail || ''}` : (r.error || '操作失败'))
      await refreshOverview()
    } catch (e) {
      showToast('操作失败：' + e.message)
    }
    setBusy(null)
  }

  const barkTest = async () => {
    setBusy('bark')
    try {
      const r = await api.bark.test()
      showToast(r.ok ? `测试推送已发送 ${r.detail || ''}` : `推送失败：${r.detail || r.error}`)
    } catch (e) { showToast('推送失败：' + e.message) }
    setBusy(null)
  }

  const placeCall = async () => {
    if (!callTo.trim()) return
    setBusy('call')
    try {
      const r = await api.call(callTo.trim())
      showToast(r.ok ? `已外呼 ${callTo}（Linphone 会振铃）` : `外呼失败：${r.detail || r.error}`)
    } catch (e) { showToast('外呼失败：' + e.message) }
    setBusy(null)
  }

  const events = [...(o?.events || [])].reverse()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ---- 状态卡 ---- */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 700 }}>
            <span className={`dot st-${d.state}`} />
            {d.label}
            {o && d.state === 'OK' && !d.flags.linphone &&
              <span style={{ fontSize: 12, fontWeight: 600, color: '#eab308' }}>（Linphone 离线——来电无人接）</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!d.flags.provisioned ? (
              <button className="btn btn-primary" onClick={() => setView('provision')}>前往开通 ▸</button>
            ) : !d.flags.container ? (
              <button className="btn btn-primary" disabled={busy === 'start'} onClick={() => act('start')}>{busy === 'start' ? '启动中…' : '启动'}</button>
            ) : (
              <>
                <button className="btn btn-ghost" disabled={!!busy} onClick={() => act('restart')}>重启</button>
                <button className="btn btn-ghost" disabled={busy === 'stop'} onClick={() => act('stop')}>{busy === 'stop' ? '停止中…' : '停止'}</button>
              </>
            )}
            <button className="btn btn-ghost" onClick={barkTest} disabled={busy === 'bark'}>推送测试</button>
            <button className="btn btn-ghost" onClick={() => setDoctor(true)}>诊断</button>
            <button className="btn btn-ghost" onClick={() => setSipInfo(true)}>SIP 信息</button>
          </div>
        </div>

        {d.flags.provisioned && <Pipeline d={d} />}

        {d.flags.provisioned && (
          <div style={{ marginTop: 16, fontSize: 13, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', color: 'var(--text-soft)' }}>
            <Detail k="号码" v={o?.line?.msisdn} mono />
            <Detail k="IMSI" v={o?.line?.imsi} mono />
            <Detail k="ICCID" v={o?.line?.iccid} mono />
            <Detail k="运营商" v={o?.line?.epdg ? o.line.epdg.replace(/epdg\.|\.pub\.3gppnetwork\.org/g, '') : ''} />
            <Detail k="ePDG" v={o?.line?.epdg} mono />
            <Detail k="SMSC" v={o?.line?.smsc} mono />
            <Detail k="IMEI" v={o?.line?.imei} mono />
            <span style={{ color: 'var(--text-mute)' }}>Linphone</span>
            <span style={{ color: d.flags.linphone ? GREEN : '#eab308', fontWeight: 600 }}>
              {d.flags.linphone ? '在线' : '离线'}{o?.linphone?.detail ? ` · ${o.linphone.detail}` : ''}
            </span>
            <span style={{ color: 'var(--text-mute)' }}>隧道</span>
            <span>{o?.tunnel?.state || '—'}</span>
            <span style={{ color: 'var(--text-mute)' }}>IMS</span>
            <span>{o?.ims?.state || '—'}{o?.ims?.detail ? ` · ${o.ims.detail}` : ''}</span>
            <span style={{ color: 'var(--text-mute)' }}>容器</span>
            <span>{o?.container?.running ? `运行中（${o.container.status || o.container.state || ''}）` : (o?.container?.status || '未运行')}</span>
          </div>
        )}

        {!d.flags.provisioned && (
          <div style={{ marginTop: 12, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.7 }}>
            尚未开通线路。把 SIM 卡插入读卡器，到 <a style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => setView('provision')}>SIM 开通</a> 页完成开通，然后回来启动 engine。
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {/* ---- 外呼 ---- */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>外呼（振铃到 Linphone）</h3>
          <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginBottom: 12 }}>
            呼叫经网关从 VoWiFi 线路拨出，接听在 Linphone 客户端进行。
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="mono" placeholder="+8613…" value={callTo}
              onChange={(e) => setCallTo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && placeCall()}
              disabled={!d.flags.provisioned} />
            <button className="btn btn-primary" style={{ flexShrink: 0 }} disabled={!d.flags.provisioned || busy === 'call' || !callTo.trim()}
              onClick={placeCall}>呼叫</button>
          </div>
        </div>

        {/* ---- 推送 ---- */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Bark 推送</h3>
          <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginBottom: 12 }}>
            来电/短信推送到 iPhone。{o?.bark_configured
              ? (o.bark_encrypted ? '已配置端到端加密。' : '未启用加密（设置页可开启）。')
              : '尚未配置——到设置页填写 Bark key。'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={barkTest} disabled={busy === 'bark' || !o?.bark_configured}>发送测试推送</button>
            <button className="btn btn-ghost" onClick={() => setView('settings')}>配置 ▸</button>
          </div>
        </div>
      </div>

      {/* ---- 事件 ---- */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>最近事件</h3>
        {events.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-mute)' }}>暂无事件（engine 启动后产生）。</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {events.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13, padding: '6px 8px', borderRadius: 8,
              background: i === 0 ? 'var(--hover)' : 'transparent' }}>
              <span style={{ color: 'var(--text-mute)', width: 64, flexShrink: 0 }}>{EVENT_LABELS[e.event] || e.event}</span>
              <span className="mono" style={{ color: 'var(--text-soft)', fontSize: 12, overflowWrap: 'anywhere' }}>
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
