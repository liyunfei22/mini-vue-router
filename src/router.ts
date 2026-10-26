/**
 * createRouter —— 路由器本体
 *
 * 核心职责(与官方一致的顺序):
 *  1. pushWithRedirect:解析目标 → 记录级 redirect 前置消费 → duplicated 判定
 *  2. navigate:守卫管线(失激活 leave → 全局 beforeEach → 复用 update →
 *     进入 enter(beforeEnter + 组件守卫)→ 懒加载 → 全局 beforeResolve),
 *     每段之间插入"导航是否被取代"检查(cancelled)
 *  3. finalizeNavigation:URL 更新(history.push/replace)→ currentRoute 整体替换 →
 *     scrollBehavior → ready 标记
 *
 * 对应官方:packages/router/src/router.ts
 */
import { nextTick, shallowRef, inject, onUnmounted } from 'vue'
import type { App } from 'vue'
import { createRouterMatcher } from './matcher'
import {
  createRouterError,
  isNavigationFailure,
  ErrorTypes,
  NavigationFailureType,
} from './errors'
import type { NavigationFailure } from './errors'
import { warn, isString, isObject, extend, looseEqual, stringifyQuery, isSameRouteRecord } from './utils'
import {
  getScrollKey,
  getSavedScrollPosition,
  getScrollPosition,
  saveScrollPosition,
  scrollToPosition,
} from './scrollBehavior'
import type {
  History,
  NavigationGuard,
  NavigationGuardNext,
  RouteComponent,
  RouteLocation,
  RouteLocationNormalized,
  RouteLocationNormalizedLoaded,
  RouteLocationRaw,
  RouteRecordName,
  RouteRecordNormalized,
  RouteRecordRaw,
  Router,
  RouterOptions,
  _ScrollPosition,
} from './types'
import { routerKey, routerViewLocationKey, routeLocationKey, matchedRouteKey } from './types'
import type { RouterLinkProps } from './types'
import { RouterLink, useLink } from './components/RouterLink'
import { RouterView } from './components/RouterView'

// ------------------------------------------------------------------
// START_LOCATION —— 初始占位位置(尚未导航时的 currentRoute)
// ------------------------------------------------------------------

export const START_LOCATION_NORMALIZED: RouteLocationNormalizedLoaded = {
  path: '/',
  name: undefined,
  params: {},
  query: {},
  hash: '',
  fullPath: '/',
  matched: [],
  meta: {},
  redirectedFrom: undefined,
}

/** 初始导航的字符串形式(history.location 初始值也是 '/') */
export const START_LOCATION = '/'

export { NavigationFailureType }

// ------------------------------------------------------------------
// 守卫回调容器(add/list/reset —— 官方 useCallbacks)
// ------------------------------------------------------------------

function useCallbacks<T>() {
  let handlers: T[] = []
  function add(handler: T) {
    handlers.push(handler)
    return () => {
      const index = handlers.indexOf(handler)
      if (index > -1) handlers.splice(index, 1)
    }
  }
  function reset() {
    handlers = []
  }
  return { add, list: () => handlers.slice(), reset }
}

// ------------------------------------------------------------------
// 比较 / 工具
// ------------------------------------------------------------------

/**
 * 位置相同性(避免 duplicated 导航)—— 与官方算法一致:
 * matched 链必须非空且等长、最后一条记录相同、参数/query/hash 全等。
 * 关键:matched 为空(START_LOCATION)时永远返回 false → 首次导航不会被误判 duplicated
 */
function isSameRouteLocation(
  a: RouteLocationNormalized,
  b: RouteLocationNormalized,
): boolean {
  const aLastIndex = a.matched.length - 1
  const bLastIndex = b.matched.length - 1
  return (
    aLastIndex > -1 &&
    aLastIndex === bLastIndex &&
    isSameRouteRecord(a.matched[aLastIndex]!, b.matched[bLastIndex]!) &&
    looseEqual(a.params, b.params) &&
    stringifyQuery(a.query) === stringifyQuery(b.query) &&
    a.hash === b.hash
  )
}

