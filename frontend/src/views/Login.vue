<template>
  <div class="login">
    <van-nav-bar title="登录" />
    <div class="login-body">
      <van-loading v-if="loading" type="spinner" size="36px">{{ loadingText }}</van-loading>
      <div v-else class="error-block">
        <van-empty :description="error" />
        <div class="hint">
          <p>钉钉免登偶尔会因授权码失效而失败，点击下方按钮重新获取授权码再试一次。</p>
          <van-button type="primary" block @click="retryLogin">重新登录</van-button>
          <p class="mock-hint">如果一直失败，可点此用调试模式进入（功能正常，只是身份是测试用户）。</p>
          <van-button plain type="default" block @click="doMockLogin">调试登录</van-button>
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
const loadingText = ref('登录中...')
const error = ref('')

async function doLoginWithAuthCode(authCode) {
  const { access_token, refresh_token } = await loginWithAuthCode(authCode)
  await setSession(access_token, refresh_token)
  await loadUser()
  router.replace('/tasks')
}

// 判断是否是「授权码失效」类错误(40078 等)，需要重新取码再试
function isAuthCodeExpired(e) {
  const msg = (e?.message || typeof e === 'string' ? e : JSON.stringify(e)) || ''
  return /40078|临时授权码|authCode|授权码/.test(msg)
}

async function doLogin(retryCount = 0) {
  loading.value = true
  error.value = ''
  try {
    const cfg = await getAppConfig()
    loadingText.value = '获取钉钉授权码...'

    // 在钉钉内：用 JSAPI 获取 authCode
    // 不在钉钉内：用 mock 登录
    const authCode = isInDingTalk()
      ? await requestAuthCode(cfg.corpId)
      : getMockAuthCode()

    loadingText.value = '登录中...'
    await doLoginWithAuthCode(authCode)
  } catch (e) {
    console.error('[Login] 登录失败:', e)
    // 授权码失效(40078)：自动重试一次，重新取码
    if (isAuthCodeExpired(e) && retryCount < 1) {
      loadingText.value = '授权码已失效，重试中...'
      // 等 800ms 让钉钉原生桥状态稳定后再取新码
      await new Promise(r => setTimeout(r, 800))
      return doLogin(retryCount + 1)
    }
    loading.value = false
    error.value = e?.message || (typeof e === 'string' ? e : JSON.stringify(e))
  }
}

function retryLogin() {
  doLogin(0)
}

async function doMockLogin() {
  loading.value = true
  loadingText.value = '调试登录中...'
  error.value = ''
  try {
    await doLoginWithAuthCode(getMockAuthCode())
  } catch (e) {
    loading.value = false
    error.value = e?.message || '调试登录也失败了'
  }
}

onMounted(() => doLogin(0))
</script>

<style scoped>
.login { min-height: 100vh; background: #f7f8fa; }
.login-body { padding: 80px 24px; text-align: center; }
.error-block { margin-top: 20px; }
.hint { margin-top: 16px; color: #969799; font-size: 13px; line-height: 1.6; }
.hint p { margin-bottom: 16px; }
.mock-hint { margin-top: 16px; margin-bottom: 12px !important; }
</style>
