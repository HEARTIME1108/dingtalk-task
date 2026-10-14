<template>
  <div class="page">
    <!-- 蓝色渐变头部 -->
    <div class="header-bar">
      <div class="header-top-row">
        <div class="header-title">任务管理</div>
        <div class="header-export" @click="exportTasks">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>
          </svg>
          <span>导出</span>
        </div>
      </div>

      <!-- 统计卡片 -->
      <div class="stat-row">
        <div class="stat-card">
          <div class="stat-num">{{ counts.all || 0 }}</div>
          <div class="stat-label">全部</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">{{ counts.todo || 0 }}</div>
          <div class="stat-label">待办</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">{{ counts.in_progress || 0 }}</div>
          <div class="stat-label">进行中</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">{{ counts.done || 0 }}</div>
          <div class="stat-label">已完成</div>
        </div>
      </div>
    </div>

    <!-- 状态标签 -->
    <div class="tab-row">
      <div v-for="(label, key) in tabs" :key="key"
        class="tab-item" :class="{ active: active === key }"
        @click="active = key; load()">
        {{ label }}<span class="tab-count">{{ counts[key] || 0 }}</span>
      </div>
    </div>

    <!-- 排序 / 分组 -->
    <div class="sort-row">
      <div v-for="s in sortOptions" :key="s.key"
        class="sort-item" :class="{ active: sortBy === s.key }"
        @click="sortBy = s.key">
        {{ s.label }}
      </div>
    </div>

    <!-- 搜索 -->
    <div class="search-row">
      <input v-model="keyword" class="search-input" placeholder="搜索任务标题/描述" @keyup.enter="load" />
    </div>

    <!-- 标签筛选 -->
    <div v-if="allTags.length" class="tag-filter-row">
      <div v-for="t in allTags" :key="t.id"
        class="tag-filter" :class="{ active: activeTag === t.id }"
        :style="activeTag === t.id ? { background: t.color || '#4472C4', borderColor: t.color || '#4472C4' } : { color: t.color || '#4472C4', borderColor: t.color || '#4472C4' }"
        @click="toggleTag(t.id)">
        {{ t.name }}({{ tagCounts[t.id] || 0 }})
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="error-banner">{{ errorMsg }}</div>

    <!-- 任务列表 -->
    <div class="task-list">
      <div v-for="t in displayTasks" :key="t.id">
        <div v-if="showHeaderBefore(t)" class="group-header">{{ groupKeyOf(t) }}<span class="group-count">{{ groupCountMap[groupKeyOf(t)] || 0 }}</span></div>
        <div class="card-wrap">
        <div class="swipe-actions" :style="{ width: revealW(t) + 'px' }">
          <button v-for="act in quickActions(t)" :key="act.to"
            class="swipe-btn" :style="{ background: act.color }"
            @click.stop="doQuickAction(t, act)">{{ act.label }}</button>
        </div>
        <div class="task-card"
          :class="{ selected: selectedIds.includes(t.id), selectMode }"
          :style="{ transform: cardTransform(t) }"
          @click="onTaskClick(t)"
          @touchstart="onCardTouchStart($event, t)" @touchmove="onCardTouchMove($event, t)" @touchend="onCardTouchEnd($event, t)"
        >
        <div class="task-top">
          <div class="task-tags">
            <span v-if="selectMode" class="check-circle" :class="{ checked: selectedIds.includes(t.id) }">
              <svg v-if="selectedIds.includes(t.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3">
                <path d="M5 12l5 5L20 7"/>
              </svg>
            </span>
            <span v-if="t.task_type" class="badge type-badge">{{ TASK_TYPE_LABEL[t.task_type] }}</span>
            <span v-if="t.priority" class="badge priority-badge" :style="{ borderColor: PRIORITY_COLOR[t.priority], color: PRIORITY_COLOR[t.priority] }">{{ PRIORITY_LABEL[t.priority] }}</span>
          </div>
          <span v-if="t.assignee" class="task-assignee">@{{ t.assignee.name }}</span>
        </div>
        <div class="task-title-row">
          <span class="task-title">{{ t.title }}</span>
          <span v-for="tg in (t.tags || [])" :key="tg.tag_id || tg.id"
            class="badge tag-label" :style="{ borderColor: (tg.tag?.color) || '#4472C4', color: (tg.tag?.color) || '#4472C4' }">
            {{ tg.tag?.name || tg.name }}
          </span>
        </div>
        <!-- 流程进度 -->
        <div class="flow-row">
          <div class="flow-step">
            <span class="flow-dot" :class="{ active: true }"></span>
            <span class="flow-text">{{ getFlowCurrent(t) }}</span>
          </div>
          <div v-if="getFlowNext(t)" class="flow-arrow">→</div>
          <div v-if="getFlowNext(t)" class="flow-step">
            <span class="flow-dot next"></span>
            <span class="flow-text next">{{ getFlowNext(t) }}</span>
          </div>
        </div>
        <div v-if="t.due_date" class="time-wrap">
          <div class="time-bar"><div class="time-fill" :style="{ width: timePct(t) + '%', background: timeColor(t) }"></div></div>
          <span class="time-label" :style="{ color: timeColor(t) }">{{ timeLabel(t) }}</span>
        </div>
        <div class="task-bottom">
          <span class="status-badge" :style="{ background: STATUS_COLOR[t.status] }">{{ STATUS_LABEL[t.status] }}</span>
          <span v-if="t.due_date" class="task-due">截止 {{ t.due_date }}</span>
        </div>
        </div>
        </div>
      </div>
      <div v-if="!loading && tasks.length === 0" class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-text">暂无任务</div>
      </div>
      <div v-if="loading" class="loading-text">加载中...</div>
    </div>

    <!-- 新建按钮 -->
    <div v-if="!selectMode" class="fab" @click="$router.push('/tasks/new')">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    </div>

    <!-- 批量操作栏 -->
    <div v-if="selectMode" class="batch-bar">
      <div class="batch-left">
        <span class="batch-count">已选 {{ selectedIds.length }} 项</span>
        <span class="batch-select-all" @click="toggleSelectAll">全选</span>
      </div>
      <div class="batch-actions">
        <button class="batch-btn complete" @click="batchComplete" :disabled="selectedIds.length === 0">批量完成</button>
        <button class="batch-btn delete" @click="batchDelete" :disabled="selectedIds.length === 0">批量删除</button>
        <button class="batch-btn cancel" @click="exitSelectMode">取消</button>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="toast.show" class="toast">{{ toast.msg }}</div>

    <!-- 删除确认弹窗 -->
    <div v-if="confirmShow" class="popup-overlay" @click="confirmShow = false">
      <div class="confirm-modal" @click.stop>
        <div class="confirm-title">确认删除</div>
        <div class="confirm-msg">删除选中的 {{ selectedIds.length }} 个任务？删除后无法恢复。</div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="confirmShow = false">取消</button>
          <button class="confirm-btn delete" @click="doBatchDelete">确认删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  fetchTasks, fetchTaskCounts, fetchTags, deleteTask, quickCompleteTask, transitionTask,
  STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR, TASK_TYPE_LABEL
} from '../api/task'
import { userStore, loadUser } from '../stores/user'

