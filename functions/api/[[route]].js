// Cloudflare Pages Functions - 只处理 /api/* 路径
// 静态资源(HTML/CSS/JS)由 Cloudflare Pages 自动 serve
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {} }
} else if (!globalThis.process.env) {
  globalThis.process.env = {}
}

let appPromise
async function getApp() {
  if (!appPromise) {
    appPromise = import('../../worker.js').then(m => m.default)
  }
  return appPromise
}

export const onRequest = async (context) => {
  const { request, env } = context
  if (env && globalThis.process && globalThis.process.env) {
    for (const key in env) {
      if (!globalThis.process.env[key]) {
        try { globalThis.process.env[key] = String(env[key]) } catch (e) {}
      }
    }
  }
  const app = await getApp()
  return app.fetch(request, env, context)
}

export const onRequestGet = onRequest
export const onRequestPost = onRequest
export const onRequestPut = onRequest
export const onRequestPatch = onRequest
export const onRequestDelete = onRequest
