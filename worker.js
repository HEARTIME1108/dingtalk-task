// Cloudflare Pages Functions - 用 Hono 重写的后端(Workers 原生兼容)
// Polyfill process.env(让 notifier.js 等模块顶层解构不报错)
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {} }
} else if (!globalThis.process.env) {
  globalThis.process.env = {}
}

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { notifyTask } from './backend/notifier.js'
import * as XLSX from 'xlsx'

const app = new Hono()

app.use('*', cors())
app.use('*', async (c, next) => {
  // 注入环境变量到 process.env(本地)
  if (typeof process !== 'undefined' && c.env) {
    for (const k in c.env) {
      if (!process.env[k]) {
        try { process.env[k] = String(c.env[k]) } catch (e) {}
      }
    }
  }
  await next()
})

// ============================================================
// 工具:读 env(优先 c.env,回退 process.env)
// ============================================================
function env(c, key, def = '') {
  if (c.env && c.env[key]) return c.env[key]
  if (typeof process !== 'undefined' && process.env[key]) return process.env[key]
  return def
}

// ============================================================
// Supabase fetch(用 service_role 绕 RLS)
// ============================================================
async function adminFetch(c, path, options = {}) {
  const SUPABASE_URL = env(c, 'SUPABASE_URL')
  const KEY = env(c, 'SUPABASE_SERVICE_ROLE_KEY')
  const url = `${SUPABASE_URL}/rest/v1/${path}`
  const headers = {
    'apikey': KEY,
    'authorization': `Bearer ${KEY}`,
    'content-type': 'application/json',
    ...options.headers
  }
  if (options.method === 'POST' || options.method === 'PATCH' || options.method === 'PUT') {
    headers['prefer'] = options.prefer || 'return=representation'
  }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Supabase 请求失败 ${res.status}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

async function adminCreateUser(c, params) {
  const SUPABASE_URL = env(c, 'SUPABASE_URL')
  const KEY = env(c, 'SUPABASE_SERVICE_ROLE_KEY')
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': KEY,
      'authorization': `Bearer ${KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(params)
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.msg || data.message || '创建用户失败')
  return data
}

async function loginWithPassword(c, email, password) {
  const SUPABASE_URL = env(c, 'SUPABASE_URL')
  const ANON = env(c, 'SUPABASE_ANON_KEY')
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': ANON,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  })
  const data = await res.json()
  if (!res.ok) {
    const err = new Error(data.msg || data.message || '登录失败')
    err.code = data.error_code || data.code
    throw err
  }
  return data
}

// ============================================================
// 钉钉应用级 access_token(用新版 api.dingtalk.com 域名)
// ============================================================
let tokenCache = { token: null, expire: 0 }

async function getDingtalkAccessToken(c) {
  const now = Date.now()
  if (tokenCache.token && now < tokenCache.expire - 60000) return tokenCache.token
  const APP_KEY = env(c, 'DINGTALK_APP_KEY')
  const APP_SECRET = env(c, 'DINGTALK_APP_SECRET')
  const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey: APP_KEY, appSecret: APP_SECRET })
  })
  const data = await res.json()
  if (!data.accessToken) throw new Error('获取钉钉 access_token 失败: ' + JSON.stringify(data))
  tokenCache = { token: data.accessToken, expire: now + data.expireIn * 1000 }
  return tokenCache.token
}

// ============================================================
// 钉钉工作通知：给指定用户发推送（钉钉会弹窗，不必打开应用即可看到）
// 用「发送工作通知」接口 asyncsend_v2，需配置 APP_AGENT_ID
// ============================================================
async function sendDingtalkWorkNotice(c, userIds, title, markdown, taskUrl) {
  const APP_AGENT_ID = env(c, 'APP_AGENT_ID')
  if (!APP_AGENT_ID) {
    console.warn('[notify] 未配置 APP_AGENT_ID，跳过工作通知')
    return { skipped: true, reason: 'no_agent_id' }
  }
  const ids = [...new Set((userIds || []).filter(Boolean))]
  if (!ids.length) return { skipped: true, reason: 'empty_users' }

  // 只给有真实钉钉 userid 的用户发（mock 用户发不出去）
  const users = await adminFetch(c, `users?select=id,dingtalk_user_id&id=in.(${ids.join(',')})`)
  const dtIds = (users || [])
    .map(u => u.dingtalk_user_id)
    .filter(v => v && !String(v).startsWith('mock_'))
  if (!dtIds.length) {
    console.warn('[notify] 目标用户无真实钉钉 userid，跳过:', ids.join(','))
    return { skipped: true, reason: 'no_real_dingtalk_users' }
  }

  const token = await getDingtalkAccessToken(c)
  // 注意:asyncsend_v2 的 action_card 按钮必须用 single_title/single_url(或 btn_json_list),
  // 不能用 btns,否则报 400002 actioncard消息必须同时设置btn_json
  const actionCard = { title, markdown }
  if (taskUrl) {
    actionCard.single_title = '查看任务'
    actionCard.single_url = taskUrl
  }

  const res = await fetch(`https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_id: APP_AGENT_ID,
      userid_list: dtIds.join(','),
      msg: { msgtype: 'action_card', action_card: actionCard }
    })
  })
  const data = await res.json()
  if (data.errcode !== 0) {
    console.warn('[notify] 工作通知发送失败:', JSON.stringify(data))
    return { sent: false, error: data }
  }
  return { sent: true, task_id: data.task_id }
}

// 按事件给任务相关人发通知
// event: assign 派发 / review 提交审核 / approve 审批通过 / reject 驳回 / close 关闭 / complete 直接完成
async function notifyTaskEvent(c, task, event, operatorId, operatorName, extraUserIds = []) {
  try {
    const base = env(c, 'FRONTEND_BASE_URL', '').replace(/\/$/, '')
    const taskUrl = base ? `${base}/tasks/${task.id}` : ''

    // 优先级转中文(日/周/月...)
    const PRIORITY_CN = { daily: '日任务', weekly: '周任务', monthly: '月任务', quarterly: '季度任务', yearly: '年任务' }
    const prioText = task.priority ? (PRIORITY_CN[task.priority] || task.priority) : '普通'
    const dueText = task.due_date || '无'

    // 任务类型/状态中文
    const TYPE_CN = { department: '部门任务', team: '班组任务', team_a: '运行一值', team_b: '运行二值' }
    const STATUS_CN = {
      todo: '待办', in_progress: '进行中', pending_review: '待审核',
      done: '已完成', rejected: '已驳回', closed: '已关闭'
    }
    const typeText = task.task_type ? (TYPE_CN[task.task_type] || task.task_type) : '部门任务'
    const statusText = task.status ? (STATUS_CN[task.status] || task.status) : ''

    // 钉钉卡片 markdown 中单换行会被合并成一行,必须用空行(\n\n)才能换行
    const L = (label, val) => `**${label}**：${val}`
    const lines = (...arr) => arr.filter(Boolean).join('\n\n')

    // 取负责人/审核人姓名:让负责人知道"做什么任务、交给谁审核"
    const nameOf = {}
    try {
      const ids = [task.assignee_id, task.reviewer_id, task.department_head_id].filter(Boolean)
      if (ids.length) {
        const us = await adminFetch(c, `users?select=id,name&id=in.(${ids.join(',')})`)
        for (const u of (us || [])) nameOf[u.id] = u.name
      }
    } catch (e) {}
    const assigneeName = nameOf[task.assignee_id] || '—'
    const reviewerName = nameOf[task.reviewer_id] || '—'

    let targetIds = []
    let title = ''
    let markdown = ''
    if (event === 'assign') {
      // 创建任务时:负责人、审核人、协作者、部门主任 全部通知
      targetIds = [task.assignee_id, task.reviewer_id, task.department_head_id, ...extraUserIds]
      title = '新任务派发'
      markdown = lines(
        `**${operatorName}** 派发了新任务`,
        L('任务', task.title),
        L('类型', typeText),
        L('负责人', assigneeName),
        L('审核人', reviewerName),
        L('优先级', prioText),
        L('截止', dueText),
        '请及时处理。'
      )
    } else if (event === 'review') {
      targetIds = [task.reviewer_id]
      title = '有任务待审核'
      markdown = lines(
        `**${operatorName}** 提交了任务待你审核`,
        L('任务', task.title),
        L('类型', typeText),
        L('负责人', assigneeName),
        L('状态', '待审核'),
        L('优先级', prioText),
        L('截止', dueText),
        '请尽快审批。'
      )
    } else if (event === 'approve') {
      targetIds = [task.assignee_id, task.creator_id]
      title = '任务审批通过'
      markdown = lines(
        `**${operatorName}** 通过了任务`,
        L('任务', task.title),
        L('类型', typeText),
        L('负责人', assigneeName),
        L('状态', '已完成'),
        L('截止', dueText)
      )
    } else if (event === 'reject') {
      targetIds = [task.assignee_id]
      title = '任务被驳回'
      markdown = lines(
        `**${operatorName}** 驳回了任务,请重新执行`,
        L('任务', task.title),
        L('类型', typeText),
        L('负责人', assigneeName),
        L('优先级', prioText),
        L('截止', dueText)
      )
    } else if (event === 'close' || event === 'complete') {
      targetIds = [task.creator_id]
      title = event === 'close' ? '任务已关闭' : '任务已完成'
      markdown = lines(
        `**${task.title}** 已${event === 'close' ? '关闭' : '完成'}`,
        L('类型', typeText),
        L('负责人', assigneeName),
        statusText ? L('当前状态', statusText) : '',
        L('截止', dueText)
      )
    } else {
      return { skipped: true, reason: 'unknown_event' }
    }

    // 参与流程的人都收到(含操作人自己,例如派给自己/自己给自己审核时也要收到),仅做去重
    targetIds = [...new Set(targetIds.filter(Boolean))]
    return await sendDingtalkWorkNotice(c, targetIds, title, markdown, taskUrl)
  } catch (e) {
    console.warn('[notify] 通知异常:', e.message)
    return { sent: false, error: e.message }
  }
}

