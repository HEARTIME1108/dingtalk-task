import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { notifyTask } from './notifier.js'

const {
  PORT = 8787,
  DINGTALK_APP_KEY,
  DINGTALK_APP_SECRET,
  DINGTALK_CORP_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  CRON_SECRET            // 定时任务鉴权密钥,自己设一个长随机串
} = process.env

const app = express()
app.use(cors())
app.use(express.json())

// service_role:后端专用,绕过 RLS
// 用 fetch 直接调 REST API,不依赖 supabase-js 库(那个在新版 Supabase 项目里有 RLS 兼容问题)
async function adminFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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

// auth admin 接口
async function adminCreateUser(params) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(params)
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.msg || data.message || '创建用户失败')
  return data
}

async function adminDeleteUser(uid) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  })
  if (!res.ok) throw new Error('删除用户失败')
}

// anonClient 用于密码登录(用 fetch)
async function loginWithPassword(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
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
// 钉钉 access_token 缓存
// ============================================================
let tokenCache = { token: null, expire: 0 }

async function getDingtalkAccessToken() {
  const now = Date.now()
  if (tokenCache.token && now < tokenCache.expire - 60000) return tokenCache.token
  const res = await fetch('https://oapi.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey: DINGTALK_APP_KEY, appSecret: DINGTALK_APP_SECRET })
  })
  const data = await res.json()
  if (!data.accessToken) {
    throw new Error('获取钉钉 access_token 失败: ' + JSON.stringify(data))
  }
  tokenCache = { token: data.accessToken, expire: now + data.expireIn * 1000 }
  return tokenCache.token
}

// ============================================================
// authCode → 钉钉用户(openId + 用户信息)
// ============================================================
async function getDingtalkUserByAuthCode(authCode) {
  // 1) authCode 换 openId(新版免登,无需 access_token)
  const r1 = await fetch('https://oapi.dingtalk.com/v1.0/contact/authUsers/me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authCode })
  })
  const d1 = await r1.json()
  const openId = d1.openId
  if (!openId) throw new Error('authCode 换 openId 失败: ' + JSON.stringify(d1))

  // 2) openId 查用户详情
  const token = await getDingtalkAccessToken()
  const r2 = await fetch(`https://oapi.dingtalk.com/v1.0/contact/users/${openId}`, {
    headers: { 'x-acs-dingtalk-access-token': token }
  })
  const u = await r2.json()
  return {
    dingtalk_user_id: openId,
    name: u.name || '钉钉用户',
    avatar_url: u.avatar || '',
    union_id: u.unionId || null
  }
}

// ============================================================
// Supabase 用户:派生固定邮箱+密码,确保用户存在并返回 token
// ============================================================
function virtualEmail(dtUserId) { return `dt_${dtUserId}@dt.local` }

function derivePassword(dtUserId) {
  // 用 service_role key 派生密码,无需单独的 JWT Secret
  const secret = SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY')
  return crypto
    .createHmac('sha256', secret)
    .update('dt:' + dtUserId)
    .digest('hex')
    .slice(0, 32)
}

async function ensureSupabaseUser(dtUser) {
  const email = virtualEmail(dtUser.dingtalk_user_id)
  const password = derivePassword(dtUser.dingtalk_user_id)

  // 先尝试登录,登录成功直接返回 token
  let loginData
  try {
    loginData = await loginWithPassword(email, password)
    if (loginData.access_token) {
      // 同步 public.users 资料(兜底)——直接 PATCH
      try {
        await adminFetch(`users?id=eq.${loginData.user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: dtUser.name,
            avatar_url: dtUser.avatar_url,
            union_id: dtUser.union_id
          })
        })
      } catch (e) { /* 忽略同步失败 */ }
      return {
        access_token: loginData.access_token,
        refresh_token: loginData.refresh_token,
        user: loginData.user
      }
    }
  } catch (e) {
    // 登录失败,继续走创建流程
  }

  // 登录失败 → 创建 auth 用户
  // 先清理可能残留的 public.users 行(对应 auth 已被删)
  try {
    await adminFetch(`users?dingtalk_user_id=eq.${dtUser.dingtalk_user_id}`, { method: 'DELETE' })
  } catch (e) { /* 忽略 */ }

  const created = await adminCreateUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name: dtUser.name,
      avatar_url: dtUser.avatar_url,
      dingtalk_user_id: dtUser.dingtalk_user_id
    }
  })
  if (!created.id) throw new Error('创建 Supabase 用户失败: ' + (created.message || JSON.stringify(created)))

  // 兜底:触发器可能没正确写,主动 upsert 一次
  try {
    await adminFetch(`users?id=eq.${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        dingtalk_user_id: dtUser.dingtalk_user_id,
        name: dtUser.name,
        avatar_url: dtUser.avatar_url,
        union_id: dtUser.union_id
      })
    })
  } catch (e) {
    // upsert 失败可能是行不存在,改用 POST 插入
    try {
      await adminFetch('users', {
        method: 'POST',
        body: JSON.stringify({
          id: created.id,
          dingtalk_user_id: dtUser.dingtalk_user_id,
          name: dtUser.name,
          avatar_url: dtUser.avatar_url,
          union_id: dtUser.union_id
        })
      })
    } catch (e2) { /* 忽略 */ }
  }

  // 创建后用密码登录拿 token
  const relogin = await loginWithPassword(email, password)
  return {
    access_token: relogin.access_token,
    refresh_token: relogin.refresh_token,
    user: relogin.user
  }
}

