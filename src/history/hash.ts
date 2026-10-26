/**
 * createWebHashHistory —— hash 模式
 *
 * 教学点:hash 模式几乎**零成本**复用了 createWebHistory 的全部机制——
 * popstate 同样在 hash 变化时触发、history.state 同样可用,
 * 唯一区别是 base 的前缀带 '#'(URL 上 '#' 之后的内容不发给服务器)。
 *
 * 对应官方:packages/router/src/history/hash.ts
 */
import type { History } from '../types'
import { createWebHistory } from './html5'
import { warn } from '../utils'

export function createWebHashHistory(base?: string): History {
  // 默认 base = 当前页面的 pathname + search(如 '/folder/#/')
  base = window.location.host
    ? base || window.location.pathname + window.location.search
    : ''
  if (!base.includes('#')) base += '#'
  if (!base.endsWith('#/') && !base.endsWith('#')) {
    warn(`hash base 必须以 "#" 结尾:"${base}" 应改为 "${base.replace(/#.*$/, '#')}"`)
  }
  return createWebHistory(base)
}