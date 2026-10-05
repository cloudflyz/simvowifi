import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../api.js'

// 短信：后端只有扁平列表（/api/sms，最新在前），会话在客户端按号码分组。
export default function Messages({ overview, showToast }) {
  const [msgs, setMsgs] = useState(null)      // 最新在前
  const [peer, setPeer] = useState(null)
  const [text, setText] = useState('')
  const [newTo, setNewTo] = useState('')
  const [composing, setComposing] = useState(false)
  const [sending, setSending] = useState(false)
  const [selMode, setSelMode] = useState(false)
  const [selIds, setSelIds] = useState(() => new Set())

  const provisioned = !!overview?.provisioned

  const load = useCallback(async () => {
    try { const r = await api.sms.list(300); setMsgs(r.messages || []) } catch {}
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 8000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => { setSelMode(false); setSelIds(new Set()) }, [peer])
  useEffect(() => { if (msgs && msgs.length === 0) { setSelMode(false); setSelIds(new Set()) } }, [msgs])

  // 会话列表：按号码分组，取每组最新一条
  const threads = React.useMemo(() => {
    if (!msgs) return []
    const by = new Map()
    for (const m of msgs) {                       // 最新在前 → 第一次遇到即最新
      if (!by.has(m.peer)) by.set(m.peer, { peer: m.peer, last: m, count: 0, unreadHint: m.dir === 'IN' })
      by.get(m.peer).count++
    }
    return [...by.values()]
  }, [msgs])

  // 当前会话消息（旧→新 显示）
  const threadMsgs = React.useMemo(() => {
    if (!msgs || !peer) return []
    return msgs.filter((m) => m.peer === peer).slice().reverse()
  }, [msgs, peer])

  const toast = (m) => showToast && showToast(m)

  const send = async () => {
    const to = (peer || newTo).trim()
    if (!to || !text.trim() || sending) return
    setSending(true)
    try {
      const res = await api.sms.send(to, text.trim())
      setText(''); setPeer(to); setNewTo(''); setComposing(false)
      await load()
      if (res && res.ok === false) toast('发送失败：' + (res.detail || res.error || '未知错误'))
      else toast(`已发送给 ${to}`)
    } catch (e) { toast('发送失败：' + e.message) }
    setSending(false)
  }

  const toggleSel = (id) => setSelIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const deleteSelected = async () => {
    if (!selIds.size) return
    if (!confirm(`删除选中的 ${selIds.size} 条短信？`)) return
    try {
      await api.sms.delete({ ids: [...selIds] })
      setSelMode(false); setSelIds(new Set()); await load()
      toast('已删除')
    } catch (e) { toast('删除失败：' + e.message) }
  }

  const deleteThread = async (p, e) => {
    if (e) e.stopPropagation()
    if (!confirm(`删除与 ${p} 的整个会话？`)) return
    try {
      await api.sms.delete({ peer: p })
      if (peer === p) { setPeer(null); setComposing(false) }
      await load()
      toast('会话已删除')
    } catch (e2) { toast('删除失败：' + e2.message) }
  }

  const clearAll = async () => {
    if (!threads.length) return
    if (!confirm('删除全部短信？此操作不可恢复。')) return
    try {
      await api.sms.delete({ all: true })
      setPeer(null); setMsgs([]); setComposing(false)
      toast('已清空')
    } catch (e) { toast('删除失败：' + e.message) }
  }

  if (!provisioned) return (
    <div className="card" style={{ padding: 24, color: 'var(--text-dim)' }}>
      尚未开通线路，短信功能需要先开通 SIM 并启动 engine。
    </div>
  )

  return (
    <div className="messages-page" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className={`split-pane ${peer || composing ? 'is-detail' : 'is-list'}`}
        style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: 16, flex: 1, minHeight: 0 }}>
        {/* ---- 会话列表 ---- */}
        <div className="card pane-list" style={{ padding: 12, overflow: 'auto', minHeight: 0 }}>
          <button className="btn btn-primary" style={{ width: '100%', marginBottom: 8 }} onClick={() => {
            setPeer(null); setComposing(true)
          }}>＋ 新短信</button>
          {threads.length > 0 &&
            <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 10, color: '#ef4444', fontSize: 12 }}
              onClick={clearAll}>清空全部</button>}
          {threads.map((t) => (
            <div key={t.peer} onClick={() => { setPeer(t.peer); setComposing(false) }} className="hover-row"
              style={{ padding: 10, borderRadius: 10, cursor: 'pointer', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8,
                background: peer === t.peer ? 'var(--active)' : 'transparent' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="mono">{t.peer}</div>
                <div style={{ fontSize: 12, color: 'var(--text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.last.dir === 'IN' ? '↙ ' : '↗ '}{t.last.body}
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>{t.count}</span>
              <button className="row-del" title="删除会话" aria-label={`删除与 ${t.peer} 的会话`}
                onClick={(e) => deleteThread(t.peer, e)}>🗑</button>
            </div>
          ))}
          {msgs && threads.length === 0 && <div style={{ color: 'var(--text-mute)', fontSize: 13, padding: 8 }}>暂无短信。</div>}
          {!msgs && <div style={{ color: 'var(--text-mute)', fontSize: 13, padding: 8 }}>加载中…</div>}
        </div>

        {/* ---- 会话详情 ---- */}
        <div className="card pane-detail" style={{ display: 'flex', flexDirection: 'column', padding: 0, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minWidth: 0, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost messages-back" onClick={() => { setPeer(null); setComposing(false) }}>← 返回</button>
            {peer ? <span className="mono" style={{ fontWeight: 600, flex: '1 1 120px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{peer}</span>
              : <input placeholder="收件号码，如 +8613800138000" value={newTo}
                onChange={(e) => setNewTo(e.target.value)}
                style={{ maxWidth: '100%', flex: '1 1 160px', minWidth: 0 }} />}
            {peer && threadMsgs.length > 0 && (
              selMode ? (
                <>
                  <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>已选 {selIds.size} 条</span>
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, color: '#ef4444' }}
                    disabled={!selIds.size} onClick={deleteSelected}>删除</button>
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => { setSelMode(false); setSelIds(new Set()) }}>取消</button>
                </>
              ) : (
                <>
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => setSelMode(true)}>选择</button>
                  <button className="btn btn-ghost" title="删除会话" style={{ padding: '4px 10px', fontSize: 12, color: '#ef4444' }}
                    onClick={() => deleteThread(peer)}>全删</button>
                </>
              )
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {threadMsgs.map((m) => {
              const out = m.dir === 'OUT'
              const checked = selIds.has(m.id)
              return (
                <div key={m.id} className="msg-row" onClick={() => selMode && toggleSel(m.id)}
                  style={{ alignSelf: out ? 'flex-end' : 'flex-start',
                    cursor: selMode ? 'pointer' : 'default', display: 'flex', alignItems: 'flex-start', gap: 8,
                    flexDirection: out ? 'row-reverse' : 'row' }}>
                  {selMode && <input type="checkbox" readOnly checked={checked} style={{ width: 'auto', flexShrink: 0, marginTop: 10 }} />}
                  <div style={{ minWidth: 0, maxWidth: '100%', flex: '1 1 auto' }}>
                    <div className="msg-bubble" style={{
                      background: checked ? 'var(--active)' : out ? 'var(--primary)' : 'var(--hover)',
                      color: out ? '#fff' : 'var(--text)',
                      padding: '8px 12px', borderRadius: 12, fontSize: 14,
                    }}>{m.body}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-mute)', textAlign: out ? 'right' : 'left', marginTop: 2 }}>
                      {m.time}{out ? ' · 已发出' : ''}
                    </div>
                  </div>
                </div>
              )
            })}
            {composing && <div style={{ color: 'var(--text-mute)', fontSize: 12.5, textAlign: 'center' }}>输入收件号码后发送</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)', flexShrink: 0, minWidth: 0 }}>
            <input placeholder="短信内容…" value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()} style={{ flex: 1, minWidth: 0 }} />
            <button className="btn btn-primary" style={{ flexShrink: 0 }}
              disabled={sending || (!peer && !newTo) || !text.trim()} onClick={send}>{sending ? '发送中…' : '发送'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
