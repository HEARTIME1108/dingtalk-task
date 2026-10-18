<template>
  <div class="page"
    @touchstart.passive="onPageTouchStart"
    @touchmove.passive="onPageTouchMove"
    @touchend="onPageTouchEnd">
    <!-- 蓝色渐变头部(外层高度固定,内部蓝条单独动画,避免滚动时整页重排抖动) -->
    <div class="header-bar" :class="{ shrink: headerShrink }">
      <div class="header-bg"></div>

      <!-- 统计卡片:同时作为筛选入口(点一下即筛选) -->
      <div class="stat-row">
        <div class="stat-card" :class="{ active: isPresetActive('active') }" @click="applyPreset('active')">
          <div class="stat-num">{{ counts.incomplete || 0 }}</div>
          <div class="stat-label">进行中</div>
        </div>
        <div class="stat-card" :class="{ active: isPresetActive('todo') }" @click="applyPreset('todo')">
          <div class="stat-num">{{ counts.todo || 0 }}</div>
          <div class="stat-label">待办</div>
        </div>
        <div class="stat-card" :class="{ active: isPresetActive('pending_review') }" @click="applyPreset('pending_review')">
          <div class="stat-num">{{ counts.pending_review || 0 }}</div>
          <div class="stat-label">待审核</div>
        </div>
        <div class="stat-card" :class="{ active: isPresetActive('done') }" @click="applyPreset('done')">
          <div class="stat-num">{{ counts.done || 0 }}</div>
          <div class="stat-label">已完成</div>
        </div>
        <div class="stat-card" :class="{ active: isPresetActive('all') }" @click="applyPreset('all')">
          <div class="stat-num">{{ counts.all || 0 }}</div>
          <div class="stat-label">全部</div>
        </div>
      </div>

      <!-- 搜索框 + 已选筛选条件(收缩状态显示在一行) -->
      <div class="search-row">
        <input v-model="keyword" class="search-input" placeholder="搜索任务标题/描述" @keyup.enter="load" />
        <div class="filter-chips">
          <span v-for="chip in activeChips" :key="chip" class="chip">{{ chip }}</span>
        </div>
      </div>
    </div>

    <!-- 分类标签(部门任务 / 运行一值 / 运行二值) -->
    <div class="tab-row type-tab-row">
      <div v-for="(label, key) in typeTabs" :key="key"
        class="tab-item" :class="{ active: activeType === key }"
        @click="toggleType(key)">
        {{ label }}
      </div>
    </div>

    <!-- 筛选入口:展开后是 周期 / 排序 / 标签 -->
    <div class="filter-row">
      <div class="filter-toggle" :class="{ on: filterOpen }" @click="filterOpen = !filterOpen">
        筛选<span class="filter-arrow">{{ filterOpen ? '▴' : '▾' }}</span>
      </div>
      <div class="filter-summary">
        <span v-for="(c, i) in panelChips" :key="i" class="summary-chip">{{ c }}</span>
      </div>
    </div>

    <div v-if="filterOpen" class="filter-panel">
      <div class="panel-group">
        <div class="panel-label">周期</div>
        <div class="panel-chips">
          <div v-for="(label, key) in priorityTabs" :key="key"
            class="chip" :class="{ active: activePriority === key }"
            @click="togglePriority(key)">{{ label }}</div>
        </div>
      </div>
      <div class="panel-group">
        <div class="panel-label">排序</div>
        <div class="panel-chips">
          <div v-for="s in sortOptions" :key="s.key"
            class="chip" :class="{ active: sortBy === s.key }"
            @click="onSort(s.key)">
            {{ s.label }}<span v-if="sortBy === s.key" class="chip-arrow">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
          </div>
        </div>
      </div>
      <div v-if="allTags.length" class="panel-group">
        <div class="panel-label">标签</div>
        <div class="panel-chips">
          <div v-for="t in allTags" :key="t.id"
            class="chip" :class="{ active: activeTag === t.id }"
            :style="activeTag === t.id ? { background: t.color || '#4472C4', borderColor: t.color || '#4472C4' } : { color: t.color || '#4472C4', borderColor: t.color || '#4472C4' }"
            @click="toggleTag(t.id)">
            {{ t.name }}<span class="chip-count">{{ tagCounts[t.id] || 0 }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="error-banner">{{ errorMsg }}</div>

    <!-- 任务列表 -->
    <div class="task-list">
      <div v-for="t in displayTasks" :key="t.id">
        <div v-if="showHeaderBefore(t)" class="group-header" @click="toggleGroup(groupKeyOf(t))">
          <span class="fold-arrow" :class="{ folded: isGroupCollapsed(groupKeyOf(t)) }">▶</span>
          {{ groupKeyOf(t) }}<span class="group-count">{{ groupCountMap[groupKeyOf(t)] || 0 }}</span>
        </div>
        <div class="card-wrap" v-if="!isGroupCollapsed(groupKeyOf(t))">
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
        <div class="empty-text">{{ viewMode === 'active' ? '暂无进行中的任务' : '暂无任务' }}</div>
        <div v-if="viewMode === 'active' && counts.all > 0" class="empty-action" @click="setViewMode('all')">
          已完成的任务在这里看 →
        </div>
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
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  fetchTasks, fetchTaskCounts, fetchTags, deleteTask, quickCompleteTask, transitionTask,
  STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR, TASK_TYPE_LABEL
} from '../api/task'
import { userStore, loadUser } from '../stores/user'
import { getCache, setCache, CACHE_KEYS } from '../utils/cache'