/** 把 "用户写的目标" 变成对象形态(加上 force/replace/state 等扩展字段的空间) */
function locationAsObject(to: RouteLocationRaw | RouteLocation): Exclude<RouteLocationRaw, string> {
  return typeof to === 'string' ? { path: to } : { ...to }
}

// ------------------------------------------------------------------
// 守卫包装:把守卫(返回值风格或 next 风格)变成 Promise
// ------------------------------------------------------------------

/**
 * 把单个守卫包成 Promise:
 *  - 返回值风格(函数签名 < 3 个参数):return false → 中止;return 路线 → 重定向
 *  - next 风格(3 个参数):next(false)/next(Error)/next(路线)/next(vm)
 *  - next 只能调用一次(再调 warn 并忽略)
 */
function guardToPromiseFn(
  guard: NavigationGuard,
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
  record?: RouteRecordNormalized,
  name?: string,
): () => Promise<void> {
  const enterCallbackArray =
    record && (record.enterCallbacks![name!] = record.enterCallbacks![name!] || [])

  return () =>
    new Promise<void>((resolve, reject) => {
      const next: NavigationGuardNext = valid => {
        if (valid === false) {
          reject(createRouterError(ErrorTypes.NAVIGATION_ABORTED, { from, to }))
        } else if (valid instanceof Error) {
          reject(valid)
        } else if (isRouteLocation(valid)) {
          reject(createRouterError(ErrorTypes.NAVIGATION_GUARD_REDIRECT, { from: to, to: valid }))
        } else {
          // next(vm):仅 beforeRouteEnter 有效;入队,由 RouterView 挂载后调用
          if (enterCallbackArray && typeof valid === 'function') {
            enterCallbackArray.push(valid)
          }
          resolve()
        }
      }

      // next 二次调用守卫(warn 且忽略)
      let called = false
      const nextOnce: NavigationGuardNext = valid => {
        if (called) {
          warn(`导航守卫的 next 被多次调用。请确保调用一次后 return。\n${guard.toString()}`)
          return
        }
        called = true
        next(valid)
      }

      let guardReturn: any
      try {
        guardReturn = guard.call(
          record && record.instances && record.instances[name!],
          to,
          from,
          // 守卫声明了 next 参数(函数签名长度 >= 3)才传
          guard.length >= 3 ? nextOnce : undefined,
        )
      } catch (err) {
        reject(err)
        return
      }

      // 守卫的"风格"由参数个数决定(官方同款技巧):
      //  长度 < 3 → 返回值风格(把返回值交给 next)
      //  长度 >= 3 → next 风格(必须调用 next;从未调用 → 视为非法守卫)
      let guardCall = Promise.resolve(guardReturn)
      if (guard.length < 3) {
        guardCall = guardCall.then(valid => {
          if (!called) next(valid)
        })
      } else if (!(guardReturn && typeof (guardReturn as any).then === 'function')) {
        // 返回值不是 Promise 的情况下,同步检查 next 是否被调用过
        guardCall = guardCall.then(() => {
          if (!called) {
            warn(
              `导航守卫(声明了 next 参数)的 next 从未被调用,导航被中止:\n${guard.toString()}\n若使用返回值风格,请去掉 next 参数。`,
            )
            throw new Error('Invalid navigation guard: next was never called')
          }
        })
      }
      guardCall.catch(err => reject(err))
    })
}

/** 依次执行守卫队列(串行) */
function runGuardQueue(guards: Array<() => Promise<void>>): Promise<void> {
  return guards.reduce((promise, guard) => promise.then(() => guard()), Promise.resolve())
}

/** 导航是否已被更新的导航取代(取代 → cancelled) */
function checkCanceledNavigation(
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
  pendingLocation: RouteLocationNormalized,
): NavigationFailure | undefined {
  if (pendingLocation !== to) {
    return createRouterError(ErrorTypes.NAVIGATION_CANCELLED, { from, to })
  }
  return undefined
}

// ------------------------------------------------------------------
// 记录变化分析:导航前后 matched 链的三类记录
// ------------------------------------------------------------------

