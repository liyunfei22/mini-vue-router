/**
 * matcher 单元测试:路由表的注册、匹配、嵌套、别名、动态增删
 */
import { describe, it, expect, vi } from 'vitest'
import { createRouterMatcher } from '../src/matcher'
import type { RouteRecordRaw } from '../src/types'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: { name: 'Home' } },
  { path: '/users', name: 'users', component: { name: 'Users' } },
  { path: '/users/new', name: 'user-new', component: { name: 'UserNew' } },
  { path: '/users/:id', name: 'user-detail', component: { name: 'UserDetail' } },
  { path: '/users/:id/posts', name: 'user-posts', component: { name: 'UserPosts' } },
  { path: '/optional/:id?', name: 'optional', component: { name: 'Optional' } },
  { path: '/files/:pathMatch(.*)*', name: 'files', component: { name: 'Files' } },
  {
    path: '/parent',
    name: 'parent',
    component: { name: 'Parent' },
    children: [
      { path: '', name: 'parent-home', component: { name: 'ParentHome' } },
      { path: 'child', name: 'parent-child', component: { name: 'ParentChild' } },
      {
        path: 'grand',
        name: 'grand',
        component: { name: 'Grand' },
        children: [{ path: 'leaf/:leafId', name: 'grand-leaf', component: { name: 'GrandLeaf' } }],
      },
    ],
  },
  { path: '/alias-main', name: 'alias-main', alias: '/alias-alt', component: { name: 'AliasMain' } },
  { path: '/redirect-me', name: 'redirect-me', redirect: '/users', component: { name: 'X' } },
  { path: '/group', children: [{ path: 'g-child', name: 'group-child', component: { name: 'GC' } }] },
]

function makeMatcher() {
  return createRouterMatcher(routes)
}

describe('基础匹配', () => {
  it('精确匹配静态路径', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve('/users')
    expect(location.path).toBe('/users')
    expect(location.matched.map(m => m.name)).toEqual(['users'])
    expect(location.fullPath).toBe('/users')
  })

  it('静态路径优先于参数路径', () => {
    const matcher = makeMatcher()
    // /users/new 同时满足 /users/new 与 /users/:id,应命中前者
    const { location } = matcher.resolve('/users/new')
    expect(location.name).toBe('user-new')
  })

  it('参数提取', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve('/users/42')
    expect(location.name).toBe('user-detail')
    expect(location.params).toEqual({ id: '42' })
  })

  it('可选参数未命中时为空串(官方同)', () => {
    const matcher = makeMatcher()
    expect(matcher.resolve('/optional').location.params).toEqual({ id: '' })
    expect(matcher.resolve('/optional/5').location.params).toEqual({ id: '5' })
  })

  it('通配路径(pathMatch)', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve('/files/a/b/c.txt')
    expect(location.name).toBe('files')
    expect(location.params.pathMatch).toEqual(['a', 'b', 'c.txt'])
  })

  it('未匹配的路径返回空 matched(404 语义)', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve('/not-exist')
    expect(location.matched).toEqual([])
    expect(location.name).toBeUndefined()
  })
})

describe('命名路由', () => {
  it('按 name 解析,带 params 自动 stringify 并归一', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve({ name: 'user-detail', params: { id: '7' } })
    expect(location.path).toBe('/users/7')
    expect(location.params).toEqual({ id: '7' })
    expect(location.fullPath).toBe('/users/7')
  })

  it('参数中的数字会被字符串化', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve({ name: 'user-detail', params: { id: 42 } })
    expect(location.path).toBe('/users/42')
  })

  it('缺失必填参数:回退到记录原始路径', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve({ name: 'user-detail' })
    expect(location.path).toBe('/users/:id')
  })

  it('不存在的 name:返回空 matched 并 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const matcher = makeMatcher()
    const { location } = matcher.resolve({ name: 'ghost' })
    expect(location.matched).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('query 与 hash 会拼进 fullPath', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve({ name: 'user-detail', params: { id: '1' }, query: { page: '2' }, hash: '#top' })
    expect(location.fullPath).toBe('/users/1?page=2#top')
    expect(location.query).toEqual({ page: '2' })
    expect(location.hash).toBe('#top')
  })
})

