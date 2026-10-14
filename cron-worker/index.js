// 定时任务：每天调用一次 Pages 后端的截止提醒接口
// 说明：提醒是「时间触发」，必须有个定时器每天醒来检查一次，
//       找出「明天到期且未完成」的任务，给负责人 + 审核人发钉钉通知。
//       同一个任务只会在截止前一天收到 1 次（后端已做去重）。

const TARGET = '/api/cron/check-due-tasks'

async function run(env) {
  const base = (env.BASE_URL || 'https://dingtalk-task.pages.dev').replace(/\/$/, '')
  const url = `${base}${TARGET}?secret=${encodeURIComponent(env.CRON_SECRET || '')}`
  try {
    const r = await fetch(url)
    const body = await r.text()
    console.log('[cron]', r.status, body)
    const result = { url: TARGET, status: r.status, body }
    if (env.KV_LOG) {
      try { await env.KV_LOG.put('last_run', JSON.stringify({ ts: new Date().toISOString(), ...result })) } catch (e) {}
    }
    return result
  } catch (e) {
    console.error('[cron] 调用失败', e.message)
    const result = { url: TARGET, error: e.message }
    if (env.KV_LOG) {
      try { await env.KV_LOG.put('last_run', JSON.stringify({ ts: new Date().toISOString(), ...result })) } catch (e2) {}
    }
    return result
  }
}

export default {
  // Cloudflare 定时触发
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env))
  },
  // 便于手动触发测试： GET /?secret=xxx
  async fetch(request, env) {
    const url = new URL(request.url)
    const secret = url.searchParams.get('secret')
    if (env.CRON_SECRET && secret !== env.CRON_SECRET) {
      return new Response('unauthorized', { status: 401 })
    }
    const out = await run(env)
    return new Response(JSON.stringify(out), {
      headers: { 'content-type': 'application/json' }
    })
  }
}