// ============================================================
// authCode → 企业接口获取用户信息(旧版 JSAPI 流程,兼容性好)
// ============================================================
async function getDingtalkUserByAuthCode(c, authCode) {
  const token = await getDingtalkAccessToken(c)

  // 1) 用企业 access_token + authCode 获取用户 userid
  const r1 = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: authCode })
  })
  const d1 = await r1.json()
  if (d1.errcode) throw new Error('getuserinfo 失败: ' + d1.errmsg + '(' + d1.errcode + ')')
  const userid = d1.result?.userid
  if (!userid) throw new Error('获取 userid 失败: ' + JSON.stringify(d1))

  // 2) 用 userid 获取用户详细信息
  const r2 = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userid })
  })
  const d2 = await r2.json()
  if (d2.errcode) throw new Error('user/get 失败: ' + d2.errmsg + '(' + d2.errcode + ')')
  const u = d2.result || {}
  return {
    dingtalk_user_id: userid,
    name: u.name || '钉钉用户',
    avatar_url: u.avatar || '',
    union_id: u.unionid || null
  }
}

// ============================================================
// 用 Web Crypto API 派生密码
// ============================================================
function virtualEmail(dtUserId) { return `dt_${dtUserId}@dt.local` }

async function derivePassword(c, dtUserId) {
  const secret = env(c, 'SUPABASE_SERVICE_ROLE_KEY')
  if (!secret) throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY')
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('dt:' + dtUserId))
  const arr = Array.from(new Uint8Array(sig))
  return arr.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

