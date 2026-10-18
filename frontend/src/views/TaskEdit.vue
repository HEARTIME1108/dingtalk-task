<template>
  <div class="page">
    <van-nav-bar title="编辑任务" left-arrow @click-left="$router.back()" fixed placeholder />

    <!-- 成功页 -->
    <div v-if="success"
      style="padding:60px 24px;text-align:center;">
      <div style="font-size:48px;margin-bottom:16px;">✅</div>
      <div style="font-size:20px;font-weight:bold;color:#07c160;margin-bottom:8px;">
        修改成功
      </div>
      <div style="font-size:14px;color:#969799;margin-bottom:32px;">
        任务"{{ successTitle }}"已更新
      </div>
      <van-button type="primary" block @click="$router.replace(`/tasks/${route.params.id}`)">
        返回任务详情
      </van-button>
    </div>

    <!-- 加载中 -->
    <div v-else-if="loading" style="padding:60px 24px;text-align:center;color:#969799;">
      <van-loading size="32px">加载中...</van-loading>
    </div>

    <!-- 表单页 -->
    <template v-else>
      <!-- 错误提示（红底白字，内联style）-->
      <div v-if="errorMsg"
        style="margin:8px 12px;padding:14px 16px;background:#ee0a24;color:#fff !important;border-radius:8px;font-size:16px;font-weight:bold;">
        {{ errorMsg }}
      </div>

      <van-form @submit="onSubmit">
        <van-cell-group inset>
          <van-field label="任务类型" is-link readonly
            :model-value="TASK_TYPE_LABEL[form.task_type] || '请选择'"
            @click="showTaskType = true" />
          <van-field
            v-model="form.title" label="标题" placeholder="请输入任务标题"
            required :rules="[{ required: true, message: '请输入标题' }]" />
          <van-field
            v-model="form.description" label="描述"
            type="textarea" rows="3" placeholder="任务详细描述" />
          <van-field label="任务周期" is-link readonly
            :model-value="PRIORITY_LABEL[form.priority] || '请选择'"
            @click="showPriority = true" />
          <van-field
            label="负责人" is-link readonly
            :model-value="labelOf(form.assignee_id)"
            placeholder="请选择" @click="showAssignee = true" />
          <van-field
            label="审批人" is-link readonly
            :model-value="labelOf(form.reviewer_id)"
            placeholder="请选择" @click="showReviewer = true" />
          <van-field
            v-if="form.task_type === 'department'"
            label="部门审批" is-link readonly
            :model-value="labelOf(form.department_head_id)"
            placeholder="请选择" @click="showDepartmentHead = true" />
          <van-field
            label="协作者" is-link readonly
            :model-value="collaboratorIds.length ? `已选 ${collaboratorIds.length} 人` : '请选择'"
            @click="showCollaborators = true" />
          <van-field
            label="截止日期" is-link readonly
            :model-value="form.due_date || ''" placeholder="请选择"
            @click="showDate = true" />
          <van-field
            label="标签"
            is-link readonly
            :model-value="selectedTags.length ? selectedTags.map(t=>t.name).join('、') : '请选择'"
            @click="showTags = true"
          />
        </van-cell-group>

        <div style="padding:16px;">
          <van-button type="primary" block native-type="submit" :loading="submitting">
            提交
          </van-button>
        </div>
      </van-form>

      <van-popup v-model:show="showAssignee" position="bottom" round @open="onPickerOpen" @close="onPickerClose">
        <div class="picker-header">
          <span class="picker-close" @click="showAssignee = false">取消</span>
          <span class="picker-title">选择负责人</span>
          <span class="picker-placeholder"></span>
        </div>
        <van-search v-model="userSearch" placeholder="搜索姓名" shape="round" />
        <div class="picker-list">
          <van-radio-group v-model="form.assignee_id">
            <template v-for="grp in groupedFilteredUsers" :key="grp.key">
              <div class="picker-group-title" @click="togglePickerGroup(grp.key)">
                <span>{{ grp.title }}</span>
                <span class="picker-group-arrow" :class="{ folded: pickerGroupOpen[grp.key] === false }">▼</span>
              </div>
              <template v-if="pickerGroupOpen[grp.key] !== false">
                <van-cell v-for="u in grp.users" :key="u.id" :title="u.name" clickable @click="form.assignee_id = u.id">
                  <template #right-icon><van-radio :name="u.id" /></template>
                </van-cell>
              </template>
            </template>
            <div v-if="filteredUsers.length === 0" class="picker-empty">无匹配人员</div>
          </van-radio-group>
        </div>
        <div class="picker-footer">
          <van-button type="primary" block @click="showAssignee = false">确定</van-button>
        </div>
      </van-popup>

      <van-popup v-model:show="showReviewer" position="bottom" round @open="onPickerOpen" @close="onPickerClose">
        <div class="picker-header">
          <span class="picker-close" @click="showReviewer = false">取消</span>
          <span class="picker-title">选择审批人</span>
          <span class="picker-placeholder"></span>
        </div>
        <van-search v-model="userSearch" placeholder="搜索姓名" shape="round" />
        <div class="picker-list">
          <van-radio-group v-model="form.reviewer_id">
            <template v-for="grp in groupedFilteredUsers" :key="grp.key">
              <div class="picker-group-title" @click="togglePickerGroup(grp.key)">
                <span>{{ grp.title }}</span>
                <span class="picker-group-arrow" :class="{ folded: pickerGroupOpen[grp.key] === false }">▼</span>
              </div>
              <template v-if="pickerGroupOpen[grp.key] !== false">
                <van-cell v-for="u in grp.users" :key="u.id" :title="u.name" clickable @click="form.reviewer_id = u.id">
                  <template #right-icon><van-radio :name="u.id" /></template>
                </van-cell>
              </template>
            </template>
            <div v-if="filteredUsers.length === 0" class="picker-empty">无匹配人员</div>
          </van-radio-group>
        </div>
        <div class="picker-footer">
          <van-button type="primary" block @click="showReviewer = false">确定</van-button>
        </div>
      </van-popup>

      <van-popup v-model:show="showDepartmentHead" position="bottom" round @open="onPickerOpen" @close="onPickerClose">
        <div class="picker-header">
          <span class="picker-close" @click="showDepartmentHead = false">取消</span>
          <span class="picker-title">选择部门审批人</span>
          <span class="picker-placeholder"></span>
        </div>
        <van-search v-model="userSearch" placeholder="搜索姓名" shape="round" />
        <div class="picker-list">
          <van-radio-group v-model="form.department_head_id">
            <template v-for="grp in groupedFilteredUsers" :key="grp.key">
              <div class="picker-group-title" @click="togglePickerGroup(grp.key)">
                <span>{{ grp.title }}</span>
                <span class="picker-group-arrow" :class="{ folded: pickerGroupOpen[grp.key] === false }">▼</span>
              </div>
              <template v-if="pickerGroupOpen[grp.key] !== false">
                <van-cell v-for="u in grp.users" :key="u.id" :title="u.name" clickable @click="form.department_head_id = u.id">
                  <template #right-icon><van-radio :name="u.id" /></template>
                </van-cell>
              </template>
            </template>
            <div v-if="filteredUsers.length === 0" class="picker-empty">无匹配人员</div>
          </van-radio-group>
        </div>
        <div class="picker-footer">
          <van-button type="primary" block @click="showDepartmentHead = false">确定</van-button>
        </div>
      </van-popup>

      <van-popup v-model:show="showCollaborators" position="bottom" round @open="onPickerOpen" @close="onPickerClose">
        <div class="picker-header">
          <span class="picker-close" @click="showCollaborators = false">取消</span>
          <span class="picker-title">选择协作者</span>
          <span class="picker-placeholder"></span>
        </div>
        <van-search v-model="userSearch" placeholder="搜索姓名" shape="round" />
        <div class="picker-list">
          <template v-for="grp in groupedFilteredCollaborators" :key="grp.key">
            <div class="picker-group-title" @click="togglePickerGroup(grp.key)">
              <span>{{ grp.title }}</span>
              <span class="picker-group-arrow" :class="{ folded: pickerGroupOpen[grp.key] === false }">▼</span>
            </div>
            <template v-if="pickerGroupOpen[grp.key] !== false">
              <div v-for="u in grp.users" :key="u.id" class="picker-item" @click="toggleArrayItem(collaboratorIds, u.id)">
                <span class="picker-item-name">{{ u.name }}</span>
                <span class="picker-check" :class="{ checked: collaboratorIds.includes(u.id) }">✓</span>
              </div>
            </template>
          </template>
          <div v-if="filteredCollaborators.length === 0" class="picker-empty">
            {{ collaboratorCandidates.length === 0 ? '负责人、审批人已选中,无可选协作者' : '无匹配人员' }}
          </div>
        </div>
        <div class="picker-footer">
          <van-button type="primary" block @click="showCollaborators = false">确定</van-button>
        </div>
      </van-popup>

      <van-popup v-model:show="showDate" position="bottom" round>
        <van-date-picker
          v-model="dateVal"
          @confirm="onPickDate"
          @cancel="showDate = false" />
      </van-popup>

      <van-popup v-model:show="showTags" position="bottom" round @open="onPickerOpen" @close="onPickerClose">
        <div class="picker-list">
          <div v-for="t in allTags" :key="t.id" class="picker-item" @click="toggleArrayItem(selectedTagIds, t.id)">
            <span class="picker-item-name">{{ t.name }}</span>
            <span class="picker-check" :class="{ checked: selectedTagIds.includes(t.id) }">✓</span>
          </div>
        </div>
        <div v-if="allTags.length === 0" style="padding:24px;text-align:center;color:#969799;font-size:14px;">
          暂无标签，请先在分类设置中添加
        </div>
        <div style="padding:12px;">
          <van-button type="primary" block @click="showTags = false">确定</van-button>
        </div>
      </van-popup>

      <van-popup v-model:show="showTaskType" position="bottom" round>
        <van-radio-group v-model="form.task_type">
          <van-cell v-for="(l, k) in CREATE_TASK_TYPES" :key="k" :title="l" clickable @click="form.task_type = k">
            <template #right-icon>
              <van-radio :name="k" />
            </template>
          </van-cell>
        </van-radio-group>
        <div style="padding:12px;">
          <van-button type="primary" block @click="showTaskType = false">确定</van-button>
        </div>
      </van-popup>

      <van-popup v-model:show="showPriority" position="bottom" round>
        <van-radio-group v-model="form.priority">
          <van-cell title="不选" clickable @click="form.priority = ''">
            <template #right-icon>
              <van-radio name="" />
            </template>
          </van-cell>
          <van-cell v-for="(l, k) in PRIORITY_LABEL" :key="k" :title="l" clickable @click="form.priority = k">
            <template #right-icon>
              <van-radio :name="k" />
            </template>
          </van-cell>
        </van-radio-group>
        <div style="padding:12px;">
          <van-button type="primary" block @click="showPriority = false">确定</van-button>
        </div>
      </van-popup>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  fetchUsers, fetchTask, updateTaskFull, fetchTags, addTagToTask, removeTagFromTask,
  PRIORITY_LABEL, TASK_TYPE_LABEL
} from '../api/task'
import { clearCache, CACHE_KEYS } from '../utils/cache'

