// simvowifi ctl REST 客户端（同源 Cookie 会话）。
// 任何 /api/* 收到 401 → 触发 onUnauthorized（App 切回登录页）。
let onUnauthorized = null
export function setUnauthorizedHandler(fn) { onUnauthorized = fn }

async function j(method, path, body) {
  const opt = { method, headers: {} }
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json'
    opt.body = JSON.stringify(body)
  }
  let r
  try {
    r = await fetch(path, opt)
  } catch (e) {
    throw new Error('网络错误：无法连接 simvowifi 服务（' + e.message + '）')
  }
  const text = await r.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (r.status === 401 && onUnauthorized) onUnauthorized()
  if (!r.ok) throw Object.assign(new Error(data.error || data.detail || ('HTTP ' + r.status)), { status: r.status, data })
  return data
}

export const api = {
  session: () => j('GET', '/api/session'),
  login: (password) => j('POST', '/api/login', { password }),
  logout: () => j('POST', '/api/logout'),

  overview: () => j('GET', '/api/overview'),

  sms: {
    list: (limit = 200) => j('GET', `/api/sms?limit=${limit}`),
    send: (to, text) => j('POST', '/api/sms', { to, text }),
    delete: (sel) => j('POST', '/api/sms/delete', sel),
  },
  calls: {
    list: (limit = 100) => j('GET', `/api/calls?limit=${limit}`),
    delete: (sel) => j('POST', '/api/calls/delete', sel),
  },
  // 经 Linphone 客户端外呼（响铃）
  call: (to) => j('POST', '/api/call', { to }),

  softphone: () => j('GET', '/api/softphone'),
  setWebrtc: (enable) => j('POST', '/api/webrtc', { enable }),
  setWebuiTls: (enable) => j('POST', '/api/webui_tls', { enable }),

  readers: () => j('GET', '/api/readers'),
  card: (reader = 0) => j('GET', `/api/card?reader=${reader}`),
  provision: (reader = 0, pin) => j('POST', '/api/provision', { reader, pin }),
  sim: {
    verifyPin: (pin, reader = 0) => j('POST', '/api/sim/verify_pin', { pin, reader }),
    changePin: (oldp, newp, reader = 0) => j('POST', '/api/sim/change_pin', { old: oldp, new: newp, reader }),
    setPinEnabled: (pin, enabled, reader = 0) => j('POST', '/api/sim/pin_enabled', { pin, enabled, reader }),
  },

  esim: {
    state: (reader = 0) => j('GET', `/api/esim?reader=${reader}`),
    profile: (body) => j('POST', '/api/esim/profile', body),
    download: (body) => j('POST', '/api/esim/download', body),
    notifications: (reader = 0, aid) => j('GET',
      `/api/esim/notifications?reader=${reader}` + (aid ? `&aid=${aid}` : '')),
    processNotifications: (body) => j('POST', '/api/esim/notifications/process', body),
  },

  bark: {
    test: () => j('POST', '/api/bark_test'),
    get: () => j('GET', '/api/bark_settings'),
    save: (s) => j('POST', '/api/bark_settings', s),
  },

  config: {
    get: () => j('GET', '/api/config'),
    save: (yaml) => j('POST', '/api/config', { yaml }),
  },

  logs: (which, tail = 400) => j('GET', `/api/logs?which=${which}&tail=${tail}`),
  lifecycle: (action) => j('POST', '/api/lifecycle', { action }),
  doctor: () => j('GET', '/api/doctor'),
  linphone: () => j('GET', '/api/linphone'),
}
