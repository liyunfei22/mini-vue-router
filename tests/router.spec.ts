/**
 * createRouter 单元测试(用 memory history,不依赖 DOM)
 */
import { describe, it, expect, vi } from 'vitest'
import { h, resolveComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createRouter, START_LOCATION_NORMALIZED } from '../src/router'
import { createMemoryHistory } from '../src/history/memory'
import { isNavigationFailure, NavigationFailureType } from '../src/errors'

const Home = { name: 'Home', render: () => h('div', 'home') }
const User = { name: 'User', render: () => h('div', 'user') }
const NotFound = { name: 'NotFound', render: () => h('div', '404') }

function makeRouter(routes: any[] = []) {
  return createRouter({
    history: createMemoryHistory(),
    routes,
  })
}

const basicRoutes = [
  { path: '/', name: 'home', component: Home },
  { path: '/users', name: 'users', component: User },
  { path: '/users/:id', name: 'user', component: User },
  { path: '/redirect-me', redirect: '/users' },
  { path: '/redirect-fn', redirect: (_to: any) => ({ path: '/users' }) },
  { path: '/catch-all/:pathMatch(.*)*', name: 'not-found', component: NotFound },
]

describe('导航基础', () => {
  it('初始 currentRoute 是 START_LOCATION_NORMALIZED', () => {
    const router = makeRouter(basicRoutes)
    expect(router.currentRoute.value).toBe(START_LOCATION_NORMALIZED)
  })

  it('push 更新 currentRoute', async () => {
    const router = makeRouter(basicRoutes)
    await router.push('/users')
    expect(router.currentRoute.value.path).toBe('/users')
    expect(router.currentRoute.value.name).toBe('users')
    expect(router.currentRoute.value.fullPath).toBe('/users')
  })

  it('push 带 query/hash/params', async () => {
    const router = makeRouter(basicRoutes)
    await router.push({ path: '/users/5', query: { page: '2' }, hash: '#top' })
    const route = router.currentRoute.value
    expect(route.params).toEqual({ id: '5' })
    expect(route.query).toEqual({ page: '2' })
    expect(route.hash).toBe('#top')
    expect(route.fullPath).toBe('/users/5?page=2#top')
  })

  it('未匹配的路径:matched 为空但导航成功(用于 404 页面)', async () => {
    const router = makeRouter(basicRoutes)
    await router.push('/nope')
    expect(router.currentRoute.value.matched).toEqual([])
    expect(router.currentRoute.value.path).toBe('/nope')
  })

  it('push 同路径目标返回 duplicated 失败', async () => {
    const router = makeRouter(basicRoutes)
    await router.push('/users')
    const result = await router.push('/users')
    expect(isNavigationFailure(result, NavigationFailureType.duplicated)).toBe(true)
  })

  it('force: true 绕过 duplicated', async () => {
    const router = makeRouter(basicRoutes)
    await router.push('/users')
    const result = await router.push({ path: '/users' } as any)
    expect(isNavigationFailure(result, NavigationFailureType.duplicated)).toBe(true)
    const forceResult = await router.push({ path: '/users', force: true } as any)
    expect(isNavigationFailure(forceResult, NavigationFailureType.duplicated)).toBe(false)
  })
})

describe('query 解析', () => {
  it('重复键合并为数组', async () => {
    const router = makeRouter(basicRoutes)
    await router.push('/users?a=1&a=2&b=3')
    expect(router.currentRoute.value.query).toEqual({ a: ['1', '2'], b: '3' })
  })

  it('无值键为 null(官方语义)', async () => {
    const router = makeRouter(basicRoutes)
    await router.push('/users?flag')
    expect(router.currentRoute.value.query).toEqual({ flag: null })
  })
})

