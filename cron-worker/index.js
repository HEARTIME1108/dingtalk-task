// 定时任务：定期调用 Pages 后端的两个 cron 接口
//
// 1) 截止前一天提醒(/api/cron/check-due-tasks)
//    每天 01:00 UTC(= 09:00 北京)跑一次,找出「明天到期且未完成」的任务,
//    给负责人 + 审核人发钉钉通知(同一任务只发 1 次,后端已去重)。
//
// 2) 每日未完成工作汇总(/api/cron/daily-digest)
//    每 30 分钟醒一次,因为每个人的提醒时间可以自定义。
//    后端只在「整点那一档」真正发送(:00 命中、:30 跳过),所以每人每天只收 1 条。
//
// 说明:Cloudflare 的 cron 只能按表达式触发,所以用 event.cron 区分是哪个表达式
//       触发的,再转发到对应接口。

const TARGETS = {
  due: '/api/cron/check-due-tasks',
  digest: '/api/cron/daily-digest'
}

async function run(env, target) {
  const base = (env.BASE_URL || 'https://dingtalk-task.pages.dev').replace(/\/$/, '')
  const url = `${base}${target}?secret=${encodeURIComponent(env.CRON_SECRET || '')}`
  try {
    const r = await fetch(url)
    const body = await r.text()
    console.log('[cron]', target, r.status, body)
    const result = { url: target, status: r.status, body }
    if (env.KV_LOG) {
      try { await env.KV_LOG.put('last_run_' + target, JSON.stringify({ ts: new Date().toISOString(), ...result })) } catch (e) {}
    }
    return result
  } catch (e) {
    console.error('[cron] 调用失败', target, e.message)
    const result = { url: target, error: e.message }
    if (env.KV_LOG) {
      try { await env.KV_LOG.put('last_run_' + target, JSON.stringify({ ts: new Date().toISOString(), ...result })) } catch (e2) {}
    }
    return result
  }
}

export default {
  // Cloudflare 定时触发
  async scheduled(event, env, ctx) {
    const target = event.cron === '0 1 * * *' ? TARGETS.due : TARGETS.digest
    ctx.waitUntil(run(env, target))
  },
  // 便于手动触发测试： GET /?secret=xxx          → 到期提醒
  //                   GET /?secret=xxx&target=digest → 每日汇总
  async fetch(request, env) {
    const url = new URL(request.url)
    const secret = url.searchParams.get('secret')
    if (env.CRON_SECRET && secret !== env.CRON_SECRET) {
      return new Response('unauthorized', { status: 401 })
    }
    const which = url.searchParams.get('target')
    const target = which === 'digest' ? TARGETS.digest : (which === 'due' ? TARGETS.due : TARGETS.digest)
    const out = await run(env, target)
    return new Response(JSON.stringify(out), {
      headers: { 'content-type': 'application/json' }
    })
  }
}
