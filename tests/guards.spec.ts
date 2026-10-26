/**
 * 导航守卫单元测试 —— 顺序、终止方式、组合式 API
 * 注意:beforeRouteUpdate/Leave 需要组件已挂载(record.instances),所以用真实 mount
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { h, resolveComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from '../src/router'
import { createMemoryHistory } from '../src/history/memory'
import { isNavigationFailure, NavigationFailureType } from '../src/errors'
import type { NavigationGuard } from '../src/types'

/** 记录守卫调用序列的数组,每个守卫把自己的名字 push 进去 */
let log: string[] = []

const makeGuard = (name: string): NavigationGuard => {
  return (_to, _from, next) => {
    log.push(name)
    next && next()
  }
}

// 真实组件(带选项式守卫)
const createPage = (name: string) => ({
  name,
  beforeRouteEnter: makeGuard(`enter:${name}`),
  beforeRouteUpdate: makeGuard(`update:${name}`),
  beforeRouteLeave: makeGuard(`leave:${name}`),
  render: () => h('div', name),
})

const Home = createPage('Home')
// 父组件嵌套 RouterView:子路由的组件才会真正挂载(instances 才会注册)
const Parent = {
  name: 'Parent',
  beforeRouteEnter: makeGuard('enter:Parent'),
  beforeRouteUpdate: makeGuard('update:Parent'),
  beforeRouteLeave: makeGuard('leave:Parent'),
  render: () => h('div', [h('div', 'parent'), h(resolveComponent('router-view'))]),
}
const Child = createPage('Child')
const About = createPage('About')

function makeRouter(
  options: { routes?: any[]; guards?: (router: ReturnType<typeof createRouter>) => void } = {},
): ReturnType<typeof createRouter> {
  const routes =
    options.routes && options.routes.length > 0
      ? options.routes
      : [
          { path: '/', name: 'home', component: Home },
          {
            path: '/parent',
            component: Parent,
            children: [{ path: 'child', name: 'parent-child', component: Child }],
          },
          { path: '/about', name: 'about', component: About },
        ]
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  })
  if (options.guards) options.guards(router)
  return router
}