const route = useRoute()
const router = useRouter()

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
const errorMsg = ref('')
const counts = ref({ all: 0, todo: 0, in_progress: 0, pending_review: 0, done: 0 })

const allTags = ref([])
const activeTag = ref(null)
const tagCounts = ref({})

const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

// 排序 / 分组
const sortBy = ref('latest')   // latest 最新 / due 按截止日期 / assignee 按负责人
const sortOptions = [
  { key: 'latest', label: '最新' },
  { key: 'due', label: '按截止日期' },
  { key: 'assignee', label: '按负责人' }
]

const displayTasks = computed(() => {
  const list = [...tasks.value]
  if (sortBy.value === 'due') {
    list.sort((a, b) => {
      const da = a.due_date || '9999-12-31'
      const db = b.due_date || '9999-12-31'
      return da < db ? -1 : da > db ? 1 : 0
    })
  } else if (sortBy.value === 'assignee') {
    list.sort((a, b) => (a.assignee?.name || '未分配').localeCompare(b.assignee?.name || '未分配', 'zh'))
  }
  return list
})

function groupKeyOf(t) {
  return sortBy.value === 'assignee' ? (t.assignee?.name || '未分配') : ''
}
const groupCountMap = computed(() => {
  const m = {}
  for (const t of displayTasks.value) {
    const k = groupKeyOf(t)
    m[k] = (m[k] || 0) + 1
  }
  return m
})
const groupFirstId = computed(() => {
  const m = {}
  for (const t of displayTasks.value) {
    const k = groupKeyOf(t)
    if (!(k in m)) m[k] = t.id
  }
  return m
})
function showHeaderBefore(t) {
  return sortBy.value === 'assignee' && groupFirstId.value[groupKeyOf(t)] === t.id
}

