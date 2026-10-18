import { reactive } from 'vue'
import { getCurrentUser, isLoggedIn, signOut } from '../api/supabase'
import { fetchMe } from '../api/task'
import { getCache, setCache, clearCache, CACHE_KEYS } from '../utils/cache'

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
      // 先展示缓存的 profile(秒开),后台再刷新
      const cachedProfile = getCache(CACHE_KEYS.PROFILE)
      if (cachedProfile) {
        userStore.profile = cachedProfile
        if (cachedProfile.id) userStore.user = { ...userStore.user, id: cachedProfile.id }
      }
      // 后台刷新 profile
      try {
        const me = await fetchMe()
        userStore.profile = me
        if (me?.id) userStore.user = { ...userStore.user, id: me.id }
        setCache(CACHE_KEYS.PROFILE, me)
      } catch (e) {
        // 刷新失败但有缓存,不报错
      }
    } else {
      userStore.profile = null
    }
  } finally {
    userStore.loading = false
  }
}

export async function logout() {
  clearCache(CACHE_KEYS.PROFILE)
  await signOut()
  userStore.user = null
  userStore.profile = null
}
