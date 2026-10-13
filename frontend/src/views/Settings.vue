<template>
  <div class="page">
    <van-nav-bar title="分类设置" left-arrow @click-left="$router.back()" fixed placeholder />

    <div class="content">
      <!-- 新增标签 -->
      <div class="section">
        <div class="section-title">新增分类</div>
        <div class="add-row">
          <input v-model="newName" class="name-input" placeholder="输入分类名称" @keyup.enter="handleAdd" />
          <div class="color-picker-row">
            <div v-for="c in colors" :key="c" class="color-dot"
              :style="{ background: c, border: newColor === c ? '3px solid #323233' : '3px solid transparent' }"
              @click="newColor = c" />
          </div>
          <van-button type="primary" size="small" @click="handleAdd" :loading="adding">添加</van-button>
        </div>
      </div>

      <!-- 已有标签列表 -->
      <div class="section">
        <div class="section-title">已有分类（{{ tags.length }}个）</div>
        <div v-if="loading" style="text-align:center;padding:20px;color:#969799;">加载中...</div>
        <div v-if="!loading && tags.length === 0" style="text-align:center;padding:20px;color:#969799;">暂无分类</div>

        <div v-for="t in tags" :key="t.id" class="tag-item">
          <div class="tag-left">
            <van-tag :color="t.color || '#1989fa'" size="large" plain>{{ t.name }}</van-tag>
            <span class="tag-count">{{ t.task_count || 0 }}个任务</span>
          </div>
          <div class="tag-right">
            <van-button size="mini" plain @click="startEdit(t)">编辑</van-button>
            <van-button size="mini" type="danger" plain @click="handleDelete(t)">删除</van-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <van-dialog v-model:show="editShow" title="编辑分类" show-cancel-button @confirm="handleEdit">
      <div style="padding:16px;">
        <input v-model="editName" class="name-input" placeholder="分类名称" style="width:100%;margin-bottom:12px;" />
        <div class="color-picker-row">
          <div v-for="c in colors" :key="c" class="color-dot"
            :style="{ background: c, border: editColor === c ? '3px solid #323233' : '3px solid transparent' }"
            @click="editColor = c" />
        </div>
      </div>
    </van-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { showToast, showConfirmDialog } from 'vant'
import { fetchTags, createTag, updateTag, deleteTag } from '../api/task'

const tags = ref([])
const loading = ref(true)
const adding = ref(false)

const newName = ref('')
const newColor = ref('#1989fa')
const editName = ref('')
const editColor = ref('#1989fa')
const editId = ref(null)
const editShow = ref(false)

const colors = ['#1989fa', '#07c160', '#ff976a', '#ee0a24', '#969799', '#7232dd', '#ffb800', '#00bcd4']

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
  editColor.value = t.color || '#1989fa'
  editShow.value = true
}

async function handleEdit() {
  if (!editName.value.trim()) return showToast('请输入名称')
  try {
    await updateTag(editId.value, { name: editName.value.trim(), color: editColor.value })
    showToast('修改成功')
    await load()
  } catch (e) {
    showToast(e.message || '修改失败')
  }
}

async function handleDelete(t) {
  try {
    await showConfirmDialog({ title: '确认删除', message: `删除「${t.name}」分类？已关联的任务将取消关联。` })
    await deleteTag(t.id)
    showToast('删除成功')
    await load()
  } catch (e) {
    // 用户取消
  }
}

onMounted(load)
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; }
.content { padding: 12px; }
.section { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
.section-title { font-size: 14px; font-weight: 600; color: #646566; margin-bottom: 12px; }
.add-row { display: flex; flex-direction: column; gap: 10px; }
.name-input {
  border: 1px solid #ebedf0; border-radius: 8px; padding: 8px 12px;
  font-size: 15px; outline: none; width: 100%;
}
.color-picker-row { display: flex; gap: 8px; flex-wrap: wrap; }
.color-dot {
  width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
  transition: border 0.15s;
}
.tag-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 0; border-bottom: 1px solid #f5f5f5;
}
.tag-item:last-child { border-bottom: none; }
.tag-left { flex: 1; display: flex; align-items: center; gap: 8px; }
.tag-count { font-size: 12px; color: #969799; }
.tag-right { display: flex; gap: 8px; }
</style>
