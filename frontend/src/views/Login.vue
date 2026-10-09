<template>
  <div class="login">
    <van-nav-bar title="登录" />
    <div class="login-body">
      <van-loading v-if="loading" type="spinner" size="36px">登录中...</van-loading>
      <van-empty v-else-if="error" :description="error" />
      <div v-else class="tip">正在自动登录...</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showDialog } from 'vant'
import { getAppConfig, loginWithAuthCode } from '../api/dingtalk'
import { requestAuthCode, isInDingTalk, getMockAuthCode } from '../utils/dd-auth'
import { setSession } from '../api/supabase'
import { loadUser } from '../stores/user'

const router = useRouter()
const loading = ref(true)
const error = ref('')

async function doLogin() {
  try {
    const cfg = await getAppConfig()
    const authCode = isInDingTalk()
      ? await requestAuthCode(cfg.corpId)
      : getMockAuthCode()
    const { access_token, refresh_token } = await loginWithAuthCode(authCode)
    await setSession(access_token, refresh_token)
    await loadUser()
    router.replace('/tasks')
  } catch (e) {
    loading.value = false
    error.value = e.message || '登录失败'
    showDialog({ title: '登录失败', message: error.value })
  }
}

onMounted(doLogin)
</script>

<style scoped>
.login { min-height: 100vh; background: #f7f8fa; }
.login-body { padding: 80px 24px; text-align: center; }
.tip { color: #969799; }
</style>
