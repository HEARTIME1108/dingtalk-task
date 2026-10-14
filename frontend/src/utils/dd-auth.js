// 钉钉免登工具

/**
 * 是否运行在钉钉环境内
 */
export function isInDingTalk() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /DingTalk/i.test(ua)
}

// 给 Promise 加超时，避免钉钉 JSAPI 回调不触发时一直卡住（表现为一直转圈）
function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

/**
 * 请求免登授权码 authCode（用 JSAPI）
 */
export async function requestAuthCode(corpId) {
  if (!isInDingTalk()) {
    throw new Error('NOT_IN_DINGTALK')
  }
  const dd = await import('dingtalk-jsapi')

  // 先等 JSAPI 就绪，未就绪直接调用可能回调不触发
  try {
    await withTimeout(
      new Promise((resolve) => { try { dd.ready(() => resolve(true)) } catch (e) { resolve(false) } }),
      3000,
      'ready_timeout'
    )
  } catch (e) {
    // 就绪超时也继续尝试，交给下面 requestAuthCode 的超时兜底
  }

  const params = corpId ? { corpId } : {}
  const codePromise = new Promise((resolve, reject) => {
    try {
      dd.runtime.permission.requestAuthCode({
        ...params,
        onSuccess: (info) => resolve(info.authCode || info.code || (typeof info === 'string' ? info : '')),
        onFail: (err) => {
          const msg = typeof err === 'string' ? err
            : (err && (err.message || err.errMsg || JSON.stringify(err)))
          reject(new Error('requestAuthCode 失败: ' + msg))
        }
      })
    } catch (e) {
      reject(e)
    }
  })
  // 12 秒还没拿到授权码就报错，让登录页显示失败提示（而不是无限转圈）
  return withTimeout(codePromise, 12000, '钉钉免登超时：未获取到授权码')
}

/**
 * 浏览器调试模式:固定 mock authCode
 */
export function getMockAuthCode() {
  return 'mock_debug_user'
}