describe('redirect', () => {
  it('记录级 redirect:导航到目标', async () => {
    const router = makeRouter(basicRoutes)
    await router.push('/redirect-me')
    expect(router.currentRoute.value.path).toBe('/users')
  })

  it('redirect 函数形式', async () => {
    const router = makeRouter(basicRoutes)
    await router.push('/redirect-fn')
    expect(router.currentRoute.value.path).toBe('/users')
  })

  it('守卫内 return 目标 → 重定向', async () => {
    const router = makeRouter(basicRoutes)
    router.beforeEach((to) => {
      if (to.path === '/blocked') return { path: '/users' }
    })
    await router.push('/blocked')
    expect(router.currentRoute.value.path).toBe('/users')
  })

  it('守卫内 next(目标) → 重定向', async () => {
    const router = makeRouter(basicRoutes)
    router.beforeEach((to, _from, next) => {
      if (to.path === '/blocked') next!({ path: '/users' })
      else next!()
    })
    await router.push('/blocked')
    expect(router.currentRoute.value.path).toBe('/users')
  })
})

describe('守卫失败', () => {
  it('beforeEach return false → aborted 失败,不导航', async () => {
    const router = makeRouter(basicRoutes)
    router.beforeEach((to, _from) => {
      if (to.path === '/secret') return false
    })
    await router.push('/users')
    const result = await router.push('/secret')
    expect(isNavigationFailure(result, NavigationFailureType.aborted)).toBe(true)
    expect(router.currentRoute.value.path).toBe('/users')
  })

  it('守卫抛错 → onError 触发 + promise reject', async () => {
    const router = makeRouter(basicRoutes)
    router.beforeEach(() => {
      throw new Error('boom')
    })
    const onError = vi.fn()
    router.onError(onError)
    await expect(router.push('/users')).rejects.toThrow('boom')
    expect(onError).toHaveBeenCalled()
  })

  it('afterEach 在失败时也能拿到 failure', async () => {
    const router = makeRouter(basicRoutes)
    router.beforeEach((to, _from) => {
      if (to.path === '/secret') return false
    })
    const afterSpy = vi.fn()
    router.afterEach(afterSpy)
    await router.push('/users')
    await router.push('/secret')
    const lastCall = afterSpy.mock.calls[afterSpy.mock.calls.length - 1]!
    expect(isNavigationFailure(lastCall[2], NavigationFailureType.aborted)).toBe(true)
  })
})

describe('replace / go', () => {
  it('replace 不新增历史条目', async () => {
    const router = makeRouter(basicRoutes)
    await router.push('/users')
    await router.replace('/')
    expect(router.currentRoute.value.path).toBe('/')
    await router.push('/users')
    router.go(-1) // memory go 触发的导航是异步管线,等一拍再断言
    await new Promise(r => setTimeout(r, 0))
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('beforeEach 可移除', async () => {
    const router = makeRouter(basicRoutes)
    const guard = vi.fn((_to: any, _from: any) => {
      // 返回值风格:什么都不返回 = 放行
    })
    const remove = router.beforeEach(guard)
    await router.push('/users')
    expect(guard).toHaveBeenCalled()
    remove()
    const callsBefore = guard.mock.calls.length
    await router.push('/')
    expect(guard.mock.calls.length).toBe(callsBefore)
  })
})

describe('install', () => {
  it('install 提供 $router / $route,并执行首次导航', async () => {
    const router = makeRouter(basicRoutes)
    const App = {
      render: () => h('div', [h(resolveComponent('router-view'))]),
    }
    const wrapper = mount(App, { global: { plugins: [router] } })
    await router.isReady()
    expect(router.currentRoute.value.path).toBe('/')
    // 等 DOM 渲染 flush
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.html()).toContain('home')
    await router.push('/users')
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.html()).toContain('user')
    wrapper.unmount()
  })

  it('isReady 在首次导航后 resolve', async () => {
    const router = makeRouter(basicRoutes)
    const ready = router.isReady()
    await router.push('/users')
    await expect(ready).resolves.toBeUndefined()
  })
})

describe('命名路由', () => {
  it('按 name 导航带 params', async () => {
    const router = makeRouter(basicRoutes)
    await router.push({ name: 'user', params: { id: '9' } })
    expect(router.currentRoute.value.path).toBe('/users/9')
  })

  it('不存在的 name:push 同步抛 MATCHER_NOT_FOUND(官方同)', async () => {
    const router = makeRouter(basicRoutes)
    // 与官方一致:resolve 阶段同步抛错
    expect(() => router.push({ name: 'ghost', params: {} })).toThrow(/No match/)
  })
})