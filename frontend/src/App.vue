<template>
  <router-view />
</template>

<script setup>
import { onMounted } from 'vue'
import { isLoggedIn } from './api/supabase'
import { loadUser } from './stores/user'

onMounted(async () => {
  if (isLoggedIn()) {
    await loadUser()
  }
})
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; background: #f7f8fa; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* 修复钉钉 WebView 里 Vant 弹层被遮挡的问题 */
.van-toast,
.van-dialog,
.van-popup,
.van-overlay,
.van-notify,
.van-action-sheet,
.van-picker,
.van-loading {
  z-index: 9999 !important;
}
.van-overlay {
  z-index: 9998 !important;
}
.van-toast {
  z-index: 10000 !important;
}

/* 修复钉钉 WebView 里弹窗文字看不见(白底白字)的问题 */
.van-dialog__title {
  color: #323233 !important;
  font-size: 16px !important;
  font-weight: 600 !important;
}
.van-dialog__message {
  color: #323233 !important;
  font-size: 14px !important;
}
.van-dialog__cancel,
.van-dialog__confirm {
  color: #1989fa !important;
  font-size: 15px !important;
}
.van-dialog__header {
  padding: 20px 16px 8px !important;
}
.van-dialog__content {
  padding: 12px 24px 20px !important;
}
</style>
