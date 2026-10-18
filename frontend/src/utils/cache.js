// 本地缓存工具:实现「缓存优先,后台刷新」(stale-while-revalidate)
// 用于任务列表、用户信息等数据,做到秒开(先展示缓存,再静默更新)

const TTL = {
  tasks: 5 * 60 * 1000,        // 任务列表缓存 5 分钟
  profile: 30 * 60 * 1000,     // 用户信息缓存 30 分钟
  tags: 30 * 60 * 1000         // 标签缓存 30 分钟
}

function now() { return Date.now() }

export function getCache(key, maxAge = TTL[key] || 0) {
  try {
    const raw = localStorage.getItem(`cache_${key}`)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (maxAge > 0 && now() - ts > maxAge) return null
    return data
  } catch (e) {
    return null
  }
}

export function setCache(key, data) {
  try {
    localStorage.setItem(`cache_${key}`, JSON.stringify({ data, ts: now() }))
  } catch (e) {
    // 配额超限等错误,忽略
  }
}

export function clearCache(key) {
  try {
    if (key) localStorage.removeItem(`cache_${key}`)
    else {
      Object.keys(localStorage)
        .filter(k => k.startsWith('cache_'))
        .forEach(k => localStorage.removeItem(k))
    }
  } catch (e) {}
}

export const CACHE_KEYS = { TASKS: 'tasks', PROFILE: 'profile', TAGS: 'tags' }
export { TTL }
