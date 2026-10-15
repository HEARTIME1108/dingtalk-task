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
