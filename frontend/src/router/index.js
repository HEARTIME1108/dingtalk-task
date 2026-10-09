import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '../api/supabase'

const routes = [
  { path: '/', redirect: '/tasks' },
  { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  {
    path: '/tasks', name: 'taskList',
    component: () => import('../views/TaskList.vue'),
    meta: { requiresAuth: true, title: '任务列表' }
  },
  {
    path: '/tasks/new', name: 'taskCreate',
    component: () => import('../views/TaskCreate.vue'),
    meta: { requiresAuth: true, title: '新建任务' }
  },
  {
    path: '/tasks/:id', name: 'taskDetail',
    component: () => import('../views/TaskDetail.vue'),
    meta: { requiresAuth: true, title: '任务详情' }
  },
  {
    path: '/dashboard', name: 'dashboard',
    component: () => import('../views/Dashboard.vue'),
    meta: { requiresAuth: true, title: '统计报表' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to, from, next) => {
  const { data } = await supabase.auth.getSession()
  if (to.meta.requiresAuth && !data.session) {
    next({ name: 'login' })
  } else if (to.name === 'login' && data.session) {
    next({ name: 'taskList' })
  } else {
    next()
  }
})

export default router
