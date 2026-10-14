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
import { STATUS_LABEL, exportStats } from '../api/task'

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

async function onExport() {
  try {
    const blob = await exportStats()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tasks_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    showToast(e.message || '导出失败')
  }
}

onMounted(loadData)
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding-bottom: 80px; }
.chart { width: 100%; height: 240px; }
.export-btn { color: #1989fa; font-size: 14px; }
</style>