// 时间进度(创建 → 截止)
function timePct(t) {
  if (!t.due_date) return 0
  const due = new Date(t.due_date + 'T23:59:59').getTime()
  const start = t.created_at ? new Date(t.created_at).getTime() : (due - 7 * 86400000)
  const total = due - start
  if (total <= 0) return 100
  return Math.max(0, Math.min(100, Math.round(((Date.now() - start) / total) * 100)))
}
function timeColor(t) {
  if (t.status === 'done' || t.status === 'closed') return '#07c160'
  const p = timePct(t)
  if (p >= 80) return '#ee0a24'
  if (p >= 50) return '#ff976a'
  return '#1989fa'
}
function timeLabel(t) {
  if (t.status === 'done' || t.status === 'closed') return '已完成'
  const due = new Date(t.due_date + 'T23:59:59').getTime()
  const d = Math.ceil((due - Date.now()) / 86400000)
  if (d < 0) return `已逾期 ${Math.abs(d)} 天`
  if (d === 0) return '今天截止'
  return `剩 ${d} 天`
}

// 批量选择
const selectMode = ref(false)
const selectedIds = ref([])
const longPressTimer = ref(null)
const longPressTriggered = ref(false)

// Toast
const toast = reactive({ show: false, msg: '' })
function showToast(msg) {
  toast.msg = msg
  toast.show = true
  setTimeout(() => { toast.show = false }, 2000)
}

// 确认弹窗
const confirmShow = ref(false)

function toggleTag(id) {
  activeTag.value = activeTag.value === id ? null : id
  load()
}

// 流程进度
function getFlowCurrent(t) {
  switch (t.status) {
    case 'todo': return `待执行 · ${t.assignee?.name || '未分配'}`
    case 'in_progress': return `执行中 · ${t.assignee?.name || ''}`
    case 'pending_review': return `待审核 · ${t.reviewer?.name || ''}`
    case 'rejected': return `已驳回 · ${t.assignee?.name || ''}`
    case 'done': return '已完成'
    case 'closed': return '已关闭'
    default: return ''
  }
}

function getFlowNext(t) {
  switch (t.status) {
    case 'todo': return `${t.assignee?.name || ''} 开始执行`
    case 'in_progress': return `${t.reviewer?.name || ''} 审核`
    case 'pending_review': return '审核通过/驳回'
    case 'rejected': return `${t.assignee?.name || ''} 重新执行`
    default: return ''
  }
}

async function loadCounts() {
  try {
    counts.value = await fetchTaskCounts()
  } catch (e) {}
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  swipeOpenId.value = null
  try {
    let list = await fetchTasks({ status: active.value, keyword: keyword.value })
    const tc = {}
    for (const t of list) {
      if (t.tags) {
        for (const tg of t.tags) {
          const tid = tg.tag_id || tg.id
          tc[tid] = (tc[tid] || 0) + 1
        }
      }
    }
    tagCounts.value = tc
    if (activeTag.value) {
      list = list.filter(t => t.tags?.some(tg => (tg.tag_id || tg.id) === activeTag.value))
    }
    tasks.value = list
    loadCounts()
  } catch (e) {
    errorMsg.value = '加载失败：' + (e.message || '未知错误')
  } finally {
    loading.value = false
  }
}

// ============ 左滑快捷操作 + 长按进入选择模式 ============
const REVEAL_UNIT = 76
const swipeOpenId = ref(null)   // 当前展开的卡片 id
const dragId = ref(null)        // 正在拖动的卡片 id
const dragX = ref(0)            // 拖动位移(px,<=0)
const dragging = ref(false)     // 是否已判定为横向拖动
let startX = 0
let startY = 0
let suppressClick = false