async function ensureSupabaseUser(c, dtUser) {
  const email = virtualEmail(dtUser.dingtalk_user_id)
  const password = await derivePassword(c, dtUser.dingtalk_user_id)
  const SUPABASE_URL = env(c, 'SUPABASE_URL')
  const KEY = env(c, 'SUPABASE_SERVICE_ROLE_KEY')

  // 1. 先尝试直接登录
  try {
    const loginData = await loginWithPassword(c, email, password)
    if (loginData.access_token) {
      try {
        await adminFetch(c, `users?id=eq.${loginData.user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: dtUser.name,
            avatar_url: dtUser.avatar_url,
            union_id: dtUser.union_id
          })
        })
      } catch (e) {}
      return {
        access_token: loginData.access_token,
        refresh_token: loginData.refresh_token,
        user: loginData.user
      }
    }
  } catch (e) {
    console.log('[ensureUser] 登录失败:', e.message)
  }

  // 2. 在 Auth 中查找已有用户（按邮箱）
  let authUserId = null
  try {
    const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
      headers: { 'apikey': KEY, 'authorization': `Bearer ${KEY}` }
    })
    if (listRes.ok) {
      const listData = await listRes.json()
      const users = Array.isArray(listData) ? listData : (listData.users || [])
      const found = users.find(u => u.email === email)
      if (found) authUserId = found.id
    }
  } catch (e) {
    console.log('[ensureUser] 查找Auth用户失败:', e.message)
  }

  if (authUserId) {
    // 3a. 用户已存在，尝试 PUT 重置密码
    let passwordReset = false
    try {
      const putRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUserId}`, {
        method: 'PUT',
        headers: {
          'apikey': KEY,
          'authorization': `Bearer ${KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          password,
          email_confirm: true,
          user_metadata: {
            name: dtUser.name,
            avatar_url: dtUser.avatar_url,
            dingtalk_user_id: dtUser.dingtalk_user_id
          }
        })
      })
      if (putRes.ok) {
        passwordReset = true
      } else {
        const errBody = await putRes.json().catch(() => ({}))
        console.log('[ensureUser] PUT 重置密码失败:', putRes.status, errBody.msg || errBody.message || '')
      }
    } catch (e) {
      console.log('[ensureUser] PUT 异常:', e.message)
    }

    // PUT 失败 → DELETE 再重建
    if (!passwordReset) {
      console.log('[ensureUser] 尝试 DELETE + 重建')
      try {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUserId}`, {
          method: 'DELETE',
          headers: { 'apikey': KEY, 'authorization': `Bearer ${KEY}` }
        })
      } catch (e) {}
      try {
        await adminFetch(c, `users?id=eq.${authUserId}`, { method: 'DELETE' })
      } catch (e) {}
      authUserId = null
    }
  }

  if (!authUserId) {
    // 3b. 创建新用户
    const created = await adminCreateUser(c, {
      email, password, email_confirm: true,
      user_metadata: {
        name: dtUser.name,
        avatar_url: dtUser.avatar_url,
        dingtalk_user_id: dtUser.dingtalk_user_id
      }
    })
    if (!created.id) throw new Error('创建用户失败: ' + (created.message || JSON.stringify(created)))
    authUserId = created.id
  }

  // 4. 确保 users 表有记录
  try {
    await adminFetch(c, `users?id=eq.${authUserId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        dingtalk_user_id: dtUser.dingtalk_user_id,
        name: dtUser.name,
        avatar_url: dtUser.avatar_url,
        union_id: dtUser.union_id
      })
    })
  } catch (e) {
    // users 表没这条记录，POST 插入
    try {
      await adminFetch(c, 'users', {
        method: 'POST',
        body: JSON.stringify({
          id: authUserId,
          dingtalk_user_id: dtUser.dingtalk_user_id,
          name: dtUser.name,
          avatar_url: dtUser.avatar_url,
          union_id: dtUser.union_id
        })
      })
    } catch (e2) {}
  }

  // 5. 用密码登录
  const relogin = await loginWithPassword(c, email, password)
  return {
    access_token: relogin.access_token,
    refresh_token: relogin.refresh_token,
    user: relogin.user
  }
}

// ============================================================
// JWT 解码(Web 兼容)
// ============================================================
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(payloadB64)
    return JSON.parse(json)
  } catch (e) {
    return null
  }
}

async function requireUser(c, next) {
  const auth = c.req.header('Authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return c.json({ message: '未登录' }, 401)
  const payload = decodeJwtPayload(m[1])
  if (!payload || !payload.sub) return c.json({ message: 'token 无效' }, 401)
  c.set('userId', payload.sub)
  await next()
}

// ============================================================
// 路由
// ============================================================
app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/auth/config', (c) => c.json({
  corpId: env(c, 'DINGTALK_CORP_ID'),
  appKey: env(c, 'DINGTALK_APP_KEY')
}))

// ============================================================
// 钉钉 JSAPI 鉴权(dd.config 签名)
// 用于前端调用需要鉴权的 JSAPI(如 saveFileToDingTalk 转存文件到钉盘)
// ============================================================
let jsapiTicketCache = { ticket: null, expire: 0 }

async function getJsapiTicket(c) {
  const now = Date.now()
  if (jsapiTicketCache.ticket && now < jsapiTicketCache.expire - 60000) return jsapiTicketCache.ticket
  const token = await getDingtalkAccessToken(c)
  const res = await fetch(`https://oapi.dingtalk.com/get_jsapi_ticket?access_token=${token}`)
  const data = await res.json()
  if (data.errcode !== 0 || !data.ticket) {
    throw new Error('获取 jsapi_ticket 失败: ' + (data.errmsg || JSON.stringify(data)))
  }
  jsapiTicketCache = { ticket: data.ticket, expire: now + (data.expires_in || 7200) * 1000 }
  return data.ticket
}

// SHA-256 十六进制
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function safeDecode(u) {
  try { return decodeURIComponent(u) } catch (e) { return u }
}

// 前端获取 dd.config 所需签名参数
app.get('/api/dingtalk/jsapi-config', async (c) => {
  try {
    const rawUrl = c.req.query('url') || ''
    const cleanUrl = rawUrl.split('#')[0] // 不含 # 及其后部分
    const ticket = await getJsapiTicket(c)
    const nonceStr = Math.random().toString(36).slice(2, 16)
    const timeStamp = String(Math.floor(Date.now() / 1000))
    const plain = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timeStamp}&url=${safeDecode(cleanUrl)}`
    const signature = await sha256Hex(plain)
    return c.json({
      agentId: env(c, 'APP_AGENT_ID'),
      corpId: env(c, 'DINGTALK_CORP_ID'),
      timeStamp,
      nonceStr,
      signature
    })
  } catch (e) {
    return c.json({ message: e.message || '获取钉钉鉴权签名失败' }, 500)
  }
})

// 同步组织成员的核心函数(可被 login 和 /api/users/sync 复用)
async function syncOrgMembers(c) {
  const token = await getDingtalkAccessToken(c)
  const deptRes = await fetch(`https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dept_id: 1 })
  })
  const deptData = await deptRes.json()
  if (deptData.errcode !== 0) return { total: 0, created: 0, skipped: 0, errors: [JSON.stringify(deptData)] }
  const deptIds = [1, ...(deptData.result || []).map(d => d.dept_id)]

  const allMembers = new Map()
  for (const deptId of deptIds) {
    let cursor = 0
    let hasMore = true
    while (hasMore) {
      const uRes = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/list?access_token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dept_id: deptId, cursor, size: 100 })
      })
      const uData = await uRes.json()
      if (uData.errcode !== 0) break
      const users = uData.result?.list || []
      for (const u of users) {
        if (u.userid && !allMembers.has(u.userid)) {
          allMembers.set(u.userid, {
            dingtalk_user_id: u.userid,
            name: u.name || '钉钉用户',
            avatar_url: u.avatar || '',
            union_id: u.unionid || null
          })
        }
      }
      hasMore = uData.result?.has_more || false
      cursor = uData.result?.next_cursor || 0
    }
  }

  // 一次性查出所有已存在的 dingtalk_user_id,避免逐人查询浪费子请求
  const existingRows = await adminFetch(c, `users?select=dingtalk_user_id&limit=1000`) || []
  const existingIds = new Set(existingRows.map(r => r.dingtalk_user_id))

  const results = { total: allMembers.size, created: 0, skipped: 0, errors: [] }
  for (const [userid, member] of allMembers) {
    try {
      if (existingIds.has(userid)) {
        results.skipped++
        continue
      }
      const email = virtualEmail(userid)
      const password = await derivePassword(c, userid)
      const created = await adminCreateUser(c, {
        email, password, email_confirm: true,
        user_metadata: { name: member.name, avatar_url: member.avatar_url, dingtalk_user_id: userid }
      })
      if (!created.id) { results.errors.push(`${member.name}: 创建失败`); continue }
      try {
        await adminFetch(c, 'users', {
          method: 'POST',
          body: JSON.stringify({
            id: created.id, dingtalk_user_id: userid,
            name: member.name, avatar_url: member.avatar_url, union_id: member.union_id
          })
        })
      } catch (e) {
        await adminFetch(c, `users?id=eq.${created.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            dingtalk_user_id: userid, name: member.name,
            avatar_url: member.avatar_url, union_id: member.union_id
          })
        })
      }
      existingIds.add(userid)
      results.created++
    } catch (e) {
      results.errors.push(`${member.name}: ${e.message}`)
    }
  }
  return results
}

app.post('/api/auth/login', async (c) => {
  try {
    const body = await c.req.json()
    const { authCode } = body
    if (!authCode) return c.json({ message: '缺少 authCode' }, 400)

    let dtUser
    if (authCode.startsWith('mock_')) {
      dtUser = { dingtalk_user_id: authCode, name: '调试用户', avatar_url: '', union_id: null }
    } else {
      dtUser = await getDingtalkUserByAuthCode(c, authCode)
    }
    const session = await ensureSupabaseUser(c, dtUser)
    // 真实用户登录时,后台异步同步组织成员(不阻塞登录响应)
    if (!authCode.startsWith('mock_')) {
      c.executionCtx.waitUntil(syncOrgMembers(c).catch(e => console.error('[auto-sync]', e)))
    }
    return c.json(session)
  } catch (e) {
    console.error('[login]', e)
    return c.json({ message: e.message }, 500)
  }
})

// 列表
app.get('/api/tasks', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const status = c.req.query('status')
    // 关键词过滤放在 Worker 内做:直接把中文拼进 Supabase 的 ilike 会导致 URL 编码错误(500)
    const keyword = (c.req.query('keyword') || '').trim().toLowerCase()
    const matchKeyword = (t) => !keyword
      || (t.title || '').toLowerCase().includes(keyword)
      || (t.description || '').toLowerCase().includes(keyword)
    const filterKw = (list) => (list || []).filter(matchKeyword)

    const myAssigns = await adminFetch(c, `task_assignees?select=task_id&user_id=eq.${userId}`)
    const myTaskIds = (myAssigns || []).map(a => a.task_id)

    const idList = myTaskIds.length
      ? myTaskIds.map(id => `id.eq.${id}`).join(',')
      : 'id.eq.00000000-0000-0000-0000-000000000000'
    let orCond = `creator_id.eq.${userId},assignee_id.eq.${userId},reviewer_id.eq.${userId},${idList}`

    // select 带 department_head join + tags(department_head_id 列可能不存在,失败时回退)
    const selectClause = `select=*,creator:users!tasks_creator_id_fkey(id,name,avatar_url),assignee:users!tasks_assignee_id_fkey(id,name,avatar_url),reviewer:users!tasks_reviewer_id_fkey(id,name,avatar_url),department_head:users!tasks_department_head_id_fkey(id,name,avatar_url),tags:task_tags(tag_id,tag:tags(id,name,color))`
    const selectClauseFallback = `select=*,creator:users!tasks_creator_id_fkey(id,name,avatar_url),assignee:users!tasks_assignee_id_fkey(id,name,avatar_url),reviewer:users!tasks_reviewer_id_fkey(id,name,avatar_url),tags:task_tags(tag_id,tag:tags(id,name,color))`

    if (status === 'todo') {
      // "待办"智能过滤:当前用户需要操作的任务(条件本身已限定用户,无需再叠加 orCond)
      // - 我是负责人 AND 状态是 todo
      // - 我是负责人 AND 状态是 rejected
      // - 我是审批人 AND 状态是 pending_review
      // - 我是创建人 AND 状态是 done AND task_type=team(班组任务创建人可关闭)
      // - 我是部门主任 AND 状态是 done AND task_type=department(部门任务由部门主任关闭)
      const todoCond = [
        `and(assignee_id.eq.${userId},status.eq.todo)`,
        `and(assignee_id.eq.${userId},status.eq.rejected)`,
        `and(reviewer_id.eq.${userId},status.eq.pending_review)`,
        `and(creator_id.eq.${userId},status.eq.done,task_type.in.(team,team_a,team_b))`,
        `and(department_head_id.eq.${userId},status.eq.done,task_type.eq.department)`
      ].join(',')
      const todoUrl = `tasks?${selectClause}&or=(${todoCond})&order=created_at.desc`
      try {
        const data = await adminFetch(c, todoUrl)
        return c.json(filterKw(data))
      } catch (e) {
        // task_type/department_head_id 列可能不存在,回退:去掉相关条件,且不带 department_head join
        const todoFallback = [
          `and(assignee_id.eq.${userId},status.eq.todo)`,
          `and(assignee_id.eq.${userId},status.eq.rejected)`,
          `and(reviewer_id.eq.${userId},status.eq.pending_review)`
        ].join(',')
        const fallbackUrl = `tasks?${selectClauseFallback}&or=(${todoFallback})&order=created_at.desc`
        const data = await adminFetch(c, fallbackUrl)
        return c.json(filterKw(data))
      }
    }

    // 其他状态:用户相关 + 状态过滤
    let url = `tasks?${selectClause}&or=(${orCond})&order=created_at.desc`
    if (status && status !== 'all') url += `&status=eq.${status}`

    try {
      const data = await adminFetch(c, url)
      return c.json(filterKw(data))
    } catch (e) {
      // department_head_id 列可能不存在,回退不带 department_head join
      let fallbackUrl = `tasks?${selectClauseFallback}&or=(${orCond})&order=created_at.desc`
      if (status && status !== 'all') fallbackUrl += `&status=eq.${status}`
      const data = await adminFetch(c, fallbackUrl)
      return c.json(filterKw(data))
    }
  } catch (e) {
    console.error('[list tasks]', e)
    return c.json({ message: e.message }, 500)
  }
})

// 任务计数(必须在 /api/tasks/:id 之前定义,否则 'counts' 会被当作 :id 匹配)
app.get('/api/tasks/counts', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const myAssigns = await adminFetch(c, `task_assignees?select=task_id&user_id=eq.${userId}`)
    const myTaskIds = (myAssigns || []).map(a => a.task_id)
    const idList = myTaskIds.length
      ? myTaskIds.map(id => `id.eq.${id}`).join(',')
      : 'id.eq.00000000-0000-0000-0000-000000000000'
    const orCond = `creator_id.eq.${userId},assignee_id.eq.${userId},reviewer_id.eq.${userId},${idList}`

    // 用最简 select 避免外键关系不存在导致报错
    const selectClause = `select=*`

    // 全部任务计数
    let allUrl = `tasks?${selectClause}&or=(${orCond})`
    // 用 select=count 方式获取总数不行,直接查所有再前端算
    const allData = await adminFetch(c, allUrl) || []

    const counts = {
      all: allData.length,
      todo: 0,
      in_progress: 0,
      pending_review: 0,
      done: 0,
      rejected: 0,
      closed: 0
    }
    for (const t of allData) {
      if (counts[t.status] !== undefined) counts[t.status]++
    }

    // 待办计数(用 todo 过滤条件)
    const todoCond = [
      `and(assignee_id.eq.${userId},status.eq.todo)`,
      `and(assignee_id.eq.${userId},status.eq.rejected)`,
      `and(reviewer_id.eq.${userId},status.eq.pending_review)`,
      `and(creator_id.eq.${userId},status.eq.done,task_type.in.(team,team_a,team_b))`,
      `and(department_head_id.eq.${userId},status.eq.done,task_type.eq.department)`
    ].join(',')
    let todoUrl = `tasks?${selectClause}&or=(${todoCond})`
    try {
      const todoData = await adminFetch(c, todoUrl) || []
      counts.todo = todoData.length
    } catch (e) {
      const todoFallback = [
        `and(assignee_id.eq.${userId},status.eq.todo)`,
        `and(assignee_id.eq.${userId},status.eq.rejected)`,
        `and(reviewer_id.eq.${userId},status.eq.pending_review)`
      ].join(',')
      let fallbackUrl = `tasks?${selectClause}&or=(${todoFallback})`
      const todoData = await adminFetch(c, fallbackUrl) || []
      counts.todo = todoData.length
    }

    return c.json(counts)
  } catch (e) {
    console.error('[counts]', e)
    return c.json({ message: e.message }, 500)
  }
})

// 详情
app.get('/api/tasks/:id', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const id = c.req.param('id')
    // 三级 fallback:完整 join → 简化 join(去掉 DH+subtasks) → 最简 join
    const selectFull = `*,creator:users!tasks_creator_id_fkey(id,name,avatar_url),assignee:users!tasks_assignee_id_fkey(id,name,avatar_url),reviewer:users!tasks_reviewer_id_fkey(id,name,avatar_url),department_head:users!tasks_department_head_id_fkey(id,name,avatar_url),assignees:task_assignees(user_id,role,user:users(id,name,avatar_url)),flows:task_flows(id,from_status,to_status,comment,created_at,operator:users(name,avatar_url)),subtasks:tasks!tasks_parent_id_fkey(id,title,status,priority,assignee:users!tasks_assignee_id_fkey(id,name))`
    const selectMid = `*,creator:users!tasks_creator_id_fkey(id,name,avatar_url),assignee:users!tasks_assignee_id_fkey(id,name,avatar_url),reviewer:users!tasks_reviewer_id_fkey(id,name,avatar_url),assignees:task_assignees(user_id,role,user:users(id,name,avatar_url)),flows:task_flows(id,from_status,to_status,comment,created_at,operator:users(name,avatar_url))`
    const selectBasic = `*,creator:users!tasks_creator_id_fkey(id,name,avatar_url),assignee:users!tasks_assignee_id_fkey(id,name,avatar_url),reviewer:users!tasks_reviewer_id_fkey(id,name,avatar_url)`
    let data
    try {
      data = await adminFetch(c, `tasks?id=eq.${id}&select=${selectFull}`)
    } catch (e1) {
      try {
        data = await adminFetch(c, `tasks?id=eq.${id}&select=${selectMid}`)
      } catch (e2) {
        data = await adminFetch(c, `tasks?id=eq.${id}&select=${selectBasic}`)
      }
    }
    if (!data || !data.length) return c.json({ message: '任务不存在' }, 404)
    const task = data[0]

    // 如果 selectFull 失败,单独查 subtasks
    if (!task.subtasks) {
      try {
        task.subtasks = await adminFetch(c, `tasks?parent_id=eq.${id}&select=id,title,status,priority`) || []
      } catch (e) { task.subtasks = [] }
    }
    // 如果 selectFull 失败,单独查 department_head
    if (!task.department_head && task.department_head_id) {
      try {
        const dh = await adminFetch(c, `users?id=eq.${task.department_head_id}&select=id,name,avatar_url`)
        task.department_head = dh && dh[0] ? dh[0] : null
      } catch (e) {}
    }

    // 查当前用户是否管理员(放在 isMember 判断之前,管理员可以访问所有任务)
    let isAdmin = false
    try {
      const adminCheck = await adminFetch(c, `users?id=eq.${userId}&select=is_admin`)
      isAdmin = adminCheck && adminCheck.length && adminCheck[0].is_admin === true
    } catch (e) {}
    task._isAdmin = isAdmin

    const isMember = isAdmin
      || task.creator_id === userId
      || task.assignee_id === userId
      || task.reviewer_id === userId
      || task.department_head_id === userId
      || (task.assignees || []).some(a => a.user_id === userId)
    if (!isMember) return c.json({ message: '无权访问该任务' }, 403)

    return c.json(task)
  } catch (e) {
    console.error('[get task]', e)
    return c.json({ message: e.message }, 500)
  }
})

// 创建
app.post('/api/tasks', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const body = await c.req.json()
    const { title, description, priority, assignee_id, reviewer_id, due_date, assignee_ids, task_type, department_head_id, parent_id } = body
    if (!title) return c.json({ message: '标题必填' }, 400)

    const finalType = task_type || 'department'
    // 建任务时没指定部门负责人 → 按分类对应的职务自动带出(部门任务→部门主任,运行一值→一值值长)
    const headId = department_head_id || await deriveHeadByType(c, finalType)

    const basePayload = {
      title, description,
      priority: priority || null,
      status: 'todo',
      creator_id: userId,
      assignee_id, reviewer_id, due_date,
      parent_id: parent_id || null
    }

    let task
    try {
      // 先带 task_type + department_head_id 插入
      const tasks = await adminFetch(c, 'tasks', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload, task_type: finalType, department_head_id: headId || null })
      })
      task = Array.isArray(tasks) ? tasks[0] : tasks
    } catch (e) {
      // department_head_id 列可能不存在,重试只带 task_type
      try {
        const tasks = await adminFetch(c, 'tasks', {
          method: 'POST',
          body: JSON.stringify({ ...basePayload, task_type: finalType })
        })
        task = Array.isArray(tasks) ? tasks[0] : tasks
      } catch (e2) {
        // task_type 列也不存在,重试不带 task_type
        const tasks = await adminFetch(c, 'tasks', {
          method: 'POST',
          body: JSON.stringify(basePayload)
        })
        task = Array.isArray(tasks) ? tasks[0] : tasks
      }
    }
    if (!task) return c.json({ message: '创建失败' }, 500)

    if (assignee_ids?.length) {
      await adminFetch(c, 'task_assignees', {
        method: 'POST',
        body: JSON.stringify(
          assignee_ids.map(uid => ({ task_id: task.id, user_id: uid, role: 'assignee' }))
        )
      })
    }
    await adminFetch(c, 'task_logs', {
      method: 'POST',
      body: JSON.stringify({
        task_id: task.id, operator_id: userId, action: 'create',
        detail: { title: task.title }
      })
    })

    // 发钉钉工作通知给负责人
    const creatorData = await adminFetch(c, `users?id=eq.${userId}&select=name`)
    const creatorName = creatorData && creatorData[0] ? creatorData[0].name : '系统'
    await notifyTaskEvent(c, task, 'assign', userId, creatorName, assignee_ids || [])

    return c.json(task)
  } catch (e) {
    console.error('[create task]', e)
    return c.json({ message: e.message }, 500)
  }
})

// 更新
app.put('/api/tasks/:id', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const body = await c.req.json()
    const { title, description, priority, assignee_id, reviewer_id, due_date, task_type, department_head_id, assignee_ids } = body

    const exist = await adminFetch(c, `tasks?id=eq.${id}&select=creator_id,department_head_id,reviewer_id`)
    if (!exist || !exist.length) return c.json({ message: '任务不存在' }, 404)

    // 管理员 / 创建人 / 部门主任 / 审批人 可编辑
    let isAdmin = false
    try {
      const adminCheck = await adminFetch(c, `users?id=eq.${userId}&select=is_admin`)
      isAdmin = adminCheck && adminCheck.length && adminCheck[0].is_admin === true
    } catch (e) {}
    const t = exist[0]
    const canModify = t.creator_id === userId || t.department_head_id === userId || t.reviewer_id === userId || isAdmin
    if (!canModify) return c.json({ message: '只有创建人、部门审批、审批人或管理员能修改' }, 403)

    const updatePayload = { title, description, priority, assignee_id, reviewer_id, due_date }
    if (task_type) updatePayload.task_type = task_type
    if (department_head_id !== undefined) updatePayload.department_head_id = department_head_id || null

    const updated = await adminFetch(c, `tasks?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updatePayload)
    })

    // 更新协作者
    if (assignee_ids !== undefined) {
      await adminFetch(c, `task_assignees?task_id=eq.${id}`, { method: 'DELETE' })
      if (assignee_ids.length) {
        await adminFetch(c, 'task_assignees', {
          method: 'POST',
          body: JSON.stringify(assignee_ids.map(uid => ({ task_id: id, user_id: uid, role: 'assignee' })))
        })
      }
    }

    // 记录日志
    await adminFetch(c, 'task_logs', {
      method: 'POST',
      body: JSON.stringify({ task_id: id, operator_id: userId, action: 'update', detail: { fields: Object.keys(updatePayload) } })
    })

    return c.json(Array.isArray(updated) ? updated[0] : updated)
  } catch (e) {
    console.error('[update task]', e)
    return c.json({ message: e.message }, 500)
  }
})

