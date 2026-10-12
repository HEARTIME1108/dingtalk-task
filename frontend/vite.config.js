import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'

const BUILD_TIME = Date.now()

export default defineConfig({
  plugins: [
    vue(),
    Components({ resolvers: [VantResolver()] }),
    // 构建时把版本号写入 version.json,供前端检测更新
    {
      name: 'write-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: BUILD_TIME })
        })
      },
      // 在 index.html 注入版本检测脚本,钉钉缓存严重,必须强制刷新
      transformIndexHtml(html) {
        const script = `
<script>
(function(){
  var CURRENT = ${BUILD_TIME};
  // URL 已带 ?v= 参数说明刚强制刷新过,不再检测,避免无限循环
  if (location.search.indexOf('v=') !== -1) return;
  try {
    fetch('/version.json?t=' + Date.now(), {cache: 'no-store'})
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d && d.version && String(d.version) !== String(CURRENT)) {
          // 跳转到带版本号的新 URL,钉钉会认为是新地址重新加载
          location.replace(location.pathname + '?v=' + d.version);
        }
      })
      .catch(function(){});
  } catch(e) {}
})();
</script>`
        return html.replace('<title>', script + '<title>')
      }
    }
  ],
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME)
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 开发期通过本机代理后端,避免钉钉跨域问题
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:8787',
        changeOrigin: true
      }
    }
  }
})
