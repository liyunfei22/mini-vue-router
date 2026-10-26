/**
 * scrollBehavior 支撑工具
 *
 * 保存/恢复滚动位置的机制:
 *  1. push 导航:离开页的滚动快照写进 history.state.scroll(html5.ts 的 push 双重操作)
 *  2. back/forward:会话内 Map,按 "position + fullPath" 记录离开时的位置,
 *     popstate 触发导航前保存,恢复时取出并删除(一次性)
 *
 * 对应官方:packages/router/src/scrollBehavior.ts
 */
import type { _ScrollPosition } from './types'
import { warn } from './utils'

/** 当前滚动位置 */
export function getScrollPosition(): { left: number; top: number } {
  return {
    left: typeof window !== 'undefined' ? window.scrollX || 0 : 0,
    top: typeof window !== 'undefined' ? window.scrollY || 0 : 0,
  }
}

/** 会话内滚动位置的键:历史深度 + 路径(同一路径多次访问会拿到不同的 key) */
export function getScrollKey(path: string, delta: number): string {
  const position = window.history.state ? window.history.state.position : -1
  return (position - delta) as unknown as string + path
}

const scrollPositions = new Map<string, { left: number; top: number }>()

/** 离开某一页时保存滚动位置 */
export function saveScrollPosition(key: string, scrollPosition: { left: number; top: number }) {
  scrollPositions.set(key, scrollPosition)
}

/** 取出并删除保存的位置(一次性消费) */
export function getSavedScrollPosition(key: string): { left: number; top: number } | null {
  const scroll = scrollPositions.get(key)
  scrollPositions.delete(key)
  return scroll || null
}

/**
 * 执行滚动。支持两种返回值:
 *  - { left, top, behavior }:绝对位置
 *  - { el, top, left, behavior }:滚动到元素(el 支持选择器或元素本身)
 */
export function scrollToPosition(position: _ScrollPosition): void {
  let scrollToOptions: ScrollToOptions = { behavior: position.behavior }
  let offset: { top?: number; left?: number } = position

  if ('el' in position && position.el) {
    const el = typeof position.el === 'string' ? document.querySelector(position.el) : position.el
    if (!el) {
      warn(`无法找到 scrollBehavior "el" 指定的元素:${String(position.el)}`)
      return
    }
    const elRect = el.getBoundingClientRect()
    offset = {
      top: elRect.top + window.scrollY - (position.top ?? 0),
      left: elRect.left + window.scrollX - (position.left ?? 0),
    }
  }

  window.scrollTo({ ...scrollToOptions, ...offset })
}