// 删除(仅创建人/管理员可删)
app.delete('/api/tasks/:id', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const exist = await adminFetch(c, `tasks?id=eq.${id}&select=creator_id`)
    if (!exist || !exist.length) return c.json({ message: '任务不存在' }, 404)
    const t = exist[0]
    // 检查是否管理员
    let isAdmin = false
    try {
      const adminCheck = await adminFetch(c, `users?id=eq.${userId}&select=is_admin`)
      isAdmin = adminCheck && adminCheck.length && adminCheck[0].is_admin === true
    } catch (e) {
      isAdmin = false
    }
    const canDelete = isAdmin || t.creator_id === userId
    if (!canDelete) return c.json({ message: '只有创建人或管理员能删除' }, 403)

    await adminFetch(c, `tasks?id=eq.${id}`, { method: 'DELETE' })
    return c.json({ ok: true })
  } catch (e) {
    console.error('[delete task]', e)
    return c.json({ message: e.message }, 500)
  }
})

// 状态流转(带权限控制)
app.post('/api/tasks/:id/transition', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const body = await c.req.json()
    const { to_status, comment, attachments } = body

    // 新的工作流状态流转规则
    const FLOW = {
      todo: ['in_progress'],                 // 待办 → 进行中:负责人开始执行
      in_progress: ['pending_review'],       // 进行中 → 待审核:负责人提交
      pending_review: ['done', 'rejected'], // 待审核 → 已完成/已驳回:审批人操作
      rejected: ['in_progress'],            // 已驳回 → 进行中:负责人重新执行
      done: ['closed'],                     // 已完成 → 已关闭:部门任务由部门主任关闭,班组任务由创建人关闭
      closed: []
    }

    // 每个状态流转允许的操作人
    const PERMISSIONS = {
      'todo->in_progress': 'assignee',            // 负责人开始执行
      'in_progress->pending_review': 'assignee',   // 负责人提交审核
      'pending_review->done': 'reviewer',          // 审批人通过
      'pending_review->rejected': 'reviewer',      // 审批人驳回
      'rejected->in_progress': 'assignee',         // 负责人重新执行
      'done->closed': 'department_head',           // 部门任务:部门主任关闭;班组任务在下方动态改为 creator
    }

    // 用 * 查询,task_type/department_head_id 列可能不存在
    const data = await adminFetch(c, `tasks?id=eq.${id}&select=*`)
    if (!data || !data.length) return c.json({ message: '任务不存在' }, 404)
    const task = data[0]
    if (!FLOW[task.status]?.includes(to_status)) {
      return c.json({ message: `不允许从 ${task.status} 流转到 ${to_status}` }, 400)
    }

    // 权限检查
    const action = `${task.status}->${to_status}`
    let requiredRole = PERMISSIONS[action]
    // done -> closed:部门任务由部门主任关闭,班组任务(及 task_type 为空时)由创建人关闭
    if (action === 'done->closed') {
      requiredRole = task.task_type === 'department' ? 'department_head' : 'creator'
    }

    // 管理员可以执行任何流转
    let isAdmin = false
    try {
      const adminCheck = await adminFetch(c, `users?id=eq.${userId}&select=is_admin`)
      isAdmin = adminCheck && adminCheck.length && adminCheck[0].is_admin === true
    } catch (e) {}

    if (requiredRole && !isAdmin) {
      let allowed = false
      let requiredName = ''
      if (requiredRole === 'creator') {
        allowed = task.creator_id === userId
        requiredName = '创建人'
      } else if (requiredRole === 'reviewer') {
        allowed = task.reviewer_id === userId
        requiredName = '审批人'
      } else if (requiredRole === 'assignee') {
        allowed = task.assignee_id === userId
        requiredName = '负责人'
      } else if (requiredRole === 'department_head') {
        allowed = task.department_head_id === userId
        requiredName = '部门审批'
      }
      if (!allowed) {
        return c.json({ message: `只有${requiredName}能执行此操作` }, 403)
      }
    }

    // done -> closed:部门任务(部门主任关闭)和班组任务(创建人关闭)都可关闭,权限已按 task_type 判断

    const updated = await adminFetch(c, `tasks?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: to_status })
    })
    await adminFetch(c, 'task_flows', {
      method: 'POST',
      body: JSON.stringify({
        task_id: id, from_status: task.status, to_status,
        comment: comment || null, operator_id: userId
      })
    })

    // 本次流转附带的附件(拍照/文件)
    if (Array.isArray(attachments) && attachments.length) {
      for (const a of attachments) {
        if (!a || !a.file_url) continue
        try {
          await adminFetch(c, 'task_attachments', {
            method: 'POST',
            body: JSON.stringify({
              task_id: id, uploader_id: userId,
              file_name: a.file_name || '附件', file_url: a.file_url,
              file_size: a.file_size || 0, file_type: a.file_type || ''
            })
          })
        } catch (e) {}
      }
    }

    // 发钉钉通知
    const updatedTask = Array.isArray(updated) ? updated[0] : updated
    const operatorData = await adminFetch(c, `users?id=eq.${userId}&select=name`)
    const operatorName = operatorData && operatorData[0] ? operatorData[0].name : '系统'

    // 状态流转时通知相关人
    let event = null
    if (to_status === 'pending_review') event = 'review'   // 提交审核 → 审批人
    else if (to_status === 'done') event = 'approve'       // 审批通过 → 负责人 + 创建人
    else if (to_status === 'rejected') event = 'reject'    // 驳回 → 负责人
    else if (to_status === 'closed') event = 'close'       // 关闭 → 创建人
    if (event) {
      await notifyTaskEvent(c, task, event, userId, operatorName)
    }

    return c.json({ ok: true, task: updatedTask })
  } catch (e) {
    console.error('[transition]', e)
    return c.json({ message: e.message }, 500)
  }
})

// 一键完成（跳过流转规则，直接改为 done）
app.post('/api/tasks/:id/quick-complete', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const comment = body.comment || '一键完成'

    const data = await adminFetch(c, `tasks?id=eq.${id}&select=*`)
    if (!data || !data.length) return c.json({ message: '任务不存在' }, 404)
    const task = data[0]
    if (task.status === 'done' || task.status === 'closed') {
      return c.json({ message: '任务已完成或关闭' }, 400)
    }

    await adminFetch(c, `tasks?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' })
    })
    await adminFetch(c, 'task_flows', {
      method: 'POST',
      body: JSON.stringify({
        task_id: id, from_status: task.status, to_status: 'done',
        comment, operator_id: userId
      })
    })

    // 通知创建人：任务已完成
    const opData = await adminFetch(c, `users?id=eq.${userId}&select=name`)
    const opName = opData && opData[0] ? opData[0].name : '系统'
    await notifyTaskEvent(c, task, 'complete', userId, opName)

    return c.json({ ok: true })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 当前登录用户信息(含 is_admin)