// 当前用户在该任务上可执行的"下一步"操作
function quickActions(t) {
  const me = userStore.user?.id
  const admin = !!userStore.profile?.is_admin
  const acts = []
  if (t.status === 'todo' && (t.assignee_id === me || admin)) {
    acts.push({ label: '开始执行', to: 'in_progress', color: '#1989fa' })
  }
  if (t.status === 'in_progress' && (t.assignee_id === me || admin)) {
    acts.push({ label: '提交审核', to: 'pending_review', color: '#1989fa' })
  }
  if (t.status === 'pending_review' && (t.reviewer_id === me || admin)) {
    acts.push({ label: '通过', to: 'done', color: '#07c160' })
    acts.push({ label: '驳回', to: 'rejected', color: '#ee0a24' })
  }
  if (t.status === 'rejected' && (t.assignee_id === me || admin)) {
    acts.push({ label: '重新执行', to: 'in_progress', color: '#1989fa' })
  }
  if (t.status === 'done' && t.task_type === 'department' && (t.department_head_id === me || admin)) {
    acts.push({ label: '关闭', to: 'closed', color: '#969799' })
  }
  if (t.status === 'done' && t.task_type === 'team' && (t.creator_id === me || admin)) {
    acts.push({ label: '关闭', to: 'closed', color: '#969799' })
  }
  return acts
}

function revealW(t) { return quickActions(t).length * REVEAL_UNIT }

function cardTransform(t) {
  if (dragId.value === t.id && dragging.value) return `translateX(${dragX.value}px)`
  if (swipeOpenId.value === t.id) return `translateX(-${revealW(t)}px)`
  return 'translateX(0)'
}

function closeSwipe() { swipeOpenId.value = null }

function clearLongPress() {
  if (longPressTimer.value) { clearTimeout(longPressTimer.value); longPressTimer.value = null }
}

function onCardTouchStart(e, t) {
  if (selectMode.value) return
  const p = e.touches[0]
  startX = p.clientX
  startY = p.clientY
  dragId.value = t.id
  dragging.value = false
  dragX.value = 0
  longPressTriggered.value = false
  longPressTimer.value = setTimeout(() => {
    if (!longPressTriggered.value && !dragging.value) {
      longPressTriggered.value = true
      closeSwipe()
      enterSelectMode(t)
    }
  }, 500)
}

function onCardTouchMove(e, t) {
  if (selectMode.value || dragId.value !== t.id) return
  const p = e.touches[0]
  const dx = p.clientX - startX
  const dy = p.clientY - startY
  if (!dragging.value) {
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) + 2) {
      dragging.value = true
      clearLongPress()
    } else {
      return
    }
  }
  const max = revealW(t)
  if (max <= 0) { dragging.value = false; return }
  let x = swipeOpenId.value === t.id ? dx - max : dx
  if (x > 0) x = 0
  if (x < -max) x = -max
  dragX.value = x
}

function onCardTouchEnd(e, t) {
  clearLongPress()
  if (dragId.value !== t.id) return
  if (!selectMode.value && dragging.value) {
    const max = revealW(t)
    swipeOpenId.value = (max > 0 && dragX.value <= -max * 0.4) ? t.id : null
    suppressClick = true
    setTimeout(() => { suppressClick = false }, 300)
  }
  dragId.value = null
  dragging.value = false
  dragX.value = 0
}

// 快捷流转到下一流程
async function doQuickAction(t, act) {
  closeSwipe()
  try {
    await transitionTask(t.id, t.status, act.to, `${act.label}(列表快捷)`)
    showToast(`已${act.label}`)
    await load()
  } catch (e) {
    showToast(e.message || '操作失败')
  }
}

