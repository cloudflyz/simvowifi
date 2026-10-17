import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX,
  Keyboard, Circle, CircleDot, Clock, Trash2, History,
  Wifi, WifiOff, Loader2, AlertTriangle, ArrowLeft, CheckCircle2
} from 'lucide-react'
import { api } from '../api.js'
import { Softphone as PhoneEngine } from '../softphone.js'

const GREEN = '#34d399', RED = '#f87171'
const KEYS = [['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],
  ['6','MNO'],['7','PQRS'],['8','TUV'],['9','WXYZ'],['*',''],['0','+'],['#','']]

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const STATUS_LABEL = {
  answered: '已接通', busy: '占线', noanswer: '未接', cancelled: '已取消',
  congestion: '拥塞', unavailable: '无法接通', failed: '失败', rejected: '已拒接',
  ringing: '进行中…',
}

function Avatar({ color = '#818cf8', size = 80 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${color}22 0%, ${color}08 100%)`,
      border: `2px solid ${color}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 0 30px ${color}22`,
    }}>
      <Phone style={{ width: size * 0.42, height: size * 0.42, color }} />
    </div>
  )
}

function CtrlBtn({ icon: Icon, label, color, bg, onClick, active }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <button onClick={onClick} style={{
        width: 54, height: 54, borderRadius: '50%', cursor: 'pointer',
        border: `1.5px solid ${active ? color : '#31415c'}`,
        background: bg || (active ? `${color}22` : 'rgba(30,41,59,.6)'),
        color: active ? color : '#94a3b8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .15s',
      }}>
        <Icon style={{ width: 22, height: 22 }} />
      </button>
      <span className="text-[11px] text-slate-500">{label}</span>
    </div>
  )
}

export default function Softphone({ overview, showToast, setView }) {
  const [prov, setProv] = useState(null)
  const [reg, setReg] = useState('idle')
  const [call, setCall] = useState(null)
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

  const toast = (m, type) => (showToast ? showToast(m, type) : null)

  useEffect(() => {
    let alive = true
    api.softphone().then((p) => { if (alive) setProv(p) }).catch(() => {})
    return () => { alive = false; if (phone.current) { phone.current.stop(); phone.current = null } }
  }, [])

  const clearCallSoon = (endCause) => {
    setCall((c) => c ? { ...c, state: 'ended', endCause } : null)
    setKeypad(false); setMuted(false); setRecording(false)
    loadCalls()
    setTimeout(() => setCall(null), 2500)
  }

  const connect = useCallback(() => {
    if (!prov || !prov.enabled || phone.current) return
    const ph = new PhoneEngine((type, data) => {
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

  useEffect(() => {
    if (call?.state !== 'active' || !call.startedAt) { setDur(0); return }
    const t = setInterval(() => setDur(Math.floor((Date.now() - call.startedAt) / 1000)), 500)
    return () => clearInterval(t)
  }, [call?.state, call?.startedAt])

  useEffect(() => {
    if (!(keypad && call?.state === 'active')) return
    setDtmfSeq('')
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^[0-9*#]$/.test(e.key)) { e.preventDefault(); pressDTMF(e.key) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keypad, call?.state])

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
    try { await api.calls.delete({ ids: [id] }); loadCalls() } catch (e2) { toast('删除失败：' + e2.message, 'error') }
  }
  const clearCalls = async () => {
    if (!calls.length || !confirm('清空全部通话记录？')) return
    try { await api.calls.delete({ all: true }); loadCalls() } catch (e) { toast('删除失败：' + e.message, 'error') }
  }

  if (prov && !prov.provisioned) return (
    <div className="rounded-2xl p-6 text-center" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
      <div className="text-slate-500 text-sm">尚未开通线路。<button className="text-indigo-400 font-medium hover:underline ml-1" onClick={() => setView('provision')}>前往开通</button></div>
    </div>
  )

  if (prov && !prov.enabled) return (
    <div className="rounded-2xl p-7 max-w-xl" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
      <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-400" /> 浏览器软电话未启用
      </h3>
      <div className="text-sm text-slate-400 leading-relaxed space-y-2">
        <p>软电话通过 WebRTC（WSS）直连 engine 的 Asterisk。启用步骤：</p>
        <ol className="pl-5 space-y-1 list-decimal">
          <li>设置 → 浏览器软电话：开启 WebRTC</li>
          <li>SIM 开通页：重新 provision</li>
          <li>总览页：重启 engine</li>
          <li>用 HTTPS 访问 WebUI</li>
        </ol>
      </div>
      <button onClick={() => setView('settings')}
        className="mt-4 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
        style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}>
        前往设置
      </button>
    </div>
  )

  if (prov === null) return <div className="text-slate-500 text-sm">加载中…</div>

  const regColor = reg === 'registered' ? GREEN : reg === 'failed' || reg === 'disconnected' ? RED : '#fbbf24'
  const regLabel = { idle: '未连接', connecting: '连接中', registered: '已注册', unregistered: '未注册', failed: '注册失败', disconnected: '连接断开' }[reg] || reg
  const inCall = call && ['active', 'calling', 'ringing', 'incoming', 'ended'].includes(call.state)
  const endLabel = (c) => c === 'Rejected' ? '已拒接' : c === 'Busy' ? '占线' : c === 'Canceled' ? '已取消' : '通话结束'

  const secureCtx = typeof window !== 'undefined' && window.isSecureContext
  const incomingOverlay = call?.state === 'incoming' ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(6,10,20,.85)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-sm mx-4 rounded-2xl p-8 text-center shadow-2xl"
        style={{ background: 'rgba(20,27,45,.95)', border: '1px solid #243049', backdropFilter: 'blur(20px)' }}>
        <div className="text-xs text-slate-500 tracking-widest uppercase mb-3">来电</div>
        <div className="flex justify-center mb-5"><Avatar color={GREEN} size={96} /></div>
        <div className="font-mono text-2xl font-bold text-white">{call.number || '未知'}</div>
        <div className="text-xs text-slate-500 mt-1">{overview?.line?.name || 'VoWiFi 线路'}</div>
        <div className="flex justify-center gap-14 mt-8">
          <div className="flex flex-col items-center gap-2">
            <button onClick={decline} style={{
              width: 62, height: 62, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: RED, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><PhoneOff className="w-6 h-6" /></button>
            <span className="text-xs text-slate-400">拒接</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button onClick={answer} className="ring-pulse" style={{
              width: 62, height: 62, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: GREEN, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Phone className="w-6 h-6" /></button>
            <span className="text-xs text-slate-400">接听</span>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
      {!secureCtx && prov.enabled && (
        <div className="mb-2.5 px-4 py-2.5 rounded-xl text-sm flex items-center gap-2"
          style={{ background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.25)' }}>
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="text-slate-400">当前页面不是 HTTPS，浏览器将禁止麦克风。到设置开启 HTTPS。</span>
        </div>
      )}

      {/* 移动端 tabs */}
      <div className="mobile-softphone-tabs flex items-center gap-2 mb-2 flex-shrink-0">
        <button onClick={() => setMobilePane('phone')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${mobilePane === 'phone' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500'}`}>拨号</button>
        <button onClick={() => setMobilePane('history')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${mobilePane === 'history' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500'}`}>最近通话</button>
        <div className="ml-auto flex items-center gap-1.5 text-xs" style={{ color: regColor }}>
          <div className={`pulse-dot ${reg === 'registered' ? 'pulse-green' : reg === 'failed' || reg === 'disconnected' ? 'pulse-red' : 'pulse-amber'}`} />
          <span>{regLabel}</span>
        </div>
      </div>

      <div className={`split-pane ${mobilePane === 'history' ? 'is-detail' : 'is-list'}`}
        style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: 3, flex: 1, minHeight: 0 }}>
        {incomingOverlay}

        {/* ── 拨号面板 ── */}
        <div className="pane-list rounded-2xl p-5 flex flex-col overflow-hidden"
          style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>

          {/* 呼出振铃 */}
          {(call?.state === 'calling' || call?.state === 'ringing') && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <Avatar />
              <div className="text-center">
                <div className="font-mono text-xl font-bold text-white">{call.number}</div>
                <div className="text-sm text-slate-500 mt-1">{call.state === 'ringing' ? '振铃中…' : '呼叫中…'}</div>
              </div>
              <button onClick={hangup} style={{
                width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: RED, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><PhoneOff className="w-6 h-6" /></button>
            </div>
          )}

          {/* 通话中 */}
          {call?.state === 'active' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 overflow-auto no-scrollbar">
              {!keypad && <Avatar color={GREEN} size={72} />}
              <div className="text-center">
                <div className="font-mono text-lg font-bold text-white truncate">{call.number || '未知'}</div>
                <div className="text-base mt-1 font-mono" style={{ color: GREEN }}>{fmtDur(dur)}</div>
                {recording && <div className="text-xs text-red-400 mt-1 flex items-center gap-1 justify-center"><CircleDot className="w-3 h-3" /> 录音中</div>}
              </div>

              {keypad && (
                <div className="w-full max-w-[240px] flex flex-col gap-2">
                  <div className="h-10 px-3 rounded-xl flex items-center justify-center font-mono text-lg overflow-hidden"
                    style={{ background: 'rgba(30,41,59,.6)', border: '1px solid #31415c', letterSpacing: 2 }}>
                    {dtmfSeq || <span className="text-xs text-slate-600">点按或键入数字</span>}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {KEYS.map(([k]) => (
                      <button key={k} onClick={() => pressDTMF(k)}
                        className="h-11 rounded-xl font-semibold text-sm flex items-center justify-center transition-colors"
                        style={{ background: 'rgba(30,41,59,.6)', border: '1px solid #31415c', color: '#e2e8f0' }}>
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-center gap-5">
                <CtrlBtn icon={muted ? MicOff : Mic} label={muted ? '取消静音' : '静音'} color="#60a5fa" onClick={toggleMute} active={muted} />
                <CtrlBtn icon={Keyboard} label="键盘" color="#a78bfa" onClick={() => setKeypad((v) => !v)} active={keypad} />
                <CtrlBtn icon={CircleDot} label={recording ? '停止' : '录音'} color={RED} onClick={toggleRecord} active={recording} />
              </div>
              <button onClick={hangup} className="mt-1" style={{
                width: 54, height: 54, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: RED, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><PhoneOff className="w-6 h-6" /></button>
            </div>
          )}

          {/* 结束 */}
          {call?.state === 'ended' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Avatar color={call.endCause === 'Rejected' ? RED : '#64748b'} />
              <div className="font-mono text-lg font-bold text-white">{call.number || '未知'}</div>
              <div className="text-sm" style={{ color: call.endCause === 'Rejected' ? RED : '#94a3b8' }}>{endLabel(call.endCause)}</div>
            </div>
          )}

          {/* 空闲拨号盘 */}
          {!inCall && (
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-500">{prov.username}</span>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: regColor }}>
                  <div className={`pulse-dot ${reg === 'registered' ? 'pulse-green' : reg === 'failed' || reg === 'disconnected' ? 'pulse-red' : 'pulse-amber'}`} />
                  {regLabel}
                </div>
              </div>

              <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="输入号码"
                className="w-full text-center font-mono text-2xl tracking-wider text-white bg-transparent border-0 outline-none mb-4 py-2"
                style={{ color: num ? '#e2e8f0' : '#475569' }} />

              <div className="grid grid-cols-3 gap-2 w-full max-w-[260px] mx-auto">
                {KEYS.map(([k, sub]) => (
                  <button key={k} onClick={() => dialKey(k)}
                    className="aspect-square rounded-2xl flex flex-col items-center justify-center transition-all hover:bg-slate-700/40"
                    style={{ background: 'rgba(30,41,59,.6)', border: '1px solid #31415c' }}>
                    <span className="text-xl font-semibold text-white leading-none">{k}</span>
                    {sub && <span className="text-[9px] text-slate-600 tracking-widest mt-0.5">{sub}</span>}
                  </button>
                ))}
              </div>

              <div className="flex justify-center items-center gap-6 mt-5">
                <div style={{ width: 54 }} />
                <button onClick={placeCall} disabled={reg !== 'registered' || !num} style={{
                  width: 60, height: 60, borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: reg === 'registered' && num ? 'linear-gradient(135deg, #34d399 0%, #059669 100%)' : '#31415c',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: reg === 'registered' && num ? '0 4px 20px rgba(52,211,153,.3)' : 'none',
                  opacity: reg === 'registered' && num ? 1 : 0.5,
                }}><Phone className="w-6 h-6" /></button>
                <button onClick={() => setNum((n) => n.slice(0, -1))}
                  style={{ width: 54, height: 54, borderRadius: '50%', border: 'none', background: 'transparent',
                    color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    visibility: num ? 'visible' : 'hidden' }}>
                  <ChevronLeft className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── 最近通话 ── */}
        <div className="pane-detail rounded-2xl p-5 flex flex-col overflow-hidden"
          style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-slate-500" /> 最近通话
            </h3>
            {calls.length > 0 && (
              <button onClick={clearCalls}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-400/10 transition-colors">
                <Trash2 className="w-3 h-3" /> 清空
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto no-scrollbar">
            {calls.length === 0 && <div className="text-slate-500 text-sm text-center py-8">暂无通话记录</div>}
            {calls.map((c) => {
              const s = c.status || 'ringing'
              const color = s === 'answered' ? GREEN : ['busy', 'failed', 'rejected', 'unavailable', 'congestion'].includes(s) ? RED
                : ['noanswer', 'cancelled'].includes(s) ? '#fbbf24' : '#64748b'
              const peer = (c.peer || '').trim()
              return (
                <div key={c.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-slate-800/40"
                  style={{ background: 'rgba(15,20,32,.6)', border: '1px solid #1a2238' }}>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm font-semibold text-slate-200 truncate">{peer || '未知号码'}</div>
                    <div className="text-[11px] text-slate-500">{c.dir === 'in' ? '↙ 来电' : '↗ 去电'} · {c.time}</div>
                  </div>
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color }}>{STATUS_LABEL[s] || s}</span>
                  <button disabled={reg !== 'registered' || !peer}
                    onClick={() => { phone.current?.unlockAudio(); setNum(peer); phone.current?.call(peer) }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-700/60 transition-colors disabled:opacity-40 flex-shrink-0">
                    <Phone className="w-3 h-3" /> 回拨
                  </button>
                  <button onClick={(e) => deleteCall(c.id, e)} title="删除"
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-red-400 p-1 flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
