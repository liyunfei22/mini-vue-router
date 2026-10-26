/**
 * RouterView —— 视图渲染器(渲染函数实现,不依赖 SFC)
 *
 * 三个教学点:
 *  1. depth 注入链:嵌套 RouterView 通过 provide(viewDepthKey, depth+1) 逐层取 matched[depth]
 *  2. 分组记录(无组件的记录)在深度计算时被跳过(while 循环)
 *  3. 实例注册:watch(flush: 'post') 把组件实例写进 record.instances
 *     (beforeRouteUpdate/Leave 守卫的判断依据),并触发 beforeRouteEnter 的 next(vm)
 *
 * 对应官方:packages/router/src/RouterView.ts
 */
import { defineComponent, inject, computed, provide, h, ref, watch, unref } from 'vue'
import { routerViewLocationKey, viewDepthKey, matchedRouteKey } from '../types'
import type { RouteLocationNormalizedLoaded, RouteRecordNormalized } from '../types'

export const RouterView = defineComponent({
  name: 'RouterView',
  inheritAttrs: false,
  props: {
    name: { type: String, default: 'default' },
  },
  setup(props, { attrs, slots }) {
    const injectedRoute = inject(routerViewLocationKey)!
    const routeToDisplay = computed(() => (injectedRoute as any).value as RouteLocationNormalizedLoaded)
    const injectedDepth = inject(viewDepthKey, ref(0) as any)

    /**
     * 当前深度:从注入的 depth 开始,跳过 components 为 null 的"分组记录"。
     * 比如外层的 <RouterView> 渲染 matched[0](真实组件),它的 <RouterView>
     * 注入 depth=1,若 matched[1] 是分组记录则自动跳过 → 渲染 matched[2]
     */
    const depth = computed(() => {
      let initialDepth = unref(injectedDepth)
      const { matched } = routeToDisplay.value
      let matchedRoute: RouteRecordNormalized | undefined
      while ((matchedRoute = matched[initialDepth]) && !matchedRoute.components) {
        initialDepth++
      }
      return initialDepth
    })

    const matchedRouteRef = computed(() => routeToDisplay.value.matched[depth.value])
    provide(viewDepthKey, computed(() => depth.value + 1))
    // 当前深度的记录提供给子组件(组合式守卫 onBeforeRouteXxx 用)
    provide(matchedRouteKey, matchedRouteRef)

    const viewRef = ref<any>(null)

    /**
     * 实例注册(务必 flush: 'post' —— DOM 挂载完成后执行):
     *  1. record.instances[name] = 组件实例(beforeRouteUpdate/Leave 守卫靠它判断是否已挂载)
     *  2. 首次渲染时触发 beforeRouteEnter 留下的 next(vm) 回调
     *  3. 记录变化但实例复用(参数变化):把守卫集合转移给新记录
     */
    watch(
      // Vue 的 watch 重载对 readonly 元组类型不友好,这里断言成 any
      (() => [viewRef.value, matchedRouteRef.value, props.name]) as any,
      ([instance, to, name], [oldInstance, from]: any[]) => {
        if (to) {
          // 注册实例
          to.instances![name] = instance
          // 实例被复用到新的记录(参数变化):继承守卫集合
          if (from && from !== to && instance && instance === oldInstance) {
            to.leaveGuards = from.leaveGuards
            to.updateGuards = from.updateGuards
          }
        }
        // 触发 next(vm):仅当实例是首次(记录变化或实例新建)
        if (
          instance &&
          to &&
          (!from || !from.instances || from.instances[name] !== instance)
        ) {
          ;(to.enterCallbacks![name] || []).forEach((cb: (vm: any) => any) => cb(instance))
          to.enterCallbacks![name] = []
        }
      },
      { flush: 'post' },
    )

    return () => {
      const route = routeToDisplay.value
      const matchedRoute = matchedRouteRef.value
      const ViewComponent =
        matchedRoute && matchedRoute.components ? matchedRoute.components[props.name] : null

      const component = ViewComponent
        ? h(ViewComponent, {
            ...attrs,
            // 卸载时清空实例登记(避免上次导航留下的实例被误判)
            onVnodeUnmounted: (vnode: any) => {
              if (matchedRoute && vnode.component && vnode.component.isUnmounted) {
                matchedRoute.instances![props.name] = null
              }
            },
            ref: viewRef,
          })
        : null

      // 支持 v-slot="{ Component, route }" 自定义包裹(配合 Transition/KeepAlive)
      return slots.default
        ? slots.default({ Component: component, route })
        : component
    }
  },
})