function extractChangingRecords(
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
): [RouteRecordNormalized[], RouteRecordNormalized[], RouteRecordNormalized[]] {
  const leavingRecords: RouteRecordNormalized[] = []
  const updatingRecords: RouteRecordNormalized[] = []
  const enteringRecords: RouteRecordNormalized[] = []
  const len = Math.max(from.matched.length, to.matched.length)
  for (let i = 0; i < len; i++) {
    const recordFrom = from.matched[i]
    if (recordFrom) {
      if (to.matched.find(record => isSameRouteRecord(record, recordFrom))) {
        // 两边都有同一记录:参数可能变化,记入 update
        updatingRecords.push(recordFrom)
      } else {
        leavingRecords.push(recordFrom)
      }
    }
    const recordTo = to.matched[i]
    if (recordTo) {
      if (!from.matched.find(record => isSameRouteRecord(record, recordTo))) {
        enteringRecords.push(recordTo)
      }
    }
  }
  return [leavingRecords, updatingRecords, enteringRecords]
}

// ------------------------------------------------------------------
// 组件守卫提取 + 懒加载
// ------------------------------------------------------------------

/**
 * 收集某类组件内守卫(beforeRouteLeave / Update / Enter)。
 * guardType !== beforeRouteEnter 时,未挂载的组件(instances 没有)直接跳过
 */
function extractComponentsGuards(
  matched: RouteRecordNormalized[],
  guardType: 'beforeRouteLeave' | 'beforeRouteUpdate' | 'beforeRouteEnter',
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
): Promise<Array<() => Promise<void>>> {
  const guards: Array<() => Promise<void>> = []

  const load = (record: RouteRecordNormalized, component: RouteComponent) => {
    // 懒加载组件:() => import(...);加载成功后替换 record 上的组件
    if (
      typeof component === 'function' &&
      !('displayName' in (component as any)) &&
      !(component as any).render &&
      !(component as any).setup
    ) {
      return Promise.resolve((component as () => Promise<any>)()).then(resolved => {
        const resolvedComponent = resolved && resolved.default ? resolved.default : resolved
        if (record.components) {
          for (const key in record.components) {
            if (record.components[key] === component) {
              record.components[key] = resolvedComponent
              ;(record as any).instances = (record as any).instances || {}
            }
          }
        }
      })
    }
    return Promise.resolve()
  }

  return (async () => {
    for (const record of matched) {
      if (!record.components) continue
      for (const name in record.components) {
        let rawComponent = record.components[name]!
        if (guardType !== 'beforeRouteEnter' && !record.instances![name]) continue
        if (guardType === 'beforeRouteEnter') {
          await load(record, rawComponent) // 懒加载完成后再读守卫
          rawComponent = record.components[name]!
        }
        const guard = (rawComponent as any)?.[guardType]
        if (guard) {
          guards.push(guardToPromiseFn(guard, to, from, record, name))
        }
      }
    }
    return guards
  })()
}

function isRouteLocation(route: unknown): route is RouteLocationRaw {
  return isString(route) || isObject(route)
}

// ------------------------------------------------------------------
// createRouter
// ------------------------------------------------------------------

