// 与后端钉钉免登服务对接
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

/**
 * 用钉钉 authCode 换取 Supabase 登录态
 * @param {string} authCode
 * @returns {Promise<{access_token:string, refresh_token:string, user:object}>}
 */
export async function loginWithAuthCode(authCode) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authCode })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || '登录失败')
  }
  return res.json()
}

/**
 * 获取应用配置(corpId 等),由后端下发
 */
export async function getAppConfig() {
  const res = await fetch(`${API_BASE}/auth/config`)
  if (!res.ok) throw new Error('获取配置失败')
  return res.json()
}
