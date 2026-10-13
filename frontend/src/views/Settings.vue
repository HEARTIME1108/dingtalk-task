<template>
  <div class="page">
    <div class="header-bar">
      <div class="header-back" @click="$router.back()">←</div>
      <div class="header-title">分类设置</div>
    </div>

    <div class="content">
      <!-- 新增分类 -->
      <div class="card">
        <div class="card-title">新增分类</div>
        <input v-model="newName" class="text-input" placeholder="输入分类名称" @keyup.enter="handleAdd" />
        <div class="color-row">
          <div v-for="c in colors" :key="c" class="color-dot"
            :class="{ active: newColor === c }"
            :style="{ background: c }"
            @click="newColor = c" />
        </div>
        <button class="btn-primary" @click="handleAdd" :disabled="adding">
          {{ adding ? '添加中...' : '添加' }}
        </button>
      </div>

      <!-- 已有分类 -->
      <div class="card">
        <div class="card-title">已有分类（{{ tags.length }}个）</div>
        <div v-if="loading" class="empty-text">加载中...</div>
        <div v-if="!loading && tags.length === 0" class="empty-text">暂无分类</div>

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
import { ref, reactive, onMounted } from 'vue'
import { fetchTags, createTag, updateTag, deleteTag } from '../api/task'

const tags = ref([])
const loading = ref(true)
const adding = ref(false)

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

onMounted(load)
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; }

/* 蓝色渐变头部 */
.header-bar {
  background: linear-gradient(135deg, #4472C4, #5b8def);
  padding: 48px 16px 16px;
  display: flex; align-items: center; gap: 12px;
  position: sticky; top: 0; z-index: 100;
}
.header-back { color: #fff; font-size: 22px; cursor: pointer; }
.header-title { color: #fff; font-size: 18px; font-weight: 600; }

.content { padding: 12px; }

/* 卡片 */
.card {
  background: #fff; border-radius: 12px; padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.card-title { font-size: 14px; font-weight: 600; color: #323233; margin-bottom: 12px; }

.text-input {
  width: 100%; border: 1px solid #ebedf0; border-radius: 8px;
  padding: 10px 12px; font-size: 15px; outline: none;
  box-sizing: border-box; margin-bottom: 12px;
}
.text-input:focus { border-color: #4472C4; }

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