const route = useRoute()
const router = useRouter()

const tabs = {
  todo: '待办',
  in_progress: '进行中',
  pending_review: '待审核',
  done: '已完成'
}
const active = ref('all')   // 'all' 表示未筛选(不渲染"全部"按钮,再点已选中的按钮即回到未筛选)

// 分类:部门任务 / 运行一值 / 运行二值
const typeTabs = { department: '部门任务', team_a: '运行一值', team_b: '运行二值' }
const activeType = ref('all')

// 任务周期(日/周/月/季/年)
const priorityTabs = { ...PRIORITY_LABEL }
const activePriority = ref('all')

// 视图模式:active=进行中(隐藏已完成/已关闭) / all=全部(含已完成)
const viewMode = ref('active')

// 筛选按钮:点一下选中,再点一下取消(回到未筛选)
function toggleType(key) {
  activeType.value = activeType.value === key ? 'all' : key
  load()
}
// 顶部卡片 = 常用筛选预设(点一下即筛选,再点当前项=取消回到「进行中」)
function applyPreset(key) {
  if (key === 'active') { viewMode.value = 'active'; active.value = 'all' }
  else if (key === 'all') { viewMode.value = 'all'; active.value = 'all' }
  else if (key === 'todo') { viewMode.value = 'active'; active.value = active.value === 'todo' ? 'all' : 'todo' }
  else if (key === 'pending_review') { viewMode.value = 'active'; active.value = active.value === 'pending_review' ? 'all' : 'pending_review' }
  else if (key === 'done') { viewMode.value = 'all'; active.value = active.value === 'done' ? 'all' : 'done' }
  load()
}
function isPresetActive(key) {
  if (key === 'active') return viewMode.value === 'active' && active.value === 'all'
  if (key === 'all') return viewMode.value === 'all' && active.value === 'all'
  if (key === 'todo' || key === 'pending_review') return viewMode.value === 'active' && active.value === key
  if (key === 'done') return viewMode.value === 'all' && active.value === 'done'
  return false
}
function togglePriority(key) {
  activePriority.value = activePriority.value === key ? 'all' : key
  load()
}
function setViewMode(mode) {
  viewMode.value = mode
  if (mode === 'active' && active.value === 'done') active.value = 'all'
  load()
}

// 页面空白处 / 卡片左右边缘 左右滑动 → 按顶部卡片顺序切换预设
const PRESET_ORDER = ['active', 'todo', 'pending_review', 'done', 'all']
const PRESET_NAME = { active: '进行中', todo: '待办', pending_review: '待审核', done: '已完成', all: '全部' }
let pageStartX = 0
let pageStartY = 0
let pageSwiping = false
let pageEligible = false

// 判断这次触摸是否属于「边缘/空白」区域(可触发切换预设)
function isPresetSwipeZone(e) {
  if (selectMode.value) return false   // 批量选择模式下不切换
  const el = e.target
  if (!el || !el.closest) return false
  // 头部、横向可滚动的行、筛选面板、弹窗、批量操作栏都不参与该手势
  if (el.closest('.header-bar, .tab-row, .filter-row, .filter-panel, .popup-overlay, .batch-bar')) return false
  const card = el.closest('.task-card')
  if (!card) return true   // 页面空白处
  const r = card.getBoundingClientRect()
  const x = e.touches[0].clientX
  return (x - r.left) < 22 || (r.right - x) < 22   // 卡片左右边缘
}