async function loginAnon(email, password) {
  const { data, error } = await anonClient.auth.signInWithPassword({ email, password })
  if (error) throw new Error('Supabase 登录失败: ' + error.message)
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: data.user
  }
}

// ============================================================
// 路由
// ============================================================
app.get('/api/health', (req, res) => res.json({ ok: true }))

app.get('/api/auth/config', (req, res) => {
  res.json({ corpId: DINGTALK_CORP_ID })
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { authCode } = req.body
    if (!authCode) return res.status(400).json({ message: '缺少 authCode' })

    let dtUser
    if (authCode.startsWith('mock_')) {
      // 浏览器调试模式
      dtUser = { dingtalk_user_id: authCode, name: '调试用户', avatar_url: '', union_id: null }
    } else {
      dtUser = await getDingtalkUserByAuthCode(authCode)
    }
    const session = await ensureSupabaseUser(dtUser)
    res.json(session)
  } catch (e) {
    console.error('[login]', e)
    res.status(500).json({ message: e.message })
  }
})

// ============================================================
// 中间件:从 Authorization Bearer token 里提取当前用户
// 前端登录后用拿到的 access_token 调后端,后端解 token 拿到 sub(用户 ID)
// 这里只解码 payload 拿 sub,不严格验签(后端在受信任环境,且后端再做权限校验)
// ============================================================
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payloadB64 = parts[1]
    const json = Buffer.from(payloadB64, 'base64').toString('utf8')
    return JSON.parse(json)
  } catch (e) {
    return null
  }
}

async function requireUser(req, res, next) {
  try {
    const auth = req.headers.authorization || ''
    const m = auth.match(/^Bearer\s+(.+)$/i)
    if (!m) return res.status(401).json({ message: '未登录' })
    const payload = decodeJwtPayload(m[1])
    if (!payload || !payload.sub) {
      return res.status(401).json({ message: 'token 无效' })
    }
    req.userId = payload.sub
    next()
  } catch (e) {
    res.status(401).json({ message: 'token 无效: ' + e.message })
  }
}

// ============================================================
// 任务路由(全部用 service_role 绕过 RLS,应用层做权限校验)
// ============================================================

// 列出我能看到的任务
app.get('/api/tasks', requireUser, async (req, res) => {
  try {
    const { status, keyword } = req.query
    // 先查 task_assignees 拿到 user_id = 我 的所有 task_id
    const myAssigns = await adminFetch(`task_assignees?select=task_id&user_id=eq.${req.userId}`)
    const myTaskIds = (myAssigns || []).map(a => a.task_id)

    // 用 or 过滤:(creator=我 OR assignee=我 OR reviewer=我 OR id in myTaskIds)
    // PostgREST 的 or 语法:or=(col1.eq.val1,col2.eq.val2)
    const idList = myTaskIds.length
      ? myTaskIds.map(id => `id.eq.${id}`).join(',')
      : 'id.eq.00000000-0000-0000-0000-000000000000'
    let orCond = `creator_id.eq.${req.userId},assignee_id.eq.${req.userId},reviewer_id.eq.${req.userId},${idList}`

    let url = `tasks?select=*,creator:users!tasks_creator_id_fkey(id,name,avatar_url),assignee:users!tasks_assignee_id_fkey(id,name,avatar_url),reviewer:users!tasks_reviewer_id_fkey(id,name,avatar_url)&or=(${orCond})&order=created_at.desc`
    if (status && status !== 'all') url += `&status=eq.${status}`
    if (keyword) url += `&title=ilike.%${keyword}%`

    const data = await adminFetch(url)
    res.json(data || [])
  } catch (e) {
    console.error('[list tasks]', e)
    res.status(500).json({ message: e.message })
  }
})

