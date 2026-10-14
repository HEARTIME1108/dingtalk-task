<template>
  <div class="page" v-if="task">
    <van-nav-bar title="任务详情" left-arrow @click-left="$router.back()" fixed placeholder />

    <!-- 内联成功提示（绿底白字）-->
    <div v-if="successMsg"
      style="margin:8px 12px;padding:12px 16px;background:#07c160;color:#fff !important;border-radius:8px;font-size:14px;">
      {{ successMsg }}
    </div>
    <!-- 内联失败提示（红底白字）-->
    <div v-if="errorMsg"
      style="margin:8px 12px;padding:12px 16px;background:#ee0a24;color:#fff !important;border-radius:8px;font-size:14px;">
      {{ errorMsg }}
    </div>

    <van-cell-group inset title="基本信息">
      <van-cell title="当前身份">
        <template #value><van-tag type="primary" plain>{{ roleHint }}</van-tag></template>
      </van-cell>
      <van-cell title="当前登录" :value="userStore.profile?.name || '未知'" />
      <van-cell v-if="task.task_type" title="任务类型">
        <template #value>
          <van-tag type="primary" plain>{{ TASK_TYPE_LABEL[task.task_type] }}</van-tag>
        </template>
      </van-cell>
      <van-cell title="标题">
        <template #value><span class="strong">{{ task.title }}</span></template>
      </van-cell>
      <van-cell title="任务周期">
        <template #value>
          <van-tag v-if="task.priority" :color="PRIORITY_COLOR[task.priority]" plain>{{ PRIORITY_LABEL[task.priority] }}</van-tag>
          <span v-else style="color:#969799;">未设置</span>
        </template>
      </van-cell>
      <van-cell title="状态">
        <template #value>
          <van-tag :color="STATUS_COLOR[task.status]">{{ STATUS_LABEL[task.status] }}</van-tag>
        </template>
      </van-cell>
      <van-cell title="负责人" :value="task.assignee?.name || '-'" />
      <van-cell title="审批人" :value="task.reviewer?.name || '-'" />
      <van-cell v-if="task.department_head_id" title="部门主任">
        <template #value>
          <span>{{ task.department_head?.name || '-' }}</span>
          <van-tag v-if="task.task_type === 'department'" type="warning" plain style="margin-left:6px;">终审关闭</van-tag>
        </template>
      </van-cell>
      <van-cell title="截止日期" :value="task.due_date || '-'" />
      <van-cell title="创建人" :value="task.creator?.name || '-'" />
      <van-cell title="创建时间" :value="formatTime(task.created_at)" />
    </van-cell-group>

    <van-cell-group inset title="标签">
      <van-cell>
        <template #value>
          <div v-if="task.tags?.length" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;">
            <van-tag v-for="t in task.tags" :key="t.tag_id || t.id" :color="t.color || t.tag?.color" plain size="medium" style="margin-bottom:4px;">
              {{ t.tag?.name || t.name }}
            </van-tag>
          </div>
          <span v-else style="color:#969799;">暂无标签</span>
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset title="描述">
      <van-cell>
        <template #value>
          <div v-if="task.description" class="desc">{{ task.description }}</div>
          <span v-else style="color:#969799;">暂无描述</span>
        </template>
      </van-cell>
    </van-cell-group>

    <van-cell-group inset title="协作者">
      <van-cell v-for="a in task.assignees" :key="a.user_id" :title="a.user.name">
        <template #value>
          <van-tag plain>{{ a.role === 'reviewer' ? '审批' : a.role === 'watcher' ? '关注' : '执行' }}</van-tag>
        </template>
      </van-cell>
      <van-cell v-if="!task.assignees?.length" title="暂无协作者" />
    </van-cell-group>

    <van-cell-group inset title="子任务">
      <van-cell
        v-for="st in task.subtasks" :key="st.id"
        :title="st.title" is-link
        @click="$router.push(`/tasks/${st.id}`)"
      >
        <template #value>
          <van-tag :color="STATUS_COLOR[st.status]" size="medium">{{ STATUS_LABEL[st.status] }}</van-tag>
        </template>
      </van-cell>
      <van-cell v-if="!task.subtasks?.length" title="暂无子任务" />
    </van-cell-group>

    <van-cell-group inset title="附件">
      <van-cell v-for="a in attachments" :key="a.id" :title="a.file_name" :label="formatFileSize(a.file_size)">
        <template #value>
          <van-button v-if="canEdit" size="mini" type="danger" plain @click="onDeleteAttachment(a.id)">删除</van-button>
        </template>
      </van-cell>
      <van-cell v-if="!attachments.length" title="暂无附件" />
      <div v-if="canEdit" style="padding:12px;">
        <van-button size="small" type="primary" plain @click="showAttachmentInput = true">添加附件链接</van-button>
      </div>
    </van-cell-group>

    <van-cell-group inset title="流转记录">
      <van-steps v-if="task.flows?.length" direction="vertical" :active="task.flows.length - 1">
        <van-step v-for="f in task.flows" :key="f.id">
          <h4>{{ f.from_status ? STATUS_LABEL[f.from_status] : '创建' }} → {{ STATUS_LABEL[f.to_status] }}</h4>
          <p v-if="f.comment">{{ f.comment }}</p>
          <p class="meta">{{ f.operator?.name }} · {{ formatTime(f.created_at) }}</p>
        </van-step>
      </van-steps>
      <van-cell v-else title="暂无记录" />
    </van-cell-group>

    <van-cell-group inset title="评论">
      <div v-if="comments.length" style="padding:0 16px;">
        <div v-for="cm in comments" :key="cm.id" class="comment-item">
          <div class="comment-header">
            <span class="comment-author">{{ cm.user?.name || '未知' }}</span>
            <span class="comment-time">{{ formatTime(cm.created_at) }}</span>
            <van-button v-if="cm.user_id === userStore.user?.id || isAdmin" size="mini" type="danger" plain @click="onDeleteComment(cm.id)">删</van-button>
          </div>
          <div class="comment-content">{{ cm.content }}</div>
        </div>
      </div>
      <van-cell v-if="!comments.length" title="暂无评论" />
      <div style="display:flex;gap:8px;padding:12px 16px;">
        <input v-model="commentInput" class="custom-input" placeholder="写评论..." style="flex:1;" />
        <van-button size="small" type="primary" @click="onAddComment">发送</van-button>
      </div>
    </van-cell-group>

    <div class="action-bar" v-if="nextActions.length || canDelete">
      <van-button
        v-for="na in nextActions" :key="na.to"
        :type="na.type" block plain
        @click="onTransition(na.to)"
      >{{ na.label }}</van-button>
      <van-button
        v-if="canEdit"
        type="warning" plain block
        @click="$router.push(`/tasks/${route.params.id}/edit`)"
      >编辑任务</van-button>
      <van-button
        v-if="canDelete"
        type="danger" plain block
        @click="onDelete"
      >删除任务</van-button>
    </div>

    <!-- 自定义审批意见弹窗 -->
    <div v-if="showComment" class="custom-overlay" @click="showComment = false">
      <div class="custom-modal" @click.stop>
        <div class="custom-modal-title">填写审批意见</div>
        <div style="padding: 12px 20px;">
          <input
            v-model="comment"
            class="custom-input"
            placeholder="可选:填写审批意见"
          />
        </div>
        <div class="custom-modal-actions">
          <button class="custom-modal-btn cancel" @click="showComment = false">取消</button>
          <button class="custom-modal-btn confirm" @click="confirmTransition">确认</button>
        </div>
      </div>
    </div>

    <!-- 自定义确认弹窗（删除确认）-->
    <div v-if="confirmModal.show" class="custom-overlay" @click="confirmModal.show = false">
      <div class="custom-modal" @click.stop>
        <div class="custom-modal-title">{{ confirmModal.title }}</div>
        <div class="custom-modal-body">{{ confirmModal.message }}</div>
        <div class="custom-modal-actions">
          <button class="custom-modal-btn cancel" @click="confirmModal.show = false">取消</button>
          <button class="custom-modal-btn confirm" @click="confirmModal.onConfirm">确认</button>
        </div>
      </div>
    </div>

    <!-- 附件输入弹窗 -->
    <div v-if="showAttachmentInput" class="custom-overlay" @click="showAttachmentInput = false">
      <div class="custom-modal" @click.stop>
        <div class="custom-modal-title">添加附件</div>
        <div style="padding:12px 20px;">
          <input v-model="attachmentName" class="custom-input" placeholder="文件名（可选）" style="margin-bottom:8px;" />
          <input v-model="attachmentUrl" class="custom-input" placeholder="文件链接URL" />
        </div>
        <div class="custom-modal-actions">
          <button class="custom-modal-btn cancel" @click="showAttachmentInput = false">取消</button>
          <button class="custom-modal-btn confirm" @click="onAddAttachment">确认</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import {
  fetchTask, transitionTask, deleteTask,
  fetchAttachments, addAttachment, deleteAttachment,
  fetchComments, addComment, deleteComment,
  STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR, TASK_TYPE_LABEL
} from '../api/task'
import { userStore, loadUser } from '../stores/user'

