import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../api.js'

const PIN_RE = /^\d{4,8}$/

function ReaderCard({ idx, name, showToast, refreshOverview, setView }) {
  const [card, setCard] = useState(undefined)   // undefined=未检测 null=检测中
  const [pinInput, setPinInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)    // provision 结果 {card, instance}

  const detect = useCallback(async () => {
    setCard(null); setErr(''); setResult(null)
    try {
      const c = await api.card(idx)
      setCard(c)
    } catch (e) {
      setCard({ present: false, error: e.message })
    }
  }, [idx])

  useEffect(() => { detect() }, [detect])

  const unlocked = card && card.imsi          // 能读到 IMSI = PIN 已通过或未启用
  const locked = card && card.present && !card.imsi && /pin/i.test(card.error || '')
  const pinOk = PIN_RE.test(pinInput)

  const unlock = async () => {
    if (!pinOk) { setErr('PIN 必须是 4-8 位数字'); return }
    setBusy(true); setErr('')
    try {
      const r = await api.sim.verifyPin(pinInput, idx)
      if (r.ok) {
        showToast('PIN 验证通过')
        await detect()
      } else {
        setErr(`${r.error || '验证失败'}${r.tries != null ? `（剩余 ${r.tries} 次）` : ''}`)
      }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const provision = async (pin) => {
    setBusy(true); setErr('')
    try {
      const r = await api.provision(idx, pin || undefined)
      if (r.ok) {
        setResult(r)
        showToast('✅ 开通成功——到总览页启动 engine')
        refreshOverview && await refreshOverview()
      } else {
        setErr(r.error || '开通失败')
      }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const row = (k, v, mono) => (
    <>
      <span style={{ color: 'var(--text-mute)' }}>{k}</span>
      <span className={mono ? 'mono' : ''} style={mono ? { fontSize: 11, overflowWrap: 'anywhere' } : undefined}>{v || '—'}</span>
    </>
  )

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>读卡器 {idx}{name ? ` · ${name}` : ''}</div>
        <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={detect}>重新检测</button>
      </div>

      {card === null && <div style={{ color: 'var(--text-mute)', fontSize: 13, marginTop: 12 }}>读卡中…</div>}

      {card && !card.present && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-mute)' }}>
          未检测到 SIM 卡。插入卡后点「重新检测」。
          {card.error && <div style={{ color: '#ef4444', marginTop: 6 }}>{card.error}</div>}
        </div>
      )}

      {locked && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', color: 'var(--text-soft)' }}>
            {row('ICCID', card.iccid)}
            {row('状态', <span style={{ color: '#eab308' }}>🔒 需要 PIN（{card.pin_tries != null ? `剩余 ${card.pin_tries} 次` : ''}）</span>)}
          </div>
          <div style={{ marginTop: 12 }}>
            <label>SIM PIN（CHV1）</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input type="password" inputMode="numeric" maxLength={8} className="mono" value={pinInput}
                onChange={(e) => { setPinInput(e.target.value.replace(/[^0-9]/g, '')); setErr('') }}
                onKeyDown={(e) => e.key === 'Enter' && pinOk && unlock()}
                placeholder="4-8 位数字" style={{ flex: 1 }} />
              <button className="btn btn-primary" disabled={busy || !pinOk} onClick={unlock}>{busy ? '验证中…' : '解锁'}</button>
            </div>
          </div>
        </div>
      )}

      {unlocked && (
        <div>
          <div style={{ marginTop: 14, fontSize: 13, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', color: 'var(--text-soft)' }}>
            {row('ICCID', card.iccid)}
            {row('IMSI', card.imsi)}
            {row('运营商', card.mcc && card.mnc ? `${card.mcc}-${card.mnc}` : '')}
            {row('SMSC', card.smsc, true)}
            {row('PIN', card.pin_enabled === false ? '未启用' : '已解锁 ✓')}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => provision(pinInput)}>
              {busy ? '开通中…' : '开通此 SIM'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
            开通 = 读卡 + 生成 instance（号码/SMSC/运营商参数）。随后到总览页启动 engine。
            带 PIN 的卡如需开机自动验证，可在 config.yaml 的 line.pin 保存 PIN。
          </div>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.7,
          background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.4)' }}>
          ✅ 已生成 instance：IMSI <span className="mono">{result.instance?.imsi}</span>，
          ePDG <span className="mono">{result.instance?.epdg}</span>。
          <button className="btn btn-primary" style={{ marginLeft: 10, padding: '4px 10px', fontSize: 12 }}
            onClick={() => setView('dashboard')}>去启动 ▸</button>
        </div>
      )}

      {err && <div style={{ marginTop: 10, fontSize: 12.5, color: '#ef4444' }}>{err}</div>}
    </div>
  )
}

function PinManage({ readers }) {
  const [reader, setReader] = useState(0)
  const [mode, setMode] = useState('change')   // change | enable | disable
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
      setMsg(r.ok ? '✅ 操作成功'
        : `❌ ${r.error || '操作失败'}${r.tries != null ? `（剩余 ${r.tries} 次）` : ''}`)
      if (r.ok) { setPin(''); setPin2('') }
    } catch (e) { setMsg('❌ ' + e.message) }
    setBusy(false)
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>PIN 管理</h3>
      <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginBottom: 12 }}>
        直接对卡操作（与 instance 无关）。输错 3 次卡会锁 PUK，请谨慎。
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <div>
          <label>读卡器</label>
          <select value={reader} onChange={(e) => setReader(+e.target.value)}>
            {readers.map((r, i) => <option key={i} value={i}>{i} · {r}</option>)}
          </select>
        </div>
        <div>
          <label>操作</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="change">修改 PIN</option>
            <option value="enable">启用 PIN 开机验证</option>
            <option value="disable">关闭 PIN 开机验证</option>
          </select>
        </div>
        <div>
          <label>{mode === 'change' ? '当前 PIN' : 'PIN'}</label>
          <input type="password" inputMode="numeric" maxLength={8} className="mono" value={pin}
            onChange={(e) => { setPin(e.target.value.replace(/[^0-9]/g, '')); setMsg('') }} placeholder="4-8 位" />
        </div>
        {mode === 'change' && (
          <div>
            <label>新 PIN</label>
            <input type="password" inputMode="numeric" maxLength={8} className="mono" value={pin2}
              onChange={(e) => { setPin2(e.target.value.replace(/[^0-9]/g, '')); setMsg('') }} placeholder="再输入新 PIN" />
          </div>
        )}
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-primary" disabled={busy || !pin || (mode === 'change' && !pin2)} onClick={submit}>
          {busy ? '执行中…' : '执行'}
        </button>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  )
}