// 编辑时可选的类型(排除旧的 team 兼容值)
const CREATE_TASK_TYPES = Object.fromEntries(
  Object.entries(TASK_TYPE_LABEL).filter(([k]) => k !== 'team')
)

const route = useRoute()
const form = ref({
  title: '', description: '', priority: '',
  task_type: 'department',
  assignee_id: null, reviewer_id: null, department_head_id: null, due_date: null
})
const users = ref([])
const submitting = ref(false)
const loading = ref(true)
const showAssignee = ref(false)
const showReviewer = ref(false)
const showDepartmentHead = ref(false)
const showCollaborators = ref(false)
const showDate = ref(false)
const showTaskType = ref(false)
const showPriority = ref(false)
const collaboratorIds = ref([])
const dateVal = ref([])
const errorMsg = ref('')
const success = ref(false)
const successTitle = ref('')

const allTags = ref([])
const selectedTagIds = ref([])
const originalTagIds = ref([])
const showTags = ref(false)
const selectedTags = computed(() => allTags.value.filter(t => selectedTagIds.value.includes(t.id)))

// 选人弹窗搜索
const userSearch = ref('')
// 按任务类型过滤可选人员
function usersByTaskType(list) {
  const t = form.value.task_type
  if (t === 'team_a') return list.filter(u => u.duty === 'team_a_lead' || u.duty === 'team_a_member')
  if (t === 'team_b') return list.filter(u => u.duty === 'team_b_lead' || u.duty === 'team_b_member')
  return list
}
const filteredUsers = computed(() => {
  const q = userSearch.value.trim().toLowerCase()
  const base = usersByTaskType(users.value)
  if (!q) return base
  return base.filter(u => (u.name || '').toLowerCase().includes(q))
})
const filteredCollaborators = computed(() => {
  const q = userSearch.value.trim().toLowerCase()
  const base = usersByTaskType(collaboratorCandidates.value)
  if (!q) return base
  return base.filter(u => (u.name || '').toLowerCase().includes(q))
})
const USER_GROUPS = [
  { key: 'department_head', title: '部门主任', duties: ['department_head'] },
  { key: 'team_a', title: '运行一值', duties: ['team_a_lead', 'team_a_member'] },
  { key: 'team_b', title: '运行二值', duties: ['team_b_lead', 'team_b_member'] },
  { key: 'other', title: '其他', duties: ['member', null, undefined, ''] }
]
// 组内排序:值长在前,员工在后,同级别按姓名
const DUTY_ORDER_IN_GROUP = {
  department_head: 0,
  team_a_lead: 0, team_b_lead: 0,
  team_a_member: 1, team_b_member: 1,
  member: 2
}
function groupUsers(list) {
  return USER_GROUPS.map(g => ({
    ...g,
    users: list.filter(u => g.duties.includes(u.duty)).sort((a, b) => {
      const oa = DUTY_ORDER_IN_GROUP[a.duty] ?? 9
      const ob = DUTY_ORDER_IN_GROUP[b.duty] ?? 9
      if (oa !== ob) return oa - ob
      return (a.name || '').localeCompare(b.name || '', 'zh')
    })
  })).filter(g => g.users.length > 0)
}
// 分组折叠状态
const pickerGroupOpen = ref({})
function togglePickerGroup(key) {
  pickerGroupOpen.value[key] = pickerGroupOpen.value[key] === false
}
// 动态计算列表高度,避免被输入法遮挡
const pickerListStyle = ref({})
let lastVpHeight = 0
let pickerPollTimer = null
function updatePickerHeight(forceSmall) {
  const vv = window.visualViewport
  const vpHeight = vv ? vv.height : window.innerHeight
  lastVpHeight = vpHeight
  const headerH = 100
  const footerH = 60
  const keyboardH = forceSmall ? 300 : 0
  const avail = vpHeight - headerH - footerH - keyboardH
  pickerListStyle.value = { maxHeight: Math.max(avail, 120) + 'px' }
}
function startPickerPoll() {
  stopPickerPoll()
  updatePickerHeight(false)
  pickerPollTimer = setInterval(() => {
    const vv = window.visualViewport
    const cur = vv ? vv.height : window.innerHeight
    if (Math.abs(cur - lastVpHeight) > 10) {
      updatePickerHeight(false)
    }
  }, 150)
}
function stopPickerPoll() {
  if (pickerPollTimer) { clearInterval(pickerPollTimer); pickerPollTimer = null }
}
function onPickerOpen() {
  userSearch.value = ''
  startPickerPoll()
}
function onPickerClose() {
  stopPickerPoll()
  pickerListStyle.value = {}
}
function onSearchFocus() {
  updatePickerHeight(true)
}
function onSearchBlur() {
  setTimeout(() => updatePickerHeight(false), 200)
}
const groupedFilteredUsers = computed(() => groupUsers(filteredUsers.value))
const groupedFilteredCollaborators = computed(() => groupUsers(filteredCollaborators.value))