const route = useRoute()
const router = useRouter()
const task = ref(null)
const showComment = ref(false)
const comment = ref('')
const pendingTo = ref('')
const successMsg = ref('')
const errorMsg = ref('')

// 自定义确认弹窗（删除确认用）
const confirmModal = reactive({
  show: false, title: '', message: '', onConfirm: () => {}
})

const isCreator = computed(() => task.value?.creator_id === userStore.user?.id)
const isAssignee = computed(() => task.value?.assignee_id === userStore.user?.id)
const isReviewer = computed(() => task.value?.reviewer_id === userStore.user?.id)
const isDepartmentHead = computed(() => task.value?.department_head_id === userStore.user?.id)
const isAdmin = computed(() => !!task.value?._isAdmin)
const canDelete = computed(() => isAdmin.value || isCreator.value)
const canEdit = computed(() => isAdmin.value || isCreator.value || isDepartmentHead.value || isReviewer.value)

const attachments = ref([])
const showAttachmentInput = ref(false)
const attachmentUrl = ref('')
const attachmentName = ref('')

const comments = ref([])
const commentInput = ref('')

async function loadAttachments() {
  try {
    attachments.value = await fetchAttachments(route.params.id)
  } catch (e) {}
}

async function onAddAttachment() {
  try {
    await addAttachment(route.params.id, {
      file_name: attachmentName.value || attachmentUrl.value,
      file_url: attachmentUrl.value,
      file_type: 'link'
    })
    showAttachmentInput.value = false
    attachmentUrl.value = ''
    attachmentName.value = ''
    await loadAttachments()
  } catch (e) {
    errorMsg.value = '添加附件失败：' + (e.message || '')
  }
}

