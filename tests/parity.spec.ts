/**
 * parity —— 与官方 vue-router 的行为对拍
 *
 * 同一张路由表分别交给 mini 与官方 createRouter:
 *  - 同一批 URL → 对比 resolve 结果(matched 名称链 / params / path / fullPath)
 *  - 同一批导航 → 对比守卫调用顺序与失败类型
 *
 * 注意:官方支持的语法与 mini 相同(不含 mini 额外支持的分组语法),
 * 若有行为差异,以官方为准修复 mini —— 这是本测试文件存在的意义。
 */
import { describe, it, expect } from 'vitest'
import { createRouter as officialCreateRouter } from 'vue-router'
import { createMemoryHistory as officialMemoryHistory } from 'vue-router'
import { createRouter as miniCreateRouter } from '../src/router'
import { createMemoryHistory as miniMemoryHistory } from '../src/history/memory'
import { isNavigationFailure as miniIsFailure } from '../src/errors'
import type { RouteRecordRaw } from '../src/types'

/** 同一张路由表:嵌套、参数、通配、alias、redirect、可选参数、404 */
const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: {} },
  { path: '/users', name: 'users', component: {} },
  { path: '/users/new', name: 'user-new', component: {} },
  { path: '/users/:id', name: 'user-detail', component: {} },
  { path: '/users/:id/posts', name: 'user-posts', component: {} },
  { path: '/optional/:id?', name: 'optional', component: {} },
  { path: '/files/:pathMatch(.*)*', name: 'files', component: {} },
  {
    path: '/parent',
    name: 'parent',
    component: {},
    children: [
      { path: '', name: 'parent-home', component: {} },
      { path: 'child', name: 'parent-child', component: {} },
      {
        path: 'grand',
        name: 'grand',
        component: {},
        children: [{ path: 'leaf/:leafId', name: 'grand-leaf', component: {} }],
      },
    ],
  },
  { path: '/alias-main', name: 'alias-main', alias: '/alias-alt', component: {} },
  { path: '/redirect-me', redirect: '/users', component: {} },
]

function makePair() {
  const official = officialCreateRouter({
    history: officialMemoryHistory(),
    routes: routes as any,
  })
  const mini = miniCreateRouter({
    history: miniMemoryHistory(),
    routes,
  })
  return { official, mini }
}

/** 比较两个 resolve 结果的可观察字段 */
function expectSameLocation(officialRt: any, miniRt: any, to: any) {
  const o = officialRt.resolve(to)
  const m = miniRt.resolve(to)
  const explain = `resolve(${JSON.stringify(to)})\n  official: ${JSON.stringify(o, null, 2)}\n  mini:     ${JSON.stringify(m, null, 2)}`

  expect(m.path, explain).toBe(o.path)
  expect(m.fullPath, explain).toBe(o.fullPath)
  expect(m.name, explain).toBe(o.name)
  expect(m.matched.map((r: any) => r.name), explain).toEqual(o.matched.map((r: any) => r.name))
  expect(m.matched.map((r: any) => r.path), explain).toEqual(o.matched.map((r: any) => r.path))
  expect(m.params, explain).toEqual(o.params)
}

describe('resolve 对拍', () => {
  const urls = [
    '/',
    '/users',
    '/users/new',
    '/users/42',
    '/users/42/posts',
    '/optional',
    '/optional/5',
    '/files',
    '/files/a/b.txt',
    '/parent',
    '/parent/child',
    '/parent/grand/leaf/x1',
    '/alias-alt',
    // 未匹配(404)
    '/nope',
    // query / hash
    '/users?page=2&q=a%20b',
    '/users?flag',
    '/users?x=1&x=2',
    '/users#top',
  ]

  it.each(urls)('URL 对拍: %s', (url) => {
    const { official, mini } = makePair()
    expectSameLocation(official, mini, url)
  })

  it('命名路由对拍(带 params)', () => {
    const { official, mini } = makePair()
    expectSameLocation(official, mini, { name: 'user-detail', params: { id: '7', page: 'x' } })
    // 多余参数官方会忽略(不在路径上)
    expectSameLocation(official, mini, { name: 'user-posts', params: { id: '3', postId: '9', extra: 'z' } })
  })

  it('4xx 场景:命名路由不存在 → 两边 resolve 都抛 MATCHER_NOT_FOUND', () => {
    const { official, mini } = makePair()
    expect(() => official.resolve({ name: 'ghost', params: {} })).toThrow(/No match/)
    expect(() => mini.resolve({ name: 'ghost', params: {} })).toThrow(/No match/)
  })
})

describe('导航与失败类型对拍', () => {
  it('duplicated:同目标连续 push 的失败类型一致', async () => {
    const { official, mini } = makePair()
    await official.push('/users')
    await mini.push('/users')
    const [of, mf] = await Promise.all([official.push('/users'), mini.push('/users')])
    expect(of!.type).toBe(16) // NAVIGATION_DUPLICATED
    expect(miniIsFailure(mf)).toBe(true)
    expect((mf as any).type).toBe((of as any).type)
  })

  it('aborted:守卫 return false 的失败类型一致', async () => {
    const { official, mini } = makePair()
    official.beforeEach((to: any, _from: any) => to.path === '/users' && false)
    mini.beforeEach((to: any) => to.path === '/users' && false)
    const [of, mf] = await Promise.all([official.push('/users'), mini.push('/users')])
    expect((of as any).type).toBe(4) // NAVIGATION_ABORTED
    expect((mf as any).type).toBe(4)
  })

  it('守卫内重定向:同一守卫逻辑,落点一致', async () => {
    const { official, mini } = makePair()
    official.beforeEach((to: any, _from: any) => {
      if (to.path === '/redirect-me') return '/users/new'
    })
    mini.beforeEach((to: any) => {
      if (to.path === '/redirect-me') return '/users/new'
    })
    await Promise.all([official.push('/redirect-me'), mini.push('/redirect-me')])
    expect(mini.currentRoute.value.fullPath).toBe(official.currentRoute.value.fullPath)
  })

  it('守卫顺序对拍:beforeEach 记录一致', async () => {
    const order: string[] = []
    const { official, mini } = makePair()
    const oguard = () => {
      order.push('official')
    }
    const mguard = () => {
      order.push('mini')
    }
    // 各自注册,不互相影响
    official.beforeEach(oguard)
    mini.beforeEach(mguard)
    await official.push('/users/42')
    await mini.push('/users/42')
    // 各自的守卫按相同顺序执行了(相对自己)
    expect(order.filter(x => x === 'official')).toHaveLength(1)
    expect(order.filter(x => x === 'mini')).toHaveLength(1)
    // 核心:两者最终位置一致
    expect(mini.currentRoute.value.fullPath).toBe(official.currentRoute.value.fullPath)
  })

  it('redirect 记录:两条 redirect 链的落点一致', async () => {
    const { official, mini } = makePair()
    await official.push('/redirect-me')
    await mini.push('/redirect-me')
    expect(official.currentRoute.value.fullPath).toBe('/users')
    expect(mini.currentRoute.value.fullPath).toBe(official.currentRoute.value.fullPath)
  })
})