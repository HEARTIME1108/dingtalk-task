import { createRouter, createWebHistory } from 'vue-router'
import { isLoggedIn } from '../api/supabase'

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
    path: '/tasks/:id/edit', name: 'taskEdit',
    component: () => import('../views/TaskEdit.vue'),
    meta: { requiresAuth: true, title: '编辑任务' }
  },
  {
    path: '/dashboard', name: 'dashboard',
    component: () => import('../views/Dashboard.vue'),
    meta: { requiresAuth: true, title: '统计报表' }
  },
  {
    path: '/settings', name: 'settings',
    component: () => import('../views/Settings.vue'),
    meta: { requiresAuth: true, title: '分类设置' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const logged = isLoggedIn()
  if (to.meta.requiresAuth && !logged) {
    next({ name: 'login' })
  } else if (to.name === 'login' && logged) {
    next({ name: 'taskList' })
  } else {
    next()
  }
})

export default router
