import { createApp } from 'vue'
import Vant from 'vant'
import 'vant/lib/index.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(Vant)
app.use(router)
app.mount('#app')

// 注册 Service Worker(仅 HTTPS 环境),二次打开秒开 + 离线可用
// 注意:SW 用 network-first 策略处理 HTML,天然能拿到最新版本,不需要额外 reload
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
    // 检测到 SW 更新时,提示页面已更新(下次打开生效)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // 新 SW 接管后刷新一次,确保加载新资源
      if (!sessionStorage.getItem('sw_reloaded')) {
        sessionStorage.setItem('sw_reloaded', '1')
        location.reload()
      }
    })
  })
}
