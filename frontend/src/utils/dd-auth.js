// 钉钉免登工具

/**
 * 是否运行在钉钉环境内
 */
export function isInDingTalk() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /DingTalk/i.test(ua)
}

/**
 * 请求免登授权码 authCode（用 JSAPI）
 */
export async function requestAuthCode(corpId) {
  if (!isInDingTalk()) {
    throw new Error('NOT_IN_DINGTALK')
  }
  const dd = await import('dingtalk-jsapi')
  const params = corpId ? { corpId } : {}
  return new Promise((resolve, reject) => {
    dd.runtime.permission.requestAuthCode({
      ...params,
      onSuccess: (info) => resolve(info.authCode || info.code || (typeof info === 'string' ? info : '')),
      onFail: (err) => {
        const msg = typeof err === 'string' ? err
          : (err && (err.message || err.errMsg || JSON.stringify(err)))
        reject(new Error('requestAuthCode 失败: ' + msg))
      }
    })
  })
}

/**
 * 浏览器调试模式:固定 mock authCode
 */
export function getMockAuthCode() {
  return 'mock_debug_user'
}
