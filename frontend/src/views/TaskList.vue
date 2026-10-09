<template>
  <div class="page">
    <van-nav-bar title="任务列表" fixed placeholder>
      <template #right>
        <van-icon name="chart-trending-o" size="20" @click="$router.push('/dashboard')" />
      </template>
    </van-nav-bar>

    <van-tabs v-model:active="active" @change="load">
      <van-tab v-for="(label, key) in tabs" :key="key" :title="label" :name="key" />
    </van-tabs>

    <van-search v-model="keyword" placeholder="搜索任务标题/描述" @search="load" />

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
            <span v-if="t.due_date" class="due">截止 {{ t.due_date }}</span>
          </div>
        </van-cell>
      </van-list>
    </van-pull-refresh>

    <van-floating-bubble icon="plus" @click="$router.push('/tasks/new')" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { showToast } from 'vant'
import {
  fetchTasks, STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR
} from '../api/task'

const tabs = {
  all: '全部',
  draft: '草稿',
  pending_review: '待审',
  in_progress: '进行中',
  done: '已完成'
}
const active = ref('all')
const tasks = ref([])
const keyword = ref('')
const loading = ref(false)
const finished = ref(true)
const refreshing = ref(false)

async function load() {
  loading.value = true
  try {
    tasks.value = await fetchTasks({ status: active.value, keyword: keyword.value })
  } catch (e) {
    showToast(e.message || '加载失败')
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

onMounted(load)
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
