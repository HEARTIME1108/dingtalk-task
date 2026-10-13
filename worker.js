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

  const results = { total: allMembers.size, created: 0, skipped: 0, errors: [] }
  for (const [userid, member] of allMembers) {
    try {
      const existing = await adminFetch(c, `users?dingtalk_user_id=eq.${userid}&select=id`)
      if (existing && existing.length > 0) {
        await adminFetch(c, `users?dingtalk_user_id=eq.${userid}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: member.name, avatar_url: member.avatar_url })
        })
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
    const keyword = c.req.query('keyword')

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
        `and(creator_id.eq.${userId},status.eq.done,task_type.eq.team)`,
        `and(department_head_id.eq.${userId},status.eq.done,task_type.eq.department)`
      ].join(',')
      let todoUrl = `tasks?${selectClause}&or=(${todoCond})&order=created_at.desc`
      if (keyword) todoUrl += `&title=ilike.%${keyword}%`
      try {
        const data = await adminFetch(c, todoUrl)
        return c.json(data || [])
      } catch (e) {
        // task_type/department_head_id 列可能不存在,回退:去掉相关条件,且不带 department_head join
        const todoFallback = [
          `and(assignee_id.eq.${userId},status.eq.todo)`,
          `and(assignee_id.eq.${userId},status.eq.rejected)`,
          `and(reviewer_id.eq.${userId},status.eq.pending_review)`
        ].join(',')
        let fallbackUrl = `tasks?${selectClauseFallback}&or=(${todoFallback})&order=created_at.desc`
        if (keyword) fallbackUrl += `&title=ilike.%${keyword}%`
        const data = await adminFetch(c, fallbackUrl)
        return c.json(data || [])
      }
    }

    // 其他状态:用户相关 + 状态过滤
    let url = `tasks?${selectClause}&or=(${orCond})&order=created_at.desc`
    if (status && status !== 'all') url += `&status=eq.${status}`
    if (keyword) url += `&title=ilike.%${keyword}%`

    try {
      const data = await adminFetch(c, url)
      return c.json(data || [])
    } catch (e) {
      // department_head_id 列可能不存在,回退不带 department_head join
      let fallbackUrl = `tasks?${selectClauseFallback}&or=(${orCond})&order=created_at.desc`
      if (status && status !== 'all') fallbackUrl += `&status=eq.${status}`
      if (keyword) fallbackUrl += `&title=ilike.%${keyword}%`
      const data = await adminFetch(c, fallbackUrl)
      return c.json(data || [])
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
      `and(creator_id.eq.${userId},status.eq.done,task_type.eq.team)`,
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
        body: JSON.stringify({ ...basePayload, task_type: task_type || 'department', department_head_id: department_head_id || null })
      })
      task = Array.isArray(tasks) ? tasks[0] : tasks
    } catch (e) {
      // department_head_id 列可能不存在,重试只带 task_type
      try {
        const tasks = await adminFetch(c, 'tasks', {
          method: 'POST',
          body: JSON.stringify({ ...basePayload, task_type: task_type || 'department' })
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

    const exist = await adminFetch(c, `tasks?id=eq.${id}&select=creator_id`)
    if (!exist || !exist.length) return c.json({ message: '任务不存在' }, 404)

    // 管理员或创建人可编辑
    let isAdmin = false
    try {
      const adminCheck = await adminFetch(c, `users?id=eq.${userId}&select=is_admin`)
      isAdmin = adminCheck && adminCheck.length && adminCheck[0].is_admin === true
    } catch (e) {}
    if (exist[0].creator_id !== userId && !isAdmin) return c.json({ message: '只有创建人或管理员能修改' }, 403)

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

// 删除(创建人/审批人/负责人都可删)
app.delete('/api/tasks/:id', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const exist = await adminFetch(c, `tasks?id=eq.${id}&select=creator_id,assignee_id,reviewer_id`)
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
    const canDelete = isAdmin || t.creator_id === userId || t.assignee_id === userId || t.reviewer_id === userId
    if (!canDelete) return c.json({ message: '只有创建人/负责人/审批人能删除' }, 403)

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
    const { to_status, comment } = body

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
        requiredName = '部门主任'
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
    return c.json({ ok: true, task: Array.isArray(updated) ? updated[0] : updated })
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
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

// 当前登录用户信息(含 is_admin)
app.get('/api/me', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    const data = await adminFetch(c, `users?id=eq.${userId}&select=id,name,avatar_url,is_admin,dingtalk_user_id`)
    const user = data && data.length ? data[0] : { id: userId, name: '未知用户', is_admin: false }
    return c.json(user)
  } catch (e) {
    return c.json({ id: c.get('userId'), name: '未知用户', is_admin: false }, 200)
  }
})

// users
app.get('/api/users', requireUser, async (c) => {
  const data = await adminFetch(c, 'users?select=id,name,avatar_url,dingtalk_user_id&order=name.asc')
  return c.json(data || [])
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

// 统计导出 CSV
app.get('/api/stats/export', requireUser, async (c) => {
  try {
    const userId = c.get('userId')
    // 查管理员
    let isAdmin = false
    try {
      const adminCheck = await adminFetch(c, `users?id=eq.${userId}&select=is_admin`)
      isAdmin = adminCheck && adminCheck.length && adminCheck[0].is_admin === true
    } catch (e) {}

    // 管理员看全部,非管理员看自己相关的
    let tasks
    if (isAdmin) {
      tasks = await adminFetch(c, `tasks?select=id,title,status,priority,creator:users!tasks_creator_id_fkey(name),assignee:users!tasks_assignee_id_fkey(name),reviewer:users!tasks_reviewer_id_fkey(name),due_date,created_at&order=created_at.desc`)
    } else {
      tasks = await adminFetch(c, `tasks?or=(creator_id.eq.${userId},assignee_id.eq.${userId},reviewer_id.eq.${userId})&select=id,title,status,priority,creator:users!tasks_creator_id_fkey(name),assignee:users!tasks_assignee_id_fkey(name),reviewer:users!tasks_reviewer_id_fkey(name),due_date,created_at&order=created_at.desc`)
    }
    const list = tasks || []

    const STATUS_LABELS = { todo: '待办', in_progress: '进行中', pending_review: '待审核', done: '已完成', rejected: '已驳回', closed: '已关闭' }
    const PRIORITY_LABELS = { daily: '日任务', weekly: '周任务', monthly: '月任务', quarterly: '季度任务', yearly: '年任务' }

    const header = 'ID,标题,状态,任务周期,创建人,负责人,审批人,截止日期,创建时间'
    const rows = list.map(t => [
      t.id,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      STATUS_LABELS[t.status] || t.status,
      PRIORITY_LABELS[t.priority] || t.priority,
      `"${t.creator?.name || '-'}"`,
      `"${t.assignee?.name || '-'}"`,
      `"${t.reviewer?.name || '-'}"`,
      t.due_date || '-',
      t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '-'
    ].join(','))

    const csv = '\ufeff' + header + '\n' + rows.join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tasks_${new Date().toISOString().slice(0,10)}.csv"`
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
    const tasks = await adminFetch(c, `tasks?select=id,status,priority,assignee_id,creator_id,reviewer_id,due_date&or=(creator_id.eq.${userId},assignee_id.eq.${userId},reviewer_id.eq.${userId})`)
    const list = tasks || []
    const stats = { total: list.length, draft: 0, pending_review: 0, in_progress: 0, done: 0, overdue: 0 }
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
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const tasks = await adminFetch(c, `tasks?status=neq.done&status=neq.cancelled&due_date=gte.${new Date().toISOString().slice(0,10)}&due_date=lt.${tomorrow}T00:00:00&select=id,assignee_id,title,due_date`)
    const list = tasks || []
    for (const t of list) {
      try { await notifyTask({ taskId: t.id, type: 'due_remind', recipientIds: [t.assignee_id].filter(Boolean) }) } catch (e) {}
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
    const tasks = await adminFetch(c, `tasks?status=neq.done&status=neq.cancelled&due_date=lt.${now}&select=id,assignee_id,title,due_date`)
    const list = tasks || []
    for (const t of list) {
      try { await notifyTask({ taskId: t.id, type: 'overdue', recipientIds: [t.assignee_id].filter(Boolean) }) } catch (e) {}
    }
    return c.json({ checked: list.length })
  } catch (e) {
    return c.json({ message: e.message }, 500)
  }
})

export default app