// 任务详情
app.get('/api/tasks/:id', requireUser, async (req, res) => {
  try {
    const { id } = req.params
    const data = await adminFetch(
      `tasks?id=eq.${id}&select=*,creator:users!tasks_creator_id_fkey(id,name,avatar_url),assignee:users!tasks_assignee_id_fkey(id,name,avatar_url),reviewer:users!tasks_reviewer_id_fkey(id,name,avatar_url),assignees:task_assignees(user_id,role,user:users(id,name,avatar_url)),flows:task_flows(id,from_status,to_status,comment,created_at,operator:users(name,avatar_url))`
    )
    if (!data || !data.length) return res.status(404).json({ message: '任务不存在' })
    const task = data[0]

    // 权限校验:必须是相关人之一
    const isMember = task.creator_id === req.userId
      || task.assignee_id === req.userId
      || task.reviewer_id === req.userId
      || (task.assignees || []).some(a => a.user_id === req.userId)
    if (!isMember) return res.status(403).json({ message: '无权访问该任务' })

    res.json(task)
  } catch (e) {
    console.error('[get task]', e)
    res.status(500).json({ message: e.message })
  }
})

// 创建任务
app.post('/api/tasks', requireUser, async (req, res) => {
  try {
    const { title, description, priority, assignee_id, reviewer_id, due_date, assignee_ids } = req.body
    if (!title) return res.status(400).json({ message: '标题必填' })

    const tasks = await adminFetch('tasks', {
      method: 'POST',
      body: JSON.stringify({
        title, description,
        priority: priority || 'medium',
        status: 'draft',
        creator_id: req.userId,
        assignee_id, reviewer_id, due_date
      })
    })
    const task = Array.isArray(tasks) ? tasks[0] : tasks
    if (!task) return res.status(500).json({ message: '创建失败' })

    if (assignee_ids?.length) {
      await adminFetch('task_assignees', {
        method: 'POST',
        body: JSON.stringify(
          assignee_ids.map(uid => ({ task_id: task.id, user_id: uid, role: 'assignee' }))
        )
      })
    }
    await adminFetch('task_logs', {
      method: 'POST',
      body: JSON.stringify({
        task_id: task.id, operator_id: req.userId, action: 'create',
        detail: { title: task.title }
      })
    })

    res.json(task)

    // 异步触发通知(失败不影响主流程)
    // 前端会单独调 /api/notify/assign,后端这里不重复触发
  } catch (e) {
    console.error('[create task]', e)
    res.status(500).json({ message: e.message })
  }
})

// 更新任务
app.put('/api/tasks/:id', requireUser, async (req, res) => {
  try {
    const { id } = req.params
    const { title, description, priority, assignee_id, reviewer_id, due_date } = req.body

    // 权限校验:只有 creator 能改
    const exist = await adminFetch(`tasks?id=eq.${id}&select=creator_id`)
    if (!exist || !exist.length) return res.status(404).json({ message: '任务不存在' })
    if (exist[0].creator_id !== req.userId) return res.status(403).json({ message: '只有创建者能修改' })

    const updated = await adminFetch(`tasks?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title, description, priority, assignee_id, reviewer_id, due_date })
    })
    res.json(Array.isArray(updated) ? updated[0] : updated)
  } catch (e) {
    console.error('[update task]', e)
    res.status(500).json({ message: e.message })
  }
})

// 删除任务
app.delete('/api/tasks/:id', requireUser, async (req, res) => {
  try {
    const { id } = req.params
    const exist = await adminFetch(`tasks?id=eq.${id}&select=creator_id`)
    if (!exist || !exist.length) return res.status(404).json({ message: '任务不存在' })
    if (exist[0].creator_id !== req.userId) return res.status(403).json({ message: '只有创建者能删除' })

    await adminFetch(`tasks?id=eq.${id}`, { method: 'DELETE' })
    res.json({ ok: true })
  } catch (e) {
    console.error('[delete task]', e)
    res.status(500).json({ message: e.message })
  }
})

// 状态流转
app.post('/api/tasks/:id/transition', requireUser, async (req, res) => {
  try {
    const { id } = req.params
    const { to_status, comment } = req.body

    const tasksData = await adminFetch(`tasks?id=eq.${id}&select=id,status,creator_id,assignee_id,reviewer_id`)
    if (!tasksData || !tasksData.length) return res.status(404).json({ message: '任务不存在' })
    const task = tasksData[0]
    const isMember = task.creator_id === req.userId
      || task.assignee_id === req.userId
      || task.reviewer_id === req.userId
    if (!isMember) return res.status(403).json({ message: '无权流转该任务' })

    const FLOW = {
      draft: ['pending_review'],
      pending_review: ['approved', 'rejected'],
      approved: ['in_progress'],
      rejected: ['draft'],
      in_progress: ['done', 'cancelled'],
      done: [],
      cancelled: []
    }
    if (!FLOW[task.status]?.includes(to_status)) {
      return res.status(400).json({ message: `不允许从 ${task.status} 流转到 ${to_status}` })
    }

    // 乐观锁更新(同时限定 id 和 status)
    await adminFetch(`tasks?id=eq.${id}&status=eq.${task.status}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: to_status })
    })

    await adminFetch('task_flows', {
      method: 'POST',
      body: JSON.stringify({
        task_id: id, operator_id: req.userId,
        from_status: task.status, to_status: to_status, comment
      })
    })
    await adminFetch('task_logs', {
      method: 'POST',
      body: JSON.stringify({
        task_id: id, operator_id: req.userId, action: 'transition',
        detail: { from: task.status, to: to_status, comment }
      })
    })

    res.json({ ok: true })

    // 前端会单独调 /api/notify/transition,后端这里不重复触发
  } catch (e) {
    console.error('[transition task]', e)
    res.status(500).json({ message: e.message })
  }
})

