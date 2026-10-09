<template>
  <div class="page">
    <van-nav-bar title="统计报表" left-arrow @click-left="$router.back()" fixed placeholder />

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
import * as echarts from 'echarts'
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
    // 后端 stats 没返回 assignee 对象,只有 assignee_id
    const name = t.assignee_name || t.assignee_id?.slice(0, 8) || '未分配'
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

onMounted(loadData)
</script>

<style scoped>
.page { min-height: 100vh; background: #f7f8fa; padding-bottom: 20px; }
.chart { width: 100%; height: 240px; }
</style>
