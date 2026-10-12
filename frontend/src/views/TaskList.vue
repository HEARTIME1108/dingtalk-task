<template>
  <div class="page">
    <van-nav-bar title="任务列表" fixed placeholder>
      <template #right>
        <van-icon name="chart-trending-o" size="20" @click="$router.push('/dashboard')" />
      </template>
    </van-nav-bar>

    <van-tabs v-model:active="active" @change="load">
      <van-tab v-for="(label, key) in tabs" :key="key" :title="`${label}(${counts[key] || 0})`" :name="key" />
    </van-tabs>

    <van-search v-model="keyword" placeholder="搜索任务标题/描述" @search="load" />

    <div v-if="allTags.length" style="display:flex;gap:6px;padding:8px 12px;overflow-x:auto;">
      <van-tag v-for="t in allTags" :key="t.id"
        :type="activeTag === t.id ? 'primary' : 'default'"
        size="medium" plain round @click="toggleTag(t.id)"
      >{{ t.name }}</van-tag>
    </div>

    <!-- 错误提示（红底白字，内联style）-->
    <div v-if="errorMsg"
      style="margin:8px 12px;padding:12px 16px;background:#ee0a24;color:#fff !important;border-radius:8px;font-size:14px;">
      {{ errorMsg }}
    </div>

    <van-pull-refresh v-model="refreshing" @refresh="load">
      <van-list v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="load">
        <van-cell
          v-for="t in tasks"
          :key="t.id"
          class="task-cell"
          is-link
          @click="$router.push(`/tasks/${t.id}`)"
        >
          <div class="task-row">
            <van-tag v-if="t.task_type" type="primary" plain size="medium">
              {{ TASK_TYPE_LABEL[t.task_type] }}
            </van-tag>
            <van-tag :color="PRIORITY_COLOR[t.priority]" plain>
              {{ PRIORITY_LABEL[t.priority] }}
            </van-tag>
            <span class="title">{{ t.title }}</span>
          </div>
          <div class="task-meta">
            <van-tag :color="STATUS_COLOR[t.status]" size="medium">
              {{ STATUS_LABEL[t.status] }}
            </van-tag>
            <span v-if="t.assignee" class="assignee">@{{ t.assignee.name }}</span>
            <span v-if="t.task_type === 'department' && t.department_head" class="assignee">主任 @{{ t.department_head.name }}</span>
            <span v-if="t.due_date" class="due">截止 {{ t.due_date }}</span>
          </div>
        </van-cell>
      </van-list>
    </van-pull-refresh>

    <van-floating-bubble icon="plus" @click="$router.push('/tasks/new')" />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  fetchTasks, fetchTaskCounts, fetchTags, STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR, TASK_TYPE_LABEL
} from '../api/task'

const route = useRoute()

const tabs = {
  all: '全部',
  todo: '待办',
  in_progress: '进行中',
  pending_review: '待审核',
  done: '已完成'
}
const active = ref('all')
const tasks = ref([])
const keyword = ref('')
const loading = ref(false)
const finished = ref(true)
const refreshing = ref(false)
const errorMsg = ref('')
const counts = ref({ all: 0, todo: 0, in_progress: 0, pending_review: 0, done: 0, rejected: 0, closed: 0 })

const allTags = ref([])
const activeTag = ref(null)

function toggleTag(id) {
  activeTag.value = activeTag.value === id ? null : id
  load()
}

async function loadCounts() {
  try {
    counts.value = await fetchTaskCounts()
  } catch (e) {}
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    let list = await fetchTasks({ status: active.value, keyword: keyword.value })
    // 前端按标签筛选（如果任务带 tags 字段）
    if (activeTag.value) {
      list = list.filter(t => t.tags?.some(tg => (tg.tag_id || tg.id) === activeTag.value))
    }
    tasks.value = list
    loadCounts()
  } catch (e) {
    errorMsg.value = '加载失败：' + (e.message || '未知错误')
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

onMounted(async () => {
  try {
    allTags.value = await fetchTags()
  } catch (e) {}
  await load()
})

watch(() => route.path, (newPath) => {
  if (newPath === '/tasks') load()
})
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding-bottom: 60px; }
.task-cell { margin: 8px 12px; border-radius: 8px; overflow: hidden; }
.task-row { display: flex; align-items: center; gap: 8px; }
.task-row .title { font-size: 15px; font-weight: 500; }
.task-meta {
  display: flex; align-items: center; gap: 10px;
  margin-top: 6px; color: #969799; font-size: 12px;
}
</style>
