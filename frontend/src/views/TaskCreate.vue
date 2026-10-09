<template>
  <div class="page">
    <van-nav-bar title="新建任务" left-arrow @click-left="$router.back()" fixed placeholder />

    <van-form @submit="onSubmit">
      <van-cell-group inset>
        <van-field
          v-model="form.title" label="标题" placeholder="请输入任务标题"
          required :rules="[{ required: true, message: '请输入标题' }]" />
        <van-field
          v-model="form.description" label="描述"
          type="textarea" rows="3" placeholder="任务详细描述" />
        <van-field label="优先级" readonly>
          <template #input>
            <van-radio-group v-model="form.priority" direction="horizontal">
              <van-radio v-for="(l, k) in PRIORITY_LABEL" :key="k" :name="k">{{ l }}</van-radio>
            </van-radio-group>
          </template>
        </van-field>
        <van-field
          label="负责人" is-link readonly
          :model-value="labelOf(form.assignee_id)"
          placeholder="请选择" @click="showAssignee = true" />
        <van-field
          label="审批人" is-link readonly
          :model-value="labelOf(form.reviewer_id)"
          placeholder="请选择" @click="showReviewer = true" />
        <van-field
          label="协作者" is-link readonly
          :model-value="collaboratorIds.length ? `已选 ${collaboratorIds.length} 人` : '请选择'"
          @click="showCollaborators = true" />
        <van-field
          label="截止日期" is-link readonly
          :model-value="form.due_date || ''" placeholder="请选择"
          @click="showDate = true" />
      </van-cell-group>

      <div class="submit-bar">
        <van-button type="primary" block native-type="submit" :loading="submitting">
          提交
        </van-button>
      </div>
    </van-form>

    <van-popup v-model:show="showAssignee" position="bottom" round>
      <van-picker
        :columns="userColumns"
        @confirm="onPick($event, 'assignee_id', showAssignee)"
        @cancel="showAssignee = false" />
    </van-popup>

    <van-popup v-model:show="showReviewer" position="bottom" round>
      <van-picker
        :columns="userColumns"
        @confirm="onPick($event, 'reviewer_id', showReviewer)"
        @cancel="showReviewer = false" />
    </van-popup>

    <van-popup v-model:show="showCollaborators" position="bottom" round>
      <van-checkbox-group v-model="collaboratorIds">
        <van-cell v-for="u in users" :key="u.id" :title="u.name" clickable>
          <template #right-icon>
            <van-checkbox :name="u.id" />
          </template>
        </van-cell>
      </van-checkbox-group>
      <div style="padding: 12px;">
        <van-button type="primary" block @click="showCollaborators = false">确定</van-button>
      </div>
    </van-popup>

    <van-popup v-model:show="showDate" position="bottom" round>
      <van-date-picker
        v-model="dateVal"
        @confirm="onPickDate"
        @cancel="showDate = false" />
    </van-popup>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { fetchUsers, createTask, PRIORITY_LABEL } from '../api/task'

const router = useRouter()
const form = ref({
  title: '', description: '', priority: 'medium',
  assignee_id: null, reviewer_id: null, due_date: null
})
const users = ref([])
const submitting = ref(false)
const showAssignee = ref(false)
const showReviewer = ref(false)
const showCollaborators = ref(false)
const showDate = ref(false)
const collaboratorIds = ref([])
const dateVal = ref([])

const userColumns = computed(() =>
  users.value.map(u => ({ text: u.name, value: u.id }))
)

function labelOf(uid) {
  return users.value.find(u => u.id === uid)?.name || ''
}

function onPick({ selectedValues }, key, refShow) {
  form.value[key] = selectedValues[0]
  refShow.value = false
}

function onPickDate({ selectedValues }) {
  form.value.due_date = selectedValues.join('-')
  showDate.value = false
}

async function onSubmit() {
  submitting.value = true
  try {
    await createTask({ ...form.value, assignee_ids: collaboratorIds.value })
    showToast('创建成功')
    router.replace('/tasks')
  } catch (e) {
    showToast(e.message || '创建失败')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  users.value = await fetchUsers()
  const today = new Date()
  dateVal.value = [String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, '0')]
})
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; }
.submit-bar { padding: 16px; }
</style>