export default function Provision({ showToast, refreshOverview, setView }) {
  const [readers, setReaders] = useState(null)   // null=加载中 [] = 无
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await api.readers()
      setReaders(r.readers || [])
      setErr(r.error || '')
    } catch (e) {
      setReaders([])
      setErr(e.message)
    }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 10000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
      {err && (
        <div className="card" style={{ padding: 16, fontSize: 13.5, color: '#ef4444' }}>
          读卡器不可用：{err}
          <div style={{ color: 'var(--text-mute)', marginTop: 6 }}>
            确认 pcscd 已安装并运行：sudo apt install pcscd && sudo systemctl start pcscd
          </div>
        </div>
      )}
      {readers === null && <div style={{ color: 'var(--text-dim)' }}>检测读卡器…</div>}
      {readers && readers.length === 0 && !err && (
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 34 }}>🔌</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 8 }}>未发现读卡器</div>
          <div style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 6, lineHeight: 1.7 }}>
            插入 USB PC/SC 读卡器（带 SIM 卡），本页自动刷新。<br />
            需要 pcscd：sudo apt install pcscd
          </div>
        </div>
      )}
      {readers && readers.map((r, i) => (
        <ReaderCard key={i} idx={i} name={r} showToast={showToast}
          refreshOverview={refreshOverview} setView={setView} />
      ))}
      {readers && readers.length > 0 && <PinManage readers={readers} />}
    </div>
  )
}
