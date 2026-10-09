import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[supabase] 缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY,请检查 .env')
}

// 只用来登录拿 token,不持久化 session(因为新版 ES256 token 在 RLS 里有问题,
// 数据操作都走后端 service_role 代理,前端只用 token 调后端)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
})

const SESSION_KEY = 'sb_session'

export async function setSession(accessToken, refreshToken) {
  // 自己存,不走 supabase.auth.setSession(那个有兼容问题)
  const user = decodeJwtUser(accessToken)
  const session = { access_token: accessToken, refresh_token: refreshToken, user }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

function decodeJwtUser(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    return {
      id: payload.sub,
      email: payload.email,
      profile: { name: payload.user_metadata?.name, avatar_url: payload.user_metadata?.avatar_url }
    }
  } catch (e) {
    return null
  }
}

export async function getCurrentUser() {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const session = JSON.parse(raw)
    return session.user
  } catch (e) {
    return null
  }
}

export async function getAccessToken() {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw).access_token
  } catch (e) {
    return null
  }
}

export async function signOut() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem('mock_auth_code')
}

export function isLoggedIn() {
  return !!localStorage.getItem(SESSION_KEY)
}