describe('嵌套路由', () => {
  it('matched 链为父→子顺序,每条记录都是自己的完整路径', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve('/parent/child')
    expect(location.matched.map(m => m.name)).toEqual(['parent', 'parent-child'])
    expect(location.matched.map(m => m.path)).toEqual(['/parent', '/parent/child'])
  })

  it('嵌套 2 层 + 路径参数,父层参数也进 params', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve('/parent/grand/leaf/x1')
    expect(location.matched.map(m => m.name)).toEqual(['parent', 'grand', 'grand-leaf'])
    expect(location.params).toEqual({ leafId: 'x1' })
  })

  it('空 path 子路由与父路由路径相同', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve('/parent')
    expect(location.matched.map(m => m.name)).toEqual(['parent', 'parent-home'])
  })

  it('分组记录(无组件)也进入 matched 链', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve('/group/g-child')
    expect(location.matched.map(m => m.name)).toEqual([undefined, 'group-child'])
    // group 记录 components 为 null(RouterView 会跳过它)
    expect(location.matched[0]!.components).toBeNull()
  })
})

describe('alias 与 redirect', () => {
  it('别名路径命中主记录:matched 记录 path 是别名路径,name 是主记录名(官方同)', () => {
    const matcher = makeMatcher()
    const { location } = matcher.resolve('/alias-alt')
    expect(location.name).toBe('alias-main')
    expect(location.path).toBe('/alias-alt')
    expect(location.matched[0]!.path).toBe('/alias-alt')
    expect(location.matched[0]!.name).toBe('alias-main')
  })

  it('redirect 记录:rewrite 目标挂在记录上,由 router 层消费', () => {
    const matcher = makeMatcher()
    const { location, matched } = matcher.resolve('/redirect-me')
    // matcher 层只负责把 redirect 目标挂在记录上,真正跳转由 router 层消费
    expect(location.name).toBe('redirect-me')
    expect(matched[0]!.record.redirect).toBe('/users')
  })
})

describe('动态增删(addRoute / removeRoute)', () => {
  it('addRoute 后可以解析;返回的移除函数可撤销', () => {
    const matcher = makeMatcher()
    const remove = matcher.addRoute({ path: '/dynamic/:id', name: 'dynamic', component: { name: 'D' } })
    expect(matcher.resolve('/dynamic/9').location.name).toBe('dynamic')
    remove()
    expect(matcher.resolve('/dynamic/9').location.matched).toEqual([])
  })

  it('addRoute 到命名父路由下', () => {
    const matcher = makeMatcher()
    matcher.addRoute('parent', { path: 'dynamic-child', name: 'dyn-child', component: D })
    const { location } = matcher.resolve('/parent/dynamic-child')
    expect(location.matched.map(m => m.name)).toEqual(['parent', 'dyn-child'])
  })

  it('removeRoute 级联清理子路由', () => {
    const matcher = makeMatcher()
    matcher.removeRoute('grand')
    // grand 及其子路由 grand-leaf 都被移除:'/parent/grand/leaf/x' 不再能匹配任何路由
    expect(matcher.resolve('/parent/grand/leaf/x').location.matched).toEqual([])
    // 同路径的空 path 子路由也不应残留
    expect(matcher.resolve('/parent').location.matched.map(m => m.name)).toEqual(['parent', 'parent-home'])
  })

  it('removeRoute 后 hasRoute 返回 false', () => {
    const matcher = makeMatcher()
    expect(matcher.hasRoute('users')).toBe(true)
    matcher.removeRoute('users')
    expect(matcher.hasRoute('users')).toBe(false)
  })

  it('hasRoute 对 alias 主记录生效', () => {
    const matcher = makeMatcher()
    expect(matcher.hasRoute('alias-main')).toBe(true)
  })

  it('getRoutes 返回全部记录', () => {
    const matcher = makeMatcher()
    const names = matcher.getRoutes().map(r => r.name).filter(Boolean)
    expect(names).toContain('users')
    expect(names).toContain('grand-leaf')
  })
})

// 占位组件(测试里不需要真正的组件实例)
const D = { name: 'D' }

describe('重名警告', () => {
  it('重复注册同名路由会 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const matcher = makeMatcher()
    matcher.addRoute({ path: '/dup', name: 'users', component: { name: 'Dup' } })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate route name'))
    warn.mockRestore()
  })
})