// Service Worker:缓存静态资源,实现二次打开秒开
// 策略:带 hash 的资源(JS/CSS/图片)用 cache-first,HTML/version.json 用 network-first
const CACHE_NAME = 'dingtalk-task-static-v2'
const STATIC_EXT = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|webp)$/i

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // 只缓存同源请求
  if (url.origin !== self.location.origin) return

  // API 请求不缓存(走后端实时数据)
  if (url.pathname.startsWith('/api/')) return

  // version.json 和 HTML:网络优先,失败回退缓存
  if (url.pathname === '/version.json' || req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy))
          return res
        })
        .catch(() => caches.match(req))
    )
    return
  }

  // 带 hash 的静态资源:缓存优先(永久有效,文件名变了就换新的)
  if (STATIC_EXT.test(url.pathname) || /assets\//.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached
        return fetch(req).then(res => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy))
          }
          return res
        }).catch(() => cached)
      })
    )
  }
})
