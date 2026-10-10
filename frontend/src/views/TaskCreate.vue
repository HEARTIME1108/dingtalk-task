<template>
  <div class="page">
    <van-nav-bar title="新建任务" left-arrow @click-left="$router.back()" fixed placeholder />

    <!-- 成功页（替换整个表单）-->
    <div v-if="success" 
      style="padding:60px 24px;text-align:center;">
      <div style="font-size:48px;margin-bottom:16px;">✅</div>
      <div style="font-size:20px;font-weight:bold;color:#07c160;margin-bottom:8px;">
        创建成功
      </div>
      <div style="font-size:14px;color:#969799;margin-bottom:32px;">
        任务"{{ successTitle }}"已创建
      </div>
      <van-button type="primary" block @click="$router.replace('/tasks')">
        返回任务列表
      </van-button>
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
          <van-field label="任务类型" readonly>
            <template #input>
              <van-radio-group v-model="form.task_type" direction="horizontal">
                <van-radio v-for="(l, k) in TASK_TYPE_LABEL" :key="k" :name="k">{{ l }}</van-radio>
              </van-radio-group>
            </template>
          </van-field>
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
            v-if="form.task_type === 'department'"
            label="部门主任" is-link readonly
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
        </van-cell-group>

        <div style="padding:16px;">
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

      <van-popup v-model:show="showDepartmentHead" position="bottom" round>
        <van-picker
          :columns="userColumns"
          @confirm="onPick($event, 'department_head_id', showDepartmentHead)"
          @cancel="showDepartmentHead = false" />
      </van-popup>

      <van-popup v-model:show="showCollaborators" position="bottom" round>
        <van-checkbox-group v-model="collaboratorIds">
          <van-cell v-for="u in collaboratorCandidates" :key="u.id" :title="u.name" clickable>
            <template #right-icon>
              <van-checkbox :name="u.id" />
            </template>
          </van-cell>
        </van-checkbox-group>
        <div v-if="collaboratorCandidates.length === 0" style="padding:24px;text-align:center;color:#969799;font-size:14px;">
          负责人、审批人已选中,无可选协作者
        </div>
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
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchUsers, createTask, PRIORITY_LABEL, TASK_TYPE_LABEL } from '../api/task'

const router = useRouter()
const form = ref({
  title: '', description: '', priority: 'medium',
  task_type: 'department',
  assignee_id: null, reviewer_id: null, department_head_id: null, due_date: null
})
const users = ref([])
const submitting = ref(false)
const showAssignee = ref(false)
const showReviewer = ref(false)
const showDepartmentHead = ref(false)
const showCollaborators = ref(false)
const showDate = ref(false)
const collaboratorIds = ref([])
const dateVal = ref([])
const errorMsg = ref('')
const success = ref(false)
const successTitle = ref('')

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
    await createTask(payload)
    // 成功：直接在当前页面切换到成功页，不跳转不弹窗
    successTitle.value = form.value.title
    success.value = true
  } catch (e) {
    errorMsg.value = '创建失败：' + (e.message || '未知错误')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  try {
    users.value = await fetchUsers()
  } catch (e) {
    errorMsg.value = '加载用户列表失败：' + (e.message || '')
  }
  const today = new Date()
  dateVal.value = [String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, '0')]
})
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; }
</style>
