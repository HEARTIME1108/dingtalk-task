// 与后端钉钉免登服务对接
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

// 带超时的 fetch，避免网络慢/请求挂起导致登录页一直转圈
async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('网络请求超时，请重试')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 用钉钉 authCode 换取 Supabase 登录态
 * @param {string} authCode
 * @returns {Promise<{access_token:string, refresh_token:string, user:object}>}
 */
export async function loginWithAuthCode(authCode) {
  const res = await fetchWithTimeout(`${API_BASE}/auth/login`, {
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
 * corpId 固定不变,缓存到 localStorage,避免每次登录多一次网络请求
 */
export async function getAppConfig() {
  const cached = localStorage.getItem('app_config')
  if (cached) {
    try { return JSON.parse(cached) } catch { /* fallthrough */ }
  }
  const res = await fetchWithTimeout(`${API_BASE}/auth/config`)
  if (!res.ok) throw new Error('获取配置失败')
  const data = await res.json()
  try { localStorage.setItem('app_config', JSON.stringify(data)) } catch {}
  return data
}

/**
 * 获取钉钉 JSAPI 鉴权签名(dd.config 使用)
 * @param {string} url 当前页面 location.href(不含 # 及其后部分)
 */
export async function getJsapiConfig(url) {
  const res = await fetchWithTimeout(`${API_BASE}/dingtalk/jsapi-config?url=${encodeURIComponent(url)}`)
  if (!res.ok) throw new Error('获取钉钉鉴权失败')
  return res.json()
}
