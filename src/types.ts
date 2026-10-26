/**
 * 全部公开类型定义 —— 与 vue-router 4 的公开类型签名保持一致
 * (内部实现允许简化,但读者看到的名字、形状与官方一致,迁移学习无摩擦)
 */
import type {
  App,
  Component,
  ComponentPublicInstance,
  InjectionKey,
  Ref,
} from 'vue'
import type { NavigationFailure } from './errors'

// ------------------------------------------------------------------
// 路由记录 (Route Records)
// ------------------------------------------------------------------

/**
 * 用户写的原始路由表(RouterOptions.routes 的每一项)
 * 简化版:官方是复杂的联合类型(多级 children 拆分),这里合并成一种
 */
export interface RouteRecordRaw {
  path: string
  name?: RouteRecordName
  /** 组件:可以是单个组件,也可以是命名视图 { [viewName]: Component } */
  components?: RouteComponents
  component?: Component      // 单组件快捷写法,归一化时并入 components
  redirect?: RouteRecordRedirectOption
  alias?: string | string[]
  children?: RouteRecordRaw[]
  meta?: RouteMeta
  beforeEnter?: NavigationGuard | NavigationGuard[]
  props?: boolean | object  // 简化支持,仅透传不改行为
}

/** 归一化后的记录(通过 normalizeRouteRecord 生成,再交给 matcher) */
export interface RouteRecordNormalized {
  path: string
  name?: RouteRecordName
  /** 组件为 null 表示"分组节点"(官方称 phantom):占住 matched 链位置但不渲染 */
  components: RouteComponents | null
  redirect?: RouteRecordRedirectOption
  alias?: string[]
  beforeEnter?: NavigationGuard | NavigationGuard[]
  meta: RouteMeta
  children: RouteRecordNormalized[]
}

export type RouteRecordName = string | symbol

export type RouteComponent = Component | (() => Promise<Component>)
export type RouteComponents = Record<string, RouteComponent>

export type RouteRecordRedirectOption =
  | string
  | RouteLocationRaw
  | ((to: RouteLocation) => RouteLocationRaw)

// ------------------------------------------------------------------
// 路由位置 (Route Location)
// ------------------------------------------------------------------

/**
 * 解析后的参数对象。repeatable 参数(如 `:id*`)是数组
 * 官方类型:RouteParamsRaw 允许 number/boolean 传入,解析后 RouteParams 归一为 string|string[]
 */
export interface RouteParams {
  [key: string]: string | string[]
}

/** 用户传入的"宽松"参数(命名路由跳转时可传数字/布尔,会自动字符串化) */
export type RouteParamsRaw = Record<
  string,
  string | number | boolean | (string | number | boolean)[] | null | undefined
>

/** query —— 值为 string | string[] | null(string[] 用于重复键,如 ?a=1&a=2) */
export interface RouteQuery {
  [key: string]: string | null | (string | null)[]
}

/** 用户调用 router.push/router-link :to 时传入的"未解析"目标 */
export type RouteLocationRaw =
  | string
  | (RouteLocationPathRaw & Partial<RouteLocationNamedRaw>) // 简化:合并成一个接口
  | RouteLocationNamedRaw

export interface RouteLocationPathRaw {
  path?: string
  query?: RouteQuery
  hash?: string
}

export interface RouteLocationNamedRaw {
  name: RouteRecordName
  params?: RouteParamsRaw
  query?: RouteQuery
  hash?: string
}

/** 导航解析后得到的完整位置(带 fullPath、matched、meta) */
export interface RouteLocation {
  path: string
  fullPath: string
  name: RouteRecordName | undefined
  params: RouteParams
  query: RouteQuery
  hash: string
  /** 重定向链来源(记录本次 location 是由哪个位置重定向过来的) */
  redirectedFrom?: RouteLocation
  /** 匹配到的记录链(父 → 子) */
  matched: RouteRecordNormalized[]
  /** 合并所有 matched 记录的 meta(深层覆盖浅层同名键) */
  meta: RouteMeta
}

/** 导航过程中的位置类型(别名,语义:已经规范化、可被守卫使用) */
export type RouteLocationNormalized = RouteLocation
export type RouteLocationNormalizedLoaded = RouteLocation

export type RouteMeta = Record<string | number | symbol, unknown>

// ------------------------------------------------------------------
// 导航守卫 (Navigation Guards)
// ------------------------------------------------------------------

/**
 * next 回调。vue-router 4 中守卫可以:
 *  - 不调用 next(返回值语义)或调用 next() → 放行
 *  - next(false) → 中止
 *  - next(Error) → 报错
 *  - next(路由目标) → 重定向
 *  - next(vm)(仅 beforeRouteEnter)→ 在组件实例化后回调
 */
