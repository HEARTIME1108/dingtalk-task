<template>
  <div class="tab-shell">
    <router-view />

    <!-- 底部导航(一级 Tab,点击原地切换,不产生返回栈) -->
    <div class="bottom-nav">
      <div class="nav-item" :class="{ active: isActive('tasks') }" @click="go('/tasks')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
        </svg>
        <span>任务</span>
      </div>
      <div class="nav-item" :class="{ active: isActive('dashboard') }" @click="go('/dashboard')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 3v18h18"/><path d="M7 12l4-4 4 4 6-6"/>
        </svg>
        <span>统计</span>
      </div>
      <div class="nav-item" :class="{ active: isActive('settings') }" @click="go('/settings')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span>设置</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

function isActive(name) {
  return route.path === '/' + name
}

// 用 replace 切换,保证 tab 之间来回切换不堆叠历史(不需要"返回")
function go(path) {
  if (route.path !== path) router.replace(path)
}
</script>

<style scoped>
.tab-shell { min-height: 100vh; }

.bottom-nav {
  position: fixed; left: 0; right: 0; bottom: 0;
  min-height: 60px; background: #fff;
  display: flex; align-items: center;
  border-top: 1px solid #ebedf0;
  box-shadow: 0 -1px 6px rgba(0,0,0,0.06);
  z-index: 999; padding-bottom: env(safe-area-inset-bottom);
}
.nav-item {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 3px; font-size: 11px; line-height: 1;
  color: #969799; cursor: pointer;
}
.nav-item svg { display: block; }
.nav-item.active { color: #4472C4; }
.nav-item:active { opacity: 0.7; }
</style>
