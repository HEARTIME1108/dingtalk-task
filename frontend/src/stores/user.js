import { reactive } from 'vue'
import { supabase, getCurrentUser, signOut } from '../api/supabase'

export const userStore = reactive({
  user: null,
  profile: null,
  loading: false
})

export async function loadUser() {
  userStore.loading = true
  try {
    const u = await getCurrentUser()
    userStore.user = u
    if (u) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', u.id)
        .single()
      userStore.profile = data
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
