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
        <div v-if="debugInfo" class="debug-info">
          <p style="font-weight:bold;margin-bottom:8px;">调试信息：</p>
          <pre>{{ debugInfo }}</pre>
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
const debugInfo = ref('')

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

// 重试延迟（递增），给原生桥更多时间与钉钉服务端同步
const RETRY_DELAYS = [1500, 2500, 3500]
const MAX_RETRY = RETRY_DELAYS.length

// 把失败的 authCode 发到后端调试接口，获取 getuserinfo 完整响应
async function sendDebugCode(authCode) {
  try {
    const res = await fetch('/api/debug/test-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authCode })
    })
    const data = await res.json()
    debugInfo.value = JSON.stringify(data, null, 2)
  } catch (e) {
    debugInfo.value = '调试请求失败: ' + e.message
  }
}

async function doLogin(retryCount = 0) {
  loading.value = true
  error.value = ''
  debugInfo.value = ''
  let authCode = null
  try {
    const cfg = await getAppConfig()
    loadingText.value = retryCount > 0
      ? `重新获取授权码（第 ${retryCount} 次）...`
      : '获取钉钉授权码...'

    // 在钉钉内：用 JSAPI 获取 authCode
    // 不在钉钉内：用 mock 登录
    authCode = isInDingTalk()
      ? await requestAuthCode(cfg.corpId)
      : getMockAuthCode()

    loadingText.value = '登录中...'
    await doLoginWithAuthCode(authCode)
  } catch (e) {
    console.error('[Login] 登录失败:', e)
    // 授权码失效(40078)：自动重试，每次重新取码
    if (isAuthCodeExpired(e) && retryCount < MAX_RETRY) {
      const delay = RETRY_DELAYS[retryCount]
      loadingText.value = `授权码未生效，${Math.round(delay / 1000)} 秒后重试（${retryCount + 1}/${MAX_RETRY}）...`
      await new Promise(r => setTimeout(r, delay))
      return doLogin(retryCount + 1)
    }
    // 最终失败：把 authCode 发到调试接口（最后一次重试的 code）
    if (authCode && !authCode.startsWith('mock_')) {
      await sendDebugCode(authCode)
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
.debug-info {
  margin-top: 24px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  text-align: left;
  font-size: 11px;
  line-height: 1.5;
  word-break: break-all;
}
.debug-info pre {
  white-space: pre-wrap;
  margin: 0;
  font-family: monospace;
}
</style>
