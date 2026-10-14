import { getCurrentUser, getAccessToken } from './supabase'

// ============================================================
// 状态机:每个状态可流转到的下一批状态
// ============================================================
export const STATUS_FLOW = {
  todo: ['in_progress'],
  in_progress: ['pending_review'],
  pending_review: ['done', 'rejected'],
  rejected: ['in_progress'],
  done: ['closed'],
  closed: []
}

export const STATUS_LABEL = {
  todo: '待办',
  in_progress: '进行中',
  pending_review: '待审核',
  done: '已完成',
  rejected: '已驳回',
  closed: '已关闭'
}

export const STATUS_COLOR = {
  todo: '#1989fa',
  in_progress: '#ff976a',
  pending_review: '#1989fa',
  done: '#07c160',
  rejected: '#ee0a24',
  closed: '#969799'
}

export const TASK_TYPE_LABEL = {
  team: '班组任务',
  department: '部门任务'
}

export const PRIORITY_LABEL = { daily: '日任务', weekly: '周任务', monthly: '月任务', quarterly: '季度任务', yearly: '年任务' }
export const PRIORITY_COLOR = { daily: '#ee0a24', weekly: '#ff976a', monthly: '#1989fa', quarterly: '#7232dd', yearly: '#07c160' }

export function canTransition(from, to) {
  return STATUS_FLOW[from]?.includes(to)
}

// ============================================================
// 后端 API 调用(全部走后端 service_role 代理,绕开 RLS 兼容问题)
// ============================================================
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

function getToken() {
  const session = JSON.parse(localStorage.getItem('sb_session') || '{}')
  return session.access_token || ''
}

async function apiCall(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  // 加超时,防止请求挂起
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal: controller.signal
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let msg = `请求失败 ${res.status}`
      try {
        const err = JSON.parse(text)
        msg = err.message || msg
      } catch (_) {}
      throw new Error(msg)
    }
    const text = await res.text()
    return text ? JSON.parse(text) : null
  } catch (e) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      throw new Error('请求超时(15秒),请检查网络')
    }
    throw e
  }
}

// ============================================================
// 列表 / 详情
// ============================================================
export async function fetchTasks({ status, keyword } = {}) {
  const params = new URLSearchParams()
  if (status && status !== 'all') params.set('status', status)
  if (keyword) params.set('keyword', keyword)
  const qs = params.toString()
  return apiCall(`/tasks${qs ? '?' + qs : ''}`)
}

export async function fetchTask(id) {
  return apiCall(`/tasks/${id}`)
}

export async function fetchTaskCounts() {
  const token = await getAccessToken()
  const res = await fetch(`${API_BASE}/tasks/counts`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) throw new Error((await res.json()).message || '获取计数失败')
  return res.json()
}

export async function fetchUsers() {
  return apiCall('/users')
}

// 当前登录用户信息(含 is_admin)
export async function fetchMe() {
  return apiCall('/me')
}

// ============================================================
// 增删改
// ============================================================
export async function createTask(payload) {
  const task = await apiCall('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
  return task
}

export async function updateTask(id, payload) {
  return apiCall(`/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
}

export async function deleteTask(id) {
  return apiCall(`/tasks/${id}`, { method: 'DELETE' })
}

export async function quickCompleteTask(id, comment) {
  return apiCall(`/tasks/${id}/quick-complete`, {
    method: 'POST',
    body: JSON.stringify({ comment: comment || '一键完成' })
  })
}

// ============================================================
// 审批流转
// ============================================================
export async function transitionTask(taskId, fromStatus, toStatus, comment, attachments) {
  if (!canTransition(fromStatus, toStatus)) {
    throw new Error(`不允许从「${STATUS_LABEL[fromStatus]}」流转到「${STATUS_LABEL[toStatus]}」`)
  }
  return apiCall(`/tasks/${taskId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to_status: toStatus, comment, attachments: attachments || [] })
  })
}

// 上传文件(拍照/文件) → 返回 { file_url, file_name, file_size, file_type }
export async function uploadFile(file) {
  const token = getToken()
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd
  })
  if (!res.ok) {
    let msg = `上传失败 ${res.status}`
    try { msg = (await res.json()).message || msg } catch (_) {}
    throw new Error(msg)
  }
  return res.json()
}

// ============================================================
// 任务编辑
// ============================================================
export async function updateTaskFull(id, payload) {
  return apiCall(`/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
}

// ============================================================
// 附件
// ============================================================
export async function fetchAttachments(taskId) {
  return apiCall(`/tasks/${taskId}/attachments`)
}
export async function addAttachment(taskId, payload) {
  return apiCall(`/tasks/${taskId}/attachments`, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}
export async function deleteAttachment(taskId, aid) {
  return apiCall(`/tasks/${taskId}/attachments/${aid}`, { method: 'DELETE' })
}

// ============================================================
// 评论
// ============================================================
export async function fetchComments(taskId) {
  return apiCall(`/tasks/${taskId}/comments`)
}
export async function addComment(taskId, content) {
  return apiCall(`/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content })
  })
}
export async function deleteComment(taskId, cid) {
  return apiCall(`/tasks/${taskId}/comments/${cid}`, { method: 'DELETE' })
}

// ============================================================
// 标签
// ============================================================
export async function fetchTags() {
  return apiCall('/tags')
}
export async function addTagToTask(taskId, tagId) {
  return apiCall(`/tasks/${taskId}/tags/${tagId}`, { method: 'POST' })
}
export async function removeTagFromTask(taskId, tagId) {
  return apiCall(`/tasks/${taskId}/tags/${tagId}`, { method: 'DELETE' })
}
export async function createTag(name, color) {
  return apiCall('/tags', { method: 'POST', body: JSON.stringify({ name, color }) })
}
export async function updateTag(id, payload) {
  return apiCall(`/tags/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}
export async function deleteTag(id) {
  return apiCall(`/tags/${id}`, { method: 'DELETE' })
}

// ============================================================
// 子任务
// ============================================================
export async function fetchSubtasks(taskId) {
  return apiCall(`/tasks/${taskId}/subtasks`)
}

// ============================================================
// 统计导出
// ============================================================
export async function exportStats() {
  const token = getToken()
  const res = await fetch(`${API_BASE}/stats/export`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  if (!res.ok) throw new Error('导出失败')
  return res.blob()
}
