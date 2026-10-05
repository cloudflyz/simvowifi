import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import SipInfoModal from './SipInfoModal.jsx'

function BarkCard({ showToast }) {
  const [s, setS] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.bark.get().then(setS).catch((e) => setMsg(e.message)) }, [])
  if (!s) return null

  const upd = (patch) => setS((x) => ({ ...x, ...patch }))
  const updEnc = (patch) => setS((x) => ({ ...x, encrypt: { ...x.encrypt, ...patch } }))

  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await api.bark.save(s)
      setMsg(r.note || '已保存')
      showToast('Bark 设置已保存')
    } catch (e) { setMsg('保存失败：' + e.message) }
    setBusy(false)
  }

  const test = async () => {
    setBusy(true)
    try {
      const r = await api.bark.test()
      showToast(r.ok ? `测试推送已发送 ${r.detail || ''}` : `推送失败：${r.detail || r.error}`)
    } catch (e) { showToast('推送失败：' + e.message) }
    setBusy(false)
  }

  const encOn = !!s.encrypt.key

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Bark 推送（iPhone）</h3>
      <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginBottom: 14, lineHeight: 1.7 }}>
        来电/短信推送到 Bark App。自建 Bark 服务器改 server；推送内容加密需 App 端配置同一密钥。
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Bark 服务器</label>
          <input className="mono" value={s.server} onChange={(e) => upd({ server: e.target.value })}
            placeholder="https://api.day.app" />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>设备 key（App 首页的字符串）</label>
          <input className="mono" value={s.key} onChange={(e) => upd({ key: e.target.value })}
            placeholder="App 打开后显示的 key" />
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: 'var(--text-soft)' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={!!s.include_body}
          onChange={(e) => upd({ include_body: e.target.checked })} />
        推送正文包含短信内容 / 来电号码
      </label>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>
          推送加密 {encOn ? <span style={{ color: '#22c55e', fontSize: 12 }}>· 已启用</span> : <span style={{ color: 'var(--text-mute)', fontSize: 12 }}>· 未启用</span>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginBottom: 10, lineHeight: 1.7 }}>
          与 Bark App「推送加密」设置保持一致：App 生成算法/模式/密钥/IV 后原样填入。留空密钥 = 关闭加密。
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <div>
            <label>算法</label>
            <select value={s.encrypt.algorithm} onChange={(e) => updEnc({ algorithm: e.target.value })}>
              <option>AES128</option><option>AES192</option><option>AES256</option>
            </select>
          </div>
          <div>
            <label>模式</label>
            <select value={s.encrypt.mode} onChange={(e) => updEnc({ mode: e.target.value })}>
              <option>CBC</option><option>GCM</option><option>ECB</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>密钥 Key</label>
            <input className="mono" value={s.encrypt.key} onChange={(e) => updEnc({ key: e.target.value })}
              placeholder="App 生成（留空 = 不加密）" />
          </div>
          {s.encrypt.mode !== 'ECB' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label>IV（GCM 模式下 App 也会显示）</label>
              <input className="mono" value={s.encrypt.iv} onChange={(e) => updEnc({ iv: e.target.value })}
                placeholder="App 生成" />
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? '处理中…' : '保存'}</button>
        <button className="btn btn-ghost" disabled={busy || !s.key} onClick={test}>发送测试推送</button>
        {msg && <span style={{ fontSize: 12.5, color: 'var(--text-dim)', flex: '1 1 200px' }}>{msg}</span>}
      </div>
    </div>
  )
}

function SoftphoneCard({ showToast }) {
  const [prov, setProv] = useState(null)
  const [tls, setTls] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.softphone().then(setProv).catch(() => {})
    api.session().then((s) => setTls(!!s.webui_tls)).catch(() => {})
  }, [])

  if (!prov) return null

  const toggleWebrtc = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await api.setWebrtc(!prov.enabled)
      setProv({ ...prov, enabled: !prov.enabled })
      setMsg(r.note || '已保存')
      showToast(r.ok !== false ? 'WebRTC 设置已保存' : '保存失败')
    } catch (e) { setMsg('保存失败：' + e.message) }
    setBusy(false)
  }

  const toggleTls = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await api.setWebuiTls(!tls)
      setTls(!tls)
      setMsg(r.note || '已保存')
    } catch (e) { setMsg('保存失败：' + e.message) }
    setBusy(false)
  }

  return (
    <>
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>浏览器软电话（WebRTC）</h3>
        <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginBottom: 12, lineHeight: 1.7 }}>
          开启后 engine 的 Asterisk 监听 WSS（端口 {prov.ws_port}），可在 WebUI 直接接打电话。
          账号：<span className="mono">{prov.username}</span> / <span className="mono">{prov.password ? '••••••' : ''}</span>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-soft)' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={!!prov.enabled}
            onChange={toggleWebrtc} disabled={busy} />
          启用 WebRTC（WSS :{prov.ws_port}）
        </label>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.7 }}>
          生效步骤：SIM 开通页重新 provision → 总览页重启 engine → 浏览器需 HTTPS 访问 WebUI，
          并先访问 <span className="mono">https://{prov.host}:{prov.ws_port}/</span> 接受一次自签名证书。
        </div>
        {msg && prov && <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.6 }}>{msg}</div>}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>WebUI HTTPS</h3>
        <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginBottom: 12, lineHeight: 1.7 }}>
          用 data/certs 自签名证书提供 HTTPS。浏览器软电话的麦克风要求安全上下文（HTTPS 或 localhost），建议开启。
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-soft)' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={!!tls}
            onChange={toggleTls} disabled={busy} />
          启用 HTTPS（webui.tls）
        </label>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
          保存后需重启 WebUI：systemctl restart simvowifi-web（或重新运行 simvowifi web），然后用 https:// 打开。
        </div>
      </div>
    </>
  )
}

function ConfigCard({ showToast }) {
  const [yaml, setYaml] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.config.get().then((r) => setYaml(r.yaml || '')).catch((e) => setMsg(e.message)) }, [])

  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await api.config.save(yaml)
      setMsg(r.note || '已保存')
      showToast('config.yaml 已保存')
    } catch (e) { setMsg('保存失败：' + e.message) }
    setBusy(false)
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>config.yaml 编辑器</h3>
      <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginBottom: 10, lineHeight: 1.7 }}>
        直接编辑配置（YAML，服务端校验）。engine 相关项重启后生效；line/bark 等修改建议先停 engine。
      </div>
      <textarea className="mono" value={yaml} onChange={(e) => { setYaml(e.target.value); setMsg('') }}
        spellCheck={false} style={{ minHeight: 320, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button className="btn btn-primary" disabled={busy || !yaml.trim()} onClick={save}>{busy ? '保存中…' : '保存配置'}</button>
        {msg && <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{msg}</span>}
      </div>
    </div>
  )
}

export default function Settings({ showToast }) {
  const [sipInfo, setSipInfo] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
      <div className="card" style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>Linphone / SIP 接入</h3>
          <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 4 }}>手机 App 注册网关，接打电话/收发短信。</div>
        </div>
        <button className="btn btn-primary" onClick={() => setSipInfo(true)}>查看接入信息</button>
      </div>

      <BarkCard showToast={showToast} />
      <SoftphoneCard showToast={showToast} />
      <ConfigCard showToast={showToast} />
      {sipInfo && <SipInfoModal onClose={() => setSipInfo(false)} />}
    </div>
  )
}
