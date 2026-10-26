/**
 * history 层共享类型与工具
 * 对应官方:packages/router/src/history/common.ts
 */
import type { History } from '../types'

/** 一条 URL 的结构化表示(浏览器 history state 里存的字段) */
export interface HistoryLocation {
  pathname: string
  search: string
  hash: string
}

/**
 * 写入 window.history state 的导航状态。
 * back/current/forward:前一条/当前/后一条 URL 字符串
 * position:导航深度,back/forward 用 position 差值判断方向
 * scroll:离开该页时的滚动快照(供 scrollBehavior 恢复)
 */
export interface NavigationHistoryState {
  back: string | null
  current: string
  forward: string | null
  replaced?: boolean
  position: number
  scroll?: { left: number; top: number } | null
}

/** 把 '/user?page=2#top' 拆成 { pathname, search, hash } */
export function parseLocation(location: string): HistoryLocation {
  let pathname = location
  let search = ''
  let hash = ''
  const hashIndex = location.indexOf('#')
  if (hashIndex > -1) {
    hash = location.slice(hashIndex)
    pathname = location.slice(0, hashIndex)
  }
  const searchIndex = pathname.indexOf('?')
  if (searchIndex > -1) {
    search = pathname.slice(searchIndex)
    pathname = pathname.slice(0, searchIndex)
  }
  return { pathname, search, hash }
}

/**
 * 规范化 base:
 *  - 空值:浏览环境取 <base> 标签,否则 '/'
 *  - 保证以 '/' 开头;去掉尾部 '/'
 *  - 注意:根 base '/' 会被规范化成 ''(与官方一致:
 *    这样 createHref 与 pushState 的 URL 拼接都不会出现双斜杠)
 */
export function normalizeBase(base?: string): string {
  if (!base) {
    if (typeof document !== 'undefined' && document.querySelector) {
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
    } else {
      base = '/'
    }
  }
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // 去掉尾部 '/'('#/' 的 '#' 前部分,如 '/app/#/' → '/app/#';根 '/' → '')
  return base.replace(/\/$/, '')
}

/** 从 pathname 里去掉 base 前缀(createCurrentLocation 用) */
export function stripBase(pathname: string, base: string): string {
  if (base.startsWith('/') && pathname.startsWith(base)) {
    return pathname.slice(base.length) || '/'
  }
  return pathname
}

/** 浏览器地址首部:pushState 需要绝对 URL */
export const createBaseLocation = (): string =>
  typeof location !== 'undefined'
    ? location.protocol + '//' + location.host
    : ''

/**
 * 生成可写入地址栏的完整 URL:base(去尾斜杠)+ location
 * 即 <RouterLink href> 的格式,与官方一致
 */
export function createHref(base: string, location: string): string {
  return base.replace(/\/$/, '') + location
}

/**
 * 从 window.location 提取"规范化后的当前 location"(不含 base 前缀)。
 * - html5 模式:pathname(去 base) + search + hash
 * - hash 模式:取 '#' 之后的路径
 */
export function createCurrentLocation(base: string, location: Location): string {
  const { pathname, search, hash } = location
  const hashPos = base.indexOf('#')
  if (hashPos > -1) {
    // hash 模式:内容全在 '#' 之后
    let pathFromHash = hash.slice(1) // 去掉开头的 '#'
    if (!pathFromHash) return '/'
    if (pathFromHash[0] !== '/') pathFromHash = '/' + pathFromHash
    return stripBase(pathFromHash, '')
  }
  return stripBase(pathname, base) + search + hash
}

export type HistoryStateValue = NavigationHistoryState

export type { History }