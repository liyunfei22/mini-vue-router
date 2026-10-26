/**
 * history 层单元测试
 * - memory:纯内存模拟,测到最细
 * - html5/hash:jsdom 环境测状态机接线(pushState 可用;
 *   jsdom 不会自动触发 popstate,测试中手动 dispatchEvent)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMemoryHistory } from '../src/history/memory'
import { createWebHistory } from '../src/history/html5'
import { createWebHashHistory } from '../src/history/hash'
import { normalizeBase, createHref, createCurrentLocation, type NavigationHistoryState } from '../src/history/common'

afterEach(() => {
  vi.restoreAllMocks()
})

// jsdom 的 window 在同一个测试文件内共享:每次测试前重置 history/URL,避免状态泄漏
beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('createMemoryHistory', () => {
  it('初始 location 为 /', () => {
    const history = createMemoryHistory()
    expect(history.location).toBe('/')
  })

  it('push 更新 location', () => {
    const history = createMemoryHistory()
    history.push('/users')
    expect(history.location).toBe('/users')
    history.push('/users/5')
    expect(history.location).toBe('/users/5')
  })

  it('back/forward 恢复历史', () => {
    const history = createMemoryHistory()
    history.push('/a')
    history.push('/b')
    history.push('/c')
    history.go(-1)
    expect(history.location).toBe('/b')
    history.go(-1)
    expect(history.location).toBe('/a')
    history.go(1)
    expect(history.location).toBe('/b')
    history.go(10) // 越界钳制
    expect(history.location).toBe('/c')
    history.go(-10) // 越界钳制
    expect(history.location).toBe('/')
  })

  it('go 触发监听器,携带 to 与 from', () => {
    const history = createMemoryHistory()
    history.push('/a')
    const spy = vi.fn()
    history.listen(spy)
    history.go(-1)
    expect(spy).toHaveBeenCalledWith('/', '/a')
  })

  it('back 后再 push 会截断后面的条目', () => {
    const history = createMemoryHistory()
    history.push('/a')
    history.push('/b')
    history.go(-1)
    history.push('/c')
    history.go(-1)
    expect(history.location).toBe('/a')
    history.go(1)
    expect(history.location).toBe('/c')
    history.go(1)
    expect(history.location).toBe('/c') // 已无 /b
  })

  it('replace 不新增条目', () => {
    const history = createMemoryHistory()
    history.push('/a')
    history.replace('/b')
    expect(history.location).toBe('/b')
    history.go(-1)
    expect(history.location).toBe('/')
  })

  it('listen 返回的取消函数生效', () => {
    const history = createMemoryHistory()
    const spy = vi.fn()
    const unlisten = history.listen(spy)
    history.push('/a')
    expect(spy).not.toHaveBeenCalled() // push 在 memory 中不触发 listen(与官方一致,仅 go 触发)
    unlisten()
    history.go(-1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('createHref 拼接 base', () => {
    const history = createMemoryHistory('/app')
    expect(history.createHref('/users')).toBe('/app/users')
  })
})

describe('normalizeBase / createHref / createCurrentLocation(纯函数)', () => {
  it('normalizeBase:补头去尾,根路径规范化为空串(官方同)', () => {
    expect(normalizeBase('app/')).toBe('/app')
    expect(normalizeBase('/app/')).toBe('/app')
    expect(normalizeBase('/')).toBe('')
  })

  it('createHref:base 尾斜杠消除', () => {
    expect(createHref('/app', '/users')).toBe('/app/users')
    expect(createHref('/', '/users')).toBe('/users')
  })

  it('createCurrentLocation:html5 模式 strip base', () => {
    const location = { pathname: '/app/users', search: '?page=1', hash: '' } as Location
    expect(createCurrentLocation('/app', location)).toBe('/users?page=1')
  })

  it('createCurrentLocation:hash 模式取 # 后内容', () => {
    const location = { pathname: '/', search: '', hash: '#/users/5' } as Location
    expect(createCurrentLocation('/#', location)).toBe('/users/5')
  })
})

describe('createWebHistory(jsdom 状态机)', () => {
  it('首次创建时写入初始 state(back/current/position)', () => {
    createWebHistory()
    const state = window.history.state
    expect(state).toBeTruthy()
    expect(state!.current).toBe('/')
    expect(state!.back).toBeNull()
    expect(state!.position).toBe(0)
  })

  it('push 后 location 更新,state 携带 back/current/position', () => {
    const history = createWebHistory()
    history.push('/users')
    expect(history.location).toBe('/users')
    const state = window.history.state
    expect(state!.current).toBe('/users')
    expect(state!.back).toBe('/')
    expect(state!.position).toBe(1)
  })

  it('push 的双重操作:先 replace 当前条目(写入 forward+滚动快照),再 push 新条目', () => {
    // jsdom 的 history.go() 不会恢复 state(已知限制),改用 spy 验证每次 push 触发两次写入:
    // replaceState(离开的条目) → pushState(新条目) —— 这正是"双重操作"机制
    const history = createWebHistory()
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    const pushSpy = vi.spyOn(window.history, 'pushState')
    history.push('/a')
    // 第一步:replace 当前(初始)条目,写入 forward 与滚动快照
    const replaced = replaceSpy.mock.calls[0]![0] as NavigationHistoryState
    expect(replaced.current).toBe('/')
    expect(replaced.forward).toBe('/a')
    expect(replaced.scroll).not.toBeNull()
    // 第二步:push 新条目,back 指向离开的位置,position + 1
    const pushed = pushSpy.mock.calls[0]![0] as NavigationHistoryState
    expect(pushed.current).toBe('/a')
    expect(pushed.back).toBe('/')
    expect(pushed.forward).toBeNull()
    expect(pushed.position).toBe(1)
  })

  it('popstate 同步 location 并触发 listener(手动 dispatch)', () => {
    const history = createWebHistory()
    const spy = vi.fn()
    history.listen(spy)
    history.push('/users')
    // jsdom 不会自动触发 popstate:手动模拟"浏览器回退"事件
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    expect(spy).toHaveBeenCalled()
    const [to] = spy.mock.calls[0]!
    expect(to).toBe('/users')
  })

  it('replace 不增加 position', () => {
    const history = createWebHistory()
    history.push('/a')
    history.replace('/b')
    expect(history.location).toBe('/b')
    expect(window.history.state!.position).toBe(1)
  })

  it('createHref 输出含 base 的 URL', () => {
    const history = createWebHistory('/app')
    expect(history.createHref('/users')).toBe('/app/users')
  })

  it('jsdom 无 scrollRestoration 属性时静默跳过(不报错)', () => {
    const history = createWebHistory()
    expect(history.location).toBe('/')
  })
})

describe('createWebHashHistory', () => {
  it('默认 base = pathname 加 #,自动补 #', () => {
    // jsdom 默认 URL 是 http://localhost:3000/ → pathname '/'
    const history = createWebHashHistory()
    expect(history.base).toBe('/#')
  })

  it('传入自定义 base 时补 #', () => {
    const history = createWebHashHistory('/folder/')
    expect(history.base).toBe('/folder/#')
  })

  it('push 更新 hash 并写入能匹配当前 hash 的 location', () => {
    const history = createWebHashHistory()
    history.push('/users')
    expect(window.location.hash).toBe('#/users')
    expect(history.location).toBe('/users')
  })

  it('createHref 保留 #', () => {
    const history = createWebHashHistory('/folder')
    expect(history.createHref('/users')).toBe('/folder#/users')
  })
})