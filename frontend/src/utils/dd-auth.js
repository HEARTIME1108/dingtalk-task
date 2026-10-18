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
 *
 * 【为什么清缓存后会 40078】
 * 清除缓存后钉钉 WebView 冷启动，原生桥(native bridge)需要重建。
 * 仅等待 dd.ready() 不够 —— 清缓存后 JSAPI 的鉴权状态也被清掉了，
 * 需要先 dd.config 完成鉴权，requestAuthCode 返回的 code 才会在服务端生效。
 * 否则会拿到一个"看起来正常"但服务端不认的 code → 40078。
 *
 * 【对策】
 * 1. 先 dd.config 鉴权（用后端下发的 jsapi 签名）
 * 2. 等 dd.ready 后再取码
 * 3. 取码后由 Login.vue 在 40078 时重试
 */
export async function requestAuthCode(corpId) {
  if (!isInDingTalk()) {
    throw new Error('NOT_IN_DINGTALK')
  }
  const dd = await import('dingtalk-jsapi')
  const { getJsapiConfig } = await import('../api/dingtalk')

  const params = corpId ? { corpId } : {}

  // 真正取码的逻辑
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

  // ★ 关键：先 dd.config 鉴权。清缓存后必须重新鉴权，否则取到的 code 无效
  try {
    const pageUrl = location.href.split('#')[0]
    const cfg = await getJsapiConfig(pageUrl)
    await new Promise((resolve, reject) => {
      try {
        dd.config({
          agentId: cfg.agentId,
          corpId: cfg.corpId,
          timeStamp: cfg.timeStamp,
          nonceStr: cfg.nonceStr,
          signature: cfg.signature,
          jsApiList: ['runtime.permission.requestAuthCode']
        })
      } catch (e) { reject(e); return }
      // dd.ready 在 config 鉴权成功后触发
      dd.ready(() => resolve('ready'))
      dd.error((err) => reject(new Error('dd.config 鉴权失败: ' + JSON.stringify(err))))
    })
  } catch (e) {
    // 鉴权失败不直接抛错，降级到只等 dd.ready（有些场景 config 非必须）
    console.warn('[dd-auth] dd.config 失败，降级到 dd.ready:', e)
    try {
      await withTimeout(new Promise((resolve) => {
        try { dd.ready(() => resolve('ready')) } catch { resolve('ready_error') }
      }), 5000, 'ready_timeout')
    } catch {}
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