// 已选的负责人/审批人/部门主任的 id 集合
const excludedIds = computed(() => {
  const ids = new Set()
  if (form.value.assignee_id) ids.add(form.value.assignee_id)
  if (form.value.reviewer_id) ids.add(form.value.reviewer_id)
  if (form.value.department_head_id) ids.add(form.value.department_head_id)
  return ids
})

// 协作者候选名单:排除已选的负责人/审批人/部门主任
const collaboratorCandidates = computed(() =>
  users.value.filter(u => !excludedIds.value.has(u.id))
)

// 当负责人/审批人/部门主任变化时,自动从协作者中移除已被选为这些角色的人
watch(excludedIds, (ids) => {
  collaboratorIds.value = collaboratorIds.value.filter(id => !ids.has(id))
})

const userColumns = computed(() =>
  users.value.map(u => ({ text: u.name, value: u.id }))
)

function labelOf(uid) {
  return users.value.find(u => u.id === uid)?.name || ''
}

function onPick({ selectedValues }, key, refShow) {
  form.value[key] = selectedValues[0]
  refShow.value = false
  if (key === 'task_type') autoFillHead()
}

// 选「部门任务」且还没选部门负责人时,按职务自动带出部门主任(唯一时才带,避免选错)
function autoFillHead() {
  if (form.value.task_type !== 'department') return
  if (form.value.department_head_id) return
  const heads = users.value.filter(u => u.duty === 'department_head')
  if (heads.length === 1) form.value.department_head_id = heads[0].id
}