// 列出所有用户(用于选择负责人/审批人/协作者)
app.get('/api/users', requireUser, async (req, res) => {
  try {
    const data = await adminFetch('users?select=id,name,avatar_url,role&order=name.asc')
    res.json(data || [])
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

// 统计数据(用于 Dashboard)
app.get('/api/stats', requireUser, async (req, res) => {
  try {
    const tasks = await adminFetch('tasks?select=id,status,priority,assignee_id,creator_id,reviewer_id,created_at,due_date')
    const myAssigns = await adminFetch(`task_assignees?select=task_id&user_id=eq.${req.userId}`)
    const myTaskIds = (myAssigns || []).map(a => a.task_id)

    const visible = (tasks || []).filter(t =>
      t.creator_id === req.userId || t.assignee_id === req.userId ||
      myTaskIds.includes(t.id) || t.reviewer_id === req.userId
    )

    const byStatus = {}
    const byPriority = {}
    const byAssignee = {}
    visible.forEach(t => {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1
      if (t.assignee_id) byAssignee[t.assignee_id] = (byAssignee[t.assignee_id] || 0) + 1
    })

    res.json({
      total: visible.length,
      byStatus,
      byPriority,
      byAssignee,
      tasks: visible
    })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

// ============================================================
// 通知触发:任务创建后通知负责人/审批人/协作者
// 前端 createTask 成功后调一次
// ============================================================
app.post('/api/notify/assign', async (req, res) => {
  try {
    const { taskId, fromName } = req.body
    if (!taskId) return res.status(400).json({ message: '缺少 taskId' })

    const taskData = await adminFetch(`tasks?id=eq.${taskId}&select=id,creator_id,assignee_id,reviewer_id`)
    const task = taskData && taskData[0]
    if (!task) return res.status(404).json({ message: '任务不存在' })

    const assignees = await adminFetch(`task_assignees?select=user_id&task_id=eq.${taskId}`)

    const recipients = new Set()
    if (task.assignee_id) recipients.add(task.assignee_id)
    if (task.reviewer_id) recipients.add(task.reviewer_id)
    ;(assignees || []).forEach(a => recipients.add(a.user_id))
    recipients.delete(task.creator_id)

    const result = await notifyTask({
      taskId, type: 'assign',
      recipientIds: [...recipients], fromName: fromName || '系统'
    })
    res.json(result)
  } catch (e) {
    console.error('[notify/assign]', e)
    res.status(500).json({ message: e.message, skipped: true })
  }
})

// ============================================================
// 通知触发:任务状态流转后通知相关人
// ============================================================
app.post('/api/notify/transition', async (req, res) => {
  try {
    const { taskId, fromStatus, toStatus, fromName } = req.body
    if (!taskId || !toStatus) return res.status(400).json({ message: '参数缺失' })

    const typeMap = {
      approved: 'approve',
      rejected: 'reject',
      done: 'complete'
    }
    const type = typeMap[toStatus]
    if (!type) return res.json({ skipped: true, reason: 'no_notify_for_this_status' })

    // 直接查相关人(不依赖 rpc,避免 RLS)
    const taskData = await adminFetch(`tasks?id=eq.${taskId}&select=creator_id,assignee_id,reviewer_id`)
    const task = taskData && taskData[0]
    if (!task) return res.status(404).json({ message: '任务不存在' })
    const assignees = await adminFetch(`task_assignees?select=user_id&task_id=eq.${taskId}`)

    const recipientSet = new Set()
    if (task.creator_id) recipientSet.add(task.creator_id)
    if (task.assignee_id) recipientSet.add(task.assignee_id)
    if (task.reviewer_id) recipientSet.add(task.reviewer_id)
    ;(assignees || []).forEach(a => recipientSet.add(a.user_id))

    const result = await notifyTask({
      taskId, type, recipientIds: [...recipientSet], fromName: fromName || '系统'
    })
    res.json(result)
  } catch (e) {
    console.error('[notify/transition]', e)
    res.status(500).json({ message: e.message, skipped: true })
  }
})

// ============================================================
// 定时任务:检查临期任务
// ============================================================
app.get('/api/cron/check-due-tasks', async (req, res) => {
  try {
    if (CRON_SECRET && req.query.secret !== CRON_SECRET) {
      return res.status(401).json({ message: 'unauthorized' })
    }
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const tasks = await adminFetch(`tasks?status=eq.in_progress&due_date=eq.${tomorrow}&select=id,title,due_date,assignee_id,creator_id`)

    const results = []
    for (const t of (tasks || [])) {
      try {
        const r = await notifyTask({
          taskId: t.id, type: 'due_remind',
          recipientIds: [t.assignee_id, t.creator_id].filter(Boolean)
        })
        results.push({ id: t.id, ...r })
      } catch (e) {
        results.push({ id: t.id, error: e.message })
      }
    }
    res.json({ checked: tasks?.length || 0, results })
  } catch (e) {
    console.error('[cron/due]', e)
    res.status(500).json({ message: e.message })
  }
})

// ============================================================
// 定时任务:检查超期任务
// ============================================================
app.get('/api/cron/check-overdue-tasks', async (req, res) => {
  try {
    if (CRON_SECRET && req.query.secret !== CRON_SECRET) {
      return res.status(401).json({ message: 'unauthorized' })
    }
    const today = new Date().toISOString().slice(0, 10)
    const tasks = await adminFetch(`tasks?status=eq.in_progress&due_date=lt.${today}&select=id,title,due_date,assignee_id,creator_id`)

    const results = []
    for (const t of (tasks || [])) {
      try {
        const r = await notifyTask({
          taskId: t.id, type: 'overdue',
          recipientIds: [t.assignee_id, t.creator_id].filter(Boolean)
        })
        results.push({ id: t.id, ...r })
      } catch (e) {
        results.push({ id: t.id, error: e.message })
      }
    }
    res.json({ checked: tasks?.length || 0, results })
  } catch (e) {
    console.error('[cron/overdue]', e)
    res.status(500).json({ message: e.message })
  }
})

// ============================================================
// 部署模式判断:
// - VERCEL/Cloudflare 环境:只 export app,让平台处理
// - 本地环境:listen + 托管前端静态文件
// ============================================================
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.CF_PAGES

if (IS_SERVERLESS) {
  // Vercel 上静态托管交给 vercel.json + build 输出
  // 这里只 export app
} else {
  // 静态托管前端 build 产物(生产环境单服务部署,同源免 CORS)
  // 部署时把 frontend/dist 复制到 backend/dist 即可
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const FRONTEND_DIST = process.env.FRONTEND_DIST || path.resolve(__dirname, '../frontend/dist')
  try {
    if (fs.existsSync(FRONTEND_DIST) && fs.statSync(FRONTEND_DIST).isDirectory()) {
      app.use(express.static(FRONTEND_DIST))
      // SPA 回退:非 /api 路径都回 index.html,避免刷新 404
      app.get(/^(?!\/api).*/, (req, res) => {
        res.sendFile(path.join(FRONTEND_DIST, 'index.html'))
      })
      console.log(`[dingtalk-task] 托管前端: ${FRONTEND_DIST}`)
    } else {
      console.warn(`[dingtalk-task] 未找到前端 dist(${FRONTEND_DIST}),仅运行 API`)
    }
  } catch (e) {
    console.warn(`[dingtalk-task] 静态托管初始化失败,仅运行 API:`, e.message)
  }

  app.listen(PORT, () => {
    console.log(`[dingtalk-task] backend on http://localhost:${PORT}`)
  })
}

// 暴露给 Vercel Serverless Function 用
export { app }