export function createRouter(options: RouterOptions): Router {
  const matcher = createRouterMatcher(options.routes)
  const routerHistory: History = options.history
  const beforeGuards = useCallbacks<NavigationGuard>()
  const beforeResolveGuards = useCallbacks<NavigationGuard>()
  const afterGuards = useCallbacks<
    (to: RouteLocationNormalized, from: RouteLocationNormalized, failure?: NavigationFailure) => any
  >()
  const errorListeners = useCallbacks<(error: any, to: RouteLocationNormalized, from: RouteLocationNormalized) => void>()

  const currentRoute = shallowRef<RouteLocationNormalizedLoaded>(START_LOCATION_NORMALIZED)

  /** 导航在途标记:每次 push 立即更新;旧导航在关键节点对比发现被取代 → cancelled */
  let pendingLocation: RouteLocationNormalized = START_LOCATION_NORMALIZED

  // ---- 路由表 CRUD ----

  function addRoute(parentOrRoute: RouteRecordName | RouteRecordRaw, route?: RouteRecordRaw): () => void {
    if (route != null) {
      return matcher.addRoute(parentOrRoute as RouteRecordName, route)
    }
    return matcher.addRoute(parentOrRoute as RouteRecordRaw)
  }

  function removeRoute(name: RouteRecordName): void {
    matcher.removeRoute(name)
  }

  function hasRoute(name: RouteRecordName): boolean {
    return matcher.hasRoute(name)
  }

  function getRoutes(): RouteRecordNormalized[] {
    return matcher.getRoutes()
  }

  // ---- 解析 ----

  function resolve(
    rawLocation: RouteLocationRaw,
    currentLocation?: RouteLocationNormalized,
  ): RouteLocation & { href: string } {
    // 命名路由不存在:与官方一致直接抛 MATCHER_NOT_FOUND
    if (
      typeof rawLocation === 'object' &&
      rawLocation != null &&
      'name' in rawLocation &&
      rawLocation.name != null
    ) {
      const { location, matched } = matcher.resolve(rawLocation, currentLocation)
      if (matched.length === 0) {
        throw createRouterError(ErrorTypes.MATCHER_NOT_FOUND, { location: rawLocation })
      }
      const href = routerHistory.createHref(location.fullPath)
      return { ...location, href }
    }
    const { location, matched } = matcher.resolve(rawLocation, currentLocation)
    const href = routerHistory.createHref(location.fullPath)
    if (href.startsWith('//')) {
      warn(`Location "${String(rawLocation)}" resolved to "${href}". A resolved location cannot start with multiple slashes.`)
    }
    if (matched.length === 0) {
      warn(`No match found for location with path "${String(rawLocation)}"`)
    }
    return { ...location, href }
  }

  // ---- 重定向记录消费 ----

  /** 最后一次匹配的记录带 redirect → 生成重定向目标;否则 undefined */
  function handleRedirectRecord(
    to: RouteLocationNormalized,
    _from: RouteLocationNormalized,
  ): RouteLocationRaw | undefined {
    const lastMatched = to.matched[to.matched.length - 1]
    if (lastMatched && lastMatched.redirect) {
      const { redirect } = lastMatched
      let newTargetLocation: RouteLocationRaw =
        typeof redirect === 'function' ? redirect(to) : redirect

      if (typeof newTargetLocation === 'string') {
        newTargetLocation = newTargetLocation.includes('?') || newTargetLocation.includes('#')
          ? locationAsObject(newTargetLocation)
          : { path: newTargetLocation }
        ;(newTargetLocation as any).params = {}
      }

      if (!isRouteLocation(newTargetLocation)) {
        warn(`非法的 redirect 目标:\n${JSON.stringify(newTargetLocation, null, 2)}\n 当导航到 "${to.fullPath}" 时。redirect 必须包含 name 或 path。`)
        throw new Error('Invalid redirect')
      }

      return extend(
        { query: to.query, hash: to.hash, params: (newTargetLocation as any).path != null ? {} : to.params },
        newTargetLocation as object,
      ) as RouteLocationRaw
    }
    return undefined
  }

  // ---- 滚动 ----

  function handleScroll(
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
    isPush: boolean,
    isFirstNavigation: boolean,
  ): Promise<void> {
    const { scrollBehavior } = options
    if (typeof document === 'undefined' || !scrollBehavior) return Promise.resolve()

    const scrollPosition: _ScrollPosition | null =
      // back/forward:查看"上次进入该页"时保存的位置
      (!isPush && getSavedScrollPosition(getScrollKey(to.fullPath, 0))) ||
      // 首次导航 / 非 push 导航:优先用 history 条目的滚动快照
      ((isFirstNavigation || !isPush) &&
        window.history.state &&
        (window.history.state as any).scroll) ||
      null

    // 延迟到 DOM 更新后执行(官方 nextTick 同款)
    return nextTick()
      .then(() => scrollBehavior(to, from, scrollPosition))
      .then(position => {
        if (position) scrollToPosition(position)
      })
      .catch(err => triggerError(err, to, from))
  }

  // ---- 导航 ----

  /** push 的目标允许附带 force/replace/state 扩展字段(官方同款) */
  type PushTo = RouteLocationRaw | (RouteLocationRaw & { force?: boolean; replace?: boolean; state?: unknown })

  function push(to: PushTo): Promise<NavigationFailure | void | undefined> {
    return pushWithRedirect(to)
  }

  function replace(to: RouteLocationRaw & { force?: boolean; state?: unknown }): Promise<NavigationFailure | void | undefined> {
    return push(extend(locationAsObject(to), { replace: true }) as any)
  }

  /**
   * 导航入口。
   * 1. resolve 目标,pendingLocation 立即登记(后续导航可直接取代本导航)
   * 2. 最后一次匹配记录的 redirect → 递归重定向(链上限 10)
   * 3. 与当前完全相同的目标(且未强制)→ duplicated 失败,直接返回
   * 4. navigate 跑守卫管线 → 守卫内重定向 → 递归
   * 5. finalizeNavigation 提交 URL 与 currentRoute
   */
  function pushWithRedirect(
    to: PushTo,
    redirectedFrom?: RouteLocationNormalized,
    redirectCount = 0,
  ): Promise<NavigationFailure | void | undefined> {
    const targetLocation: RouteLocationNormalized = (pendingLocation = resolve(to))
    const from = currentRoute.value
    const data = (to as any).state
    const force = (to as any).force === true
    const replaceOption = (to as any).replace === true

    // 记录级 redirect:消费它,带着 redirectedFrom 重新走解析
    const shouldRedirect = handleRedirectRecord(targetLocation, from)
    if (shouldRedirect) {
      return pushWithRedirect(
        extend(locationAsObject(shouldRedirect), {
          // 合并 redirect 目标上的 state(官方语义)
          state: { ...data, ...(isObject(shouldRedirect) ? (shouldRedirect as any).state : {}) },
          force,
          replace: replaceOption,
        }) as any,
        redirectedFrom || targetLocation,
        redirectCount,
      )
    }

    const toLocation = targetLocation
    // 挂上重定向来源链(用于可追踪的错误信息)
    ;(toLocation as any).redirectedFrom = redirectedFrom

    let failure: NavigationFailure | undefined
    // duplicated:没有 force 且与当前位置完全相同(路径一致) → 不再导航
    if (!force && isSameRouteLocation(from, targetLocation)) {
      failure = createRouterError(ErrorTypes.NAVIGATION_DUPLICATED, { to: toLocation, from })
    }

    return (failure
      ? Promise.resolve(failure)
      : navigate(toLocation, from)
    )
      .catch(error =>
        isNavigationFailure(error)
          ? // 守卫内重定向错误:原样留给下面处理;cancelled 等失败也进入 then 分支
            error
          : triggerError(error, toLocation, from),
      )
      .then(failureOrUndefined => {
        if (failureOrUndefined) {
          const navFailure = failureOrUndefined as NavigationFailure
          if (isNavigationFailure(navFailure, NavigationFailureType.cancelled)) {
            // 导航被取代:cancelled 返回给调用者,不更新 URL
          } else if (isNavigationFailure(navFailure, ErrorTypes.NAVIGATION_GUARD_REDIRECT as any)) {
            // 守卫内重定向:递归导航到新目标(上限 10 次防死循环)
            if (redirectCount >= 10) {
              warn(`检测到可能的无限重定向(守卫内 redirect 超过 10 次)。检查是否在守卫里每次都返回新位置。`)
              return Promise.reject(new Error('Infinite redirect in navigation guard'))
            }
            return pushWithRedirect(
              extend(
                extend(
                  { replace: replaceOption },
                  locationAsObject((navFailure as any).to),
                ),
                {
                  state: { ...data, ...(isObject((navFailure as any).to) ? (navFailure as any).to.state : {}) },
                  force,
                },
              ) as any,
              redirectedFrom || toLocation,
              redirectCount + 1,
            )
          }
          triggerAfterEach(toLocation, from, failureOrUndefined as NavigationFailure | undefined)
          return failureOrUndefined
        } else {
          // 导航成功:提交 URL 与 currentRoute
          failureOrUndefined = finalizeNavigation(toLocation, from, true, replaceOption)
          triggerAfterEach(toLocation, from, failureOrUndefined as NavigationFailure | undefined)
          return failureOrUndefined
        }
      })
  }

  /**
   * 守卫管线(导航核心流程,顺序与官方完全一致):
   *
   *  ① 失激活组件守卫 beforeRouteLeave(最深 → 最浅)
   *  ② 全局 beforeEach
   *  ③ 复用组件守卫 beforeRouteUpdate(参数变化复用)
   *  ④ 新进入记录的路由级 beforeEnter
   *  ⑤ 新进入组件的 beforeRouteEnter(在此之前完成懒加载)
   *  ⑥ 全局 beforeResolve
   *
   *  每一段之间插入"导航是否被取代"检查 → 被取代抛 cancelled
   */
  function navigate(to: RouteLocationNormalized, from: RouteLocationNormalized): Promise<void | NavigationFailure> {
    const [leavingRecords, updatingRecords, enteringRecords] = extractChangingRecords(to, from)
    const canceledNavigationCheck = () => {
      const error = checkCanceledNavigation(to, from, pendingLocation)
      return error ? Promise.reject(error) : Promise.resolve()
    }

    return (async () => {
      try {
        // ① 离开组件守卫(最深 → 最浅)
        let guards: Array<() => Promise<void>> = []
        guards = await extractComponentsGuards(leavingRecords.reverse(), 'beforeRouteLeave', to, from)
        for (const record of leavingRecords) {
          record.leaveGuards!.forEach(guard => guards.push(guardToPromiseFn(guard, to, from, record)))
        }
        guards.push(canceledNavigationCheck)
        await runGuardQueue(guards)

        // ② 全局 beforeEach
        guards = beforeGuards.list().map(guard => guardToPromiseFn(guard, to, from))
        guards.push(canceledNavigationCheck)
        await runGuardQueue(guards)

        // ③ 复用组件守卫
        guards = await extractComponentsGuards(updatingRecords, 'beforeRouteUpdate', to, from)
        for (const record of updatingRecords) {
          record.updateGuards!.forEach(guard => guards.push(guardToPromiseFn(guard, to, from, record)))
        }
        guards.push(canceledNavigationCheck)
        await runGuardQueue(guards)

        // ④ 新进入记录的路由级 beforeEnter
        guards = []
        for (const record of enteringRecords) {
          if (record.beforeEnter) {
            const beforeEnters = Array.isArray(record.beforeEnter) ? record.beforeEnter : [record.beforeEnter]
            for (const beforeEnter of beforeEnters) {
              guards.push(guardToPromiseFn(beforeEnter, to, from, record))
            }
          }
        }
        guards.push(canceledNavigationCheck)
        await runGuardQueue(guards)

        // ⑤ 重置下一轮的 enterCallbacks,加载懒加载组件,进入组件守卫
        to.matched.forEach(record => (record.enterCallbacks = {}))
        guards = await extractComponentsGuards(enteringRecords, 'beforeRouteEnter', to, from)
        guards.push(canceledNavigationCheck)
        await runGuardQueue(guards)

        // ⑥ 全局 beforeResolve
        guards = beforeResolveGuards.list().map(guard => guardToPromiseFn(guard, to, from))
        guards.push(canceledNavigationCheck)
        await runGuardQueue(guards)
      } catch (err) {
        // cancelled 作为"可预期失败"返回;其他错误原样抛出
        if (isNavigationFailure(err, NavigationFailureType.cancelled)) return err
        throw err
      }
    })()
  }

  function triggerAfterEach(
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
    failure?: NavigationFailure,
  ): void {
    afterGuards.list().forEach(guard => guard(to, from, failure))
  }

  /** 导航确认:写 URL → 更新 currentRoute → 滚动 → ready */
  function finalizeNavigation(
    toLocation: RouteLocationNormalized,
    from: RouteLocationNormalized,
    isPush: boolean,
    replaceOption?: boolean,
  ): NavigationFailure | void {
    const error = checkCanceledNavigation(toLocation, from, pendingLocation)
    if (error) return error

    const isFirstNavigation = from === START_LOCATION_NORMALIZED
    if (isPush) {
      if (replaceOption || isFirstNavigation) {
        routerHistory.replace(toLocation.fullPath)
      } else {
        // 保存离开页面的滚动位置(会话级,back 回来时恢复)
        const historyState = isBrowser() && window.history.state
        if (historyState) {
          saveScrollPosition(getScrollKey(from.fullPath, 0), historyState.scroll || getScrollPosition())
        }
        routerHistory.push(toLocation.fullPath)
      }
    }

    // currentRoute 整体替换(shallowRef:不深层响应,RouterView 依赖 matched 引用稳定性)
    currentRoute.value = toLocation

    handleScroll(toLocation, from, isPush, isFirstNavigation)

    markAsReady()
  }

  function isBrowser(): boolean {
    return typeof window !== 'undefined'
  }

  // ---- 首次导航 / 浏览器导航监听 ----

  let removeHistoryListener: (() => void) | undefined
  function setupListeners() {
    if (removeHistoryListener) return
    removeHistoryListener = routerHistory.listen((to: string) => {
      if (!router.listening) return
      const toLocation = resolve(to)
      const shouldRedirect = handleRedirectRecord(toLocation, router.currentRoute.value)
      if (shouldRedirect) {
        pushWithRedirect(extend(shouldRedirect as any, { replace: true, force: true }), toLocation).catch(() => {})
        return
      }
      pendingLocation = toLocation
      const from = currentRoute.value
      // 保存离开页面的滚动位置(back/forward 时用)
      if (isBrowser()) {
        saveScrollPosition(getScrollKey(from.fullPath, 0), getScrollPosition())
      }
      navigate(toLocation, from)
        .then(failure => {
          failure = (failure as NavigationFailure) || finalizeNavigation(toLocation, from, false)
          triggerAfterEach(toLocation, from, failure as NavigationFailure | undefined)
        })
        .catch(err => {
          if (isNavigationFailure(err, ErrorTypes.NAVIGATION_GUARD_REDIRECT as any)) {
            pushWithRedirect(extend(locationAsObject((err as any).to), { force: true }) as any, toLocation).catch(() => {})
            return
          }
          triggerError(err, toLocation, from)
        })
    })
  }

  // ---- ready / error ----

  let readyHandlers = useCallbacks<[() => void, (err: any) => void]>()
  let ready: boolean | undefined

  function markAsReady(err?: any): any {
    if (!ready) {
      ready = !err
      setupListeners()
      readyHandlers.list().forEach(([resolve, reject]) => (err ? reject(err) : resolve()))
      readyHandlers.reset()
    }
    return err
  }

  function isReady(): Promise<void> {
    if (ready && currentRoute.value !== START_LOCATION_NORMALIZED) return Promise.resolve()
    return new Promise((resolve, reject) => {
      readyHandlers.add([resolve, reject])
    })
  }

  function triggerError(error: any, to: RouteLocationNormalized, from: RouteLocationNormalized): Promise<never> {
    markAsReady(error)
    const list = errorListeners.list()
    if (list.length) {
      list.forEach(handler => handler(error, to, from))
    } else {
      warn(`导航期间发生未捕获错误:`)
      console.error(error)
    }
    return Promise.reject(error)
  }

  function go(delta: number): void {
    routerHistory.go(delta)
  }

  // ---- install ----

  const installedApps: Set<App> = new Set()
  let started = false

  const router: Router = {
    currentRoute,
    listening: true, // 置 false 可暂时挂起浏览器导航(官方同款)
    options,
    addRoute,
    removeRoute,
    hasRoute,
    getRoutes,
    resolve,
    push,
    replace,
    go,
    back: () => go(-1),
    forward: () => go(1),
    beforeEach: beforeGuards.add,
    beforeResolve: beforeResolveGuards.add,
    afterEach: afterGuards.add,
    onError: errorListeners.add,
    isReady,
    install(app: App) {
      app.component('RouterLink', RouterLink)
      app.component('RouterView', RouterView)
      // 注意:必须转 any —— vue-router 官方声明文件会把 $router 增强成官方 Router 类型
      ;(app.config.globalProperties as any).$router = router
      ;(app.config.globalProperties as any).$route = computedRoute(app)

      // 首次挂载:导航到当前 URL
      if (isBrowser() && !started && currentRoute.value === START_LOCATION_NORMALIZED) {
        started = true
        push(routerHistory.location).catch(err => {
          warn(`启动路由时发生错误: ${String(err)}`)
        })
      }

      app.provide(routerKey, router)
      app.provide(routerViewLocationKey, currentRoute)
      app.provide(routeLocationKey, routeProxy(app))
      app.provide(matchedRouteKey, undefined as any)

      const unmountApp = app.unmount
      installedApps.add(app)
      app.unmount = function () {
        installedApps.delete(app)
        if (installedApps.size < 1) {
          pendingLocation = START_LOCATION_NORMALIZED
          removeHistoryListener && removeHistoryListener()
          removeHistoryListener = undefined
          currentRoute.value = START_LOCATION_NORMALIZED
          started = false
          ready = undefined
          readyHandlers.reset()
        }
        unmountApp()
      }
    },
  }

  /** $route:当前 route 的浅响应式代理(从 currentRoute.value 取字段) */
  function computedRoute(_app: App): RouteLocationNormalizedLoaded {
    const proxy = {} as RouteLocationNormalizedLoaded
    for (const key in START_LOCATION_NORMALIZED) {
      Object.defineProperty(proxy, key, {
        get: () => currentRoute.value[key as keyof RouteLocationNormalizedLoaded],
        enumerable: true,
      })
    }
    return proxy
  }

  /** routeLocationKey 注入的值(useRoute 读取) */
  function routeProxy(app: App): RouteLocationNormalizedLoaded {
    return computedRoute(app)
  }

  return router
}

