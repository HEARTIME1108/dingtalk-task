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
 * 清理缓存后钉钉 WebView 原生桥可能尚未完全就绪，直接调 requestAuthCode
 * 可能拿到无效码（后端报 40078）。这里确保在 dd.ready 之后再取码，并支持一次重试。
 */
export async function requestAuthCode(corpId) {
  if (!isInDingTalk()) {
    throw new Error('NOT_IN_DINGTALK')
  }
  const dd = await import('dingtalk-jsapi')

  const params = corpId ? { corpId } : {}

  // 真正取码的逻辑，放在 dd.ready 回调里执行，保证原生桥就绪
  function fetchCode() {
    return new Promise((resolve, reject) => {
      try {
        dd.runtime.permission.requestAuthCode({
          ...params,
          onSuccess: (info) => {
            const code = info.authCode || info.code || (typeof info === 'string' ? info : '')
            if (!code) {
              reject(new Error('requestAuthCode 返回空授权码'))
            } else {
              resolve(code)
            }
          },
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
  }

  // 等 dd.ready 就绪(5s 兜底)，就绪后在回调里取码
  const readyPromise = new Promise((resolve) => {
    try {
      dd.ready(() => resolve('ready'))
    } catch (e) {
      resolve('ready_error')
    }
  })

  try {
    await withTimeout(readyPromise, 5000, 'ready_timeout')
  } catch (e) {
    // 就绪超时也继续尝试取码（requestAuthCode 自身有超时兜底）
  }

  // 取码：12s 超时
  const code = await withTimeout(fetchCode(), 12000, '钉钉免登超时：未获取到授权码')
  return code
}

/**
 * 浏览器调试模式:固定 mock authCode
 */
export function getMockAuthCode() {
  return 'mock_debug_user'
}

/**
 * 把文件转存到钉盘(导出文件后使用,可在钉盘里查看并转发分享)
 * @param {string} fileUrl 文件地址
 * @param {string} fileName 文件名
 */
export async function saveFileToDingTalk(fileUrl, fileName) {
  if (!isInDingTalk()) throw new Error('NOT_IN_DINGTALK')
  const mod = await import('dingtalk-jsapi')
  const dd = mod.default || mod
  const { getJsapiConfig } = await import('../api/dingtalk')

  // 当前页面地址(不含 # 及其后部分),需与前端页面 URL 严格一致
  const pageUrl = location.href.split('#')[0]
  const cfg = await getJsapiConfig(pageUrl)

  // 先完成 dd.config 鉴权
  await withTimeout(
    new Promise((resolve, reject) => {
      try {
        dd.config({
          agentId: cfg.agentId,
          corpId: cfg.corpId,
          timeStamp: cfg.timeStamp,
          nonceStr: cfg.nonceStr,
          signature: cfg.signature,
          jsApiList: ['saveFileToDingTalk']
        })
      } catch (e) { reject(e); return }
      dd.ready(() => resolve(true))
    }),
    8000,
    '钉钉鉴权超时'
  )

  // 转存到钉盘
  return withTimeout(new Promise((resolve, reject) => {
    try {
      dd.saveFileToDingTalk({
        url: fileUrl,
        name: fileName,
        success: (res) => resolve(res),
        fail: (err) => reject(new Error((err && (err.errorMessage || err.error || err.message)) || '保存到钉盘失败'))
      })
    } catch (e) { reject(e) }
  }), 30000, '保存到钉盘超时')
}