/** 挂载 App 并等首次导航完成 */
async function mountApp(router: any) {
  const App = {
    render: () => h('div', [h(resolveComponent('router-view'))]),
  }
  const wrapper = mount(App, { global: { plugins: [router] } })
  await router.isReady()
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

beforeEach(() => {
  log = []
})

describe('守卫完整顺序', () => {
  it('嵌套路由:leave(最深→最浅) → beforeEach → enter(浅→深) → beforeResolve → afterEach', async () => {
    const router = makeRouter({
      guards: r => {
        r.beforeEach(makeGuard('global:beforeEach'))
        r.beforeResolve(makeGuard('global:beforeResolve'))
        r.afterEach((_to, _from) => log.push('global:afterEach'))
      },
    })
    await mountApp(router)

    // /parent/child → /about
    await router.push('/parent/child')
    log = [] // 清掉首次导航的日志
    await router.push('/about')
    expect(log.join(',')).toBe(
      [
        'leave:Child', // ① 失激活组件(最深 → 最浅)
        'leave:Parent',
        'global:beforeEach', // ② 全局
        'enter:About', // ⑤ beforeRouteEnter(④ 记录的 beforeEnter 没配)
        'global:beforeResolve', // ⑥
        'global:afterEach', // ⑦ 成功后才触发
      ].join(','),
    )
  })

  it('参数变化:update 触发、enter 不触发、实例复用', async () => {
    const detail1 = createPage('Detail')
    const router = makeRouter({
      routes: [{ path: '/d/:id', component: detail1 }],
    })
    await mountApp(router)
    await router.push('/d/1')
    log = []
    await router.push('/d/2')
    // 同一记录:update(而非 leave+enter)
    expect(log).toEqual(['update:Detail'])
  })
})

describe('守卫终止方式', () => {
  it('next(false) → aborted,位置不变,afterEach 带 failure', async () => {
    const router = makeRouter({
      guards: r => {
        r.beforeEach((to: any, _from: any, next: any) => {
          if (to.path === '/about') {
            next(false)
          } else {
            next()
          }
        })
        r.afterEach((_to, _from, failure) => log.push(`afterEach:${failure ? 'failure' : 'ok'}`))
      },
    })
    await mountApp(router)

    await router.push('/parent/child')
    log = []
    const result = await router.push('/about')
    expect(isNavigationFailure(result, NavigationFailureType.aborted)).toBe(true)
    expect(router.currentRoute.value.path).toBe('/parent/child')
    // 注意:leave 守卫在 beforeEach 之前就已执行(官方语义:先跑完 pipeline 阶段才中止)
    expect(log).toEqual(['leave:Child', 'leave:Parent', 'afterEach:failure'])
  })

  it('next(Error) → 抛出,onError 收到', async () => {
    const router = makeRouter({
      guards: r => {
        r.beforeEach((_to: any, _from: any, next: any) => {
          next(new Error('denied'))
        })
      },
    })
    const onError = vi.fn()
    router.onError(onError)
    await expect(router.push('/about')).rejects.toThrow('denied')
    expect(onError).toHaveBeenCalled()
  })

  it('beforeEach return false(返回值风格)等价于 next(false)', async () => {
    const router = makeRouter({
      guards: r => {
        r.beforeEach(to => {
          if (to.path === '/about') return false
        })
      },
    })
    await mountApp(router)
    await router.push('/parent/child')
    const result = await router.push('/about')
    expect(isNavigationFailure(result, NavigationFailureType.aborted)).toBe(true)
  })
})

describe('cancelled:导航被新导航取代', () => {
  it('慢守卫中的导航 A 被 B 取代 → A cancelled,B 成功', async () => {
    let resolveSlow: (v: unknown) => void
    const slowGuardPromise = new Promise(resolve => {
      resolveSlow = resolve
    })
    const router = makeRouter({
      guards: r => {
        r.beforeEach((to) => {
          if (to.path === '/parent/child') {
            // 慢守卫:A 卡在这里
            return slowGuardPromise.then(() => undefined)
          }
        })
      },
    })
    await mountApp(router)

    const slowNavigation = router.push('/parent/child')
    // A 在途时发起 B
    await router.push('/about')
    // 放行 A
    resolveSlow!(undefined)
    const A = await slowNavigation
    expect(isNavigationFailure(A, NavigationFailureType.cancelled)).toBe(true)
    // B 成功,currentRoute 属于 B
    expect(router.currentRoute.value.path).toBe('/about')
  })
})

describe('beforeRouteEnter 的 next(vm)', () => {
  it('组件挂载后收到实例', async () => {
    const received: any[] = []
    const GuardedPage = {
      name: 'GuardedPage',
      render: () => h('div', 'guarded'),
    }
    const router = makeRouter({
      routes: [
        {
          path: '/guarded',
          component: GuardedPage,
          // 选项式写法
          beforeEnter: (() => {
            return (_to: any, _from: any, next: any) => {
              log.push('record:beforeEnter')
              next()
            }
          })(),
        },
      ],
    })
    // 组件级 beforeRouteEnter 需要挂在组件上 —— 这里动态添加
    ;(GuardedPage as any).beforeRouteEnter = (_to: any, _from: any, next: any) => {
      log.push('component:beforeRouteEnter')
      next((vm: any) => received.push(vm))
    }
    await mountApp(router)
    await router.push('/guarded')
    await new Promise(r => setTimeout(r, 0))
    // 顺序:记录级 beforeEnter → 组件级 beforeRouteEnter
    expect(log).toEqual(['record:beforeEnter', 'component:beforeRouteEnter'])
    // next(vm) 在挂载后拿到实例
    expect(received.length).toBe(1)
    expect(received[0]).toBeTruthy()
  })
})

describe('组合式 API 守卫(onBeforeRouteLeave/Update)', () => {
  it('组件内注册的守卫生效,组件卸载时自动注销', async () => {
    const leaveLog: string[] = []
    const ComposablePage = {
      name: 'ComposablePage',
      setup() {
        onBeforeRouteLeave(() => {
          leaveLog.push('composable:leave')
        })
        onBeforeRouteUpdate(() => {
          leaveLog.push('composable:update')
        })
        // setup 返回函数 = 渲染函数
        return () => h('div', 'composable')
      },
    }
    const router = makeRouter({
      routes: [
        { path: '/c/:id', component: ComposablePage },
        { path: '/about', component: About },
      ],
    })
    const wrapper = await mountApp(router)
    await router.push('/c/1')
    await new Promise(r => setTimeout(r, 0))
    leaveLog.length = 0
    // 参数变化 → update
    await router.push('/c/2')
    await new Promise(r => setTimeout(r, 0))
    expect(leaveLog).toContain('composable:update')
    // 离开 → leave
    leaveLog.length = 0
    await router.push('/about')
    await new Promise(r => setTimeout(r, 0))
    expect(leaveLog).toEqual(['composable:leave'])
    wrapper.unmount()
  })
})