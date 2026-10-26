/**
 * demo 路由表:同一张表给 history / hash 两种模式共用
 */
import { createRouter, createWebHistory, createWebHashHistory } from '@mini/index'
import type { RouteRecordRaw } from '@mini/types'
import {
  Home,
  Users,
  UserDetail,
  About,
  GuardDemo,
  GuardSecret,
  Parent,
  ChildA,
  ChildB,
  NotFound,
  LongPage,
} from './pages'

export type Mode = 'history' | 'hash'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: Home },
  { path: '/about', name: 'about', component: About },
  { path: '/users', name: 'users', component: Users },
  { path: '/users/:id', name: 'user-detail', component: UserDetail },
  {
    path: '/parent',
    component: Parent,
    children: [
      { path: 'child-a', name: 'child-a', component: ChildA },
      { path: 'child-b', name: 'child-b', component: ChildB },
    ],
  },
  {
    path: '/guard',
    component: GuardDemo,
    beforeEnter: () => {
      window.__guardLog += '→ [route] beforeEnter(/guard)\n'
    },
    children: [
      {
        path: 'secret',
        name: 'guard-secret',
        component: GuardSecret,
        beforeEnter: () => {
          window.__guardLog += '→ [route] beforeEnter(/guard/secret) 被全局守卫拦截…\n'
        },
      },
    ],
  },
  {
    path: '/long',
    name: 'long',
    component: LongPage,
  },
  // 懒加载:() => import(...) 在导航管线中才真正加载
  {
    path: '/lazy',
    name: 'lazy',
    component: () => import('./lazy-load').then(m => m.LazyLoaded),
  },
  // 兜底 404
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound },
]

export function buildRouter(mode: Mode) {
  const router = createRouter({
    history:
      mode === 'hash' ? createWebHashHistory() : createWebHistory(),
    routes,
    // 滚动行为:新导航回到顶部;back/forward 恢复上次位置
    scrollBehavior(_to, _from, savedPosition) {
      return savedPosition || { top: 0 }
    },
    linkActiveClass: 'router-link-active',
    linkExactActiveClass: 'router-link-exact-active',
  })

  // ---- 守卫日志(演示用) ----
  window.__guardLog = ''

  router.beforeEach((to, from) => {
    window.__guardLog += `→ [global] beforeEach: ${from.fullPath} → ${to.fullPath}\n`
    // 拦截秘密页
    if (to.path === '/guard/secret') {
      window.__guardLog += '✗ [global] beforeEach 返回 false,导航终止!\n'
      return false
    }
  })

  router.afterEach((to, from, failure) => {
    window.__guardLog += `✓ [global] afterEach: ${from.fullPath} → ${to.fullPath}${failure ? ' (失败:' + failure.type + ')' : ''}\n`
  })

  return router
}

// 给 app.ts 渲染日志面板用
export const routesForMenu = routes.filter(r => r.path !== '/:pathMatch(.*)*')