/**
 * createMemoryHistory —— 内存版 history(测试 / SSR 用)
 *
 * 与官方实现一致:用数组 + 游标模拟浏览器历史栈,
 * go(delta) 移动游标并触发监听器。不触碰 window。
 *
 * 对应官方:packages/router/src/history/memory.ts
 */
import type { History } from '../types'
import { createHref, normalizeBase } from './common'

export function createMemoryHistory(base = ''): History {
  let listeners: Array<(to: string, from: string) => void> = []
  // 历史栈:每个条目是 [location, state],queue[position] 是当前位置
  let queue: Array<[string, unknown]> = [['/', {}]]
  let position = 0
  base = normalizeBase(base)

  function setLocation(location: string, state = {}) {
    position++
    if (position !== queue.length) {
      // 撤销了历史后退后再 push:截断后面的条目(所有路由器同款语义)
      queue.splice(position)
    }
    queue.push([location, state])
  }

  function triggerListeners(to: string, from: string) {
    for (const callback of listeners) {
      callback(to, from)
    }
  }

  function replace(to: string, state = {}) {
    // 覆盖当前位置:先回退游标再 setLocation
    queue.splice(position--, 1)
    setLocation(to, state)
  }

  function go(delta: number): void {
    const from = getLocation()
    position = Math.max(0, Math.min(position + delta, queue.length - 1))
    triggerListeners(getLocation(), from)
  }

  function getLocation(): string {
    return queue[position]![0]
  }

  return {
    base,
    get location() {
      return getLocation()
    },
    push: setLocation,
    replace,
    go,
    listen(callback) {
      listeners.push(callback)
      return () => {
        const index = listeners.indexOf(callback)
        if (index > -1) listeners.splice(index, 1)
      }
    },
    createHref: (loc: string) => createHref(base, loc),
  }
}