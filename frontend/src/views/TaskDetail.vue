<template>
  <div class="page" v-if="task">
    <van-nav-bar title="任务详情" left-arrow @click-left="$router.back()" fixed placeholder>
      <template #right>
        <van-icon v-if="canEdit" name="delete-o" size="20" @click="onDelete" />
      </template>
    </van-nav-bar>

    <van-cell-group inset title="基本信息">
      <van-cell title="标题">
        <template #value><span class="strong">{{ task.title }}</span></template>
      </van-cell>
      <van-cell title="优先级">
        <template #value>
          <van-tag :color="PRIORITY_COLOR[task.priority]" plain>{{ PRIORITY_LABEL[task.priority] }}</van-tag>
        </template>
      </van-cell>
      <van-cell title="状态">
        <template #value>
          <van-tag :color="STATUS_COLOR[task.status]">{{ STATUS_LABEL[task.status] }}</van-tag>
        </template>
      </van-cell>
      <van-cell title="负责人" :value="task.assignee?.name || '-'" />
      <van-cell title="审批人" :value="task.reviewer?.name || '-'" />
      <van-cell title="截止日期" :value="task.due_date || '-'" />
      <van-cell title="创建人" :value="task.creator?.name || '-'" />
      <van-cell title="创建时间" :value="formatTime(task.created_at)" />
    </van-cell-group>

    <van-cell-group inset title="描述" v-if="task.description">
      <van-cell>
        <template #value><div class="desc">{{ task.description }}</div></template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset title="协作者" v-if="task.assignees?.length">
      <van-cell v-for="a in task.assignees" :key="a.user_id" :title="a.user.name">
        <template #value>
          <van-tag plain>{{ a.role === 'reviewer' ? '审批' : a.role === 'watcher' ? '关注' : '执行' }}</van-tag>
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset title="流转记录" v-if="task.flows?.length">
      <van-steps direction="vertical" :active="task.flows.length - 1">
        <van-step v-for="f in task.flows" :key="f.id">
          <h4>{{ f.from_status ? STATUS_LABEL[f.from_status] : '创建' }} → {{ STATUS_LABEL[f.to_status] }}</h4>
          <p v-if="f.comment">{{ f.comment }}</p>
          <p class="meta">{{ f.operator?.name }} · {{ formatTime(f.created_at) }}</p>
        </van-step>
      </van-steps>
    </van-cell-group>

    <div class="action-bar" v-if="nextActions.length">
      <van-button
        v-for="na in nextActions" :key="na.to"
        :type="na.type" block plain
        @click="onTransition(na.to)"
      >{{ na.label }}</van-button>
    </div>

    <van-dialog
      v-model:show="showComment"
      title="填写审批意见"
      show-cancel-button
      @confirm="confirmTransition"
    >
      <van-field v-model="comment" placeholder="可选:填写审批意见" />
    </van-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast, showConfirmDialog } from 'vant'
import dayjs from 'dayjs'
import {
  fetchTask, transitionTask, deleteTask,
  STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR
} from '../api/task'
import { userStore } from '../stores/user'

const route = useRoute()
const router = useRouter()
const task = ref(null)
const showComment = ref(false)
const comment = ref('')
const pendingTo = ref('')

const canEdit = computed(() => task.value?.creator_id === userStore.user?.id)

const nextActions = computed(() => {
  if (!task.value) return []
  const map = {
    draft: [{ type: 'primary', label: '提交审批', to: 'pending_review' }],
    pending_review: [
      { type: 'success', label: '通过审批', to: 'approved' },
      { type: 'danger', label: '驳回', to: 'rejected' }
    ],
    rejected: [{ type: 'primary', label: '重新编辑', to: 'draft' }],
    approved: [{ type: 'primary', label: '开始执行', to: 'in_progress' }],
    in_progress: [
      { type: 'success', label: '标记完成', to: 'done' },
      { type: 'danger', label: '取消任务', to: 'cancelled' }
    ]
  }
  return map[task.value.status] || []
})

function formatTime(t) { return dayjs(t).format('YYYY-MM-DD HH:mm') }

async function load() {
  task.value = await fetchTask(route.params.id)
}

function onTransition(to) {
  pendingTo.value = to
  showComment.value = true
}

async function confirmTransition() {
  try {
    await transitionTask(task.value.id, task.value.status, pendingTo.value, comment.value)
    showToast('已流转')
    comment.value = ''
    await load()
  } catch (e) {
    showToast(e.message || '操作失败')
  }
}

async function onDelete() {
  try {
    await showConfirmDialog({ title: '确认删除', message: '删除后无法恢复,是否继续?' })
    await deleteTask(task.value.id)
    showToast('已删除')
    router.replace('/tasks')
  } catch (e) { /* 取消 */ }
}

onMounted(load)
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding-bottom: 80px; }
.strong { font-weight: 600; }
.desc { white-space: pre-wrap; color: #323233; text-align: left; }
.meta { color: #969799; font-size: 12px; }
.action-bar {
  position: fixed; left: 0; right: 0; bottom: 0;
  display: flex; gap: 8px; padding: 12px; background: #fff;
  box-shadow: 0 -1px 8px rgba(0,0,0,.05);
}
</style>
