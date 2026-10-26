/**
 * RouterLink —— 声明式导航(渲染函数实现)
 *
 * 教学点:isActive / isExactActive 的计算算法(useLink 是独立导出的可测函数)
 * 对应官方:packages/router/src/RouterLink.ts
 */
import { defineComponent, inject, computed, reactive, h } from 'vue'
import type { PropType, Ref } from 'vue'
import { routerKey, routerViewLocationKey } from '../types'
import type {
  RouteLocation,
  RouteLocationRaw,
} from '../types'
import type { NavigationFailure } from '../errors'
import { looseEqual, isSameRouteRecord } from '../utils'

export interface UseLinkOptions {
  to: RouteLocationRaw
  replace?: boolean
}

/**
 * 计算一条 RouterLink 的所有派生状态(与组件解耦,便于单测)
 */
export function useLink(props: UseLinkOptions): {
  route: Ref<RouteLocation & { href: string }>
  href: Ref<string>
  isActive: Ref<boolean>
  isExactActive: Ref<boolean>
  navigate: (e?: MouseEvent) => Promise<void | NavigationFailure>
} {
  const router = inject(routerKey)!
  const currentRoute = inject(routerViewLocationKey)!

  // 解析目标(router.resolve 返回带 href 的完整位置)
  const route = computed(() => router.resolve(props.to)) as Ref<RouteLocation & { href: string }>

  /**
   * 目标最后一条记录在 currentRoute.matched 中的位置。
   *  - 找到:该记录"在链上" → 可能是 active
   *  - 找不到:如果目标是当前链的最后一条的别名(父路由,如 /user 的子页里
   *    链接到 /user 本身)也算 active —— 简化:仅做记录查找
   */
  const activeRecordIndex = computed(() => {
    const { matched } = route.value
    const { length } = matched
    const routeMatched = matched[length - 1]
    const currentMatched = currentRoute.value.matched
    if (!routeMatched || !currentMatched.length) return -1
    // 记录同一性(alias 记录透视到主记录)
    const index = currentMatched.findIndex(record =>
      isSameRouteRecord(record as any, routeMatched as any),
    )
    return index
  })

  /** active 还需要:该记录路径上的参数与当前完全一致 */
  const paramsAreEqual = (activeRouteIndex: number): boolean => {
    const activeRoute = route.value.matched[activeRouteIndex]
    if (!activeRoute) return false
    const keys = (activeRoute as any).keys || []
    if (!keys.length) return true // 静态路径:只要记录在链上即 active
    return keys.every(
      (k: { name: string }) =>
        looseEqual(currentRoute.value.params[k.name], route.value.params[k.name]),
    )
  }

  /** active:目标记录在链上 + 该记录参数一致(/users/:id 对 /users/5 的链接在 /users/5 高亮) */
  const isActive = computed(
    () => activeRecordIndex.value > -1 && paramsAreEqual(activeRecordIndex.value),
  )

  /** exactActive:记录是最后一条 + 全部参数一致(/users/5 的链接只在 /users/5 高亮) */
  const isExactActive = computed(
    () =>
      activeRecordIndex.value > -1 &&
      activeRecordIndex.value === currentRoute.value.matched.length - 1 &&
      looseEqual(currentRoute.value.params, route.value.params),
  )

  const href = computed(() => route.value.href)

  function navigate(e: MouseEvent = {} as MouseEvent): Promise<void | NavigationFailure> {
    if (guardEvent(e)) {
      return router[(props.replace ? 'replace' : 'push') as 'push'](props.to)
    }
    return Promise.resolve()
  }

  return { route, href, isActive, isExactActive, navigate }
}

/**
 * 点击事件的放行/拦截规则(官方同款):
 *  - 非鼠标左键 / 带修饰键 / 已 preventDefault / target=_blank → 不接管
 *  - 否则 preventDefault 后交给路由导航
 */
function guardEvent(e: MouseEvent): boolean {
  if (e.button > 0) return false // 非左键
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return false // 新标签页等浏览器行为
  if (e.defaultPrevented) return false
  if (e.currentTarget && (e.currentTarget as HTMLElement).getAttribute) {
    const target = (e.currentTarget as HTMLElement).getAttribute('target')
    if (/\b_blank\b/i.test(target || '')) return false
  }
  if (e.preventDefault) e.preventDefault()
  return true
}

const defaultActiveClass = 'router-link-active'
const defaultExactActiveClass = 'router-link-exact-active'

export const RouterLink = defineComponent({
  name: 'RouterLink',
  inheritAttrs: false,
  props: {
    to: { type: [String, Object] as PropType<RouteLocationRaw>, required: true },
    replace: Boolean,
    activeClass: String,
    exactActiveClass: String,
    /** custom 模式下不渲染 <a>,通过插槽暴露导航能力 */
    custom: Boolean,
    ariaCurrentValue: { type: String, default: 'page' },
  },
  setup(props, { slots, attrs }) {
    // reactive() 会把 useLink 返回的 computed ref 解包,直接得到值
    const link = reactive(useLink(props))

    return () => {
      // reactive() 已解包:isActive/href/route 都是「值」而非 ref
      const { isActive, isExactActive, href, navigate, route } = link
      const ariaCurrent = isExactActive ? props.ariaCurrentValue : null
      const classList = {
        [props.activeClass || defaultActiveClass]: isActive,
        [props.exactActiveClass || defaultExactActiveClass]: isExactActive,
      }

      const slotProps = { ...link, route, href }
      const slotContent = slots.default ? slots.default(slotProps) : []

      if (props.custom) {
        return slotContent
      }

      return h(
        'a',
        {
          ...attrs,
          href,
          'aria-current': ariaCurrent,
          onClick: (e: MouseEvent) => navigate(e),
          class: classList,
        },
        slotContent,
      )
    }
  },
})