// ------------------------------------------------------------------
// 组合式 API
// ------------------------------------------------------------------

/**
 * 在组件 setup 中注册"离开当前路由"的守卫。
 * 原理:把守卫挂到"当前深度的 record"上;组件卸载时自动注销
 */
export function onBeforeRouteLeave(leaveGuard: NavigationGuard): void {
  const activeRecord = inject(matchedRouteKey, undefined as any)
  const record: RouteRecordNormalized | undefined = activeRecord && activeRecord.value
  if (!record) {
    warn('onBeforeRouteLeave 只能在 RouterView 渲染的组件中调用')
    return
  }
  record.leaveGuards!.add(leaveGuard)
  onUnmounted(() => record.leaveGuards!.delete(leaveGuard))
}

/** 在组件 setup 中注册"路由复用但参数变化"的守卫 */
export function onBeforeRouteUpdate(updateGuard: NavigationGuard): void {
  const activeRecord = inject(matchedRouteKey, undefined as any)
  const record: RouteRecordNormalized | undefined = activeRecord && activeRecord.value
  if (!record) {
    warn('onBeforeRouteUpdate 只能在 RouterView 渲染的组件中调用')
    return
  }
  record.updateGuards!.add(updateGuard)
  onUnmounted(() => record.updateGuards!.delete(updateGuard))
}

/** 在组件 setup 中注册"进入路由"的守卫(不能用 next(vm)) */
export function onBeforeRouteEnter(_enterGuard: NavigationGuard): void {
  // beforeRouteEnter 执行时机早于 setup,beforeRouteUpdate/Leave 覆盖了大多数场景;留作文档说明
  warn('mini 版暂不支持 onBeforeRouteEnter(组合式 API)。请在组件选项中使用 beforeRouteEnter。')
}

/** 获取当前 Router 实例(必须在 setup 中或组件渲染子树中调用) */
export function useRouter(): Router {
  return inject(routerKey)!
}

/** 获取当前响应式 route 对象(必须在组件 setup 中调用) */
export function useRoute(): RouteLocationNormalizedLoaded {
  return inject(routeLocationKey)!
}

// ------------------------------------------------------------------
// hooks 导出(Router 接口用)
// ------------------------------------------------------------------

export { RouterLink, RouterView, useLink }
export type { RouterLinkProps }