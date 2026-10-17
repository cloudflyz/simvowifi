import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { MessageSquare, Send, Trash2, ChevronLeft, Plus, Check, CheckCheck } from 'lucide-react'
import { api } from '../api.js'

const inp = "flex-1 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all"

export default function Messages({ overview, showToast }) {
  const [msgs, setMsgs] = useState(null)
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

  const threads = useMemo(() => {
    if (!msgs) return []
    const by = new Map()
    for (const m of msgs) {
      if (!by.has(m.peer)) by.set(m.peer, { peer: m.peer, last: m, count: 0 })
      by.get(m.peer).count++
    }
    return [...by.values()]
  }, [msgs])

  const threadMsgs = useMemo(() => {
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
      if (res && res.ok === false) toast('发送失败：' + (res.detail || res.error || '未知错误'), 'error')
      else toast(`已发送给 ${to}`, 'success')
    } catch (e) { toast('发送失败：' + e.message, 'error') }
    setSending(false)
  }

  const toggleSel = (id) => setSelIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const deleteSelected = async () => {
    if (!selIds.size) return
    if (!confirm(`删除选中的 ${selIds.size} 条短信？`)) return
    try {
      await api.sms.delete({ ids: [...selIds] })
      setSelMode(false); setSelIds(new Set()); await load()
      toast('已删除', 'success')
    } catch (e) { toast('删除失败：' + e.message, 'error') }
  }

  const deleteThread = async (p, e) => {
    if (e) e.stopPropagation()
    if (!confirm(`删除与 ${p} 的整个会话？`)) return
    try {
      await api.sms.delete({ peer: p })
      if (peer === p) { setPeer(null); setComposing(false) }
      await load(); toast('会话已删除', 'success')
    } catch (e2) { toast('删除失败：' + e2.message, 'error') }
  }

  const clearAll = async () => {
    if (!threads.length) return
    if (!confirm('删除全部短信？此操作不可恢复。')) return
    try {
      await api.sms.delete({ all: true })
      setPeer(null); setMsgs([]); setComposing(false)
      toast('已清空', 'success')
    } catch (e) { toast('删除失败：' + e.message, 'error') }
  }

  if (!provisioned) return (
    <div className="rounded-2xl p-6 text-center" style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
      <MessageSquare className="w-12 h-12 text-slate-700 mx-auto mb-3" />
      <div className="text-slate-500 text-sm">尚未开通线路，短信功能需要先开通 SIM 并启动 engine。</div>
    </div>
  )

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className={`split-pane ${peer || composing ? 'is-detail' : 'is-list'}`}
        style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: 3, flex: 1, minHeight: 0 }}>

        {/* ── 会话列表 ── */}
        <div className="pane-list rounded-2xl overflow-y-auto no-scrollbar p-3 space-y-1"
          style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>
          <button onClick={() => { setPeer(null); setComposing(true) }}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white mb-2 transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}>
            <Plus className="w-4 h-4" /> 新短信
          </button>
          {threads.length > 0 && (
            <button onClick={clearAll}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium text-red-400 hover:bg-red-400/10 transition-colors mb-2">
              <Trash2 className="w-3 h-3" /> 清空全部
            </button>
          )}

          {threads.map((t) => (
            <div key={t.peer} onClick={() => { setPeer(t.peer); setComposing(false) }}
              className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-colors"
              style={{ background: peer === t.peer ? 'rgba(99,102,241,.1)' : 'transparent' }}>
              <div className="w-8 h-8 rounded-full bg-slate-700/60 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-slate-200 truncate font-mono">{t.peer}</div>
                <div className="text-xs text-slate-500 truncate">
                  {t.last.dir === 'IN' ? '↙ ' : '↗ '}{t.last.body}
                </div>
              </div>
              <span className="text-[10px] text-slate-600 flex-shrink-0">{t.count}</span>
              <button onClick={(e) => deleteThread(t.peer, e)} title="删除"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-red-400 p-1">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {msgs && threads.length === 0 && <div className="text-slate-500 text-sm text-center py-4">暂无短信</div>}
          {!msgs && <div className="text-slate-500 text-sm text-center py-4">加载中…</div>}
        </div>

        {/* ── 会话详情 ── */}
        <div className="pane-detail rounded-2xl flex flex-col overflow-hidden"
          style={{ background: 'rgba(20,27,45,.8)', border: '1px solid #243049' }}>

          {/* 头部 */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/60 flex-shrink-0">
            <button className="messages-back flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
              onClick={() => { setPeer(null); setComposing(false) }}>
              <ChevronLeft className="w-4 h-4" /> 返回
            </button>
            {peer
              ? <span className="font-mono text-sm font-semibold text-white truncate flex-1">{peer}</span>
              : <input placeholder="收件号码，如 +8613800138000" value={newTo}
                onChange={(e) => setNewTo(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all" />}
            {peer && threadMsgs.length > 0 && (
              selMode ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">已选 {selIds.size} 条</span>
                  <button onClick={deleteSelected} disabled={!selIds.size}
                    className="px-2.5 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50">删除</button>
                  <button onClick={() => { setSelMode(false); setSelIds(new Set()) }}
                    className="px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-700/60 transition-colors">取消</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelMode(true)}
                    className="px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-700/60 transition-colors">选择</button>
                  <button onClick={() => deleteThread(peer)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-400/10 transition-colors">
                    <Trash2 className="w-3 h-3" /> 全删
                  </button>
                </div>
              )
            )}
          </div>

          {/* 消息列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-3 space-y-2">
            {threadMsgs.map((m) => {
              const out = m.dir === 'OUT'
              const checked = selIds.has(m.id)
              return (
                <div key={m.id} onClick={() => selMode && toggleSel(m.id)}
                  className="flex items-start gap-2"
                  style={{
                    flexDirection: out ? 'row-reverse' : 'row',
                    justifyContent: out ? 'flex-end' : 'flex-start',
                    cursor: selMode ? 'pointer' : 'default',
                  }}>
                  {selMode && (
                    <div className={`mt-2 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      checked ? 'bg-indigo-500 border-indigo-500' : 'border-slate-600'
                    }`}>
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </div>
                  )}
                  <div style={{ maxWidth: '75%' }}>
                    <div className="px-3.5 py-2 rounded-2xl text-sm leading-relaxed"
                      style={{
                        background: checked ? 'rgba(99,102,241,.2)' : out ? 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)' : 'rgba(51,65,85,.6)',
                        color: out ? '#fff' : '#e2e8f0',
                        border: checked ? '1px solid rgba(99,102,241,.4)' : 'none',
                      }}>
                      {m.body}
                    </div>
                    <div className={`text-[10px] text-slate-600 mt-1 ${out ? 'text-right' : ''}`}>
                      {m.time}{out ? ' · 已发出' : ''}
                    </div>
                  </div>
                </div>
              )
            })}
            {composing && <div className="text-slate-500 text-xs text-center py-2">输入收件号码后发送</div>}
          </div>

          {/* 输入框 */}
          <div className="flex gap-2 px-3 py-3 border-t border-slate-800/60 flex-shrink-0">
            <input placeholder="短信内容…" value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              className={inp} />
            <button onClick={send} disabled={sending || (!peer && !newTo) || !text.trim()}
              className="flex items-center justify-center w-10 h-10 rounded-xl text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