async function onDeleteAttachment(aid) {
  try {
    await deleteAttachment(route.params.id, aid)
    await loadAttachments()
  } catch (e) {
    errorMsg.value = '删除附件失败：' + (e.message || '')
  }
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}

async function loadComments() {
  try {
    comments.value = await fetchComments(route.params.id)
  } catch (e) {}
}

async function onAddComment() {
  if (!commentInput.value.trim()) return
  try {
    await addComment(route.params.id, commentInput.value)
    commentInput.value = ''
    await loadComments()
  } catch (e) {
    errorMsg.value = '评论失败：' + (e.message || '')
  }
}

async function onDeleteComment(cid) {
  try {
    await deleteComment(route.params.id, cid)
    await loadComments()
  } catch (e) {
    errorMsg.value = '删除评论失败：' + (e.message || '')
  }
}

const nextActions = computed(() => {
  if (!task.value) return []
  const status = task.value.status
  const actions = []
  const admin = isAdmin.value

  // todo + (是负责人 或 管理员) → "开始执行" (in_progress)
  if (status === 'todo' && (isAssignee.value || admin)) {
    actions.push({ type: 'primary', label: '开始执行', to: 'in_progress' })
  }
  // in_progress + (是负责人 或 管理员) → "提交审核" (pending_review)
  if (status === 'in_progress' && (isAssignee.value || admin)) {
    actions.push({ type: 'primary', label: '提交审核', to: 'pending_review' })
  }
  // pending_review + (是审批人 或 管理员) → "通过" (done), "驳回" (rejected)
  if (status === 'pending_review' && (isReviewer.value || admin)) {
    actions.push({ type: 'success', label: '通过', to: 'done' })
    actions.push({ type: 'danger', label: '驳回', to: 'rejected' })
  }
  // rejected + (是负责人 或 管理员) → "重新执行" (in_progress)
  if (status === 'rejected' && (isAssignee.value || admin)) {
    actions.push({ type: 'primary', label: '重新执行', to: 'in_progress' })
  }
  // done + 是部门主任 + task_type=department → "关闭任务" (closed)
  if (status === 'done' && (isDepartmentHead.value || admin) && task.value.task_type === 'department') {
    actions.push({ type: 'danger', label: '关闭任务', to: 'closed' })
  }
  // done + 是创建人 + task_type=team → "关闭任务" (closed)(班组任务创建人可关闭)
  if (status === 'done' && (isCreator.value || admin) && task.value.task_type === 'team') {
    actions.push({ type: 'danger', label: '关闭任务', to: 'closed' })
  }
  return actions
})

