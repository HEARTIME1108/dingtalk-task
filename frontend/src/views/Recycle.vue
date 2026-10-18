<template>
  <div class="recycle">
    <van-nav-bar title="回收站" left-arrow @click-left="$router.back()" />
    <div class="recycle-body">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="tasks.length === 0" class="empty">
        <van-empty description="回收站为空" />
      </div>
      <div v-else class="task-list">
        <div v-for="t in tasks" :key="t.id" class="task-card">
          <div class="task-main">
            <div class="task-title">{{ t.title }}</div>
            <div class="task-meta">
              <span>创建人: {{ t.creator?.name || '-' }}</span>
              <span>负责人: {{ t.assignee?.name || '-' }}</span>
            </div>
            <div class="task-meta">
              <span>状态: {{ statusLabel(t.status) }}</span>
              <span>删除于: {{ formatDate(t.deleted_at) }}</span>
            </div>
          </div>
          <div class="task-actions">
            <van-button size="small" type="primary" plain @click="confirmRestore(t)">恢复</van-button>
            <van-button size="small" type="danger" plain @click="confirmDelete(t)">彻底删除</van-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { getRecycleTasks, restoreTask, permanentDeleteTask } from '../api/task'
import { STATUS_LABEL } from '../api/task'

const tasks = ref([])
const loading = ref(true)

function statusLabel(s) { return STATUS_LABEL[s] || s }
function formatDate(d) {
  if (!d) return '-'
  const dt = new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
}

async function load() {
  loading.value = true
  try {
    tasks.value = await getRecycleTasks()
  } catch (e) {
    showToast(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function confirmRestore(t) {
  try {
    await showConfirmDialog({ title: '恢复任务', message: `确定要恢复「${t.title}」吗？` })
    await restoreTask(t.id)
    showToast('已恢复')
    tasks.value = tasks.value.filter(x => x.id !== t.id)
  } catch (e) {
    if (e !== 'cancel') showToast(e.message || '操作失败')
  }
}

async function confirmDelete(t) {
  try {
    await showConfirmDialog({ title: '彻底删除', message: `确定要彻底删除「${t.title}」吗？此操作不可恢复！`, confirmButtonText: '彻底删除', confirmButtonColor: '#ee0a24' })
    await permanentDeleteTask(t.id)
    showToast('已彻底删除')
    tasks.value = tasks.value.filter(x => x.id !== t.id)
  } catch (e) {
    if (e !== 'cancel') showToast(e.message || '操作失败')
  }
}

onMounted(load)
</script>

<style scoped>
.recycle { min-height: 100vh; background: #f7f8fa; }
.recycle-body { padding: 12px; }
.loading { text-align: center; padding: 40px; color: #969799; }
.empty { margin-top: 60px; }
.task-card {
  background: #fff; border-radius: 8px; padding: 12px; margin-bottom: 10px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.task-title { font-size: 15px; font-weight: 600; color: #323233; margin-bottom: 6px; }
.task-meta { font-size: 12px; color: #969799; display: flex; gap: 12px; margin-top: 4px; }
.task-actions { display: flex; gap: 10px; margin-top: 10px; }
</style>
