import React, { useEffect, useState, useCallback } from 'react'
import { CardSim, RefreshCw, Lock, Unlock, CreditCard, Hash, Globe, KeyRound, ShieldCheck, ArrowRight } from 'lucide-react'
import { api } from '../api.js'

const PIN_RE = /^\d{4,8}$/
const inp = "w-full px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all"
const lbl = "block text-xs font-medium text-slate-400 mb-1"

function ReaderCard({ idx, name, showToast, refreshOverview, setView }) {
  const [card, setCard] = useState(undefined)
  const [pinInput, setPinInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)

  const detect = useCallback(async () => {
    setCard(null); setErr(''); setResult(null)
    try { setCard(await api.card(idx)) }
    catch (e) { setCard({ present: false, error: e.message }) }
  }, [idx])

  useEffect(() => { detect() }, [detect])

  const unlocked = card && card.imsi
  const locked = card && card.present && !card.imsi && /pin/i.test(card.error || '')
  const pinOk = PIN_RE.test(pinInput)

  const unlock = async () => {
    if (!pinOk) { setErr('PIN 必须是 4-8 位数字'); return }
    setBusy(true); setErr('')
    try {
      const r = await api.sim.verifyPin(pinInput, idx)
      if (r.ok) { showToast('PIN 验证通过', 'success'); await detect() }
      else setErr(`${r.error || '验证失败'}${r.tries != null ? `（剩余 ${r.tries} 次）` : ''}`)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const provision = async (pin) => {
    setBusy(true); setErr('')
    try {
      const r = await api.provision(idx, pin || undefined)
      if (r.ok) { setResult(r); showToast('✅ 开通成功', 'success'); refreshOverview && await refreshOverview() }
      else setErr(r.error || '开通失败')
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const Row = ({ k, v, icon: Icon, mono }) => (
    <div className="flex items-center gap-2">
      {Icon && <Icon className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />}
      <span className="text-slate-500 text-xs">{k}</span>
      <span className={`text-xs text-slate-300 ${mono ? 'font-mono' : ''} truncate`}>{v || '—'}</span>
    </div>
  )

  return (
    <div className="rounded-2xl p-5" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CardSim className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">读卡器 {idx}{name ? ` · ${name}` : ''}</span>
        </div>
        <button onClick={detect}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors">
          <RefreshCw className="w-3 h-3" /> 重新检测
        </button>
      </div>

      {card === null && <div className="text-slate-500 text-sm">读卡中…</div>}

      {card && !card.present && (
        <div className="text-slate-500 text-sm">
          未检测到 SIM 卡。插入卡后点「重新检测」。
          {card.error && <div className="text-red-400 mt-1">{card.error}</div>}
        </div>
      )}

      {locked && (
        <div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <Row k="ICCID" v={card.iccid} icon={CreditCard} mono />
            <Row k="状态" v={<span className="text-amber-400 flex items-center gap-1"><Lock className="w-3 h-3" /> 需要 PIN</span>} icon={Lock} />
          </div>
          <label className={lbl}>SIM PIN（CHV1）</label>
          <div className="flex gap-2">
            <input type="password" inputMode="numeric" maxLength={8} className={`${inp} font-mono`} value={pinInput}
              onChange={(e) => { setPinInput(e.target.value.replace(/[^0-9]/g, '')); setErr('') }}
              onKeyDown={(e) => e.key === 'Enter' && pinOk && unlock()}
              placeholder="4-8 位数字" />
            <button onClick={unlock} disabled={busy || !pinOk}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}>
              <Unlock className="w-3.5 h-3.5" /> {busy ? '验证中…' : '解锁'}
            </button>
          </div>
        </div>
      )}

      {unlocked && (
        <div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <Row k="ICCID" v={card.iccid} icon={CreditCard} mono />
            <Row k="IMSI" v={card.imsi} icon={Hash} mono />
            <Row k="运营商" v={card.mcc && card.mnc ? `${card.mcc}-${card.mnc}` : ''} icon={Globe} />
            <Row k="SMSC" v={card.smsc} icon={KeyRound} mono />
            <Row k="PIN" v={card.pin_enabled === false ? '未启用' : <span className="text-emerald-400">已解锁 ✓</span>} icon={ShieldCheck} />
          </div>
          <button onClick={() => provision(pinInput)} disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #34d399 0%, #059669 100%)' }}>
            <Unlock className="w-4 h-4" /> {busy ? '开通中…' : '开通此 SIM'}
          </button>
        </div>
      )}

      {result && (
        <div className="mt-4 p-3 rounded-xl flex items-center justify-between gap-3"
          style={{ background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.3)' }}>
          <div className="text-sm text-emerald-400">
            ✅ 已生成 instance：IMSI <span className="font-mono">{result.instance?.imsi}</span>
          </div>
          <button onClick={() => setView('dashboard')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}>
            去启动 <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {err && <div className="mt-3 text-xs text-red-400">{err}</div>}
    </div>
  )
}

function PinManage({ readers }) {
  const [reader, setReader] = useState(0)
  const [mode, setMode] = useState('change')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async () => {
    setBusy(true); setMsg('')
    try {
      let r
      if (mode === 'change') {
        if (!PIN_RE.test(pin) || !PIN_RE.test(pin2)) throw new Error('PIN 必须是 4-8 位数字')
        if (pin === pin2) throw new Error('新 PIN 不能与旧 PIN 相同')
        r = await api.sim.changePin(pin, pin2, reader)
      } else {
        if (!PIN_RE.test(pin)) throw new Error('PIN 必须是 4-8 位数字')
        r = await api.sim.setPinEnabled(pin, mode === 'enable', reader)
      }
      setMsg(r.ok ? '✅ 操作成功' : `❌ ${r.error || '操作失败'}`)
      if (r.ok) { setPin(''); setPin2('') }
    } catch (e) { setMsg('❌ ' + e.message) }
    setBusy(false)
  }

  return (
    <div className="rounded-2xl p-5" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
      <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-amber-400" /> PIN 管理
      </h3>
      <p className="text-xs text-slate-500 mb-4">直接对卡操作。输错 3 次卡会锁 PUK，请谨慎。</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={lbl}>读卡器</label>
          <select className={inp} value={reader} onChange={(e) => setReader(+e.target.value)}>
            {readers.map((r, i) => <option key={i} value={i}>{i} · {r.name || r.idx}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>操作</label>
          <select className={inp} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="change">修改 PIN</option>
            <option value="enable">启用 PIN</option>
            <option value="disable">关闭 PIN</option>
          </select>
        </div>
        <div>
          <label className={lbl}>{mode === 'change' ? '当前 PIN' : 'PIN'}</label>
          <input type="password" inputMode="numeric" maxLength={8} className={`${inp} font-mono`} value={pin}
            onChange={(e) => { setPin(e.target.value.replace(/[^0-9]/g, '')); setMsg('') }} placeholder="4-8 位" />
        </div>
        {mode === 'change' && (
          <div>
            <label className={lbl}>新 PIN</label>
            <input type="password" inputMode="numeric" maxLength={8} className={`${inp} font-mono`} value={pin2}
              onChange={(e) => { setPin2(e.target.value.replace(/[^0-9]/g, '')); setMsg('') }} placeholder="新 PIN" />
          </div>
        )}
      </div>
      <div className="flex gap-2 mt-4 items-center">
        <button onClick={submit} disabled={busy || !pin || (mode === 'change' && !pin2)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}>
          {busy ? '执行中…' : '执行'}
        </button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </div>
  )
}

export default function Provision({ showToast, refreshOverview, setView }) {
  const [readers, setReaders] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { const r = await api.readers(); setReaders(r.readers || []); setErr(r.error || '') }
    catch (e) { setReaders([]); setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 10000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {err && (
        <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)' }}>
          <span className="text-red-400 text-sm">读卡器不可用：{err}</span>
        </div>
      )}
      {readers === null && <div className="text-slate-500 text-sm">检测读卡器…</div>}
      {readers && readers.length === 0 && !err && (
        <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
          <CardSim className="w-12 h-12 text-slate-700 mx-auto mb-3" />
          <div className="text-base font-semibold text-slate-400 mb-1">未发现读卡器</div>
          <div className="text-sm text-slate-600">插入 USB PC/SC 读卡器（带 SIM 卡），本页自动刷新。</div>
        </div>
      )}
      {readers?.map((r, i) => (
        <ReaderCard key={i} idx={i} name={r} showToast={showToast} refreshOverview={refreshOverview} setView={setView} />
      ))}
      {readers?.length > 0 && <PinManage readers={readers} />}
    </div>
  )
}