app.get('/api/me', requireUser, async (c) => {
  const userId = c.get('userId')
  // duty 列可能还没加(见 sql/migration_v3.sql),失败时回退
  try {
    const data = await adminFetch(c, `users?id=eq.${userId}&select=id,name,avatar_url,is_admin,dingtalk_user_id,duty`)
    const user = data && data.length ? data[0] : { id: userId, name: '未知用户', is_admin: false, duty: 'member' }
    return c.json(user)
  } catch (e) {
    try {
      const data = await adminFetch(c, `users?id=eq.${userId}&select=id,name,avatar_url,is_admin,dingtalk_user_id`)
      const user = data && data.length ? { duty: 'member', ...data[0] } : { id: userId, name: '未知用户', is_admin: false, duty: 'member' }
      return c.json(user)
    } catch (e2) {
      return c.json({ id: userId, name: '未知用户', is_admin: false, duty: 'member' }, 200)
    }
  }
})

// users
app.get('/api/users', requireUser, async (c) => {
  // duty 列可能还没加,失败时回退
  let data = null
  try {
    data = await adminFetch(c, 'users?select=id,name,avatar_url,dingtalk_user_id,duty,is_admin&order=name.asc')
  } catch (e) {
    data = await adminFetch(c, 'users?select=id,name,avatar_url,dingtalk_user_id,is_admin&order=name.asc')
  }
  // 过滤掉“调试登录”产生的 mock 账号,避免出现在成员选择列表(它们也收不到钉钉通知)
  const list = (data || []).filter(u => !String(u.dingtalk_user_id || '').startsWith('mock_'))
  return c.json(list)
})

// ============================================================
// 职务(部门主任 / 值长)与每日提醒
// ============================================================
const DUTY_VALUES = ['department_head', 'team_a_lead', 'team_b_lead', 'member']
// 任务分类 → 对应职务(用于建任务时自动带出部门负责人)
// 注意:只有「部门任务」会自动带出负责人。部门任务的 department_head_id 就是"部门审批人"。
//      运行一值/二值 的班组任务,负责人是下面单独选的,不在这里兜底,避免改动原有创建流程。
const TYPE_TO_DUTY = { department: 'department_head' }
const DIGEST_TYPES = ['department', 'team_a', 'team_b']

// 读当前用户的权限信息(is_admin / duty),duty 列不存在时按 member 处理
async function getActor(c, userId) {
  try {
    const d = await adminFetch(c, `users?id=eq.${userId}&select=id,is_admin,duty`)
    return d && d[0] ? d[0] : { id: userId, is_admin: false, duty: 'member' }
  } catch (e) {
    try {
      const d = await adminFetch(c, `users?id=eq.${userId}&select=id,is_admin`)
      return d && d[0] ? { ...d[0], duty: 'member' } : { id: userId, is_admin: false, duty: 'member' }
    } catch (e2) {
      return { id: userId, is_admin: false, duty: 'member' }
    }
  }
}

