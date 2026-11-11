import React, { useEffect, useState, useCallback } from 'react'
import {
  Smartphone, RefreshCw, Download, Power, Trash2, Pencil, BellRing, CheckCircle2
} from 'lucide-react'
import { api } from '../api.js'

const inp = "w-full px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all"
const lbl = "block text-xs font-medium text-slate-400 mb-1"
const btn = "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"

function ProfileRow({ p, se, onAction, busy }) {
  const iccid = p.iccid || p.iccidValue || ''
  const active = p.state === 'enabled' || p.profileState === 'enabled' || p.isEnabled
  const name = p.profileName || p.nickname || p.name || '（未命名）'
  const provider = p.serviceProviderName || p.providerName || ''
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl"
         style={{ background: 'rgba(15,23,42,.55)', border: '1px solid #243049' }}>
      <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white truncate">{name}</span>
          {active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">启用中</span>}
        </div>
        <div className="text-[11px] text-slate-500 font-mono truncate">{iccid || '—'}</div>
        {provider && <div className="text-[11px] text-slate-500 truncate">{provider}</div>}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {!active && (
          <button disabled={busy} onClick={() => onAction('enable', iccid, se)}
            className={`${btn} text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20`}>
            <Power className="w-3 h-3" /> 启用
          </button>
        )}
        {active && (
          <button disabled={busy} onClick={() => onAction('disable', iccid, se)}
            className={`${btn} text-amber-300 bg-amber-500/10 hover:bg-amber-500/20`}>
            <Power className="w-3 h-3" /> 停用
          </button>
        )}
        <button disabled={busy}
          onClick={() => {
            const nick = window.prompt('新的名称（留空取消）')
            if (nick !== null && nick.trim()) onAction('nickname', iccid, se, nick.trim())
          }}
          className={`${btn} text-slate-300 bg-slate-800/70 hover:bg-slate-700`}>
          <Pencil className="w-3 h-3" />
        </button>
        <button disabled={busy || active}
          onClick={() => { if (window.confirm('删除这个 eSIM 配置？不可恢复')) onAction('delete', iccid, se) }}
          className={`${btn} ${active ? 'text-slate-600 bg-slate-800/40 cursor-not-allowed' : 'text-rose-300 bg-rose-500/10 hover:bg-rose-500/20'}`}>
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

export default function Esim({ showToast, refreshOverview }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [seIdx, setSeIdx] = useState(0)
  const [ac, setAc] = useState('')
  const [smdp, setSmdp] = useState('')
  const [mid, setMid] = useState('')
  const [cc, setCc] = useState('')
  const [imei, setImei] = useState('')

  const load = useCallback(async () => {
    setErr(''); setData(null)
    try {
      setData(await api.esim.state(0))
    } catch (e) {
      setErr(e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const ses = (data && data.ses) || []
  const se = ses[Math.min(seIdx, Math.max(ses.length - 1, 0))] || null

  const run = async (fn, okMsg) => {
    setBusy(true); setErr('')
    try {
      const r = await fn()
      if (r && r.ok === false) setErr(r.error || '操作失败')
      else { okMsg && showToast(okMsg, 'success'); await load(); refreshOverview && refreshOverview() }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const onAction = (action, iccid, targetSe, nickname) =>
    run(() => api.esim.profile({
      reader: 0, iccid, action, nickname,
      aid: targetSe ? targetSe.aid || undefined : undefined,
    }), action === 'enable' ? '已启用' : action === 'disable' ? '已停用'
      : action === 'delete' ? '已删除' : '已重命名')

  const download = () => {
    if (!ac.trim() && (!smdp.trim() || !mid.trim())) {
      setErr('填激活码，或 SM-DP+ 地址 + matching ID'); return
    }
    run(() => api.esim.download({
      reader: 0,
      activation_code: ac.trim() || undefined,
      smdp: smdp.trim() || undefined,
      matching_id: mid.trim() || undefined,
      confirmation_code: cc.trim() || undefined,
      imei: imei.trim() || undefined,
      aid: se ? se.aid || undefined : undefined,
    }), 'eSIM 下载完成')
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-semibold text-white">eSIM / eUICC</span>
          </div>
          <button onClick={load} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60">
            <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} /> 刷新
          </button>
        </div>

        {data === null && !err && <div className="text-slate-500 text-sm">读取 eUICC 中…</div>}
        {err && <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">{err}</div>}
        {data && data.available === false && (
          <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
            {data.error || 'lpac 不可用'}
          </div>
        )}

        {data && data.available && ses.length > 1 && (
          <div className="flex gap-2 mb-3">
            {ses.map((s, i) => (
              <button key={s.id} onClick={() => setSeIdx(i)}
                className={`px-3 py-1.5 rounded-lg text-xs ${i === seIdx ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40' : 'bg-slate-800/60 text-slate-400 border border-slate-700'}`}>
                {s.label}
              </button>
            ))}
          </div>
        )}

        {se && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(15,23,42,.55)', border: '1px solid #243049' }}>
                <div className="text-[11px] text-slate-500">EID</div>
                <div className="text-xs font-mono text-slate-300 truncate">{se.eid || '—'}</div>
              </div>
              <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(15,23,42,.55)', border: '1px solid #243049' }}>
                <div className="text-[11px] text-slate-500">剩余空间</div>
                <div className="text-xs text-slate-300">{se.freeSpace != null ? `${se.freeSpace} 字节` : '—'}</div>
              </div>
              <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(15,23,42,.55)', border: '1px solid #243049' }}>
                <div className="text-[11px] text-slate-500">默认 SM-DP+</div>
                <div className="text-xs text-slate-300 truncate">{se.defaultDpAddress || '—'}</div>
              </div>
            </div>

            {se.error && <div className="text-sm text-rose-300 mb-3">{se.error}</div>}

            <div className="space-y-2">
              {(se.profiles || []).length === 0 && <div className="text-sm text-slate-500">这张卡上还没有 eSIM 配置</div>}
              {(se.profiles || []).map((p, i) => (
                <ProfileRow key={(p.iccid || p.iccidValue || i) + ''} p={p} se={se} onAction={onAction} busy={busy} />
              ))}
            </div>

            {(se.notifications || []).length > 0 && (
              <div className="mt-4 flex items-center justify-between rounded-xl px-3 py-2"
                   style={{ background: 'rgba(15,23,42,.55)', border: '1px solid #243049' }}>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <BellRing className="w-3.5 h-3.5 text-amber-400" />
                  待投递通知 {se.notifications.length} 条
                </div>
                <button disabled={busy}
                  onClick={() => run(() => api.esim.processNotifications({ reader: 0, aid: se.aid || undefined }), '通知已处理')}
                  className={`${btn} text-slate-200 bg-slate-800/70 hover:bg-slate-700`}>
                  <CheckCircle2 className="w-3 h-3" /> 处理
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl p-5" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
        <div className="flex items-center gap-2 mb-4">
          <Download className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">下载 eSIM 配置</span>
        </div>
        <div className="space-y-3">
          <div>
            <label className={lbl}>激活码（LPA:1$…）</label>
            <input className={inp} value={ac} onChange={(e) => setAc(e.target.value)}
                   placeholder="LPA:1$smdp.example.com$MATCHING-ID" />
          </div>
          <div className="text-[11px] text-slate-500">或者手工填写 SM-DP+ 与 matching ID：</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>SM-DP+ 地址</label>
              <input className={inp} value={smdp} onChange={(e) => setSmdp(e.target.value)} placeholder="rsp.example.com" />
            </div>
            <div>
              <label className={lbl}>Matching ID</label>
              <input className={inp} value={mid} onChange={(e) => setMid(e.target.value)} placeholder="MATCHING-ID" />
            </div>
            <div>
              <label className={lbl}>Confirmation Code（可选）</label>
              <input className={inp} value={cc} onChange={(e) => setCc(e.target.value)} />
            </div>
            <div>
              <label className={lbl}>IMEI（可选）</label>
              <input className={inp} value={imei} onChange={(e) => setImei(e.target.value)} placeholder="15 位" />
            </div>
          </div>
          <button disabled={busy} onClick={download}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors">
            <Download className="w-4 h-4" /> {busy ? '处理中…' : '开始下载'}
          </button>
        </div>
      </div>
    </div>
  )
}