function onPageTouchStart(e) {
  pageEligible = isPresetSwipeZone(e)
  pageSwiping = false
  if (!pageEligible) return
  pageStartX = e.touches[0].clientX
  pageStartY = e.touches[0].clientY
}

function onPageTouchMove(e) {
  if (!pageEligible || pageSwiping) return
  const dx = e.touches[0].clientX - pageStartX
  const dy = e.touches[0].clientY - pageStartY
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
    pageSwiping = true
    switchPreset(dx < 0 ? 1 : -1)
  }
}

function onPageTouchEnd() {
  pageEligible = false
  pageSwiping = false
}

// 当前预设(与顶部卡片的选中状态一致)
function currentPresetKey() {
  if (active.value === 'todo') return 'todo'
  if (active.value === 'pending_review') return 'pending_review'
  if (viewMode.value === 'all') return active.value === 'done' ? 'done' : 'all'
  return 'active'
}

function switchPreset(step) {
  const i = PRESET_ORDER.indexOf(currentPresetKey())
  const next = PRESET_ORDER[(i + step + PRESET_ORDER.length) % PRESET_ORDER.length]
  applyPreset(next)
  showToast(PRESET_NAME[next])
}

// 筛选面板展开状态
const filterOpen = ref(false)
// 展开时:滚动页面 或 点其他位置,自动收起(不用再点一下「筛选」)
function onFilterOutsideClick(e) {
  if (!filterOpen.value) return
  const el = e.target
  if (el && el.closest && el.closest('.filter-row, .filter-panel')) return
  filterOpen.value = false
}
function onFilterGesture() {
  if (filterOpen.value) filterOpen.value = false
}
watch(filterOpen, (open) => {
  if (open) {
    document.addEventListener('click', onFilterOutsideClick)
    window.addEventListener('touchmove', onFilterGesture, { passive: true })
    window.addEventListener('wheel', onFilterGesture, { passive: true })
  } else {
    document.removeEventListener('click', onFilterOutsideClick)
    window.removeEventListener('touchmove', onFilterGesture)
    window.removeEventListener('wheel', onFilterGesture)
  }
})
const tasks = ref([])
const keyword = ref('')
const loading = ref(false)
const errorMsg = ref('')
const counts = ref({ all: 0, incomplete: 0, todo: 0, in_progress: 0, pending_review: 0, done: 0 })

const allTags = ref([])
const activeTag = ref(null)
const tagCounts = ref({})

const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

// 排序 / 分组
const sortBy = ref('latest')   // latest 下发时间 / due 截止时间 / remaining 剩余时间 / assignee 姓名
const sortDir = ref('desc')    // 当前排序方向 asc/desc
const sortOptions = [
  { key: 'latest', label: '下发时间', defaultDir: 'desc' },
  { key: 'due', label: '截止时间', defaultDir: 'asc' },
  { key: 'remaining', label: '剩余时间', defaultDir: 'asc' },
  { key: 'assignee', label: '姓名', defaultDir: 'asc' }
]
// 点击排序:同一项切换正/倒序,不同项用该排序的默认方向
function onSort(key) {
  if (sortBy.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = key
    sortDir.value = sortOptions.find(s => s.key === key).defaultDir
  }
}

// 面板内已生效的筛选摘要(周期 / 排序 / 标签)
const panelChips = computed(() => {
  const chips = []
  if (activePriority.value !== 'all') chips.push(priorityTabs[activePriority.value])
  const s = sortOptions.find(x => x.key === sortBy.value)
  if (s) chips.push(s.label + (sortDir.value === 'asc' ? ' ↑' : ' ↓'))
  if (activeTag.value) {
    const t = allTags.value.find(x => x.id === activeTag.value)
    if (t) chips.push(t.name)
  }
  return chips
})