function toggleArrayItem(arr, id) {
  // 模板里 ref 会自动解包,arr 可能是数组或 ref
  const list = arr.value !== undefined ? arr.value : arr
  const idx = list.indexOf(id)
  if (idx >= 0) {
    list.splice(idx, 1)
  } else {
    list.push(id)
  }
}

function onPickDate({ selectedValues }) {
  form.value.due_date = selectedValues.join('-')
  showDate.value = false
}

async function onSubmit() {
  submitting.value = true
  errorMsg.value = ''
  try {
    const payload = { ...form.value, assignee_ids: collaboratorIds.value }
    // 班组任务不带 department_head_id(仅部门任务需要)
    if (payload.task_type !== 'department') {
      delete payload.department_head_id
    }
    await updateTaskFull(route.params.id, payload)

    // 更新标签：计算新增和移除
    const taskId = route.params.id
    const toAdd = selectedTagIds.value.filter(id => !originalTagIds.value.includes(id))
    const toRemove = originalTagIds.value.filter(id => !selectedTagIds.value.includes(id))
    for (const tagId of toAdd) {
      try { await addTagToTask(taskId, tagId) } catch (e) {}
    }
    for (const tagId of toRemove) {
      try { await removeTagFromTask(taskId, tagId) } catch (e) {}
    }

    // 清除任务列表缓存,确保返回列表时数据是最新的
    clearCache(CACHE_KEYS.TASKS)
    successTitle.value = form.value.title
    success.value = true
  } catch (e) {
    errorMsg.value = '修改失败：' + (e.message || '未知错误')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  try {
    // 同时加载用户列表、任务详情、标签列表
    const [usersData, taskData, tagsData] = await Promise.all([
      fetchUsers(),
      fetchTask(route.params.id),
      fetchTags()
    ])
    users.value = usersData
    allTags.value = tagsData || []
    // 填充表单
    form.value = {
      title: taskData.title || '',
      description: taskData.description || '',
      priority: taskData.priority || 'medium',
      task_type: taskData.task_type || 'department',
      assignee_id: taskData.assignee_id || null,
      reviewer_id: taskData.reviewer_id || null,
      department_head_id: taskData.department_head_id || null,
      due_date: taskData.due_date || null
    }
    // 填充协作者（从 task.assignees 中提取 role 为 collaborator/executor 的用户）
    if (taskData.assignees?.length) {
      collaboratorIds.value = taskData.assignees
        .filter(a => a.role === 'collaborator' || a.role === 'executor' || !a.role)
        .map(a => a.user_id)
        // 排除已是负责人/审批人/部门主任的
        .filter(id => !excludedIds.value.has(id))
    }
    // 填充已选标签
    if (taskData.tags?.length) {
      selectedTagIds.value = taskData.tags.map(t => t.tag_id || t.id)
    }
    originalTagIds.value = [...selectedTagIds.value]
    // 填充日期选择器
    if (taskData.due_date) {
      dateVal.value = taskData.due_date.split('-')
    } else {
      const today = new Date()
      dateVal.value = [String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, '0')]
    }
    // 老任务没填部门负责人时,按职务带出部门主任
    autoFillHead()
  } catch (e) {
    errorMsg.value = '加载任务失败：' + (e.message || '')
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; }

/* 选人弹窗布局:头部固定、列表滚动、底部按钮固定 */
.picker-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid #ebedf0;
}
.picker-close { color: #969799; font-size: 15px; cursor: pointer; }
.picker-title { font-size: 16px; font-weight: 600; color: #323233; }
.picker-placeholder { width: 32px; }
.picker-list { max-height: 150px; overflow-y: auto; }
.picker-group-title {
  padding: 10px 16px; font-size: 13px; font-weight: 600;
  color: #969799; background: #f7f8fa;
  display: flex; align-items: center; justify-content: space-between;
  cursor: pointer;
}
.picker-group-arrow {
  font-size: 11px; color: #969799;
  transition: transform 0.2s;
}
.picker-group-arrow.folded {
  transform: rotate(-90deg);
}
.picker-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: #fff; border-bottom: 1px solid #f2f3f5;
  cursor: pointer;
}
.picker-item:active { background: #f7f8fa; }
.picker-item-name { font-size: 15px; color: #323233; }
.picker-check {
  width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid #dcdee0;
  color: transparent; display: flex; align-items: center; justify-content: center;
  font-size: 12px; flex-shrink: 0; transition: all 0.15s;
}
.picker-check.checked {
  background: #4472C4; border-color: #4472C4; color: #fff;
}
.picker-empty { padding: 32px 16px; text-align: center; color: #969799; font-size: 14px; }
.picker-footer { padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid #ebedf0; }
</style>
