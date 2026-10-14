import { createRouter, createWebHistory } from 'vue-router'
import { isLoggedIn } from '../api/supabase'

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  // 一级 Tab(任务/统计/设置)共用底部导航,原地切换
  {
    path: '/',
    component: () => import('../views/TabLayout.vue'),
    children: [
      { path: '', redirect: '/tasks' },
      {
        path: 'tasks', name: 'taskList',
        component: () => import('../views/TaskList.vue'),
        meta: { requiresAuth: true, title: '任务列表' }
      },
      {
        path: 'dashboard', name: 'dashboard',
        component: () => import('../views/Dashboard.vue'),
        meta: { requiresAuth: true, title: '统计报表' }
      },
      {
        path: 'settings', name: 'settings',
        component: () => import('../views/Settings.vue'),
        meta: { requiresAuth: true, title: '分类设置' }
      }
    ]
  },
  // 顶部二级页面(不带底部导航)
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
