import React, { useState } from 'react'
import { Smartphone, Bell, Shield, Globe, Save, Send, CheckCircle2 } from 'lucide-react'
import { api } from '../api.js'
import SipInfoModal from './SipInfoModal.jsx'

function BarkCard({ showToast }) {
  const [s, setS] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  React.useEffect(() => { api.bark.get().then(setS).catch((e) => setMsg(e.message)) }, [])
  if (!s) return null

  const upd = (patch) => setS((x) => ({ ...x, ...patch }))
  const updEnc = (patch) => setS((x) => ({ ...x, encrypt: { ...x.encrypt, ...patch } }))

  const save = async () => {
    setBusy(true); setMsg('')
    try { const r = await api.bark.save(s); setMsg(r.note || '已保存'); showToast('Bark 设置已保存', 'success') }
    catch (e) { setMsg('保存失败：' + e.message) }
    setBusy(false)
  }

  const test = async () => {
    setBusy(true)
    try {
      const r = await api.bark.test()
      showToast(r.ok ? `测试推送已发送 ${r.detail || ''}` : `推送失败：${r.detail || r.error}`, r.ok ? 'success' : 'error')
    } catch (e) { showToast('推送失败：' + e.message, 'error') }
    setBusy(false)
  }

  const encOn = !!s.encrypt.key

  const inp = "w-full px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all"
  const lbl = "block text-xs font-medium text-slate-400 mb-1.5"

  return (
    <div className="rounded-2xl p-5" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
      <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
        <Bell className="w-4 h-4 text-amber-400" /> Bark 推送（iPhone）
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        来电/短信推送到 Bark App。来电推送可唤醒 Linphone 接听。
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className={lbl}>Bark 服务器</label>
          <input className={inp} value={s.server} onChange={(e) => upd({ server: e.target.value })} placeholder="https://api.day.app" />
        </div>
        <div className="md:col-span-2">
          <label className={lbl}>设备 key</label>
          <input className={inp} value={s.key} onChange={(e) => upd({ key: e.target.value })} placeholder="App 首页的 key" />
        </div>

        <div>
          <label className={lbl}>铃声</label>
          <input className={inp} value={s.call_sound || 'alarm'} onChange={(e) => upd({ call_sound: e.target.value })} placeholder="alarm" />
        </div>
        <div>
          <label className={lbl}>级别</label>
          <select className={inp} value={s.call_level || 'critical'} onChange={(e) => upd({ call_level: e.target.value })}>
            <option value="critical">critical（绕过静音）</option>
            <option value="timeSensitive">timeSensitive</option>
            <option value="active">active</option>
            <option value="passive">passive（静默）</option>
          </select>
        </div>
        <div>
          <label className={lbl}>分组</label>
          <input className={inp} value={s.call_group || s.group || 'VoIP'} onChange={(e) => upd({ call_group: e.target.value })} placeholder="VoIP" />
        </div>
        <div>
          <label className={lbl}>归档</label>
          <select className={inp} value={s.call_isArchive ?? 1} onChange={(e) => upd({ call_isArchive: parseInt(e.target.value) })}>
            <option value="1">归档（不重复占位）</option>
            <option value="0">不归档</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 mt-4 text-sm text-slate-400 cursor-pointer">
        <input type="checkbox" className="w-4 h-4 rounded border-slate-600 text-indigo-500 focus:ring-indigo-500/40"
          checked={!!s.include_body} onChange={(e) => upd({ include_body: e.target.checked })} />
        推送正文包含短信内容 / 来电号码
      </label>

      {/* 加密 */}
      <div className="mt-4 pt-4 border-t border-slate-800">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-300">推送加密</span>
          {encOn ? <span className="text-xs text-emerald-400">· 已启用</span> : <span className="text-xs text-slate-500">· 未启用</span>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>算法</label>
            <select className={inp} value={s.encrypt.algorithm} onChange={(e) => updEnc({ algorithm: e.target.value })}>
              <option>AES128</option><option>AES192</option><option>AES256</option>
            </select>
          </div>
          <div>
            <label className={lbl}>模式</label>
            <select className={inp} value={s.encrypt.mode} onChange={(e) => updEnc({ mode: e.target.value })}>
              <option>CBC</option><option>GCM</option><option>ECB</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className={lbl}>密钥 Key</label>
            <input className={inp} value={s.encrypt.key} onChange={(e) => updEnc({ key: e.target.value })} placeholder="留空 = 不加密" />
          </div>
          {s.encrypt.mode !== 'ECB' && (
            <div className="col-span-2">
              <label className={lbl}>IV</label>
              <input className={inp} value={s.encrypt.iv} onChange={(e) => updEnc({ iv: e.target.value })} placeholder="留空 = 每条随机" />
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={save} disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}>
          <Save className="w-3.5 h-3.5" /> {busy ? '保存中…' : '保存'}
        </button>
        <button onClick={test} disabled={busy || !s.key}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-slate-300 bg-slate-800/60 border border-slate-700 hover:bg-slate-700/60 transition-colors disabled:opacity-50">
          <Send className="w-3.5 h-3.5" /> 发送测试推送
        </button>
        {msg && <span className="text-xs text-slate-500 flex-1 self-center">{msg}</span>}
      </div>
    </div>
  )
}

function SipInfoCard({ showToast }) {
  const [show, setShow] = useState(false)
  return (
    <div className="rounded-2xl p-5" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-cyan-400" /> Linphone / SIP 接入
          </h3>
          <p className="text-xs text-slate-500">手机 App 注册网关，接打电话/收发短信。</p>
        </div>
        <button onClick={() => setShow(true)}
          className="px-3.5 py-2 rounded-xl text-sm font-medium text-white transition-all"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)' }}>
          查看接入信息
        </button>
      </div>
      {show && <SipInfoModal onClose={() => setShow(false)} />}
    </div>
  )
}

function ConfigCard({ showToast }) {
  const [yaml, setYaml] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  React.useEffect(() => { api.config.get().then((r) => setYaml(r.yaml || '')).catch((e) => setMsg(e.message)) }, [])

  const save = async () => {
    setBusy(true); setMsg('')
    try { const r = await api.config.save(yaml); setMsg(r.note || '已保存'); showToast('config.yaml 已保存', 'success') }
    catch (e) { setMsg('保存失败：' + e.message) }
    setBusy(false)
  }

  return (
    <div className="rounded-2xl p-5" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
      <h3 className="text-sm font-semibold text-white mb-1">config.yaml 编辑器</h3>
      <p className="text-xs text-slate-500 mb-3">直接编辑配置（YAML，服务端校验）。</p>
      <textarea className="w-full min-h-[280px] px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-xs text-slate-300 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
        value={yaml} onChange={(e) => { setYaml(e.target.value); setMsg('') }} spellCheck={false} />
      <div className="flex gap-2 mt-3 items-center">
        <button onClick={save} disabled={busy || !yaml.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}>
          <Save className="w-3.5 h-3.5" /> {busy ? '保存中…' : '保存配置'}
        </button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </div>
  )
}

export default function Settings({ showToast }) {
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <SipInfoCard showToast={showToast} />
      <BarkCard showToast={showToast} />
      <ConfigCard showToast={showToast} />
    </div>
  )
}