// 导出当前列表为 CSV
function csvCell(v) { return `"${String(v ?? '').replace(/"/g, '""')}"` }
function exportTasks() {
  const rows = displayTasks.value
  if (!rows.length) { showToast('没有可导出的任务'); return }
  const header = ['标题', '状态', '任务类型', '任务周期', '负责人', '审批人', '截止日期', '创建人', '创建时间']
  const lines = [header.join(',')]
  for (const t of rows) {
    lines.push([
      csvCell(t.title),
      STATUS_LABEL[t.status] || t.status || '',
      TASK_TYPE_LABEL[t.task_type] || '',
      PRIORITY_LABEL[t.priority] || '',
      csvCell(t.assignee?.name || ''),
      csvCell(t.reviewer?.name || ''),
      t.due_date || '',
      csvCell(t.creator?.name || ''),
      t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : ''
    ].join(','))
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `任务清单_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast('已导出当前列表')
}

function enterSelectMode(task) {
  selectMode.value = true
  selectedIds.value = [task.id]
  showToast('已进入批量选择模式')
}

function exitSelectMode() {
  selectMode.value = false
  selectedIds.value = []
}

function onTaskClick(task) {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (longPressTriggered.value) {
    longPressTriggered.value = false
    return
  }
  // 有卡片处于展开状态时,点击只收起
  if (swipeOpenId.value) {
    swipeOpenId.value = null
    return
  }
  if (selectMode.value) {
    toggleSelect(task.id)
  } else {
    router.push(`/tasks/${task.id}`)
  }
}

function toggleSelect(id) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) {
    selectedIds.value.splice(idx, 1)
  } else {
    selectedIds.value.push(id)
  }
}

function toggleSelectAll() {
  if (selectedIds.value.length === tasks.value.length) {
    selectedIds.value = []
  } else {
    selectedIds.value = tasks.value.map(t => t.id)
  }
}

// 一键完成
async function quickComplete(task) {
  try {
    await quickCompleteTask(task.id, '一键完成')
    showToast('任务已完成')
    await load()
  } catch (e) {
    showToast(e.message || '操作失败')
  }
}

// 批量完成
async function batchComplete() {
  const targets = tasks.value.filter(t => selectedIds.value.includes(t.id) && t.status !== 'done' && t.status !== 'closed')
  if (targets.length === 0) {
    showToast('选中的任务都已完成或关闭')
    return
  }
  let ok = 0
  let fail = 0
  for (const t of targets) {
    try {
      await quickCompleteTask(t.id, '批量完成')
      ok++
    } catch (e) {
      fail++
    }
  }
  showToast(`完成 ${ok} 个${fail ? '，失败 ' + fail + ' 个' : ''}`)
  exitSelectMode()
  await load()
}

// 批量删除
function batchDelete() {
  if (selectedIds.value.length === 0) return
  confirmShow.value = true
}

async function doBatchDelete() {
  confirmShow.value = false
  let ok = 0
  let fail = 0
  for (const id of selectedIds.value) {
    try {
      await deleteTask(id)
      ok++
    } catch (e) {
      fail++
    }
  }
  showToast(`删除 ${ok} 个${fail ? '，失败 ' + fail + ' 个' : ''}`)
  exitSelectMode()
  await load()
}

onMounted(async () => {
  try {
    allTags.value = await fetchTags()
  } catch (e) {}
  // 加载当前用户(用于左滑快捷操作的角色判断)
  if (!userStore.user) {
    try { await loadUser() } catch (e) {}
  }
  await load()
})

watch(() => route.path, (newPath) => {
  if (newPath === '/tasks') load()
})
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding-bottom: 140px; }

/* 蓝色渐变头部 */
.header-bar {
  background: linear-gradient(135deg, #4472C4, #5b8def);
  padding: 40px 16px 16px;
}
.header-top-row { position: relative; margin-bottom: 14px; height: 26px; }
.header-title { position: absolute; left: 50%; transform: translateX(-50%); color: #fff; font-size: 18px; font-weight: 700; }
.header-export {
  position: absolute; right: 0; top: 1px;
  display: flex; align-items: center; gap: 4px;
  color: #fff; font-size: 13px; opacity: 0.95; cursor: pointer;
}
.header-export:active { opacity: 0.7; }

/* 统计卡片 */
.stat-row {
  display: flex; gap: 6px;
}
.stat-card {
  flex: 1; background: rgba(255,255,255,0.15); border-radius: 8px;
  padding: 8px 4px; text-align: center;
}
.stat-num { font-size: 20px; font-weight: 700; color: #fff; }
.stat-label { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 1px; }

/* 状态标签 */
.tab-row {
  display: flex; padding: 12px 12px 8px; gap: 6px;
  overflow-x: auto; -webkit-overflow-scrolling: touch;
}
.tab-row::-webkit-scrollbar { display: none; }
.tab-item {
  padding: 6px 16px; border-radius: 20px; font-size: 13px;
  background: #fff; color: #646566; white-space: nowrap;
  cursor: pointer; border: 1px solid #ebedf0;
  transition: all 0.2s;
}
.tab-item.active {
  background: #4472C4; color: #fff; border-color: #4472C4;
}
.tab-count {
  margin-left: 2px; font-size: 12px; opacity: 0.7;
}
.tab-item.active .tab-count { opacity: 0.9; }

/* 排序 / 分组切换 */
.sort-row {
  display: flex; gap: 6px; padding: 0 12px 8px;
  overflow-x: auto; -webkit-overflow-scrolling: touch;
}
.sort-row::-webkit-scrollbar { display: none; }
.sort-item {
  padding: 5px 14px; border-radius: 16px; font-size: 12px;
  background: #fff; color: #646566; white-space: nowrap;
  cursor: pointer; border: 1px solid #ebedf0; transition: all 0.2s;
}
.sort-item.active {
  background: #e8f0fe; color: #4472C4; border-color: #4472C4; font-weight: 600;
}

/* 搜索 */
.search-row { padding: 0 12px 8px; }
.search-input {
  width: 100%; box-sizing: border-box;
  padding: 8px 14px; border: 1px solid #ebedf0; border-radius: 20px;
  font-size: 14px; outline: none; background: #fff;
}
.search-input:focus { border-color: #4472C4; }

/* 标签筛选 */
.tag-filter-row {
  display: flex; gap: 6px; padding: 0 12px 8px;
  overflow-x: auto; -webkit-overflow-scrolling: touch;
}
.tag-filter-row::-webkit-scrollbar { display: none; }
.tag-filter {
  padding: 4px 12px; border-radius: 20px; font-size: 12px;
  border: 1px solid; background: #fff; white-space: nowrap;
  cursor: pointer; transition: all 0.2s;
}

/* 错误提示 */
.error-banner {
  margin: 8px 12px; padding: 10px 14px;
  background: #ee0a24; color: #fff; border-radius: 8px; font-size: 14px;
}

/* 任务列表 */
.task-list { padding: 4px 12px; }
.card-wrap {
  position: relative; overflow: hidden; border-radius: 10px;
  margin-bottom: 8px; background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.swipe-actions {
  position: absolute; top: 0; right: 0; bottom: 0;
  display: flex; align-items: stretch;
}
.swipe-btn {
  flex: 1; min-width: 0; border: none; color: #fff; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; padding: 0; white-space: nowrap;
}
.task-card {
  position: relative; z-index: 1;
  background: #fff; border-radius: 10px; padding: 14px;
  cursor: pointer; transition: transform 0.2s ease;
  touch-action: pan-y;
}
.task-card.selectMode { padding-left: 8px; }
.task-card.selected {
  background: #f0f6ff;
  border: 1.5px solid #4472C4;
}
.task-top {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.task-tags { display: flex; gap: 6px; flex: 1; align-items: center; }
.badge {
  padding: 2px 8px; border-radius: 4px; font-size: 11px;
  border: 1px solid;
}
.type-badge { border-color: #4472C4; color: #4472C4; }
.priority-badge { }
.task-assignee { font-size: 13px; color: #646566; white-space: nowrap; }
.task-title-row {
  display: flex; align-items: flex-start; gap: 6px;
  margin-bottom: 8px;
}
.task-title {
  font-size: 15px; font-weight: 500; color: #323233;
  line-height: 1.4; flex: 1;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.task-title-row .badge { flex-shrink: 0; margin-top: 2px; }
.task-bottom {
  display: flex; align-items: center; gap: 10px;
}

/* 流程进度 */
.flow-row {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 8px; font-size: 12px;
}
.flow-step { display: flex; align-items: center; gap: 4px; }
.flow-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #4472C4; flex-shrink: 0;
}
.flow-dot.next { background: #c8c9cc; }
.flow-text { color: #323233; font-weight: 500; }
.flow-text.next { color: #969799; }
.flow-arrow { color: #c8c9cc; font-size: 12px; }
.status-badge {
  padding: 2px 10px; border-radius: 4px; font-size: 12px;
  color: #fff;
}
.task-due { font-size: 12px; color: #969799; }

/* 分组表头(按负责人分组时显示) */
.group-header {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 4px 6px; font-size: 13px; font-weight: 600; color: #4472C4;
}
.group-count {
  font-size: 11px; font-weight: 400; color: #fff;
  background: #4472C4; border-radius: 10px; padding: 1px 7px;
}

/* 时间进度条(创建 → 截止) */
.time-wrap {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
}
.time-bar {
  flex: 1; height: 6px; border-radius: 3px;
  background: #ebedf0; overflow: hidden;
}
.time-fill {
  height: 100%; border-radius: 3px; transition: width 0.3s;
}
.time-label {
  font-size: 12px; font-weight: 600; white-space: nowrap;
}

/* 选择圆圈 */
.check-circle {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid #c8c9cc; display: flex; align-items: center;
  justify-content: center; flex-shrink: 0; transition: all 0.2s;
}
.check-circle.checked {
  background: #4472C4; border-color: #4472C4;
}

/* 空状态 */
.empty-state { text-align: center; padding: 40px 0; }
.empty-icon { font-size: 48px; }
.empty-text { color: #969799; font-size: 14px; margin-top: 8px; }
.loading-text { text-align: center; padding: 20px; color: #969799; font-size: 14px; }

/* 浮动按钮 */
.fab {
  position: fixed; right: 20px; bottom: 84px;
  width: 52px; height: 52px; border-radius: 50%;
  background: linear-gradient(135deg, #4472C4, #5b8def);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(68,114,196,0.4);
  cursor: pointer; z-index: 50;
  transition: transform 0.15s;
}
.fab:active { transform: scale(0.9); }

/* 批量操作栏 */
.batch-bar {
  position: fixed; left: 0; right: 0; bottom: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: #fff;
  box-shadow: 0 -2px 12px rgba(0,0,0,0.1);
  z-index: 100;
}
.batch-left { display: flex; align-items: center; gap: 12px; }
.batch-count { font-size: 14px; font-weight: 600; color: #323233; }
.batch-select-all { font-size: 13px; color: #4472C4; cursor: pointer; }
.batch-actions { display: flex; gap: 8px; }
.batch-btn {
  padding: 6px 14px; border-radius: 6px; font-size: 13px;
  border: 1px solid; background: #fff; cursor: pointer;
}
.batch-btn.complete { border-color: #07c160; color: #07c160; }
.batch-btn.delete { border-color: #ee0a24; color: #ee0a24; }
.batch-btn.cancel { border-color: #c8c9cc; color: #646566; }
.batch-btn:disabled { opacity: 0.4; }
.batch-btn:active { opacity: 0.8; }

/* 弹窗 */
.popup-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5); z-index: 9999;
  display: flex; align-items: center; justify-content: center;
}
.confirm-modal {
  background: #fff; border-radius: 12px; width: 80%; max-width: 320px;
  overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
}
.confirm-title { padding: 20px 16px 8px; font-size: 16px; font-weight: 600; text-align: center; }
.confirm-msg { padding: 8px 24px 20px; font-size: 14px; color: #646566; text-align: center; line-height: 1.6; }
.confirm-actions { display: flex; border-top: 1px solid #ebedf0; }
.confirm-btn {
  flex: 1; padding: 14px 0; border: none; background: #fff;
  font-size: 15px; font-weight: 500; cursor: pointer;
}
.confirm-btn.cancel { color: #969799; border-right: 1px solid #ebedf0; }
.confirm-btn.delete { color: #ee0a24; }

/* Toast */
.toast {
  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
  background: rgba(0,0,0,0.75); color: #fff; padding: 8px 20px;
  border-radius: 8px; font-size: 14px; z-index: 100000;
}
</style>
