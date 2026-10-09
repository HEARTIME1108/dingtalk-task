// 钉钉免登工具
// 注意:dingtalk-jsapi 在非钉钉环境下 import 时会抛错,
// 所以我们用动态 import + UA 检测来规避

/**
 * 是否运行在钉钉环境内(基于 UA 检测,不依赖 dd.env)
 */
export function isInDingTalk() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // 钉钉 PC / 移动端 UA 都包含 "DingTalk"
  return /DingTalk/i.test(ua)
}

/**
 * 请求免登授权码 authCode
 * @param {string} [corpId] 企业 corpId(新版钉钉可不传)
 * @returns {Promise<string>} authCode
 */
export async function requestAuthCode(corpId) {
  if (!isInDingTalk()) {
    throw new Error('NOT_IN_DINGTALK')
  }
  // 动态 import,避免非钉钉环境加载失败
  const dd = await import('dingtalk-jsapi')
  const params = corpId ? { corpId } : {}
  return new Promise((resolve, reject) => {
    dd.runtime.permission.requestAuthCode({
      ...params,
      onSuccess: (info) => resolve(info.authCode),
      onFail: (err) => reject(err)
    })
  })
}

/**
 * 浏览器调试模式:固定 mock authCode
 * 用固定值避免每次刷新都创建新用户,导致 RLS 用户 id 不一致
 * 实际生产环境请在钉钉内打开页面
 */
export function getMockAuthCode() {
  // 必须固定值!改了就会在 Supabase 建出第二个用户,导致之前建的任务"消失"
  return 'mock_debug_user'
}
