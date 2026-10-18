<template>
  <div class="page">
    <!-- 蓝色头部 -->
    <div class="header-bar">
      <div class="header-title">分类设置</div>
    </div>

    <div class="content">
      <!-- 分类管理(新增 + 已有,整合到一个卡片,仿成员职务) -->
      <div class="card">
        <div class="card-header" @click="tagsOpen = !tagsOpen">
          <div class="card-title" style="margin-bottom:0;">分类管理（{{ tags.length }}个）</div>
          <span class="fold-arrow" :class="{ folded: !tagsOpen }">▼</span>
        </div>
        <div v-if="tagsOpen">
          <!-- 新增分类:仅管理员可见 -->
          <div v-if="isAdmin" class="tag-row add-tag-row">
            <div class="add-inner">
              <div class="add-line">
                <input v-model="newName" class="text-input add-input" placeholder="输入分类名称" @keyup.enter="handleAdd" />
                <button class="btn-add" @click="handleAdd" :disabled="adding">
                  {{ adding ? '...' : '添加' }}
                </button>
              </div>
              <div class="color-row add-colors">
                <div v-for="c in colors" :key="c" class="color-dot"
                  :class="{ active: newColor === c }"
                  :style="{ background: c }"
                  @click="newColor = c" />
              </div>
            </div>
          </div>

          <!-- 已有分类列表 -->
          <div v-if="loading" class="empty-text">加载中...</div>
          <div v-if="!loading && tags.length === 0" class="empty-text">暂无分类</div>
          <div v-for="t in tags" :key="t.id" class="tag-row">
            <span class="tag-badge" :style="{ borderColor: t.color || '#4472C4', color: t.color || '#4472C4' }">{{ t.name }}</span>
            <div class="tag-right">
              <span class="tag-count">{{ t.task_count || 0 }}个任务</span>
              <div v-if="isAdmin" class="tag-actions">
                <button class="btn-edit" @click="startEdit(t)">编辑</button>
                <button class="btn-delete" @click="handleDelete(t)">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 成员职务（所有人可见；非管理员只读） -->
      <div class="card">
        <div class="card-header" @click="dutyOpen = !dutyOpen">
          <div class="card-title" style="margin-bottom:0;">成员职务（{{ users.length }}人）</div>
          <span class="fold-arrow" :class="{ folded: !dutyOpen }">▼</span>
        </div>
        <div v-if="dutyOpen">
          <div class="hint-text">{{ isAdmin ? '指定谁是部门主任、谁是值长。建任务时选好分类会自动带出对应负责人。' : '查看部门成员的职务分组。' }}</div>
          <div class="search-sticky">
            <input v-model="userSearch" class="text-input search-input" placeholder="搜索成员姓名" />
          </div>
          <div v-if="usersLoading" class="empty-text">加载中...</div>
          <div v-if="!usersLoading && filteredUsers.length === 0" class="empty-text">无匹配成员</div>

          <!-- 按职务分组 -->
          <div v-for="grp in groupedUsers" :key="grp.key" class="duty-group">
            <div class="duty-group-header" @click="toggleGroup(grp.key)">
              <span class="fold-arrow sm" :class="{ folded: groupOpen[grp.key] !== true }">▼</span>
              <span class="duty-group-title">{{ grp.title }}</span>
              <span class="duty-group-count">{{ grp.users.length }}人</span>
            </div>
            <div v-if="groupOpen[grp.key] === true" class="duty-group-body">
              <div v-for="(u, idx) in grp.users" :key="u.id" class="user-row">
                <div class="user-left">
                  <span class="user-name" :class="{ 'name-unknown': !u.name || u.name === '？？？' }" @click="isAdmin && startEditName(u)">{{ u.name || '未命名' }}</span>
                  <span v-if="isAdmin && u.is_super_admin" class="super-badge">超管</span>
                </div>
                <div v-if="isAdmin" class="user-right">
                  <div class="sort-btns">
                    <button class="sort-btn" :disabled="idx === 0" @click="moveUser(grp, idx, -1)">▲</button>
                    <button class="sort-btn" :disabled="idx === grp.users.length - 1" @click="moveUser(grp, idx, 1)">▼</button>
                  </div>
                  <span class="duty-badge" :class="'duty-' + (u.duty || 'member')">{{ DUTY_LABEL[u.duty] || DUTY_LABEL.member }}</span>
                  <label class="admin-switch" :class="{ 'switch-disabled': u.id === myId }">
                    <input type="checkbox" :checked="u.is_admin === true" :disabled="u.id === myId" @change="handleAdminChange(u, $event.target.checked)" />
                    <span class="slider"><span class="switch-text">管理员</span></span>
                  </label>
                  <label v-if="canSetSuper(u)" class="admin-switch super-switch" :class="{ 'switch-disabled': u.id === myId && u.is_super_admin }">
                    <input type="checkbox" :checked="u.is_super_admin === true" :disabled="u.id === myId && u.is_super_admin" @change="handleSuperChange(u, $event.target.checked)" />
                    <span class="slider"><span class="switch-text">超管</span></span>
                  </label>
                  <select class="duty-select" :value="u.duty || 'member'"
                    @change="handleDutyChange(u, $event.target.value)">
                    <option v-for="(label, key) in DUTY_LABEL" :key="key" :value="key">{{ label }}</option>
                  </select>
                </div>
                <div v-if="!isAdmin" class="user-right">
                  <span v-if="shortDuty(u)" class="short-duty-badge" :class="'duty-' + (u.duty || 'member')">{{ shortDuty(u) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 每日提醒（管理员 + 部门主任） -->
      <div v-if="digest.allowed" class="card">
        <div class="card-title">每日提醒</div>
        <div class="hint-text">每天到点给你发一条钉钉消息，列出未完成的工作、剩余天数、负责人和审核人。</div>

        <div class="switch-row">
          <span>接收每日提醒</span>
          <label class="switch">
            <input type="checkbox" v-model="digest.enabled" />
            <span class="slider"></span>
          </label>
        </div>

        <template v-if="digest.enabled">
          <div class="field-label">关注哪些分类</div>
          <div class="chip-row">
            <div v-for="t in digestTypes" :key="t.key" class="chip"
              :class="{ active: digest.types.includes(t.key) }"
              @click="toggleDigestType(t.key)">{{ t.label }}</div>
          </div>

          <div class="field-label">每天什么时候发</div>
          <select class="duty-select full" v-model.number="digest.hour">
            <option v-for="h in hourOptions" :key="h" :value="h">{{ String(h).padStart(2, '0') }}:00</option>
          </select>
        </template>

        <button class="btn-primary digest-save" @click="handleSaveDigest" :disabled="savingDigest">
          {{ savingDigest ? '保存中...' : '保存提醒设置' }}
        </button>
      </div>

      <!-- 回收站(仅管理员/超管可见) -->
      <div v-if="isAdmin" class="card recycle-entry" @click="$router.push('/recycle')">
        <div class="recycle-left">
          <div class="recycle-icon">🗑️</div>
          <div class="recycle-text">
            <div class="recycle-title">回收站</div>
            <div class="recycle-desc">已删除的任务保留 1 年，可恢复或彻底删除</div>
          </div>
        </div>
        <span class="fold-arrow folded">▶</span>
      </div>
    </div>

    <!-- 编辑弹窗（底部弹出） -->
    <div v-if="editShow" class="popup-overlay" @click="editShow = false">
      <div class="popup-sheet" @click.stop>
        <div class="popup-header">
          <span class="popup-cancel" @click="editShow = false">取消</span>
          <span class="popup-title">编辑分类</span>
          <span class="popup-confirm" @click="handleEdit">确认</span>
        </div>
        <div class="popup-body">
          <input v-model="editName" class="text-input" placeholder="分类名称" />
          <div class="color-row">
            <div v-for="c in colors" :key="c" class="color-dot"
              :class="{ active: editColor === c }"
              :style="{ background: c }"
              @click="editColor = c" />
          </div>
        </div>
        <div style="padding:12px 16px 20px;">
          <button class="btn-primary" @click="handleEdit">确定</button>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="deleteShow" class="popup-overlay" @click="deleteShow = false">
      <div class="confirm-modal" @click.stop>
        <div class="confirm-title">确认删除</div>
        <div class="confirm-msg">删除「{{ deleteTarget?.name }}」分类？已关联的任务将取消关联。</div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="deleteShow = false">取消</button>
          <button class="confirm-btn delete" @click="doDelete">确认删除</button>
        </div>
      </div>
    </div>

    <!-- 编辑姓名弹窗 -->
    <div v-if="editingNameUser" class="popup-overlay" @click="editingNameUser = null">
      <div class="popup-sheet" @click.stop>
        <div class="popup-header">
          <span class="popup-cancel" @click="editingNameUser = null">取消</span>
          <span class="popup-title">修改姓名</span>
          <span class="popup-confirm" @click="saveName">{{ savingName ? '保存中...' : '保存' }}</span>
        </div>
        <div class="popup-body">
          <input v-model="editingNameValue" class="text-input" placeholder="请输入姓名" autofocus @keyup.enter="saveName" />
          <div class="hint-text" style="margin-top:8px;">姓名来自钉钉，若显示异常可在此手动修正。</div>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="toast.show" class="toast">{{ toast.msg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import {
  fetchTags, createTag, updateTag, deleteTag,
  fetchUsers, updateUserDuty, updateUserAdmin, updateUserName, DUTY_LABEL,
  updateUserSuperAdmin, updateUserSort,
  fetchDigestSettings, saveDigestSettings
} from '../api/task'
import { userStore, loadUser } from '../stores/user'

const tags = ref([])
const loading = ref(true)
const adding = ref(false)
const tagsOpen = ref(true)          // 分类管理默认展开

const newName = ref('')
const newColor = ref('#4472C4')
const editName = ref('')
const editColor = ref('#4472C4')
const editId = ref(null)
const editShow = ref(false)

const deleteShow = ref(false)
const deleteTarget = ref(null)

const toast = reactive({ show: false, msg: '' })

const colors = ['#4472C4', '#07c160', '#ff976a', '#ee0a24', '#969799', '#7232dd', '#ffb800', '#00bcd4']

function showToast(msg) {
  toast.msg = msg
  toast.show = true
  setTimeout(() => { toast.show = false }, 2000)
}

// ============================================================
// 成员职务(仅管理员可改)
// ============================================================
const users = ref([])
const usersLoading = ref(true)
const isAdmin = computed(() => userStore.profile?.is_admin === true)
const isSuperAdmin = computed(() => userStore.profile?.is_super_admin === true)
const hasSuperAdmin = computed(() => users.value.some(u => u.is_super_admin === true))
const myId = computed(() => userStore.profile?.id)

// 是否可以设置该用户的超级管理员身份
// 规则:超管开关只在自己旁边显示(管理员可把自己设为超管,或确认自己的超管身份)
function canSetSuper(u) {
  if (!isAdmin.value) return false
  if (!u.is_admin) return false
  return u.id === myId.value
}

// 简化职务标签:部门主任→主任,值长→值长,员工→员工,普通员工不显示
function shortDuty(u) {
  const d = u.duty
  if (d === 'department_head') return '主任'
  if (d === 'team_a_lead' || d === 'team_b_lead') return '值长'
  if (d === 'team_a_member' || d === 'team_b_member') return '员工'
  return ''
}
const dutyOpen = ref(true)           // 成员职务板块默认展开
const userSearch = ref('')
const filteredUsers = computed(() => {
  const q = userSearch.value.trim().toLowerCase()
  if (!q) return users.value
  return users.value.filter(u => (u.name || '').toLowerCase().includes(q))
})

// 按职务分组:部门主任 / 运行一值(值长+组员) / 运行二值(值长+组员) / 未分组
const DUTY_GROUPS = [
  { key: 'department_head', title: '部门主任', duties: ['department_head'] },
  { key: 'team_a', title: '运行一值', duties: ['team_a_lead', 'team_a_member'] },
  { key: 'team_b', title: '运行二值', duties: ['team_b_lead', 'team_b_member'] },
  { key: 'ungrouped', title: '未分组', duties: ['member', null, undefined, ''] }
]
// 值长优先级高,组内排最前
const DUTY_ORDER = { department_head: 0, team_a_lead: 0, team_b_lead: 0, team_a_member: 1, team_b_member: 1, member: 1 }
const groupedUsers = computed(() => {
  return DUTY_GROUPS.map(g => ({
    ...g,
    users: filteredUsers.value
      .filter(u => g.duties.includes(u.duty))
      .sort((a, b) => {
        const oa = DUTY_ORDER[a.duty] ?? 9
        const ob = DUTY_ORDER[b.duty] ?? 9
        if (oa !== ob) return oa - ob
        // 同级别内按手动排序 sort_order 排,没有则按姓名
        const sa = a.sort_order ?? 0
        const sb = b.sort_order ?? 0
        if (sa !== sb) return sa - sb
        return (a.name || '').localeCompare(b.name || '', 'zh')
      })
  })).filter(g => g.users.length > 0)
})

// 分组折叠状态(默认全部展开)
const groupOpen = reactive({})
function toggleGroup(key) {
  groupOpen[key] = !groupOpen[key]
}

// 编辑成员姓名
const editingNameUser = ref(null)
const editingNameValue = ref('')
const savingName = ref(false)
function startEditName(u) {
  editingNameUser.value = u
  editingNameValue.value = u.name || ''
}
async function saveName() {
  const u = editingNameUser.value
  if (!u) return
  const name = editingNameValue.value.trim()
  if (!name) { showToast('姓名不能为空'); return }
  savingName.value = true
  try {
    await updateUserName(u.id, name)
    u.name = name
    showToast('已修改姓名')
    editingNameUser.value = null
  } catch (e) {
    showToast(e.message || '修改失败')
  } finally {
    savingName.value = false
  }
}

async function loadUsers() {
  usersLoading.value = true
  try {
    users.value = await fetchUsers()
  } catch (e) {
    // 忽略:可能还没有权限或网络异常
  } finally {
    usersLoading.value = false
  }
}

async function handleDutyChange(u, duty) {
  const old = u.duty
  u.duty = duty
  try {
    await updateUserDuty(u.id, duty)
    showToast(`已将「${u.name}」设为${DUTY_LABEL[duty] || duty}`)
  } catch (e) {
    u.duty = old
    showToast(e.message || '设置失败')
  }
}

async function handleAdminChange(u, isAdmin) {
  // 不能取消自己的管理员身份
  if (u.id === myId.value && isAdmin === false) {
    showToast('不能取消自己的管理员身份')
    return
  }
  const old = u.is_admin
  u.is_admin = isAdmin
  // 取消管理员时同步取消超级管理员
  if (isAdmin === false) u.is_super_admin = false
  try {
    await updateUserAdmin(u.id, isAdmin)
    showToast(isAdmin ? `已将「${u.name}」设为管理员` : `已取消「${u.name}」的管理员权限`)
  } catch (e) {
    u.is_admin = old
    showToast(e.message || '设置失败')
  }
}

async function handleSuperChange(u, isSuper) {
  // 不能取消自己的超级管理员身份
  if (u.id === myId.value && isSuper === false) {
    showToast('不能取消自己的超级管理员身份')
    return
  }
  const old = u.is_super_admin
  u.is_super_admin = isSuper
  try {
    await updateUserSuperAdmin(u.id, isSuper)
    showToast(isSuper ? `已将「${u.name}」设为超级管理员` : `已取消「${u.name}」的超级管理员身份`)
  } catch (e) {
    u.is_super_admin = old
    showToast(e.message || '设置失败')
  }
}

// 成员排序:上移/下移
async function moveUser(grp, idx, dir) {
  const swapIdx = idx + dir
  if (swapIdx < 0 || swapIdx >= grp.users.length) return
  // 复制当前分组的用户列表并交换
  const arr = [...grp.users]
  ;[arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]]
  // 重新分配 sort_order
  const orders = arr.map((user, i) => ({ id: user.id, sort_order: i }))
  try {
    await updateUserSort(orders)
    showToast('排序已保存')
    await loadUsers()
  } catch (e) {
    showToast(e.message || '排序失败')
    loadUsers()
  }
}

// ============================================================
// 每日提醒(管理员 + 部门主任)
// ============================================================
const digest = reactive({ allowed: false, enabled: false, types: [], hour: 8 })
const digestTypes = [
  { key: 'department', label: '部门任务' },
  { key: 'team_a', label: '运行一值' },
  { key: 'team_b', label: '运行二值' }
]
const hourOptions = Array.from({ length: 24 }, (_, i) => i)
const savingDigest = ref(false)

async function loadDigest() {
  try {
    const r = await fetchDigestSettings()
    digest.allowed = r.allowed === true
    digest.enabled = r.setting?.enabled === true
    digest.types = Array.isArray(r.setting?.types) ? r.setting.types : []
    digest.hour = Number.isInteger(r.setting?.hour) ? r.setting.hour : 8
  } catch (e) {
    digest.allowed = false
  }
}

function toggleDigestType(key) {
  const i = digest.types.indexOf(key)
  if (i >= 0) digest.types.splice(i, 1)
  else digest.types.push(key)
}

async function handleSaveDigest() {
  if (digest.enabled && digest.types.length === 0) return showToast('请至少选择一个分类')
  savingDigest.value = true
  try {
    await saveDigestSettings({ enabled: digest.enabled, types: digest.types, hour: digest.hour })
    showToast(digest.enabled ? `已保存，每天 ${String(digest.hour).padStart(2, '0')}:00 发送` : '已关闭每日提醒')
  } catch (e) {
    showToast(e.message || '保存失败')
  } finally {
    savingDigest.value = false
  }
}

async function load() {
  loading.value = true
  try {
    tags.value = await fetchTags()
  } catch (e) {
    showToast('加载失败')
  } finally {
    loading.value = false
  }
}

async function handleAdd() {
  if (!newName.value.trim()) return showToast('请输入名称')
  adding.value = true
  try {
    await createTag(newName.value.trim(), newColor.value)
    showToast('添加成功')
    newName.value = ''
    await load()
  } catch (e) {
    showToast(e.message || '添加失败')
  } finally {
    adding.value = false
  }
}

function startEdit(t) {
  editId.value = t.id
  editName.value = t.name
  editColor.value = t.color || '#4472C4'
  editShow.value = true
}

async function handleEdit() {
  if (!editName.value.trim()) return showToast('请输入名称')
  try {
    await updateTag(editId.value, { name: editName.value.trim(), color: editColor.value })
    editShow.value = false
    showToast('修改成功')
    await load()
  } catch (e) {
    showToast(e.message || '修改失败')
  }
}

function handleDelete(t) {
  deleteTarget.value = t
  deleteShow.value = true
}

async function doDelete() {
  if (!deleteTarget.value) return
  const t = deleteTarget.value
  try {
    await deleteTag(t.id)
    deleteShow.value = false
    showToast('删除成功')
    // 乐观更新:直接从列表移除,不依赖重新加载
    tags.value = tags.value.filter(x => x.id !== t.id)
  } catch (e) {
    showToast(e.message || '删除失败')
  }
}

onMounted(async () => {
  // 直接进设置页时 store 里可能还没 profile,先补一次(要用来判断是否管理员)
  if (!userStore.profile) {
    try { await loadUser() } catch (e) {}
  }
  load()
  loadDigest()
  loadUsers()  // 所有人都能查看成员职务
})

onUnmounted(() => {})
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding-bottom: calc(90px + env(safe-area-inset-bottom)); }

/* 蓝色渐变头部(滚动收缩,仿任务列表) */
.header-bar {
  position: sticky; top: 0; z-index: 100;
  height: 50px; box-sizing: border-box;
  padding: 0 16px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #4472C4, #5b8def);
}
.header-title {
  color: #fff; font-size: 17px; font-weight: 600;
}

.content { padding: 12px; }

/* 卡片 */
.card {
  background: #fff; border-radius: 12px; padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.card-title { font-size: 14px; font-weight: 600; color: #323233; margin-bottom: 12px; }

/* 可折叠卡片头部 */
.card-header {
  display: flex; align-items: center; justify-content: space-between;
  cursor: pointer; user-select: none;
}
.fold-arrow {
  font-size: 12px; color: #969799;
  transition: transform 0.25s;
  display: inline-block;
}
.fold-arrow.folded { transform: rotate(180deg); }

.text-input {
  width: 100%; border: 1px solid #ebedf0; border-radius: 8px;
  padding: 10px 12px; font-size: 15px; outline: none;
  box-sizing: border-box; margin-bottom: 12px;
}
.text-input:focus { border-color: #4472C4; }

/* 成员职务搜索框：滚动时固定在 header 下方 */
.search-sticky {
  position: sticky;
  top: 50px;
  z-index: 50;
  background: #fff;
  margin: 0 -16px 10px;
  padding: 8px 16px 0;
}
.search-input { margin-bottom: 0; }

/* 新增分类行:作为列表第一项,与已有分类统一为一行 */
.add-tag-row {
  display: block;
  padding: 12px 0;
  border-bottom: 1px solid #f5f5f5;
}
.add-tag-row:last-child { border-bottom: none; }
.add-inner { width: 100%; }
.add-line {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 10px;
}
.add-input {
  flex: 1; min-width: 0; margin-bottom: 0; padding: 8px 12px; font-size: 14px;
}
.btn-add {
  flex: none; padding: 8px 16px; border: none; border-radius: 8px;
  background: #4472C4; color: #fff; font-size: 14px; cursor: pointer;
  white-space: nowrap;
}
.btn-add:active { opacity: 0.85; }
.btn-add:disabled { opacity: 0.5; }

.add-colors {
  margin-bottom: 0; gap: 6px;
}
.add-colors .color-dot {
  width: 22px; height: 22px;
  border-width: 2px;
}

/* 颜色选择 */
.color-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.color-dot {
  width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
  transition: all 0.2s;
  border: 3px solid transparent;
}
.color-dot.active {
  border-color: #323233;
  transform: scale(1.15);
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

/* 主按钮 */
.btn-primary {
  width: 100%; padding: 12px; border: none; border-radius: 8px;
  background: #4472C4; color: #fff; font-size: 16px; font-weight: 500;
  cursor: pointer; transition: opacity 0.2s;
}
.btn-primary:active { opacity: 0.85; }
.btn-primary:disabled { opacity: 0.5; }

/* 标签列表 */
.tag-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0; border-bottom: 1px solid #f5f5f5;
}
.tag-row:last-child { border-bottom: none; }
.tag-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.tag-badge {
  padding: 2px 12px; border-radius: 20px; font-size: 13px;
  border: 1.5px solid; font-weight: 500;
}
.tag-count { font-size: 12px; color: #969799; }
.tag-actions { display: flex; gap: 8px; }

.btn-edit, .btn-delete {
  padding: 4px 12px; border-radius: 6px; font-size: 13px;
  border: 1px solid; background: #fff; cursor: pointer;
}
.btn-edit { border-color: #c8c9cc; color: #646566; }
.btn-delete { border-color: #ee0a24; color: #ee0a24; }
.btn-edit:active { background: #f7f8fa; }
.btn-delete:active { background: #fff1f0; }

.empty-text { text-align: center; padding: 20px; color: #969799; font-size: 14px; }

/* 说明文字 / 字段标题 */
.hint-text { font-size: 12px; color: #969799; line-height: 1.6; margin: -4px 0 12px; }
.field-label { font-size: 13px; color: #646566; margin: 14px 0 8px; }
/* 成员行布局 */
.user-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 0; border-bottom: 1px solid #f5f5f5;
  gap: 8px;
}
.user-row:last-child { border-bottom: none; }
.user-left {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 6px;
}
.user-right {
  display: flex; align-items: center; gap: 8px; flex-shrink: 0;
}
.user-name { font-size: 14px; color: #323233; cursor: pointer; flex-shrink: 0; }
.user-name:hover { text-decoration: underline; }
.name-unknown { color: #ee0a24; font-weight: 500; }
.admin-badge {
  font-size: 10px; color: #fff; background: #ee0a24;
  padding: 1px 5px; border-radius: 3px; flex-shrink: 0; line-height: 1.4;
}
.super-badge {
  font-size: 10px; color: #fff; background: #ff976a;
  padding: 1px 5px; border-radius: 3px; flex-shrink: 0; line-height: 1.4;
}
/* 非管理员看到的简化职务标签 */
.short-duty-badge {
  font-size: 10px; padding: 1px 6px; border-radius: 3px; flex-shrink: 0;
  border: 1px solid transparent; line-height: 1.4; white-space: nowrap;
}
.short-duty-badge.duty-department_head { color: #7232dd; border-color: #7232dd; background: #f3ebff; }
.short-duty-badge.duty-team_a_lead      { color: #1989fa; border-color: #1989fa; background: #e8f3ff; }
.short-duty-badge.duty-team_b_lead      { color: #07c160; border-color: #07c160; background: #e8faf0; }
.short-duty-badge.duty-team_a_member    { color: #4472C4; border-color: #4472C4; background: #eef3fc; }
.short-duty-badge.duty-team_b_member    { color: #2ba471; border-color: #2ba471; background: #eaf7f0; }
/* 排序按钮 */
.sort-btns { display: flex; flex-direction: column; gap: 1px; flex-shrink: 0; }
.sort-btn {
  width: 18px; height: 14px; font-size: 8px; line-height: 1;
  border: 1px solid #ebedf0; background: #fff; color: #969799;
  border-radius: 2px; cursor: pointer; padding: 0; display: flex;
  align-items: center; justify-content: center;
}
.sort-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.sort-btn:not(:disabled):active { background: #f5f5f5; }
.duty-badge {
  font-size: 11px; padding: 1px 6px; border-radius: 3px; flex-shrink: 0;
  border: 1px solid transparent; line-height: 1.5; white-space: nowrap;
}
.duty-department_head { color: #7232dd; border-color: #7232dd; background: #f3ebff; }
.duty-team_a_lead      { color: #1989fa; border-color: #1989fa; background: #e8f3ff; }
.duty-team_b_lead      { color: #07c160; border-color: #07c160; background: #e8faf0; }
.duty-team_a_member    { color: #4472C4; border-color: #4472C4; background: #eef3fc; }
.duty-team_b_member    { color: #2ba471; border-color: #2ba471; background: #eaf7f0; }
.duty-member           { color: #969799; border-color: #dcdee0; background: #f7f8fa; }

/* 职务下拉 */
.duty-select {
  border: 1px solid #ebedf0; border-radius: 6px; padding: 5px 8px;
  font-size: 12px; color: #323233; background: #fff; outline: none;
  flex-shrink: 0; max-width: 110px;
}
.duty-select.full { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 15px; max-width: none; }

/* 管理员开关(带文字) */
.admin-switch { position: relative; display: inline-block; width: 52px; height: 22px; flex-shrink: 0; }
.admin-switch input { opacity: 0; width: 0; height: 0; }
.admin-switch .slider {
  position: absolute; inset: 0; background: #dcdfe6; border-radius: 11px;
  transition: background 0.2s; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.admin-switch .switch-text {
  font-size: 9px; color: #fff; font-weight: 500; line-height: 1;
  z-index: 1; transition: color 0.2s;
}
.admin-switch .slider::before {
  content: ''; position: absolute; width: 18px; height: 18px; left: 2px; top: 2px;
  background: #fff; border-radius: 50%; transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.admin-switch input:checked + .slider { background: #4472C4; }
.admin-switch input:checked + .slider::before { transform: translateX(30px); }
.admin-switch input:not(:checked) + .slider .switch-text { color: #969799; }
.admin-switch.switch-disabled { opacity: 0.5; pointer-events: none; }
.admin-switch.super-switch input:checked + .slider { background: #ff976a; }
.admin-switch.super-switch input:checked + .slider::before { transform: translateX(30px); }

/* 折叠箭头 */
.fold-arrow.sm { font-size: 10px; color: #969799; transition: transform 0.2s; display: inline-block; }
.fold-arrow.sm.folded { transform: rotate(180deg); }

/* 开关 */
.switch-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 15px; color: #323233; padding: 4px 0;
}
.switch { position: relative; display: inline-block; width: 48px; height: 28px; flex: none; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute; inset: 0; background: #dcdfe6; border-radius: 14px;
  transition: background 0.2s; cursor: pointer;
}
.slider::before {
  content: ''; position: absolute; width: 24px; height: 24px; left: 2px; top: 2px;
  background: #fff; border-radius: 50%; transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.switch input:checked + .slider { background: #4472C4; }
.switch input:checked + .slider::before { transform: translateX(20px); }
.switch.sm { width: 40px; height: 22px; }
.switch.sm .slider::before { width: 18px; height: 18px; }
.switch.sm input:checked + .slider::before { transform: translateX(16px); }

/* 分类胶囊 */
.chip-row { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  padding: 6px 14px; border-radius: 20px; font-size: 13px;
  border: 1px solid #ebedf0; background: #f7f8fa; color: #646566; cursor: pointer;
  transition: all 0.15s;
}
.chip.active { background: #4472C4; border-color: #4472C4; color: #fff; }

.digest-save { margin-top: 16px; }

/* 底部弹窗 */
.popup-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5); z-index: 9999;
  display: flex; align-items: flex-end; justify-content: center;
}
.popup-sheet {
  background: #fff; width: 100%; max-width: 500px;
  border-radius: 16px 16px 0 0;
  animation: slideUp 0.25s ease;
}
@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.popup-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid #ebedf0;
}
.popup-cancel { color: #969799; font-size: 14px; cursor: pointer; }
.popup-title { font-size: 15px; font-weight: 600; color: #323233; }
.popup-confirm { color: #4472C4; font-size: 14px; font-weight: 500; cursor: pointer; }
.popup-body { padding: 16px; }

/* 删除确认弹窗 */
.confirm-modal {
  background: #fff; border-radius: 12px; width: 80%; max-width: 320px;
  overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  align-self: center; margin: auto;
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
  animation: fadeIn 0.2s;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* 职务分组 */
.duty-group { margin-top: 16px; }
.duty-group:first-child { margin-top: 8px; }
.duty-group-header {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 0; margin-bottom: 4px;
  border-bottom: 1px solid #f5f5f5; cursor: pointer;
}
.duty-group-title {
  font-size: 13px; font-weight: 600; color: #323233; flex: 1;
}
.duty-group-count { font-size: 12px; color: #969799; }
.duty-group-body { padding-top: 4px; }

/* 回收站入口 */
.recycle-entry {
  display: flex; align-items: center; justify-content: space-between;
  cursor: pointer; transition: background 0.15s;
}
.recycle-entry:active { background: #f5f5f5; }
.recycle-left { display: flex; align-items: center; gap: 12px; }
.recycle-icon { font-size: 22px; line-height: 1; }
.recycle-title { font-size: 15px; font-weight: 600; color: #323233; }
.recycle-desc { font-size: 12px; color: #969799; margin-top: 2px; }
.recycle-entry .fold-arrow { font-size: 12px; color: #c8c9cc; }
</style>
