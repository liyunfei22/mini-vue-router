/**
 * createWebHistory —— HTML5 History 模式
 *
 * 关键机制(与官方一致的三个设计):
 *  1. state 模型:每次导航把 { back, current, forward, position, scroll } 写进
 *     history.state,popstate 时靠 position 差值判断前进还是后退
 *  2. push 的"双重操作":先 replaceState 更新当前条目(写入 forward 与滚动快照),
 *     再 pushState 新条目 —— 保证 back/forward 链永远正确
 *  3. popstate + scrollRestoration='manual' + 离开页面时写入滚动快照
 *
 * 对应官方:packages/router/src/history/html5.ts
 */
import type { History } from '../types'
import {
  createBaseLocation,
  createCurrentLocation,
  createHref,
  normalizeBase,
  type NavigationHistoryState,
} from './common'
import { warn } from '../utils'

export function createWebHistory(rawBase?: string): History {
  const base = normalizeBase(rawBase)

  const { history, location: windowLocation } = window

  // ---- 内存中的当前状态(不直接依赖 window.history.state,
  //      因为浏览器会在 replace 后失去对原始对象的引用) ----
  const currentLocation: { value: string } = {
    value: createCurrentLocation(base, windowLocation),
  }
  const historyState: { value: NavigationHistoryState } = {
    value: window.history.state as NavigationHistoryState,
  }

  // 首次进入页面:replaceState 写入一个干净的初始 state
  if (!historyState.value) {
    changeLocation(
      currentLocation.value,
      buildState(null, currentLocation.value, null, 0),
      true,
    )
  }

  function buildState(
    back: string | null,
    current: string,
    forward: string | null,
    position: number,
  ): NavigationHistoryState {
    return { back, current, forward, position, scroll: null }
  }

  /**
   * 写入 history(唯一改动浏览器历史的地方)。
   * url 的拼法:
   *  - hash 模式(base 含 '#'):只写 '#' 之后的片段
   *  - html5 模式:绝对 URL(协议+host) + base + to
   */
  function changeLocation(to: string, state: NavigationHistoryState, replace: boolean): void {
    const hashIndex = base.indexOf('#')
    const url =
      hashIndex > -1
        ? base.slice(hashIndex) + to
        : createBaseLocation() + base + to
    try {
      history[replace ? 'replaceState' : 'pushState'](state, '', url)
      historyState.value = state
    } catch (err) {
      warn(`Error with push/replace State: ${String(err)}`)
      // 某些浏览器(如旧的 Safari 私密模式)会拒绝 pushState,降级为整页跳转
      windowLocation[replace ? 'replace' : 'assign'](url)
    }
  }

  /** 获取当前滚动位置(写入 state 的 scroll 字段) */
  function getScrollPosition(): { left: number; top: number } {
    return { left: window.scrollX || 0, top: window.scrollY || 0 }
  }

  // ---- 公共 API ----

  function replace(to: string, data?: unknown): void {
    const state: NavigationHistoryState = {
      ...historyState.value,
      ...buildState(historyState.value.back, to, historyState.value.forward, historyState.value.position),
      ...(data ? (data as object) : {}),
      replaced: true,
    }
    changeLocation(to, state, true)
    currentLocation.value = to
  }

  /**
   * push 的"双重操作"(官方原版算法):
   *   第一步 replaceState 更新"当前条目":写入 forward 与离开前的滚动快照
   *   第二步 pushState 新条目:back 指向离开的位置,position + 1
   */
  function push(to: string, data?: unknown): void {
    // 第一步:replace 当前条目(把 forward 与滚动快照写进它的 state)
    const currentState: NavigationHistoryState = {
      ...historyState.value,
      forward: to,
      scroll: getScrollPosition(),
    }
    changeLocation(currentState.current, currentState, true)
    // 第二步:push 新条目
    const newState: NavigationHistoryState = {
      ...buildState(currentLocation.value, to, null, currentState.position + 1),
      ...(data ? (data as object) : {}),
    }
    changeLocation(to, newState, false)
    currentLocation.value = to
  }

  /** 向前/向后导航(原生 history.go);direction 由 router 层根据 delta 判断 */
  function go(delta: number): void {
    history.go(delta)
  }

  // ---- popstate 监听 ----

  const listeners: Array<(to: string, from: string) => void> = []

  function listen(cb: (to: string, from: string) => void): () => void {
    listeners.push(cb)
    return () => {
      const index = listeners.indexOf(cb)
      if (index > -1) listeners.splice(index, 1)
    }
  }

  window.addEventListener('popstate', (event: PopStateEvent) => {
    const to = createCurrentLocation(base, window.location)
    const from = currentLocation.value

    const state = event.state as NavigationHistoryState | null
    if (state) {
      // 正常前进/后退:浏览器给了我们真实写入的 state
      currentLocation.value = to
      historyState.value = state
    } else {
      // 外部导航(地址栏输入、location.assign 等):没有 state,用 replace 补齐
      replace(to)
    }

    listeners.forEach(listener => listener(currentLocation.value, from))
  })

  // 手动管理滚动:关闭浏览器的自动滚动恢复,由 scrollBehavior 接管
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual'
  }

  const routerHistory: History = {
    base,
    // location 用 getter 暴露:每次访问都拿到最新值
    get location() {
      return currentLocation.value
    },
    push,
    replace,
    go,
    listen,
    createHref: (location: string) => createHref(base, location),
  }

  return routerHistory
}