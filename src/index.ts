/**
 * mini-vue-router 公共 API 出口
 * 与官方 vue-router 的入口文件(index.ts)保持一致——读者对照官方源码时按图索骥
 */
export {
  createRouter,
  RouterLink,
  RouterView,
  START_LOCATION,
} from './router'
export { NavigationFailureType, isNavigationFailure } from './errors'
export type {
  Router,
  RouterOptions,
} from './types'

export { createWebHistory } from './history/html5'
export { createWebHashHistory } from './history/hash'
export { createMemoryHistory } from './history/memory'

export { routerKey, routerViewLocationKey, viewDepthKey } from './types'
export type {
  RouteLocation,
  RouteLocationNormalized,
  RouteLocationNormalizedLoaded,
  RouteLocationRaw,
  RouteLocationPathRaw,
  RouteLocationNamedRaw,
  RouteParams,
  RouteParamsRaw,
  RouteQuery,
  RouteMeta,
  RouteRecordRaw,
  RouteRecordNormalized,
  RouteRecordName,
  RouteRecordRedirectOption,
  RouteComponents,
  RouteComponent,
  NavigationGuard,
  NavigationGuardNext,
  NavigationGuardReturn,
  NavigationFailure,
  RouterComponentInstance,
  RouteComponentInstance,
  RouterLinkProps,
  RouterViewProps,
  RouterLinkSlotContext,
} from './types'

export type { History, HistoryLocation, NavigationHistoryState } from './history/common'