export type NavigationGuardNext = (error?: any) => void

export type NavigationGuard = (
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
  next?: NavigationGuardNext,
) => NavigationGuardReturn | Promise<NavigationGuardReturn>

export type NavigationGuardReturn = void | boolean | RouteLocationRaw | Error

// ------------------------------------------------------------------
// history 层统一接口(memory / html5 / hash 三种实现)
// 与官方 _History 接口一致,实现细节见 src/history/*.ts
// ------------------------------------------------------------------

export interface History {
  /** 规范化后的 base(如 '/app/';hash 模式为 '/app/#/' 形态) */
  base: string
  /** 当前规范化 location(不含 base 前缀) */
  location: string
  /** 订阅导航事件(URL 变化 / go 移动);返回取消订阅函数 */
  listen(cb: (to: string, from: { location: string; state: unknown }) => void): () => void
  push(to: string, data?: unknown): void
  replace(to: string, data?: unknown): void
  go(delta: number): void
}

// ------------------------------------------------------------------
// Router
// ------------------------------------------------------------------

export interface RouterOptions {
  /** history 实例:createWebHistory / createWebHashHistory / createMemoryHistory */
  history: History
  routes: RouteRecordRaw[]
  /** 滚动行为函数:返回滚动目标位置(或 Promise) */
  scrollBehavior?: (
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
    savedPosition: _ScrollPosition | null,
  ) => _ScrollPosition | Promise<_ScrollPosition | null | undefined> | null | undefined
  /** RouterLink 默认激活类名 */
  linkActiveClass?: string
  /** RouterLink 默认精确激活类名 */
  linkExactActiveClass?: string
}

export declare type _ScrollPosition =
  | { top?: number; left?: number; behavior?: ScrollBehavior }
  | { el: string | Element; top?: number; left?: number; behavior?: ScrollBehavior }

export interface Router {
  readonly currentRoute: Ref<RouteLocationNormalizedLoaded>
  readonly options: RouterOptions

  push(to: RouteLocationRaw): Promise<NavigationFailure | void | undefined>
  replace(to: RouteLocationRaw): Promise<NavigationFailure | void | undefined>
  back(): ReturnType<Router['go']>
  forward(): ReturnType<Router['go']>
  go(delta: number): void

  addRoute(
    parentName: RouteRecordName,
    route: RouteRecordRaw,
  ): () => void
  addRoute(route: RouteRecordRaw): () => void
  removeRoute(name: RouteRecordName): void
  hasRoute(name: RouteRecordName): boolean
  getRoutes(): RouteRecordNormalized[]

  resolve(
    to: RouteLocationRaw,
    currentLocation?: RouteLocationNormalized,
  ): RouteLocation & { href: string }

  beforeEach(guard: NavigationGuard): () => void
  beforeResolve(guard: NavigationGuard): () => void
  afterEach(guard: (to: any, from: any, failure?: NavigationFailure) => any): () => void

  onError(handler: (error: any) => void): () => void
  isReady(): Promise<void>
  install(app: App): void
}

// ------------------------------------------------------------------
// Injection keys(组件实现用)
// ------------------------------------------------------------------

export const routerKey: InjectionKey<Router> = Symbol('mini router')
export const routerViewLocationKey: InjectionKey<Ref<RouteLocationNormalizedLoaded>> =
  Symbol('mini router view location')
/** RouterView 的深度注入键:嵌套 RouterView 每深一层 depth + 1 */
export const viewDepthKey: InjectionKey<Ref<number>> = Symbol('mini router view depth')

// ------------------------------------------------------------------
// 组件 props 类型
// ------------------------------------------------------------------

export interface RouterViewProps {
  name?: string
}

export interface RouterLinkProps {
  to: RouteLocationRaw
  replace?: boolean
  activeClass?: string
  exactActiveClass?: string
  /** custom 模式下不渲染 <a>,通过插槽暴露导航能力 */
  custom?: boolean
  /**
   * aria-current 取值:https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-current
   * 官方默认 'page',仅精确激活时设置
   */
  ariaCurrentValue?: 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false'
}

/** RouterLink 插槽暴露的上下文(useLink 的返回值) */
export interface RouterLinkSlotContext {
  href: string
  route: RouteLocation
  navigate: (e?: MouseEvent) => Promise<void | NavigationFailure>
  isActive: boolean
  isExactActive: boolean
}

/** 组件实例(enterCallbacks 的 next(vm) 用) */
export type RouterComponentInstance = ComponentPublicInstance
/** 别名:官方旧版命名 RouteComponentInstance */
export type RouteComponentInstance = RouterComponentInstance