const roleHint = computed(() => {
  if (!task.value) return ''
  if (isAdmin.value) return '管理员'
  if (isDepartmentHead.value) return '你是部门主任'
  if (isCreator.value) return '你是创建人'
  if (isReviewer.value) return '你是审批人'
  if (isAssignee.value) return '你是负责人'
  return '你是协作者'
})

function formatTime(t) { return dayjs(t).format('YYYY-MM-DD HH:mm') }

async function load() {
  try {
    task.value = await fetchTask(route.params.id)
    // 如果 userStore 还没加载,补加载一次(解决刷新页面后 profile 为空的问题)
    if (!userStore.profile) {
      await loadUser()
    }
    await loadAttachments()
    await loadComments()
  } catch (e) {
    errorMsg.value = '加载失败：' + (e.message || '未知错误')
  }
}

function onTransition(to) {
  pendingTo.value = to
  comment.value = ''
  successMsg.value = ''
  errorMsg.value = ''
  showComment.value = true
}

async function confirmTransition() {
  showComment.value = false
  successMsg.value = ''
  errorMsg.value = ''
  try {
    await transitionTask(task.value.id, task.value.status, pendingTo.value, comment.value)
    await load()
    successMsg.value = '操作成功！任务状态已更新'
  } catch (e) {
    errorMsg.value = '操作失败：' + (e.message || '未知错误')
  }
}

function onDelete() {
  successMsg.value = ''
  errorMsg.value = ''
  confirmModal.show = true
  confirmModal.title = '确认删除'
  confirmModal.message = '确认删除？删除后无法恢复'
  confirmModal.onConfirm = doDelete
}

async function doDelete() {
  confirmModal.show = false
  successMsg.value = ''
  errorMsg.value = ''
  try {
    await deleteTask(task.value.id)
    // 删除成功后跳转回列表
    router.replace('/tasks')
  } catch (e) {
    errorMsg.value = '删除失败：' + (e.message || '未知错误')
  }
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

/* 自定义弹窗 - 纯 CSS */
.custom-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.custom-modal {
  background: #ffffff;
  border-radius: 12px;
  width: 80%;
  max-width: 320px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.custom-modal-title {
  padding: 20px 16px 8px;
  font-size: 16px;
  font-weight: 600;
  color: #323233;
  text-align: center;
}

.custom-modal-body {
  padding: 8px 24px 20px;
  font-size: 14px;
  color: #323233;
  text-align: center;
  line-height: 1.6;
}

.custom-modal-actions {
  display: flex;
  border-top: 1px solid #ebedf0;
}

.custom-modal-btn {
  display: block;
  flex: 1;
  padding: 14px 0;
  border: none;
  background: #ffffff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
}

.custom-modal-btn.cancel {
  color: #969799;
  border-right: 1px solid #ebedf0;
}

.custom-modal-btn.confirm {
  color: #1989fa;
}

.custom-modal-btn:active {
  background: #f7f8fa;
}

.custom-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdee0;
  border-radius: 6px;
  font-size: 14px;
  color: #323233;
  outline: none;
}

.custom-input:focus {
  border-color: #1989fa;
}

.comment-item { padding:12px 0;border-bottom:1px solid #ebedf0; }
.comment-item:last-child { border-bottom:none; }
.comment-header { display:flex;align-items:center;gap:8px;margin-bottom:4px; }
.comment-author { font-weight:600;font-size:14px;color:#323233; }
.comment-time { font-size:12px;color:#969799; }
.comment-content { font-size:14px;color:#323233;line-height:1.5; }
</style>
