<template>
  <div class="page">
    <van-nav-bar title="统计报表" fixed placeholder>
      <template #right>
        <span class="export-btn" @click="onExport">导出</span>
      </template>
    </van-nav-bar>

    <van-cell-group inset title="任务概览">
      <van-grid :column-num="2" :border="false">
        <van-grid-item v-for="s in stats" :key="s.text" :icon="s.icon" :text="s.text" />
      </van-grid>
    </van-cell-group>

    <van-cell-group inset title="状态分布">
      <div ref="statusChart" class="chart" />
    </van-cell-group>

    <van-cell-group inset title="负责人工作量">
      <div ref="assigneeChart" class="chart" />
    </van-cell-group>

    <van-cell-group inset title="近 7 天创建趋势">
      <div ref="trendChart" class="chart" />
    </van-cell-group>

    <!-- 导出格式选择 -->
    <div v-if="showExport" class="exp-overlay" @click="showExport = false">
      <div class="exp-modal" @click.stop>
        <div class="exp-title">导出任务清单</div>
        <div class="exp-opt" @click="doExport('xls')">
          <div class="exp-opt-name">Excel 表格（.xls）</div>
          <div class="exp-opt-desc">可直接用 Excel / WPS 打开</div>
        </div>
        <div class="exp-opt" @click="doExport('csv')">
          <div class="exp-opt-name">CSV 文件（.csv）</div>
          <div class="exp-opt-desc">通用格式，多数软件可导入</div>
        </div>
        <div class="exp-cancel" @click="showExport = false">取消</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart, BarChart, LineChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, GridComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([PieChart, BarChart, LineChart, TitleComponent, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer])
import { showToast } from 'vant'
import { STATUS_LABEL } from '../api/task'

const statusChart = ref()
const assigneeChart = ref()
const trendChart = ref()
const stats = ref([])

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

function getToken() {
  const session = JSON.parse(localStorage.getItem('sb_session') || '{}')
  return session.access_token || ''
}

async function loadData() {
  try {
    const res = await fetch(`${API_BASE}/stats`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    })
    if (!res.ok) throw new Error('加载失败')
    const data = await res.json()
    const tasks = data.tasks || []

    const total = tasks.length
    const done = tasks.filter(t => t.status === 'done').length
    const pending = tasks.filter(t => t.status === 'pending_review').length
    const inProgress = tasks.filter(t => t.status === 'in_progress').length
    stats.value = [
      { icon: 'description', text: `总数 ${total}` },
      { icon: 'clock-o', text: `进行 ${inProgress}` },
      { icon: 'todo-o', text: `待审 ${pending}` },
      { icon: 'passed', text: `完成 ${done}` }
    ]

    await nextTick()
    drawStatus(tasks)
    drawAssignee(tasks)
    drawTrend(tasks)
  } catch (e) {
    showToast(e.message || '加载失败')
  }
}

function drawStatus(tasks) {
  const counts = {}
  tasks.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1 })
  const chart = echarts.init(statusChart.value)
  chart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, type: 'scroll' },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      label: { formatter: '{b}: {c}' },
      data: Object.entries(counts).map(([k, v]) => ({ name: STATUS_LABEL[k], value: v }))
    }]
  })
}

function drawAssignee(tasks) {
  const counts = {}
  tasks.forEach(t => {
    const name = t.assignee?.name || (t.assignee_id ? t.assignee_id.slice(0, 8) : '未分配')
    counts[name] = (counts[name] || 0) + 1
  })
  const chart = echarts.init(assigneeChart.value)
  chart.setOption({
    tooltip: {},
    grid: { left: 8, right: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: Object.keys(counts), axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'bar', data: Object.values(counts), itemStyle: { color: '#1989fa' } }]
  })
}

function drawTrend(tasks) {
  const days = []
  for (let i = 6; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10))
  }
  const counts = days.map(d => tasks.filter(t => (t.created_at || '').slice(0, 10) === d).length)
  const chart = echarts.init(trendChart.value)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: days.map(d => d.slice(5)) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'line', data: counts, smooth: true, areaStyle: {}, itemStyle: { color: '#07c160' } }]
  })
}

const showExport = ref(false)

function onExport() {
  showExport.value = true
}

// 直接打开后端下载链接 → 交给钉钉内置浏览器下载/打开(可再"发送到外部应用")
function doExport(format) {
  showExport.value = false
  const token = getToken()
  if (!token) { showToast('请先登录'); return }
  const url = `${API_BASE}/stats/export?format=${format}&token=${encodeURIComponent(token)}`
  window.open(url, '_blank')
}

onMounted(loadData)
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding-bottom: calc(90px + env(safe-area-inset-bottom)); }
.chart { width: 100%; height: 240px; }
.export-btn { color: #1989fa; font-size: 14px; }

/* 导出格式选择弹窗 */
.exp-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.45); z-index: 1000;
  display: flex; align-items: flex-end;
}
.exp-modal {
  width: 100%; background: #fff;
  border-radius: 14px 14px 0 0; padding: 8px 0 env(safe-area-inset-bottom);
}
.exp-title {
  font-size: 15px; font-weight: 600; color: #323233;
  text-align: center; padding: 14px 0 8px;
}
.exp-opt { padding: 14px 20px; border-top: 1px solid #f2f3f5; cursor: pointer; }
.exp-opt:active { background: #f7f8fa; }
.exp-opt-name { font-size: 15px; color: #323233; }
.exp-opt-desc { font-size: 12px; color: #969799; margin-top: 3px; }
.exp-cancel {
  text-align: center; padding: 14px 0; margin-top: 8px;
  font-size: 15px; color: #969799; border-top: 8px solid #f7f8fa; cursor: pointer;
}
</style>
