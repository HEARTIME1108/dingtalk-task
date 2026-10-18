<template>
  <div class="page">
    <!-- 蓝色渐变头部(滚动收缩,仿任务列表) -->
    <div class="header-bar" :class="{ shrink: headerShrink }">
      <div class="header-bg"></div>
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
          <!-- 新增分类:作为列表第一项,与已有分类统一 -->
          <div class="tag-row add-tag-row">
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

          <!-- 已有分类列表(无缝衔接) -->
          <div v-if="loading" class="empty-text">加载中...</div>
          <div v-if="!loading && tags.length === 0" class="empty-text">暂无分类,在上方添加</div>
          <div v-for="t in tags" :key="t.id" class="tag-row">
            <div class="tag-info">
              <span class="tag-badge" :style="{ borderColor: t.color || '#4472C4', color: t.color || '#4472C4' }">{{ t.name }}</span>
              <span class="tag-count">{{ t.task_count || 0 }}个任务</span>
            </div>
            <div class="tag-actions">
              <button class="btn-edit" @click="startEdit(t)">编辑</button>
              <button class="btn-delete" @click="handleDelete(t)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 成员职务（仅管理员，可折叠） -->
      <div v-if="isAdmin" class="card">
        <div class="card-header" @click="dutyOpen = !dutyOpen">
          <div class="card-title" style="margin-bottom:0;">成员职务（{{ users.length }}人）</div>
          <span class="fold-arrow" :class="{ folded: !dutyOpen }">▼</span>
        </div>
        <div v-if="dutyOpen">
          <div class="hint-text">指定谁是部门主任、谁是值长。建任务时选好分类会自动带出对应负责人。</div>
          <input v-model="userSearch" class="text-input" placeholder="搜索成员姓名" style="margin-bottom:10px;" />
          <div v-if="usersLoading" class="empty-text">加载中...</div>
          <div v-if="!usersLoading && filteredUsers.length === 0" class="empty-text">无匹配成员</div>
          <div v-for="u in filteredUsers" :key="u.id" class="tag-row">
            <div class="tag-info">
              <span class="user-name">{{ u.name }}</span>
              <span v-if="u.is_admin" class="admin-badge">管理员</span>
            </div>
            <div class="duty-actions">
              <label class="switch sm">
                <input type="checkbox" :checked="u.is_admin === true" @change="handleAdminChange(u, $event.target.checked)" />
                <span class="slider"></span>
              </label>
              <select class="duty-select" :value="u.duty || 'member'"
                @change="handleDutyChange(u, $event.target.value)">
                <option v-for="(label, key) in DUTY_LABEL" :key="key" :value="key">{{ label }}</option>
              </select>
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

    <!-- Toast -->
    <div v-if="toast.show" class="toast">{{ toast.msg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import {
  fetchTags, createTag, updateTag, deleteTag,
  fetchUsers, updateUserDuty, updateUserAdmin, DUTY_LABEL,
  fetchDigestSettings, saveDigestSettings
} from '../api/task'
import { userStore, loadUser } from '../stores/user'

// 头部滚动收缩
const headerShrink = ref(false)
function onScroll() {
  const y = window.scrollY
  if (headerShrink.value) { if (y < 20) headerShrink.value = false }
  else { if (y > 50) headerShrink.value = true }
}

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
const dutyOpen = ref(false)          // 成员职务板块默认折叠(人多)
const userSearch = ref('')
const filteredUsers = computed(() => {
  const q = userSearch.value.trim().toLowerCase()
  if (!q) return users.value
  return users.value.filter(u => (u.name || '').toLowerCase().includes(q))
})

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
  const old = u.is_admin
  u.is_admin = isAdmin
  try {
    await updateUserAdmin(u.id, isAdmin)
    showToast(isAdmin ? `已将「${u.name}」设为管理员` : `已取消「${u.name}」的管理员权限`)
  } catch (e) {
    u.is_admin = old
    showToast(e.message || '设置失败')
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
  try {
    await deleteTag(deleteTarget.value.id)
    deleteShow.value = false
    showToast('删除成功')
    await load()
  } catch (e) {
    showToast(e.message || '删除失败')
  }
}

onMounted(async () => {
  window.addEventListener('scroll', onScroll, { passive: true })
  // 直接进设置页时 store 里可能还没 profile,先补一次(要用来判断是否管理员)
  if (!userStore.profile) {
    try { await loadUser() } catch (e) {}
  }
  load()
  loadDigest()
  if (isAdmin.value) loadUsers()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding-bottom: calc(90px + env(safe-area-inset-bottom)); }

/* 蓝色渐变头部(滚动收缩,仿任务列表) */
.header-bar {
  position: sticky; top: 0; z-index: 100;
  height: 110px; box-sizing: border-box;
  padding: 48px 16px 16px;
  overflow: hidden;
  background: transparent;
  transition: padding 0.28s ease;
}
.header-bar.shrink { padding: 14px 16px; }
.header-bg {
  position: absolute; left: 0; right: 0; top: 0;
  height: 110px;
  background: linear-gradient(135deg, #4472C4, #5b8def);
  transition: height 0.28s ease, background 0.28s ease;
  z-index: -1;
}
.header-bar.shrink .header-bg {
  height: 50px;
  background: #4472C4;
}
.header-title {
  color: #fff; font-size: 18px; font-weight: 600;
  text-align: center; width: 100%;
  transition: font-size 0.28s;
}
.header-bar.shrink .header-title { font-size: 16px; }

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
}
.fold-arrow.folded { transform: rotate(-90deg); }

.text-input {
  width: 100%; border: 1px solid #ebedf0; border-radius: 8px;
  padding: 10px 12px; font-size: 15px; outline: none;
  box-sizing: border-box; margin-bottom: 12px;
}
.text-input:focus { border-color: #4472C4; }

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
.tag-info { flex: 1; display: flex; align-items: center; gap: 10px; }
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
.user-name { font-size: 14px; color: #323233; }
.admin-badge {
  font-size: 11px; color: #fff; background: #ee0a24;
  padding: 1px 6px; border-radius: 4px; margin-left: 6px;
}
.duty-actions { display: flex; align-items: center; gap: 10px; }

/* 职务下拉 */
.duty-select {
  border: 1px solid #ebedf0; border-radius: 8px; padding: 6px 10px;
  font-size: 13px; color: #323233; background: #fff; outline: none;
  flex: none;
}
.duty-select.full { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 15px; margin-left: 0; }

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
</style>