// 每日提醒的配置权限:管理员 / 部门主任 / 运行一值值长 / 运行二值值长
function canManageDigest(actor) {
  return actor.is_admin === true ||
    ['department_head', 'team_a_lead', 'team_b_lead'].includes(actor.duty)
}

// 按任务分类推导部门负责人:只有当该职务唯一匹配时才带出,避免选错人
async function deriveHeadByType(c, taskType) {
  const duty = TYPE_TO_DUTY[taskType]
  if (!duty) return null
  try {
    const rows = await adminFetch(c, `users?duty=eq.${duty}&select=id&limit=2`)
    return rows && rows.length === 1 ? rows[0].id : null
  } catch (e) {
    return null
  }
}

// 设置某个用户的职务(仅管理员)
app.put('/api/users/:id/duty', requireUser, async (c) => {
  const actor = await getActor(c, c.get('userId'))
  if (actor.is_admin !== true) return c.json({ message: '只有管理员可以设置职务' }, 403)
  const body = await c.req.json().catch(() => ({}))
  if (!DUTY_VALUES.includes(body.duty)) return c.json({ message: '职务值不合法' }, 400)
  try {
    await adminFetch(c, `users?id=eq.${c.req.param('id')}`, {
      method: 'PATCH',
      body: JSON.stringify({ duty: body.duty })
    })
    return c.json({ ok: true, duty: body.duty })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 设置/取消管理员(仅管理员)
app.put('/api/users/:id/admin', requireUser, async (c) => {
  const actor = await getActor(c, c.get('userId'))
  if (actor.is_admin !== true) return c.json({ message: '只有管理员可以设置管理员' }, 403)
  const body = await c.req.json().catch(() => ({}))
  const isAdmin = body.is_admin === true
  try {
    await adminFetch(c, `users?id=eq.${c.req.param('id')}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_admin: isAdmin })
    })
    return c.json({ ok: true, is_admin: isAdmin })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 当前用户的每日提醒配置 + 是否有权限
app.get('/api/digest-settings', requireUser, async (c) => {
  const userId = c.get('userId')
  const actor = await getActor(c, userId)
  let setting = null
  try {
    const rows = await adminFetch(c, `daily_digest_settings?user_id=eq.${userId}&select=user_id,enabled,types,hour`)
    setting = rows && rows[0] ? rows[0] : null
  } catch (e) {
    // 表还没建(sql/migration_v3.sql),按未配置处理
  }
  return c.json({
    allowed: canManageDigest(actor),
    is_admin: actor.is_admin === true,
    duty: actor.duty || 'member',
    setting: setting || { user_id: userId, enabled: false, types: [], hour: 8 }
  })
})

app.put('/api/digest-settings', requireUser, async (c) => {
  const userId = c.get('userId')
  const actor = await getActor(c, userId)
  if (!canManageDigest(actor)) return c.json({ message: '没有权限配置每日提醒' }, 403)
  const body = await c.req.json().catch(() => ({}))
  const enabled = body.enabled === true
  const types = Array.isArray(body.types) ? body.types.filter(t => DIGEST_TYPES.includes(t)) : []
  const hour = Number.isInteger(body.hour) ? Math.min(23, Math.max(0, body.hour)) : 8
  try {
    await adminFetch(c, 'daily_digest_settings', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ user_id: userId, enabled, types, hour, updated_at: new Date().toISOString() })
    })
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 同步组织成员:调用钉钉通讯录 API,把组织里所有人拉到数据库
app.post('/api/users/sync', requireUser, async (c) => {
  try {
    const results = await syncOrgMembers(c)
    return c.json(results)
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// ============================================================
// 任务附件
// ============================================================
app.get('/api/tasks/:id/attachments', requireUser, async (c) => {
  try {
    const id = c.req.param('id')
    const data = await adminFetch(c, `task_attachments?task_id=eq.${id}&select=id,task_id,uploader_id,file_name,file_url,file_size,file_type,created_at&order=created_at.desc`)
    return c.json(data || [])
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

app.post('/api/tasks/:id/attachments', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const body = await c.req.json()
    const { file_name, file_url, file_size, file_type } = body
    if (!file_name || !file_url) return c.json({ message: '文件名和URL必填' }, 400)

    const data = await adminFetch(c, 'task_attachments', {
      method: 'POST',
      body: JSON.stringify({ task_id: id, uploader_id: userId, file_name, file_url, file_size: file_size || 0, file_type: file_type || '' })
    })
    return c.json(Array.isArray(data) ? data[0] : data)
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

app.delete('/api/tasks/:id/attachments/:aid', requireUser, async (c) => {
  try {
    const id = c.req.param('id')
    const aid = c.req.param('aid')
    await adminFetch(c, `task_attachments?id=eq.${aid}&task_id=eq.${id}`, { method: 'DELETE' })
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 上传文件(拍照/文件)到 Supabase Storage,返回可访问 URL
app.post('/api/upload', requireUser, async (c) => {
  try {
    const SUPABASE_URL = env(c, 'SUPABASE_URL')
    const KEY = env(c, 'SUPABASE_SERVICE_ROLE_KEY')
    const BUCKET = 'task-files'

    const form = await c.req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') return c.json({ message: '未收到文件' }, 400)

    // 确保 bucket 存在(公开可读);已存在会报错,忽略
    try {
      await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true })
      })
    } catch (e) {}

    const orig = file.name || 'file'
    const dot = orig.lastIndexOf('.')
    const ext = dot > -1 ? orig.slice(dot).toLowerCase() : ''
    const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`

    const buf = await file.arrayBuffer()
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        authorization: `Bearer ${KEY}`,
        'content-type': file.type || 'application/octet-stream',
        'x-upsert': 'true'
      },
      body: buf
    })
    if (!up.ok) {
      const err = await up.json().catch(() => ({}))
      return c.json({ message: err.message || '上传失败' }, 500)
    }

    return c.json({
      file_url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`,
      file_name: orig,
      file_size: buf.byteLength,
      file_type: file.type || ''
    })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// ============================================================
// 任务评论
// ============================================================
app.get('/api/tasks/:id/comments', requireUser, async (c) => {
  try {
    const id = c.req.param('id')
    const data = await adminFetch(c, `task_comments?task_id=eq.${id}&select=id,task_id,user_id,content,created_at,user:users!task_comments_user_id_fkey(id,name,avatar_url)&order=created_at.asc`)
    return c.json(data || [])
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

app.post('/api/tasks/:id/comments', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const body = await c.req.json()
    const { content } = body
    if (!content) return c.json({ message: '评论内容必填' }, 400)

    const data = await adminFetch(c, 'task_comments', {
      method: 'POST',
      body: JSON.stringify({ task_id: id, user_id: userId, content })
    })
    // 补充返回用户信息
    const result = Array.isArray(data) ? data[0] : data
    if (result) {
      const user = await adminFetch(c, `users?id=eq.${userId}&select=id,name,avatar_url`)
      result.user = user && user[0]
    }
    return c.json(result)
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

app.delete('/api/tasks/:id/comments/:cid', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const cid = c.req.param('cid')
    // 查评论是否属于当前用户
    const exist = await adminFetch(c, `task_comments?id=eq.${cid}&select=user_id`)
    if (!exist || !exist.length) return c.json({ message: '评论不存在' }, 404)
    let isAdmin = false
    try {
      const adminCheck = await adminFetch(c, `users?id=eq.${userId}&select=is_admin`)
      isAdmin = adminCheck && adminCheck.length && adminCheck[0].is_admin === true
    } catch (e) {}
    if (exist[0].user_id !== userId && !isAdmin) return c.json({ message: '只能删除自己的评论' }, 403)
    await adminFetch(c, `task_comments?id=eq.${cid}`, { method: 'DELETE' })
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// ============================================================
// 标签
// ============================================================
app.get('/api/tags', requireUser, async (c) => {
  try {
    const data = await adminFetch(c, 'tags?select=id,name,color&order=name.asc')
    // 查每个标签关联了多少任务
    let counts = {}
    try {
      const tagTasks = await adminFetch(c, 'task_tags?select=tag_id')
      for (const tt of (tagTasks || [])) {
        counts[tt.tag_id] = (counts[tt.tag_id] || 0) + 1
      }
    } catch (e) {}
    const result = (data || []).map(t => ({ ...t, task_count: counts[t.id] || 0 }))
    return c.json(result)
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

app.post('/api/tags', requireUser, async (c) => {
  try {
    const body = await c.req.json()
    const { name, color } = body
    if (!name) return c.json({ message: '标签名必填' }, 400)
    const data = await adminFetch(c, 'tags', {
      method: 'POST',
      body: JSON.stringify({ name, color: color || '#1989fa' })
    })
    return c.json(Array.isArray(data) ? data[0] : data)
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 给任务添加/移除标签
app.post('/api/tasks/:id/tags/:tagId', requireUser, async (c) => {
  try {
    const id = c.req.param('id')
    const tagId = c.req.param('tagId')
    await adminFetch(c, 'task_tags', {
      method: 'POST',
      body: JSON.stringify({ task_id: id, tag_id: tagId }),
      headers: { 'prefer': 'return=minimal' }
    })
    return c.json({ ok: true })
  } catch (e) {
    // 重复添加忽略
    return c.json({ ok: true })
  }
})

app.delete('/api/tasks/:id/tags/:tagId', requireUser, async (c) => {
  try {
    const id = c.req.param('id')
    const tagId = c.req.param('tagId')
    await adminFetch(c, `task_tags?task_id=eq.${id}&tag_id=eq.${tagId}`, { method: 'DELETE' })
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 修改标签
app.put('/api/tags/:id', requireUser, async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { name, color } = body
    const patch = {}
    if (name) patch.name = name
    if (color) patch.color = color
    const data = await adminFetch(c, `tags?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      headers: { 'prefer': 'return=representation' }
    })
    return c.json(Array.isArray(data) ? data[0] : data)
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 删除标签
app.delete('/api/tags/:id', requireUser, async (c) => {
  try {
    const id = c.req.param('id')
    // 先删关联
    await adminFetch(c, `task_tags?tag_id=eq.${id}`, { method: 'DELETE' })
    await adminFetch(c, `tags?id=eq.${id}`, { method: 'DELETE' })
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 子任务列表
app.get('/api/tasks/:id/subtasks', requireUser, async (c) => {
  try {
    const id = c.req.param('id')
    const data = await adminFetch(c, `tasks?parent_id=eq.${id}&select=id,title,status,priority,assignee:users!tasks_assignee_id_fkey(id,name),due_date&order=created_at.asc`)
    return c.json(data || [])
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 统计导出 CSV/Excel(支持 ?token= 便于前端用 window.open 直接下载)
app.get('/api/stats/export', async (c) => {
  // 下载链接无法携带请求头,优先从查询参数取 token,否则用 Authorization
  const qToken = c.req.query('token')
  let token = qToken
  if (!token) {
    const auth = c.req.header('Authorization') || ''
    const m = auth.match(/^Bearer\s+(.+)$/i)
    token = m ? m[1] : ''
  }
  const payload = token ? decodeJwtPayload(token) : null
  if (!payload || !payload.sub) return c.json({ message: '未登录' }, 401)
  c.set('userId', payload.sub)
  try {
    const userId = c.get('userId')
    // 查管理员
    let isAdmin = false
    try {
      const adminCheck = await adminFetch(c, `users?id=eq.${userId}&select=is_admin`)
      isAdmin = adminCheck && adminCheck.length && adminCheck[0].is_admin === true
    } catch (e) {}

    // 管理员看全部,非管理员看自己相关的
    // 尝试带完整关联的查询(含 task_type/department_head/assignees/flows/tags),失败回退到基础版
    const baseCols = 'id,title,description,status,priority,due_date,created_at,updated_at'
    const baseJoins = 'creator:users!tasks_creator_id_fkey(name),assignee:users!tasks_assignee_id_fkey(name),reviewer:users!tasks_reviewer_id_fkey(name)'
    const extraJoins = 'department_head:users!tasks_department_head_id_fkey(name),assignees:task_assignees(role,user:users(name)),flows:task_flows(from_status,to_status,created_at,operator:users(name)),tags:task_tags(tag:tags(name))'
    const order = 'order=created_at.desc'
    const filter = isAdmin ? '' : `or=(creator_id.eq.${userId},assignee_id.eq.${userId},reviewer_id.eq.${userId})&`

    let tasks
    try {
      tasks = await adminFetch(c, `tasks?${filter}select=${baseCols},task_type,${baseJoins},${extraJoins}&${order}`)
    } catch (e1) {
      try {
        tasks = await adminFetch(c, `tasks?${filter}select=${baseCols},${baseJoins},${extraJoins}&${order}`)
      } catch (e2) {
        tasks = await adminFetch(c, `tasks?${filter}select=${baseCols},${baseJoins}&${order}`)
      }
    }
    const list = tasks || []

    const STATUS_LABELS = { draft: '草稿', todo: '待办', pending_review: '待审核', approved: '已通过', rejected: '已驳回', in_progress: '进行中', done: '已完成', cancelled: '已取消', closed: '已关闭' }
    const PRIORITY_LABELS = { daily: '日任务', weekly: '周任务', monthly: '月任务', quarterly: '季度任务', yearly: '年任务' }
    const TASK_TYPE_LABELS = { team: '班组任务', department: '部门任务', personal: '个人任务' }
    const ROLE_LABELS = { assignee: '协作', reviewer: '审核', watcher: '关注' }

    const now = new Date()
    // 从 flows 中推算开始/结束时间
    function getTiming(t) {
      const flows = (t.flows || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      let startAt = null, endAt = null
      for (const f of flows) {
        if (!startAt && (f.to_status === 'in_progress' || f.to_status === 'todo')) {
          startAt = f.created_at
        }
        if (!endAt && (f.to_status === 'done' || f.to_status === 'closed' || f.to_status === 'cancelled')) {
          endAt = f.created_at
        }
      }
      // 没有流转记录时,用 created_at 作为开始
      if (!startAt) startAt = t.created_at
      return { startAt, endAt }
    }

    function daysBetween(a, b) {
      if (!a || !b) return null
      const ms = new Date(b) - new Date(a)
      return Math.ceil(ms / 86400000)
    }

    // 构建每一行的完整数据
    const buildRow = (t) => {
      const { startAt, endAt } = getTiming(t)
      const daysUsed = daysBetween(startAt, endAt || now)
      const daysLeft = (t.due_date && !endAt) ? daysBetween(now, t.due_date) : (endAt ? 0 : null)
      const assignees = (t.assignees || []).map(a => `${a.user?.name || '-'}(${ROLE_LABELS[a.role] || a.role})`).join('、') || '-'
      const flows = (t.flows || [])
        .slice()
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(f => `${f.operator?.name || '-'}:${STATUS_LABELS[f.from_status] || '-'}→${STATUS_LABELS[f.to_status] || f.to_status}`)
        .join('；') || '-'
      const tags = (t.tags || []).map(tg => tg.tag?.name).filter(Boolean).join('、') || '-'
      return {
        id: t.id,
        title: t.title || '',
        description: t.description || '',
        status: STATUS_LABELS[t.status] || t.status,
        priority: PRIORITY_LABELS[t.priority] || t.priority || '',
        taskType: TASK_TYPE_LABELS[t.task_type] || (t.task_type || '-'),
        creator: t.creator?.name || '-',
        assignee: t.assignee?.name || '-',
        reviewer: t.reviewer?.name || '-',
        departmentHead: t.department_head?.name || '-',
        assignees,
        dueDate: t.due_date || '-',
        startAt: startAt ? new Date(startAt).toLocaleString('zh-CN') : '-',
        endAt: endAt ? new Date(endAt).toLocaleString('zh-CN') : '-',
        daysUsed: daysUsed !== null ? `${daysUsed} 天` : '-',
        daysLeft: daysLeft !== null ? `${daysLeft} 天` : '-',
        flows,
        tags,
        createdAt: t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '-',
        updatedAt: t.updated_at ? new Date(t.updated_at).toLocaleString('zh-CN') : '-'
      }
    }

    const rows = list.map(buildRow)

    const stamp = new Date().toISOString().slice(0, 10)
    const format = (c.req.query('format') || 'csv').toLowerCase()

    const HEAD = ['ID', '标题', '描述', '状态', '任务周期', '任务类型', '创建人', '负责人', '审批人', '部门审批', '协作者', '截止日期', '开始时间', '完成时间', '已用天数', '剩余天数', '标签', '流程记录', '创建时间', '更新时间']

    let buf, contentType, filename
    if (format === 'xls') {
      // 用 SheetJS 生成真正的 .xlsx 文件(钉钉/WPS/Excel 均可预览打开)
      const data = rows.map(r => [
        r.id, r.title, r.description, r.status, r.priority, r.taskType,
        r.creator, r.assignee, r.reviewer, r.departmentHead, r.assignees,
        r.dueDate, r.startAt, r.endAt, r.daysUsed, r.daysLeft, r.tags, r.flows,
        r.createdAt, r.updatedAt
      ])
      const ws = XLSX.utils.aoa_to_sheet([HEAD, ...data])
      // 设置列宽
      ws['!cols'] = [
        { wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 20 },
        { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 40 },
        { wch: 18 }, { wch: 18 }
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '任务清单')
      buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      filename = `tasks_${stamp}.xlsx`
    } else {
      const csvRows = rows.map(r => [
        r.id,
        `"${(r.title || '').replace(/"/g, '""')}"`,
        `"${(r.description || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
        r.status, r.priority, r.taskType,
        `"${r.creator}"`, `"${r.assignee}"`, `"${r.reviewer}"`, `"${r.departmentHead}"`, `"${r.assignees}"`,
        r.dueDate, r.startAt, r.endAt, r.daysUsed, r.daysLeft, `"${r.tags}"`, `"${r.flows}"`,
        r.createdAt, r.updatedAt
      ].join(','))
      const csv = '\ufeff' + HEAD.join(',') + '\n' + csvRows.join('\n')
      buf = new TextEncoder().encode(csv).buffer
      contentType = 'text/csv; charset=utf-8'
      filename = `tasks_${stamp}.csv`
    }

    // 上传到 Supabase 公开存储,返回可直接访问的 URL,方便钉钉内置浏览器打开/下载
    try {
      const SUPABASE_URL = env(c, 'SUPABASE_URL')
      const KEY = env(c, 'SUPABASE_SERVICE_ROLE_KEY')
      const BUCKET = 'task-files'
      const path = `exports/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${filename}`
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: {
          apikey: KEY,
          authorization: `Bearer ${KEY}`,
          'content-type': contentType,
          'x-upsert': 'true'
        },
        body: buf
      })
      if (up.ok) {
        const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
        // 加 ?download 让 Supabase 返回 Content-Disposition: attachment,
        // 钉钉会把内容当作"文件"下载(而非网页链接),之后可作为文件转发分享
        const url = `${baseUrl}?download=${encodeURIComponent(filename)}`
        return c.json({ url, filename })
      }
    } catch (e) {
      // 上传失败,回退到直接返回文件流
    }

    // 回退:直接返回文件流
    return new Response(buf, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// stats
app.get('/api/stats', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const tasks = await adminFetch(c, `tasks?select=id,status,priority,created_at,due_date,assignee_id,creator_id,reviewer_id,assignee:users!tasks_assignee_id_fkey(id,name)&or=(creator_id.eq.${userId},assignee_id.eq.${userId},reviewer_id.eq.${userId})`)
    const list = tasks || []
    const stats = { total: list.length, draft: 0, pending_review: 0, in_progress: 0, done: 0, overdue: 0, tasks: list }
    const now = new Date()
    for (const t of list) {
      if (stats[t.status] !== undefined) stats[t.status]++
      if (t.due_date && new Date(t.due_date) < now && t.status !== 'done' && t.status !== 'cancelled') stats.overdue++
    }
    return c.json(stats)
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// notify
app.post('/api/notify/assign', async (c) => {
  try {
    const body = await c.req.json()
    const { taskId, recipientIds, fromName } = body
    // 临时注入 env 到 process 让 notifier 能读
    if (typeof process !== 'undefined' && c.env) {
      for (const k in c.env) {
        if (!process.env[k]) { try { process.env[k] = String(c.env[k]) } catch (e) {} }
      }
    }
    const r = await notifyTask({ taskId, type: 'assign', recipientIds, fromName })
    return c.json(r)
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

app.post('/api/notify/transition', async (c) => {
  try {
    const body = await c.req.json()
    const { taskId, to_status, recipientIds, fromName } = body
    if (typeof process !== 'undefined' && c.env) {
      for (const k in c.env) {
        if (!process.env[k]) { try { process.env[k] = String(c.env[k]) } catch (e) {} }
      }
    }
    const type = to_status === 'approved' ? 'approve'
      : to_status === 'rejected' ? 'reject'
      : to_status === 'done' ? 'complete' : null
    if (!type) return c.json({ skipped: true })
    const r = await notifyTask({ taskId, type, recipientIds, fromName })
    return c.json(r)
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// cron
app.get('/api/cron/check-due-tasks', async (c) => {
  const CRON_SECRET = env(c, 'CRON_SECRET')
  const provided = c.req.query('secret')
  if (CRON_SECRET && provided !== CRON_SECRET) return c.json({ message: 'unauthorized' }, 401)
  if (typeof process !== 'undefined' && c.env) {
    for (const k in c.env) {
      if (!process.env[k]) { try { process.env[k] = String(c.env[k]) } catch (e) {} }
    }
  }
  try {
    // 截止前一天提醒：只挑「截止日期 = 明天」且未完成的任务
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    const tasks = await adminFetch(c, `tasks?status=neq.done&status=neq.cancelled&due_date=gte.${tomorrow}&due_date=lt.${dayAfter}&select=id,assignee_id,reviewer_id,title,due_date`)
    const list = tasks || []
    for (const t of list) {
      try { await notifyTask({ taskId: t.id, type: 'due_remind', recipientIds: [t.assignee_id, t.reviewer_id].filter(Boolean) }) } catch (e) {}
    }
    return c.json({ checked: list.length })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

app.get('/api/cron/check-overdue-tasks', async (c) => {
  const CRON_SECRET = env(c, 'CRON_SECRET')
  const provided = c.req.query('secret')
  if (CRON_SECRET && provided !== CRON_SECRET) return c.json({ message: 'unauthorized' }, 401)
  if (typeof process !== 'undefined' && c.env) {
    for (const k in c.env) {
      if (!process.env[k]) { try { process.env[k] = String(c.env[k]) } catch (e) {} }
    }
  }
  try {
    const now = new Date().toISOString()
    const tasks = await adminFetch(c, `tasks?status=neq.done&status=neq.cancelled&due_date=lt.${now}&select=id,assignee_id,reviewer_id,title,due_date`)
    const list = tasks || []
    for (const t of list) {
      try { await notifyTask({ taskId: t.id, type: 'overdue', recipientIds: [t.assignee_id, t.reviewer_id].filter(Boolean) }) } catch (e) {}
    }
    return c.json({ checked: list.length })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 每日未完成工作提醒:由 cron 每 30 分钟唤醒一次,给「配置时间点到了」的人发一条汇总
// 只在整点那一档发送(cron :00 命中、:30 不命中),所以每人每天只会收到一次
app.get('/api/cron/daily-digest', async (c) => {
  const CRON_SECRET = env(c, 'CRON_SECRET')
  const provided = c.req.query('secret')
  if (CRON_SECRET && provided !== CRON_SECRET) return c.json({ message: 'unauthorized' }, 401)
  if (typeof process !== 'undefined' && c.env) {
    for (const k in c.env) {
      if (!process.env[k]) { try { process.env[k] = String(c.env[k]) } catch (e) {} }
    }
  }
  try {
    // 北京时间 = UTC + 8
    const bj = new Date(Date.now() + 8 * 3600 * 1000)
    const hour = bj.getUTCHours()
    const minute = bj.getUTCMinutes()
    const dayKey = bj.toISOString().slice(0, 10)
    if (minute >= 30) return c.json({ skipped: 'not_top_of_hour', hour, minute })

    let settings = []
    try {
      settings = await adminFetch(c, 'daily_digest_settings?enabled=eq.true&select=user_id,types,hour,last_sent_slot') || []
    } catch (e) {
      return c.json({ skipped: 'no_settings_table', message: e.message })
    }
    const slot = `${dayKey}T${String(hour).padStart(2, '0')}`
    const due = settings.filter(s => Number(s.hour) === hour && s.last_sent_slot !== slot)

    let sent = 0
    for (const s of due) {
      try {
        const md = await buildDigestMarkdown(c, s)
        if (md) {
          await sendDingtalkWorkNotice(c, [s.user_id], `每日未完成工作提醒（${bj.getUTCMonth() + 1}月${bj.getUTCDate()}日）`, md, '')
          sent++
        }
        // 无论有没有未完成任务,都记下已发时段,避免重复检查
        await adminFetch(c, `daily_digest_settings?user_id=eq.${s.user_id}`, {
          method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ last_sent_slot: slot })
        })
      } catch (e) {
        console.warn('[digest] 发送失败', s.user_id, e.message)
      }
    }
    return c.json({ hour, candidates: due.length, sent })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 生成某个人要看的每日汇总(按分类分组),没有未完成任务时返回空串
async function buildDigestMarkdown(c, setting) {
  const types = Array.isArray(setting.types) ? setting.types.filter(t => DIGEST_TYPES.includes(t)) : []
  if (!types.length) return ''
  const rows = await adminFetch(c,
    `tasks?status=not.in.(done,closed,cancelled)&task_type=in.(${types.join(',')})`
    + `&select=id,title,due_date,task_type,assignee:users!tasks_assignee_id_fkey(name),reviewer:users!tasks_reviewer_id_fkey(name)`
    + `&order=due_date.asc.nullslast`)
  const list = rows || []
  if (!list.length) return ''

  const TYPE_CN = { department: '部门任务', team: '班组任务', team_a: '运行一值', team_b: '运行二值' }
  const MAX = 30
  const bjNow = new Date(Date.now() + 8 * 3600 * 1000)
  const todayStr = bjNow.toISOString().slice(0, 10)

  const lineOf = (t) => {
    const parts = []
    if (t.due_date) {
      const d1 = new Date(todayStr + 'T00:00:00Z').getTime()
      const d2 = new Date(String(t.due_date).slice(0, 10) + 'T00:00:00Z').getTime()
      const n = Math.round((d2 - d1) / 86400000)
      parts.push(n > 0 ? `剩 ${n} 天` : (n === 0 ? '今天到期' : `已逾期 ${-n} 天`))
    } else {
      parts.push('无截止日期')
    }
    parts.push(`负责人：${t.assignee?.name || '—'}`)
    parts.push(`审核人：${t.reviewer?.name || '—'}`)
    return `· ${t.title} —— ${parts.join('，')}`
  }

  // 按分类分组;钉钉卡片 markdown 单换行会被合并,所以用空行分隔
  const blocks = []
  let shown = 0
  for (const type of types) {
    const group = list.filter(t => t.task_type === type)
    if (!group.length) continue
    const take = group.slice(0, MAX - shown)
    shown += take.length
    blocks.push(`**${TYPE_CN[type] || type}**（${group.length} 项）`)
    for (const t of take) blocks.push(lineOf(t))
    if (shown >= MAX) break
  }
  const more = list.length > shown ? [`> 还有 ${list.length - shown} 项未列出，请打开任务管理查看`] : []
  return [`**未完成 ${list.length} 项**`, ...blocks, ...more].join('\n\n')
}

export default app
