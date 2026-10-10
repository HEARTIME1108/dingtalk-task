<template>
  <div class="login">
    <van-nav-bar title="登录" />
    <div class="login-body">
      <van-loading v-if="loading" type="spinner" size="36px">登录中...</van-loading>
      <div v-else class="error-block">
        <van-empty :description="error" />
        <div class="hint">
          <p>如果钉钉免登失败,可点下面按钮用调试模式进入(功能正常,只是身份是测试用户)。</p>
          <van-button type="primary" block @click="doMockLogin">调试登录</van-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getAppConfig, loginWithAuthCode } from '../api/dingtalk'
import { requestAuthCode, isInDingTalk, getMockAuthCode } from '../utils/dd-auth'
import { setSession } from '../api/supabase'
import { loadUser } from '../stores/user'

const router = useRouter()
const loading = ref(true)
const error = ref('')

async function doLoginWithAuthCode(authCode) {
  const { access_token, refresh_token } = await loginWithAuthCode(authCode)
  await setSession(access_token, refresh_token)
  await loadUser()
  router.replace('/tasks')
}

async function doLogin() {
  try {
    const cfg = await getAppConfig()
    console.log('[Login] 配置:', cfg)

    // 在钉钉内：用 JSAPI 获取 authCode
    // 不在钉钉内：用 mock 登录
    const authCode = isInDingTalk()
      ? await requestAuthCode(cfg.corpId)
      : getMockAuthCode()

    console.log('[Login] 获取到 authCode, 长度:', authCode?.length)
    await doLoginWithAuthCode(authCode)
  } catch (e) {
    console.error('[Login] 登录失败:', e)
    loading.value = false
    error.value = e?.message || (typeof e === 'string' ? e : JSON.stringify(e))
  }
}

async function doMockLogin() {
  loading.value = true
  error.value = ''
  try {
    await doLoginWithAuthCode(getMockAuthCode())
  } catch (e) {
    loading.value = false
    error.value = e?.message || '调试登录也失败了'
  }
}

onMounted(doLogin)
</script>

<style scoped>
.login { min-height: 100vh; background: #f7f8fa; }
.login-body { padding: 80px 24px; text-align: center; }
.error-block { margin-top: 20px; }
.hint { margin-top: 16px; color: #969799; font-size: 13px; line-height: 1.6; }
.hint p { margin-bottom: 16px; }
</style>
