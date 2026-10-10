// 钉钉工作消息通知工具(用 fetch 直接调 REST API,绕过 supabase-js)
// 不在模块顶层读 env,所有 env 在函数内读(适配 Cloudflare Workers)

function env(key, def = '') {
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key]
  return def
}

async function adminFetch(path, options = {}) {
  const SUPABASE_URL = env('SUPABASE_URL')
  const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
  const url = `${SUPABASE_URL}/rest/v1/${path}`
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...options.headers
  }
  if (options.method === 'POST' || options.method === 'PATCH') {
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

// ============================================================
// 钉钉 access_token
// ============================================================
let tokenCache = { token: null, expire: 0 }

export async function getDingtalkAccessToken() {
  const now = Date.now()
  if (tokenCache.token && now < tokenCache.expire - 60000) {
    return tokenCache.token
  }
  const DINGTALK_APP_KEY = env('DINGTALK_APP_KEY')
  const DINGTALK_APP_SECRET = env('DINGTALK_APP_SECRET')
  const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey: DINGTALK_APP_KEY, appSecret: DINGTALK_APP_SECRET })
  })
  const data = await res.json()
  if (!data.accessToken) {
    throw new Error('获取钉钉 access_token 失败: ' + JSON.stringify(data))
  }
  tokenCache = {
    token: data.accessToken,
    expire: now + (data.expireIn || 7200) * 1000
  }
  return tokenCache.token
}

// ============================================================
// 根据 user.id 查钉钉 userid
// ============================================================
async function getDingtalkUserIds(userIds) {
  if (!userIds?.length) return []
  const filter = `id=in.(${userIds.join(',')})`
  const data = await adminFetch(`users?select=id,dingtalk_user_id&${filter}`)
  return (data || []).filter(u => u.dingtalk_user_id && !u.dingtalk_user_id.startsWith('mock_'))
}

// ============================================================
// 发送 actionCard 工作消息
// ============================================================
async function sendActionCard({ userIds, title, markdown, taskUrl }) {
  const APP_AGENT_ID = env('APP_AGENT_ID')
  if (!APP_AGENT_ID) {
    console.warn('[notifier] 未配置 APP_AGENT_ID,跳过发送')
    return { skipped: true, reason: 'no_agent_id' }
  }
  if (!userIds?.length) return { skipped: true, reason: 'empty_users' }

  const token = await getDingtalkAccessToken()
  const url = 'https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend/v2'
  const body = {
    access_token: token,
    agent_id: APP_AGENT_ID,
    userid_list: userIds.join(','),
    msg: {
      msgtype: 'action_card',
      action_card: {
        title,
        markdown,
        btn_orientation: '0',
        btns: [
          { title: '查看任务', action_url: taskUrl }
        ]
      }
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  if (data.errcode !== 0) {
    throw new Error('发送工作消息失败: ' + JSON.stringify(data))
  }
  return { sent: true, task_id: data.task_id }
}

// ============================================================
// 通知模板
// ============================================================
const TEMPLATES = {
  assign: {
    title: (t) => `新任务:${t.title}`,
    body: (t, fromName) => `### 新任务指派\n**任务**: ${t.title}\n\n**指派人**: ${fromName}\n\n**优先级**: ${t.priority}\n\n**截止**: ${t.due_date || '无'}\n\n请及时处理。`
  },
  approve: {
    title: (t) => `审批通过:${t.title}`,
    body: (t) => `### 审批通过\n**任务**: ${t.title}\n\n审批已通过,可以开始执行。`
  },
  reject: {
    title: (t) => `审批驳回:${t.title}`,
    body: (t) => `### 审批驳回\n**任务**: ${t.title}\n\n请修改后重新提交。`
  },
  complete: {
    title: (t) => `任务完成:${t.title}`,
    body: (t) => `### 任务已完成\n**任务**: ${t.title}\n\n任务已标记为完成。`
  },
  due_remind: {
    title: (t) => `任务即将到期:${t.title}`,
    body: (t) => `### 任务即将到期\n**任务**: ${t.title}\n\n**截止日期**: ${t.due_date}\n\n请尽快完成。`
  },
  overdue: {
    title: (t) => `任务已超期:${t.title}`,
    body: (t) => `### 任务已超期\n**任务**: ${t.title}\n\n**截止日期**: ${t.due_date}\n\n请立即处理!`
  }
}

// ============================================================
// 主入口
// ============================================================
export async function notifyTask({ taskId, type, recipientIds, fromName = '系统' }) {
  // 1) 拉任务详情
  const tasksData = await adminFetch(`tasks?id=eq.${taskId}&select=id,title,priority,due_date,status`)
  const task = tasksData && tasksData[0]
  if (!task) throw new Error('任务不存在')

  // 2) 找出真实钉钉 userid(mock 用户不发)
  const dtUsers = await getDingtalkUserIds(recipientIds)
  if (!dtUsers.length) {
    return { skipped: true, reason: 'no_real_dingtalk_users' }
  }

  // 3) 去重:今天同类型通知已发过就跳过
  const today = new Date().toISOString().slice(0, 10)
  const sentFilter = `task_id=eq.${taskId}&type=eq.${type}&sent_date=eq.${today}&select=recipient_id`
  const sent = await adminFetch(`task_notifications?${sentFilter}`)
  const sentSet = new Set((sent || []).map(s => s.recipient_id))
  const toSend = dtUsers.filter(u => !sentSet.has(u.id))
  if (!toSend.length) {
    return { skipped: true, reason: 'already_sent_today' }
  }

  // 4) 渲染消息
  const tpl = TEMPLATES[type]
  if (!tpl) throw new Error('未知通知类型: ' + type)
  const FRONTEND_BASE_URL = env('FRONTEND_BASE_URL', 'http://localhost:5173')
  const taskUrl = `${FRONTEND_BASE_URL}/tasks/${task.id}`
  const markdown = tpl.body(task, fromName) + `\n\n[查看任务](${taskUrl})`
  const title = tpl.title(task)

  // 5) 发送
  const userIds = toSend.map(u => u.dingtalk_user_id)
  const result = await sendActionCard({ userIds, title, markdown, taskUrl })

  // 6) 记录已发送
  if (!result.skipped) {
    try {
      await adminFetch('task_notifications', {
        method: 'POST',
        body: JSON.stringify(
          toSend.map(u => ({
            task_id: taskId,
            recipient_id: u.id,
            type,
            sent_date: today
          }))
        ),
        prefer: 'return=minimal'
      })
    } catch (e) { /* 忽略 */ }
  }
  return result
}