const displayTasks = computed(() => {
  const list = [...tasks.value]
  const dir = sortDir.value === 'asc' ? 1 : -1
  if (sortBy.value === 'due' || sortBy.value === 'remaining') {
    list.sort((a, b) => {
      const da = a.due_date || '9999-12-31'
      const db = b.due_date || '9999-12-31'
      return (da < db ? -1 : da > db ? 1 : 0) * dir
    })
  } else if (sortBy.value === 'assignee') {
    list.sort((a, b) =>
      (a.assignee?.name || '未分配').localeCompare(b.assignee?.name || '未分配', 'zh') * dir
    )
  }
  // latest: 保持后端返回顺序(按下发时间 created_at 倒序);切 asc 时前端反转
  if (sortBy.value === 'latest' && sortDir.value === 'asc') {
    list.reverse()
  }
  return list
})

// ===== 按姓名分组的折叠 =====
const collapsedGroups = ref(new Set())
function toggleGroup(key) {
  const s = new Set(collapsedGroups.value)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  collapsedGroups.value = s
}
function isGroupCollapsed(key) {
  return collapsedGroups.value.has(key)
}

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

async function load(silent = false) {
  if (!silent) {
    loading.value = true
  }
  errorMsg.value = ''
  swipeOpenId.value = null
  try {
    // 取回所有状态的任务,由前端按 分类/状态/标签 过滤
    let list = await fetchTasks({ status: 'all', keyword: keyword.value })
    // 1) 按分类过滤
    if (activeType.value !== 'all') {
      list = list.filter(t => t.task_type === activeType.value)
    }
    // 2) 基于分类过滤后的任务统计各状态数量(顶部统计卡)
    // all = 全部分类任务(含已完成) / incomplete = 未完成任务合计
    const c = { all: list.length, incomplete: 0, todo: 0, in_progress: 0, pending_review: 0, done: 0, closed: 0, rejected: 0 }
    for (const t of list) {
      if (c[t.status] !== undefined) c[t.status]++
      if (t.status !== 'done' && t.status !== 'closed') c.incomplete++
    }
    counts.value = c
    // 3) 标签计数
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
    // 4) 缓存原始任务列表 + 计数 + 标签计数(下次进入秒开)
    setCache(CACHE_KEYS.TASKS, { tasks: list, counts: c, tagCounts: tc })
    // 5) 视图模式:「进行中」视图隐藏已完成/已关闭任务
    if (viewMode.value === 'active') {
      list = list.filter(t => t.status !== 'done' && t.status !== 'closed')
    }
    // 6) 按状态过滤
    if (active.value !== 'all') {
      list = list.filter(t => t.status === active.value)
    }
    // 7) 按任务周期过滤(日/周/月/季/年)
    if (activePriority.value !== 'all') {
      list = list.filter(t => t.priority === activePriority.value)
    }
    // 8) 按标签过滤
    if (activeTag.value) {
      list = list.filter(t => t.tags?.some(tg => (tg.tag_id || tg.id) === activeTag.value))
    }
    tasks.value = list
  } catch (e) {
    // 后台刷新失败时不弹错(缓存还在展示),手动刷新才提示
    if (!silent) {
      errorMsg.value = '加载失败：' + (e.message || '未知错误')
    }
  } finally {
    if (!silent) {
      loading.value = false
    }
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
let edgeStart = false        // 本次触摸是否落在卡片左右边缘(边缘交给页面手势切换预设)

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
  const isTeamType = t.task_type === 'team' || t.task_type === 'team_a' || t.task_type === 'team_b'
  if (t.status === 'done' && isTeamType && (t.creator_id === me || admin)) {
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
  const r = e.currentTarget.getBoundingClientRect()
  // 卡片左右边缘(含卡片内边距)的横向滑动不展开快捷按钮,交给页面手势切换预设
  edgeStart = (p.clientX - r.left) < 22 || (r.right - p.clientX) < 22
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
      if (edgeStart) {
        // 边缘横滑:本卡片不响应,让页面手势去切换预设
        clearLongPress()
        dragId.value = null
        return
      }
      dragging.value = true
      clearLongPress()
    } else if (Math.abs(dy) > 8) {
      // 纵向滚动页面:取消长按,避免误触发批量选择
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

// 顶部头部滚动收起(滞回阈值,避免临界点闪烁)
const headerShrink = ref(false)
function onPageScroll() {
  const y = window.scrollY
  if (headerShrink.value) {
    if (y < 20) headerShrink.value = false
  } else {
    if (y > 50) headerShrink.value = true
  }
}

// 已选筛选条件标签(收缩状态下显示在搜索框旁)
const activeChips = computed(() => {
  const chips = []
  if (viewMode.value === 'all') chips.push('全部任务')
  if (activeType.value !== 'all') chips.push(typeTabs[activeType.value])
  if (active.value !== 'all') chips.push(tabs[active.value])
  if (activePriority.value !== 'all') chips.push(priorityTabs[activePriority.value])
  const sort = sortOptions.find(s => s.key === sortBy.value)
  if (sort) chips.push(sort.label)
  if (activeTag.value) {
    const t = allTags.value.find(x => x.id === activeTag.value)
    if (t) chips.push(t.name)
  }
  if (keyword.value) chips.push(keyword.value)
  return chips
})

onMounted(async () => {
  window.addEventListener('scroll', onPageScroll, { passive: true })

  // 1) 秒开:先从本地缓存读出任务 + 计数 + 标签,立即展示(无需等网络)
  const cachedTasks = getCache(CACHE_KEYS.TASKS)
  if (cachedTasks?.tasks?.length) {
    tasks.value = cachedTasks.tasks
    if (cachedTasks.counts) counts.value = cachedTasks.counts
    if (cachedTasks.tagCounts) tagCounts.value = cachedTasks.tagCounts
  }
  const cachedTags = getCache(CACHE_KEYS.TAGS)
  if (cachedTags?.length) allTags.value = cachedTags

  // 2) 后台并行刷新:标签 / 用户信息 / 任务列表 同时请求
  const refreshTags = fetchTags().then(tags => {
    if (tags?.length) {
      allTags.value = tags
      setCache(CACHE_KEYS.TAGS, tags)
    }
  }).catch(() => {})

  const refreshUser = (!userStore.user) ? loadUser().catch(() => {}) : Promise.resolve()

  // 任务加载(后台刷新,不阻塞首屏)
  const refreshTasks = load(true)

  await Promise.allSettled([refreshTags, refreshUser, refreshTasks])
})

onUnmounted(() => {
  window.removeEventListener('scroll', onPageScroll)
  document.removeEventListener('click', onFilterOutsideClick)
  window.removeEventListener('touchmove', onFilterGesture)
  window.removeEventListener('wheel', onFilterGesture)
  clearTimeout(keywordTimer)
})

// 输入即搜(防抖 400ms):手机上软键盘敲回车不稳定,边打字边搜更顺手
let keywordTimer = null
watch(keyword, () => {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(() => { load() }, 400)
})

watch(() => route.path, (newPath) => {
  // 从详情/编辑页返回时:先展示已有数据,后台静默刷新(不闪 loading)
  if (newPath === '/tasks') load(true)
})
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding-bottom: 140px; }

/* 蓝色渐变头部
   外层高度固定:滚动时只改变内部蓝条高度,不改变外层占位,
   因此不会引起列表整体重排(sticky 抖动/闪烁的根因) */
.header-bar {
  position: sticky; top: 0; z-index: 100;
  height: 162px; box-sizing: border-box;
  padding: 40px 16px 16px;
  overflow: hidden;
  background: transparent;
  transition: padding 0.28s ease;
  transform: translateZ(0);
  backface-visibility: hidden;
}
.header-bar.shrink {
  padding: 12px 16px 12px;
  /* 收缩后只有顶部蓝条是不透明的,下面 100 多像素是透明的;
     必须关掉指针事件,否则会挡住下方列表/筛选按钮的点击 */
  pointer-events: none;
}
.header-bar.shrink .search-row {
  pointer-events: auto;
}

/* 蓝条背景层:独立动画,只影响自身高度 */
.header-bg {
  position: absolute; left: 0; right: 0; top: 0;
  height: 162px;
  background: linear-gradient(135deg, #4472C4, #5b8def);
  transition: height 0.28s ease, background 0.28s ease;
  z-index: -1;
}
.header-bar.shrink .header-bg {
  height: 56px;
  background: #4472C4;
}

/* 统计卡片(收起时高度归零,用 max-height 过渡) */
.stat-row {
  position: relative;
  display: flex; gap: 6px;
  overflow: hidden;
  max-height: 120px;
  opacity: 1;
  margin-bottom: 10px;
  transition: max-height 0.28s, opacity 0.28s, margin-bottom 0.28s;
}
.header-bar.shrink .stat-row {
  max-height: 0;
  opacity: 0;
  margin-bottom: 0;
}
.stat-card {
  flex: 1; min-width: 0; background: rgba(255,255,255,0.15); border-radius: 8px;
  padding: 8px 2px; text-align: center; cursor: pointer;
  transition: background 0.2s;
}
.stat-card.active { background: #fff; }
.stat-card.active .stat-num { color: #4472C4; }
.stat-card.active .stat-label { color: #4472C4; }
.stat-num { font-size: 18px; line-height: 22px; font-weight: 700; color: #fff; }
.stat-label { font-size: 10px; line-height: 13px; color: rgba(255,255,255,0.7); margin-top: 2px; white-space: nowrap; }

/* 搜索框 + 筛选标签 */
.search-row {
  position: relative;
  display: flex; align-items: center; gap: 8px;
  transition: gap 0.3s;
}
.search-input {
  flex: 1; min-width: 0;
  box-sizing: border-box; height: 36px; padding: 0 14px;
  border: none; border-radius: 18px; background: #fff;
  font-size: 14px; outline: none;
  transition: flex 0.3s;
}
.header-bar.shrink .search-input {
  flex: 0 0 45%;
}
.filter-chips {
  display: none;
  flex: 1; min-width: 0;
  gap: 4px; overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.filter-chips::-webkit-scrollbar { display: none; }
.header-bar.shrink .filter-chips { display: flex; }
.chip {
  flex-shrink: 0;
  padding: 3px 10px; border-radius: 12px;
  background: rgba(255,255,255,0.25);
  color: #fff; font-size: 12px; white-space: nowrap;
  max-width: 90px; overflow: hidden; text-overflow: ellipsis;
}

/* 筛选入口行 */
.filter-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 12px 8px;
  overflow-x: auto; -webkit-overflow-scrolling: touch;
}
.filter-toggle {
  flex: none; display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 14px; border-radius: 15px;
  border: 1px solid #dcdfe6; background: #fff;
  color: #646566; font-size: 13px; cursor: pointer;
  transition: all 0.2s;
}
.filter-toggle.on {
  background: #4472C4; border-color: #4472C4; color: #fff;
}
.filter-arrow { font-size: 10px; }
.filter-summary { display: flex; gap: 6px; flex: none; }
.summary-chip {
  flex: none; padding: 4px 10px; border-radius: 12px;
  background: #eef3fb; color: #4472C4; font-size: 12px; white-space: nowrap;
}

/* 展开的筛选面板 */
.filter-panel {
  margin: 0 12px 8px; padding: 10px 12px;
  background: #f7f8fa; border-radius: 10px;
}
.panel-group + .panel-group { margin-top: 10px; }
.panel-label {
  font-size: 11px; color: #969799; margin-bottom: 6px;
}
.panel-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.chip {
  padding: 5px 12px; border-radius: 14px;
  border: 1px solid #dcdfe6; background: #fff;
  color: #646566; font-size: 12px; cursor: pointer;
  transition: all 0.2s;
}
.chip.active {
  background: #4472C4; border-color: #4472C4; color: #fff;
}
.chip-arrow { margin-left: 2px; font-size: 10px; }
.chip-count { margin-left: 3px; opacity: 0.65; }

/* 分类标签 */
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
  border: 1px solid #eef0f3;
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
  cursor: pointer; user-select: none;
}
.fold-arrow {
  display: inline-block;
  font-size: 10px;
  transition: transform 0.2s;
  transform: rotate(90deg); /* 展开时箭头朝下 */
}
.fold-arrow.folded {
  transform: rotate(0deg); /* 折叠时箭头朝右 */
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
.empty-action {
  display: inline-block; margin-top: 14px; padding: 7px 16px;
  border: 1px solid #4472C4; border-radius: 18px;
  color: #4472C4; font-size: 13px; cursor: pointer;
}
.loading-text { text-align: center; padding: 20px; color: #969799; font-size: 14px; }

/* 浮动按钮 */
.fab {
  position: fixed; right: 20px; bottom: calc(84px + env(safe-area-inset-bottom));
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
  position: fixed; left: 0; right: 0;
  bottom: calc(60px + env(safe-area-inset-bottom));
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: #fff;
  box-shadow: 0 -2px 12px rgba(0,0,0,0.1);
  z-index: 1000;
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
