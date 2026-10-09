import { getCurrentUser } from './supabase'

// ============================================================
// 状态机:每个状态可流转到的下一批状态
// ============================================================
export const STATUS_FLOW = {
  draft: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: ['in_progress'],
  rejected: ['draft'],
  in_progress: ['done', 'cancelled'],
  done: [],
  cancelled: []
}

export const STATUS_LABEL = {
  draft: '草稿',
  pending_review: '待审批',
  approved: '已通过',
  rejected: '已驳回',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消'
}

export const STATUS_COLOR = {
  draft: '#969799',
  pending_review: '#1989fa',
  approved: '#07c160',
  rejected: '#ee0a24',
  in_progress: '#ff976a',
  done: '#07c160',
  cancelled: '#969799'
}

export const PRIORITY_LABEL = { low: '低', medium: '中', high: '高', urgent: '紧急' }
export const PRIORITY_COLOR = { low: '#969799', medium: '#1989fa', high: '#ff976a', urgent: '#ee0a24' }

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
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `请求失败 ${res.status}`)
  }
  return res.json()
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

export async function fetchUsers() {
  return apiCall('/users')
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

// ============================================================
// 审批流转
// ============================================================
export async function transitionTask(taskId, fromStatus, toStatus, comment) {
  if (!canTransition(fromStatus, toStatus)) {
    throw new Error(`不允许从「${STATUS_LABEL[fromStatus]}」流转到「${STATUS_LABEL[toStatus]}」`)
  }
  return apiCall(`/tasks/${taskId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to_status: toStatus, comment })
  })
}
