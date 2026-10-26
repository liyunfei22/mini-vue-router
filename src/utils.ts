/**
 * 通用工具函数(学习向:每个函数都有对应官方源码中的原版)
 */
import type { RouteParams, RouteQuery } from './types'

// ------------------------------------------------------------------
// 警告
// ------------------------------------------------------------------

export function warn(msg: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[mini-vue-router] ${msg}`)
}

// ------------------------------------------------------------------
// 对象判断
// ------------------------------------------------------------------

export const isESModule = (obj: any): obj is { default: any } =>
  obj.__esModule || obj[Symbol.toStringTag] === 'Module'

export const isObject = (val: unknown): val is Record<string, any> =>
  val !== null && typeof val === 'object'

export const isPromise = <T = any>(val: unknown): val is Promise<T> =>
  isObject(val) && 'then' in val && typeof (val as any).then === 'function'

export const isString = (val: unknown): val is string => typeof val === 'string'

export const isSymbol = (val: unknown): val is symbol => typeof val === 'symbol'

// ------------------------------------------------------------------
// 浅层扩展
// ------------------------------------------------------------------

/** 把 from 的属性拷贝到 to(Object.assign 的循环写成,便于对比官方) */
export function extend<T extends object, U extends object>(to: T, from: U): T & U {
  for (const key in from) {
    ;(to as any)[key] = (from as any)[key]
  }
  return to as T & U
}

// ------------------------------------------------------------------
// 深/浅相等
// ------------------------------------------------------------------

/** 深度相等(支持数组),用于 query / params 比较 */
export function looseEqual(a: any, b: any): boolean {
  if (a === b) return true
  let isObjectA = isObject(a)
  let isObjectB = isObject(b)
  if (isObjectA && isObjectB) {
    try {
      const isArrayA = Array.isArray(a)
      const isArrayB = Array.isArray(b)
      if (isArrayA && isArrayB) {
        return a.length === b.length && a.every((e, i) => looseEqual(e, b[i]))
      }
      if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime()
      }
      if (!isArrayA && !isArrayB) {
        const keysA = Object.keys(a)
        const keysB = Object.keys(b)
        return (
          keysA.length === keysB.length &&
          keysA.every(key => looseEqual(a[key], b[key]))
        )
      }
      return false
    } catch (e) {
      return false
    }
  } else if (!isObjectA && !isObjectB) {
    return String(a) === String(b)
  }
  return false
}

/**
 * 比较两个 params 是否存在差异。
 * compareUntil: 只比较前 n 个键(路由记录匹配时只需比对该记录的参数)
 */
export function isSameRouteLocationParams(
  a: RouteParams,
  b: RouteParams,
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(key => looseEqual(a[key], b[key]))
}

/**
 * 只比较 a 中存在的键与 b 对应键(子集比较)。
 * 用于守卫:同一记录仅比较该记录 keys 对应的参数是否变化
 */
export function isSameRouteLocationParamsCompare(
  a: RouteParams,
  b: RouteParams,
  compareUntil: number,
): boolean {
  const aKeys = Object.keys(a)
  let i = 0
  while (i < compareUntil && i < aKeys.length) {
    const key = aKeys[i]
    if (!looseEqual(a[key], b[key])) return false
    i++
  }
  return true
}

/**
 * 记录同一性(官方同款):alias 记录透视到主记录再比较
 */
export function isSameRouteRecord(
  a: { aliasOf?: object },
  b: { aliasOf?: object },
): boolean {
  return (a.aliasOf || a) === (b.aliasOf || b)
}

// ------------------------------------------------------------------
// query 解析
// ------------------------------------------------------------------

/**
 * 把 URL 上的 query 字符串解析为 RouteQuery 对象。
 * 简化实现:与官方一致支持 键=值、重复键(→数组)、无值的键(→null)。
 * 不做官方的高级边界处理(?a 与 ?a= 全等价 null)
 */
export function parseQuery(search: string): RouteQuery {
  const query: RouteQuery = {}
  if (!search || search === '?') return query

  for (const segment of search.split('&')) {
    if (!segment) continue
    // 分离键与值(只按第一个 '=' 切分)
    const eqIndex = segment.indexOf('=')
    const rawKey = eqIndex >= 0 ? segment.slice(0, eqIndex) : segment
    const rawValue = eqIndex >= 0 ? segment.slice(eqIndex + 1) : null
    const key = decodeURIComponent(rawKey)
    const value = rawValue === null ? null : decodeURIComponent(rawValue)

    if (key in query) {
      const current = query[key]
      // 重复键:合并为数组
      if (Array.isArray(current)) {
        ;(current as Array<string | null>).push(value)
      } else {
        query[key] = [current, value]
      }
    } else {
      query[key] = value
    }
  }
  return query
}

/**
 * 把 RouteQuery 序列化为 query 字符串(带 '?')
 */
export function stringifyQuery(query: RouteQuery): string {
  let search = ''
  for (const key in query) {
    const value = query[key]
    const values = Array.isArray(value) ? value : [value]
    for (const v of values) {
      if (v == null) {
        search += (search ? '&' : '') + encodeURIComponent(key)
      } else {
        search +=
          (search ? '&' : '') +
          encodeURIComponent(key) +
          '=' +
          encodeURIComponent(String(v))
      }
    }
  }
  return search ? '?' + search : ''
}