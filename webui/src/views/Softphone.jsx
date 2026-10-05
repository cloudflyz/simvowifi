import React, { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api.js'
import { Softphone as Phone } from '../softphone.js'

const GREEN = '#22c55e', RED = '#ef4444'
const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'],
  ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']]

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// 通话结果 → 中文（后端 STATUS 映射后的值）
const STATUS_LABEL = {
  answered: '已接通', busy: '占线', noanswer: '未接', cancelled: '已取消',
  congestion: '拥塞', unavailable: '无法接通', failed: '失败', rejected: '已拒接',
  ringing: '进行中…',
}

function Avatar({ color = 'var(--primary)', size = 96 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: color + '22',
      border: `2px solid ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, color, margin: '0 auto' }}>☎</div>
  )
}

function RoundBtn({ icon, label, color, bg, onClick, active }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <button onClick={onClick} style={{
        width: 58, height: 58, borderRadius: '50%', cursor: 'pointer', fontSize: 22,
        border: '1px solid ' + (active ? color : 'var(--border-strong)'),
        background: bg || (active ? color + '22' : 'var(--hover)'),
        color: active ? color : 'var(--text-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</button>
      <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>{label}</span>
    </div>
  )
}

export default function Softphone({ overview, showToast, setView }) {
  const [prov, setProv] = useState(null)
  const [reg, setReg] = useState('idle')
  const [call, setCall] = useState(null)     // {dir, number, state, startedAt, endCause}
  const [num, setNum] = useState('')
  const [dur, setDur] = useState(0)
  const [muted, setMuted] = useState(false)
  const [keypad, setKeypad] = useState(false)
  const [dtmfSeq, setDtmfSeq] = useState('')
  const [recording, setRecording] = useState(false)
  const [calls, setCalls] = useState([])
  const [mobilePane, setMobilePane] = useState('phone')
  const phone = useRef(null)
  const audioRef = useRef(null)

  const loadCalls = useCallback(() => {
    api.calls.list().then((r) => setCalls(r.calls || [])).catch(() => {})
  }, [])
  useEffect(() => { loadCalls() }, [loadCalls])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadCalls() }, 10000)
    return () => clearInterval(t)
  }, [loadCalls])

  const toast = (m) => (showToast ? showToast(m) : null)

  // 软电话配置（单线路，一次）
  useEffect(() => {
    let alive = true
    api.softphone().then((p) => { if (alive) setProv(p) }).catch(() => {})
    return () => {
      alive = false
      if (phone.current) { phone.current.stop(); phone.current = null }
    }
  }, [])

  const clearCallSoon = (endCause) => {
    setCall((c) => c ? { ...c, state: 'ended', endCause } : null)
    setKeypad(false); setMuted(false); setRecording(false)
    loadCalls()
    setTimeout(() => setCall(null), 2500)
  }

  const connect = useCallback(() => {
    if (!prov || !prov.enabled || phone.current) return
    const ph = new Phone((type, data) => {
      if (type === 'registered') setReg(data ? 'registered' : 'unregistered')
      else if (type === 'ws') setReg((r) => data === 'connected' ? (r === 'registered' ? r : 'connecting') : 'disconnected')
      else if (type === 'regfail') setReg('failed')
      else if (type === 'incoming') setCall({ dir: 'in', number: data.from || '未知', state: 'incoming' })
      else if (type === 'calling') setCall({ dir: 'out', number: data.to, state: 'calling' })
      else if (type === 'progress') setCall((c) => (c && c.dir === 'out' && (c.state === 'calling' || c.state === 'ringing')) ? { ...c, state: 'ringing' } : c)
      else if (type === 'active') setCall((c) => c ? { ...c, state: 'active', startedAt: Date.now() } : c)
      else if (type === 'ended') clearCallSoon(data && data.cause)
      else if (type === 'failed') clearCallSoon(data && data.cause)
    }, audioRef.current)
    ph.start(prov, prov.host || location.hostname)
    phone.current = ph
    setReg('connecting')
  }, [prov])

  useEffect(() => { if (prov && prov.enabled && !phone.current) connect() }, [prov, connect])
  useEffect(() => { if (phone.current && audioRef.current) phone.current.setAudioEl(audioRef.current) })

  // 通话计时
  useEffect(() => {
    if (call?.state !== 'active' || !call.startedAt) { setDur(0); return }
    const t = setInterval(() => setDur(Math.floor((Date.now() - call.startedAt) / 1000)), 500)
    return () => clearInterval(t)
  }, [call?.state, call?.startedAt])

  // 物理键盘 DTMF
  useEffect(() => {
    if (!(keypad && call?.state === 'active')) return
    setDtmfSeq('')
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key
      if (/^[0-9*#]$/.test(k)) { e.preventDefault(); pressDTMF(k) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keypad, call?.state])

  // 看门狗：非终态呼叫超时强制回空闲
  useEffect(() => {
    if (!call || call.state === 'active' || call.state === 'ended') return
    const ms = call.state === 'incoming' ? 60000 : 65000
    const t = setTimeout(() => {
      try { phone.current?.hangup() } catch {}
      setCall(null); setKeypad(false); setMuted(false); setRecording(false)
    }, ms)
    return () => clearTimeout(t)
  }, [call?.state])

  const dialKey = (k) => setNum((n) => n + k)
  const pressDTMF = (k) => { phone.current?.sendDTMF(k); setDtmfSeq((s) => (s + k).slice(-32)) }
  const placeCall = () => { if (phone.current && num) { phone.current.unlockAudio(); phone.current.call(num); setNum('') } }
  const answer = () => { phone.current?.unlockAudio(); phone.current?.answer() }
  const hangup = () => {
    phone.current?.hangup()
    setCall((c) => (c && c.state !== 'ended') ? { ...c, state: 'ended' } : c)
    setKeypad(false); setMuted(false); setRecording(false)
    setTimeout(() => setCall((c) => (c && c.state === 'ended') ? null : c), 2500)
  }
  const decline = () => {
    phone.current?.reject()
    setCall((c) => (c && c.state !== 'ended') ? { ...c, state: 'ended', endCause: 'Rejected' } : c)
    setKeypad(false); setMuted(false); setRecording(false)
    setTimeout(() => setCall((c) => (c && c.state === 'ended') ? null : c), 2500)
  }
  const toggleMute = () => { const m = !muted; setMuted(m); phone.current?.setMuted(m) }
  const toggleRecord = async () => {
    if (!phone.current) return
    if (recording) {
      const blob = await phone.current.stopRecording(); setRecording(false)
      if (blob) {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `call-${call?.number || 'rec'}-${Date.now()}.webm`; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    } else { const ok = await phone.current.startRecording(); setRecording(ok) }
  }

  const deleteCall = async (id, e) => {
    if (e) e.stopPropagation()
    try { await api.calls.delete({ ids: [id] }); loadCalls() } catch (e2) { toast('删除失败：' + e2.message) }
  }
  const clearCalls = async () => {
    if (!calls.length || !confirm('清空全部通话记录？')) return
    try { await api.calls.delete({ all: true }); loadCalls() } catch (e) { toast('删除失败：' + e.message) }
  }

  // ---- 未开通 / WebRTC 未启用 / 非 HTTPS 引导 ----
  if (prov && !prov.provisioned) return (
    <div className="card" style={{ padding: 24, color: 'var(--text-dim)', lineHeight: 1.8 }}>
      尚未开通线路。<button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => setView('provision')}>前往开通 ▸</button>
    </div>
  )

  if (prov && !prov.enabled) return (
    <div className="card" style={{ padding: 28, maxWidth: 640 }}>
      <h3 style={{ marginTop: 0, fontSize: 16 }}>浏览器软电话未启用</h3>
      <div style={{ fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.9 }}>
        软电话通过 WebRTC（WSS）直连 engine 的 Asterisk，默认关闭（本网关默认客户端是 Linphone）。启用步骤：
        <ol style={{ margin: '10px 0', paddingLeft: 20 }}>
          <li><b>设置 → 浏览器软电话</b>：开启 WebRTC</li>
          <li><b>SIM 开通</b>页：重新 provision（生成新 instance）</li>
          <li><b>总览</b>页：重启 engine</li>
          <li>用 <b>HTTPS</b> 访问 WebUI（设置页可开启 HTTPS；浏览器软电话的麦克风必须安全上下文）</li>
          <li>先访问 <span className="mono">https://{prov.host}:{prov.ws_port}/</span> 一次并接受自签名证书</li>
        </ol>
      </div>
      <button className="btn btn-primary" onClick={() => setView('settings')}>前往设置 ▸</button>
    </div>
  )

  if (prov === null) return <div style={{ color: 'var(--text-dim)' }}>加载中…</div>

  const regColor = reg === 'registered' ? GREEN : reg === 'failed' || reg === 'disconnected' ? RED : '#eab308'
  const regLabel = { idle: '未连接', connecting: '连接中', registered: '已注册', unregistered: '未注册', failed: '注册失败', disconnected: '连接断开' }[reg] || reg
  const inCall = call && ['active', 'calling', 'ringing', 'incoming', 'ended'].includes(call.state)
  const endLabel = (c) => c === 'Rejected' ? '已拒接' : c === 'Busy' ? '占线' : c === 'Canceled' ? '已取消' : '通话结束'

  const secureCtx = typeof window !== 'undefined' && window.isSecureContext
  const incomingOverlay = call?.state === 'incoming' ? (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(6,10,20,0.82)',
      backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ padding: 40, width: 380, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>
        <div style={{ fontSize: 13, color: 'var(--text-mute)', letterSpacing: 2 }}>来电</div>
        <div style={{ margin: '22px 0' }}><Avatar color={GREEN} size={110} /></div>
        <div className="mono" style={{ fontSize: 26, fontWeight: 800 }}>{call.number || '未知'}</div>
        <div style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 6 }}>{overview?.line?.name || 'VoWiFi 线路'}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 56, marginTop: 34 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <button onClick={decline} style={{ width: 68, height: 68, borderRadius: '50%', border: 'none',
              cursor: 'pointer', fontSize: 26, background: RED, color: '#fff' }}>✕</button>
            <span style={{ fontSize: 13, color: 'var(--text-soft)' }}>拒接</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <button onClick={answer} style={{ width: 68, height: 68, borderRadius: '50%', border: 'none',
              cursor: 'pointer', fontSize: 26, background: GREEN, color: '#fff',
              animation: 'ringpulse 1.4s infinite' }}>✆</button>
            <span style={{ fontSize: 13, color: 'var(--text-soft)' }}>接听</span>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div className="softphone-page" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
      {!secureCtx && prov.enabled && (
        <div style={{ marginBottom: 10, padding: '10px 14px', borderRadius: 10, fontSize: 13,
          background: 'rgba(249,115,22,.12)', border: '1px solid rgba(249,115,22,.45)', color: 'var(--text-soft)' }}>
          ⚠ 当前页面不是 HTTPS，浏览器将禁止麦克风。到 <b>设置 → HTTPS</b> 开启后用 https:// 访问。
        </div>
      )}
      <div className="mobile-softphone-tabs">
        <button type="button" className={`btn ${mobilePane === 'phone' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMobilePane('phone')}>拨号</button>
        <button type="button" className={`btn ${mobilePane === 'history' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMobilePane('history')}>最近通话</button>
        <div className="mobile-reg" style={{ color: regColor }} title={regLabel}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: regColor, flexShrink: 0 }} />
          <span>{regLabel}</span>
        </div>
      </div>
      <div className={`split-pane softphone ${mobilePane === 'history' ? 'is-detail' : 'is-list'}`}
        style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: 16, flex: 1, minHeight: 0 }}>
        {incomingOverlay}
        <style>{`@keyframes ringpulse{0%{box-shadow:0 0 0 0 ${GREEN}88}70%{box-shadow:0 0 0 16px ${GREEN}00}100%{box-shadow:0 0 0 0 ${GREEN}00}}`}</style>

        {/* ---- 拨号面板 ---- */}
        <div className="card pane-list softphone-phone" style={{ padding: 24, minHeight: 520, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="softphone-meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexShrink: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>软电话 · {prov.username}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: regColor }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: regColor }} />{regLabel}
            </div>
          </div>

          {/* 呼出振铃中 */}
          {(call?.state === 'calling' || call?.state === 'ringing') && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', gap: 16 }}>
              <Avatar />
              <div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{call.number}</div>
                <div style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 4 }}>{call.state === 'ringing' ? '振铃中…' : '呼叫中…'}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                <RoundBtn icon="✕" label="挂断" color="#fff" bg={RED} onClick={hangup} />
              </div>
            </div>
          )}

          {/* 通话中 */}
          {call?.state === 'active' && (
            <div className="softphone-active" style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', justifyContent: keypad ? 'flex-start' : 'center', textAlign: 'center', gap: 12, paddingBottom: 8 }}>
              {!keypad && <Avatar color={GREEN} size={84} />}
              <div style={{ flexShrink: 0 }}>
                <div className="mono" style={{ fontSize: keypad ? 16 : 20, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{call.number || '未知'}</div>
                <div style={{ fontSize: 15, color: GREEN, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(dur)}</div>
                {recording && <div style={{ fontSize: 12, color: RED, marginTop: 2 }}>● 录音中</div>}
              </div>
              {keypad && (
                <div style={{ width: '100%', maxWidth: 240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                  <div className="mono" style={{ minHeight: 40, padding: '8px 12px', borderRadius: 8,
                    background: 'var(--hover)', border: '1px solid var(--border)',
                    fontSize: 20, letterSpacing: 2, textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
                    direction: 'rtl', color: dtmfSeq ? 'var(--text)' : 'var(--text-mute)' }}>
                    {dtmfSeq || '点按或键入数字'}
                  </div>
                  <div className="dtmf-pad">
                    {KEYS.map(([k]) => <button key={k} className="dial-key" onClick={() => pressDTMF(k)}>{k}</button>)}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginTop: 4, flexShrink: 0 }}>
                <RoundBtn icon={muted ? '🔇' : '🎙'} label={muted ? '取消静音' : '静音'} color="#60a5fa" onClick={toggleMute} active={muted} />
                <RoundBtn icon="⌨" label="键盘" color="#a78bfa" onClick={() => setKeypad((v) => !v)} active={keypad} />
                <RoundBtn icon="⏺" label={recording ? '停止' : '录音'} color={RED} onClick={toggleRecord} active={recording} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 2, flexShrink: 0 }}>
                <RoundBtn icon="✕" label="挂断" color="#fff" bg={RED} onClick={hangup} />
              </div>
            </div>
          )}

          {/* 通话结束（短暂显示） */}
          {call?.state === 'ended' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
              <Avatar color={call.endCause === 'Rejected' ? RED : 'var(--text-mute)'} />
              <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{call.number || '未知'}</div>
              <div style={{ fontSize: 14, color: call.endCause === 'Rejected' ? RED : 'var(--text-mute)' }}>{endLabel(call.endCause)}</div>
            </div>
          )}

          {/* 空闲拨号盘 */}
          {!inCall && (
            <div className="softphone-idle" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="输入号码"
                className="mono softphone-num" style={{ fontSize: 24, textAlign: 'center', margin: '10px 0 16px', letterSpacing: 1, border: 'none', background: 'transparent', minHeight: 48 }} />
              <div className="dial-pad">
                {KEYS.map(([k, sub]) => (
                  <button key={k} className="dial-key" onClick={() => dialKey(k)} style={{
                    padding: '8px 0', borderRadius: 12, cursor: 'pointer', background: 'var(--hover)',
                    border: '1px solid var(--border)', color: 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>{k}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-mute)', letterSpacing: 1, height: 12, lineHeight: '12px' }}>{sub || '\u00a0'}</span>
                  </button>
                ))}
              </div>
              <div className="softphone-actions" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 24, marginTop: 16, flexShrink: 0 }}>
                <div style={{ width: 58 }} />
                <button className="call-fab" onClick={placeCall} disabled={reg !== 'registered' || !num} style={{
                  width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 26,
                  background: (reg === 'registered' && num) ? GREEN : 'var(--border-strong)', color: '#fff',
                }}>✆</button>
                <button className="icon-action" onClick={() => setNum((n) => n.slice(0, -1))} style={{
                  width: 58, height: 58, borderRadius: '50%', border: 'none', background: 'transparent',
                  color: 'var(--text-mute)', cursor: 'pointer', fontSize: 22, visibility: num ? 'visible' : 'hidden',
                }}>⌫</button>
              </div>
            </div>
          )}
        </div>

        {/* ---- 最近通话 ---- */}
        <div className="card pane-detail softphone-history" style={{ padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>最近通话</div>
            {calls.length > 0 &&
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, color: RED }}
                onClick={clearCalls}>清空</button>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, overflow: 'auto' }}>
            {calls.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-mute)' }}>暂无通话记录。</div>}
            {calls.map((c) => {
              const s = c.status || 'ringing'
              const color = s === 'answered' ? GREEN : ['busy', 'failed', 'rejected', 'unavailable', 'congestion'].includes(s) ? RED
                : ['noanswer', 'cancelled'].includes(s) ? '#eab308' : 'var(--text-dim)'
              const peer = (c.peer || '').trim()
              return (
                <div key={c.id} className="hover-row"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    fontSize: 13.5, padding: '10px 12px', borderRadius: 10, background: 'var(--input-bg)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono" style={{ fontWeight: 600, color: peer ? undefined : 'var(--text-mute)' }}>{peer || '未知号码'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                      {c.dir === 'in' ? '↙ 来电' : '↗ 去电'} · {c.time}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color, fontWeight: 600 }}>{STATUS_LABEL[s] || s}</span>
                    <button className="btn btn-ghost" style={{ padding: '5px 10px' }}
                      disabled={reg !== 'registered' || !peer}
                      onClick={() => { phone.current?.unlockAudio(); setNum(peer); phone.current?.call(peer) }}>回拨</button>
                    <button className="row-del" title="删除" aria-label="删除该记录" onClick={(e) => deleteCall(c.id, e)}>🗑</button>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 10, flexShrink: 0 }}>
            通话记录与「外呼（振铃到 Linphone）」共用线路；接通状态由 engine 事件回填。
          </div>
        </div>
      </div>
    </div>
  )
}
