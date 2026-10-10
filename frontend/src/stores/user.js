import { reactive } from 'vue'
import { getCurrentUser, isLoggedIn, signOut } from '../api/supabase'
import { fetchMe } from '../api/task'

export const userStore = reactive({
  user: null,
  profile: null,
  loading: false
})

export async function loadUser() {
  userStore.loading = true
  try {
    // 先从 localStorage 拿 JWT user(含 id/email)
    const u = await getCurrentUser()
    userStore.user = u
    if (u) {
      // 通过后端 /api/me 拿 profile(含 name/is_admin),绕 RLS
      try {
        const me = await fetchMe()
        userStore.profile = me
        // 同步 user.id 以防 JWT 解码出来的 id 和 DB 不一致
        if (me?.id) userStore.user = { ...userStore.user, id: me.id }
      } catch (e) {
        userStore.profile = null
      }
    } else {
      userStore.profile = null
    }
  } finally {
    userStore.loading = false
  }
}

export async function logout() {
  await signOut()
  userStore.user = null
  userStore.profile = null
}
