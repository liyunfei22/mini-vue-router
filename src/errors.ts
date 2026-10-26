/**
 * 错误类型与导航失败 (Navigation Failure)
 *
 * 与官方一致的语义:
 *  - MATCHER_NOT_FOUND(1):命名路由找不到
 *  - NAVIGATION_GUARD_REDIRECT(2):守卫内部重定向(内部错误,会触发重新导航)
 *  - aborted(4):被守卫中止(next(false) / return false)
 *  - cancelled(8):导航在途时被新的导航取代
 *  - duplicated(16):导航到当前所在位置(重复导航)
 */
import type { RouteLocationNormalized, RouteLocationRaw } from './types'

export const ErrorTypes = {
  MATCHER_NOT_FOUND: 1,
  NAVIGATION_GUARD_REDIRECT: 2,
  NAVIGATION_ABORTED: 4,
  NAVIGATION_CANCELLED: 8,
  NAVIGATION_DUPLICATED: 16,
} as const

export type ErrorTypes = (typeof ErrorTypes)[keyof typeof ErrorTypes]

/** 对外暴露的三类"可预期失败"(aborted / cancelled / duplicated) */
export const NavigationFailureType = {
  aborted: ErrorTypes.NAVIGATION_ABORTED,
  cancelled: ErrorTypes.NAVIGATION_CANCELLED,
  duplicated: ErrorTypes.NAVIGATION_DUPLICATED,
} as const

export type NavigationFailureType = (typeof NavigationFailureType)[keyof typeof NavigationFailureType]

export interface NavigationFailure extends Error {
  to: RouteLocationNormalized
  from: RouteLocationNormalized
  type: NavigationFailureType
  /** 当失败发生在重定向目标上时,记录原始位置 */
  redirectedFrom?: RouteLocationNormalized
}

/** 内部错误(守卫重定向),error.to 携带重定向目标 */
export interface NavigationRedirectError extends Error {
  to: RouteLocationRaw
  redirectedFrom?: RouteLocationNormalized
}

export interface RouterErrorParams {
  [key: string]: any
}

const messageMap: Record<number, (params: RouterErrorParams) => string> = {
  [ErrorTypes.MATCHER_NOT_FOUND]: params =>
    `Route with name '${String(params.name)}' does not exist`,
  [ErrorTypes.NAVIGATION_GUARD_REDIRECT]: params =>
    `Redirected from "${params.from.fullPath}" to "${params.to}" via a navigation guard.`,
  [ErrorTypes.NAVIGATION_ABORTED]: params =>
    `Navigation aborted from "${params.from.fullPath}" to "${params.to}" via a navigation guard.`,
  [ErrorTypes.NAVIGATION_CANCELLED]: params =>
    `Navigation cancelled from "${params.from.fullPath}" to "${params.to}" with a new navigation.`,
  [ErrorTypes.NAVIGATION_DUPLICATED]: params =>
    `Navigated to "${params.to.fullPath}" which already lies at the path of "from". It won't create a new entry during navigation.`,
}

export function createRouterError(
  type: ErrorTypes,
  params: RouterErrorParams,
): NavigationFailure & NavigationRedirectError {
  const error = new Error(messageMap[type](params)) as NavigationFailure & NavigationRedirectError
  error.type = type as NavigationFailureType
  error.to = params.to
  error.from = params.from
  if (params.redirectedFrom) error.redirectedFrom = params.redirectedFrom
  return error
}

/**
 * 判断一个错误是否是导航失败,可选地限定类型
 * 用法: if (isNavigationFailure(err, NavigationFailureType.aborted)) { ... }
 */
export function isNavigationFailure(
  error: any,
  type?: NavigationFailureType,
): error is NavigationFailure {
  return (
    error instanceof Error &&
    (error as NavigationFailure).type !== undefined &&
    (type == null || (error as NavigationFailure).type === type)
  )
}