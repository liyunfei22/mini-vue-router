# 05 · RouterView 与 RouterLink 原理

> 对应官方:`packages/router/src/RouterView.ts` + `RouterLink.ts`
> 本仓库实现:`src/components/RouterView.ts` + `src/components/RouterLink.ts`

两个组件加起来是 vue-router 与 Vue 响应式系统衔接的部分。核心词:**inject/provide 注入链**。

## 1. 注入键位总览

| key | 提供者 | 内容 |
|---|---|---|
| `routerKey` | install | Router 实例(useRouter 用) |
| `routerViewLocationKey` | install / RouterView | `currentRoute`(shallowRef) |
| `viewDepthKey` | RouterView | 当前深度 + 1(嵌套链) |
| `matchedRouteKey` | RouterView | 当前深度匹配到的记录(组合式守卫用) |
| `routeLocationKey` | install | route 的浅响应式代理(useRoute 用) |

## 2. RouterView:depth 注入链

### 2.1 渲染函数

RouterView 的核心渲染逻辑极短:

```ts
const injectedDepth = inject(viewDepthKey, ref(0))
const depth = computed(() => {
  let initialDepth = unref(injectedDepth)
  const { matched } = routeToDisplay.value
  let matchedRoute
  // 关键:跳过「分组记录」(components 为 null 的纯容器记录)
  while ((matchedRoute = matched[initialDepth]) && !matchedRoute.components) {
    initialDepth++
  }
  return initialDepth
})
const matchedRouteRef = computed(() => routeToDisplay.value.matched[depth.value])
provide(viewDepthKey, computed(() => depth.value + 1))
```

**嵌套的魔法在这里**:`matched` 是导航产生的记录链(父 → 子)。顶层 `<RouterView>` 的 depth=0 → 渲染 `matched[0]`(比如 Parent 组件);Parent 组件内部再放一个 `<RouterView>`,它 inject 到的 depth=1 → 渲染 `matched[1]`(Child 组件)。**子路由的内容出现在哪,完全由父组件模板里 RouterView 的位置决定**——这就是嵌套路由的布局意义。

### 2.2 分组记录(phantom)为什么被跳过

```ts
{ path: '/group', children: [{ path: 'g-child', component: G }] }
```

`/group` 没有组件 → matched = [group(无组件), g-child]。但如果 depth 从 0 数,顶层 RouterView 会渲染「空气」。所以 while 循环把无组件记录跳过,`/group/g-child` 直接渲染 g-child 的内容。**匹配时记录占位、渲染时记录让位**——`tests/matcher.spec.ts` 与 parity 测试都锁定了这条链的构成。

### 2.3 实例注册与守卫集合迁移

```ts
watch(() => [viewRef.value, matchedRouteRef.value, props.name],
  ([instance, to, name], [oldInstance, from]) => {
    if (to) {
      to.instances[name] = instance          // ① 实例注册:离场/更新守卫依赖它判断「已挂载」
      if (from && from !== to && instance && instance === oldInstance) {
        to.leaveGuards = from.leaveGuards    // ② 实例复用到新记录:迁移守卫集合
        to.updateGuards = from.updateGuards
      }
    }
    if (instance && to && (!from || !from.instances || from.instances[name] !== instance)) {
      (to.enterCallbacks[name] || []).forEach(cb => cb(instance))  // ③ 触发 next(vm)
      to.enterCallbacks[name] = []
    }
  },
  { flush: 'post' })   // 必须 post:DOM 挂载完成后才有实例
```

三个注释对应三件事:

- ① 守卫管线里 `extractComponentsGuards` 对 `beforeRouteUpdate/Leave` 有个前置条件:`!record.instances[name]` 就跳过——没挂载的组件没有资格跑组件守卫。实例注册是这条判断的数据源;
- ② 参数变化时实例复用(见 2.4),守卫必须「跟着实例走」;
- ③ next(vm) 的触发时机(04 章第 5 节)。

`onVnodeUnmounted` 里还有一步:组件卸载时把 `instances[name]` 清空,避免「上次导航的僵尸实例」被误判。

### 2.4 参数变化为什么不重新挂载

```
/users/1 → /users/2
```

matched 链上还是**同一条记录**(matcher 返回的记录对象引用稳定),RouterView 渲染的 `ViewComponent` 是同一个组件类型 → Vue 的 diff 判定「组件相同」→ **复用实例,仅更新 props**。物证:`tests/components.spec.ts`「参数变化:同一实例被复用」——setup 只执行一次。

这反过来解释了 03 章那句:「不要就地修改 route.params,要 push 新位置」——因为当前位置和导航目标是**同一对象引用**,改了它就破坏了「目标 ≠ 当前」的对比基础。

## 3. RouterLink:active 的计算算法

### 3.1 href

```ts
const route = computed(() => router.resolve(props.to))   // 解析目标
const href = computed(() => route.value.href)            // history.createHref(fullPath)
```

### 3.2 isActive / isExactActive(核心算法)

```ts
// ① 目标最后一条记录在 currentRoute.matched 中的位置
const activeRecordIndex = computed(() => {
  const routeMatched = route.value.matched[route.value.matched.length - 1]
  const currentMatched = currentRoute.value.matched
  const index = currentMatched.findIndex(r => isSameRouteRecord(r, routeMatched))  // alias 透视
  return index
})

// ② active:记录在链上 + 该记录路径上的参数一致
const isActive = computed(
  () => activeRecordIndex.value > -1 && paramsAreEqual(activeRecordIndex.value),
)
// paramsAreEqual:两条位置在该记录的 keys(路径参数名)上的值全部相等

// ③ exactActive:记录是链上最后一条 + 全部参数一致
const isExactActive = computed(
  () => activeRecordIndex.value > -1
    && activeRecordIndex.value === currentRoute.value.matched.length - 1
    && looseEqual(currentRoute.value.params, route.value.params),
)
```

直觉理解:

| 场景 | active | exactActive |
|---|---|---|
| 在 `/users` 上,链接到 `/users` | ✓ | ✓ |
| 在 `/users/5` 上,链接到 `/users` | ✗ | ✗ |
| 在 `/parent/child` 上,链接到 `/parent`(父路由) | ✓ | ✗ |
| 在 `/users/5` 上,链接到 `/users/5?q=1` | ✗ | ✗(query 不同) |

active 的「父路由链接也高亮」是**记录链查找**的自然结果:`/parent` 的记录在第 0 层,`paramsAreEqual` 通过 → active。这是官方行为,`tests/components.spec.ts` 有专门用例。

### 3.3 点击导航与 custom 模式

```ts
function guardEvent(e) {
  if (e.button > 0) return false                       // 非左键
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return false  // 新标签页等浏览器行为
  if (e.defaultPrevented) return false
  if (target === '_blank') return false
  e.preventDefault()                                    // 否则接管:阻止默认跳转
  return true
}

// navigate:守卫通过才走 router[replace ? 'replace' : 'push'](props.to)
```

`custom` 模式:不渲染 `<a>`,插槽收到 `{ href, route, navigate, isActive, isExactActive }`,由你决定怎么渲染(比如按钮、菜单组件)。

### 3.4 useLink 为什么单独导出

`useLink` 是 RouterLink 的**纯逻辑部分**,与组件解耦。官方导出它是为了让你在自己的组件里复用它(自定义导航组件);mini 的 parity 测试也用它——**逻辑可测,组件壳子只需验证渲染**。

## 4. 与官方源码的差异速览

| 项 | mini | 官方 |
|---|---|---|
| RouterView 的 `route` prop | 未实现 | 支持(测试用) |
| 命名视图 props 透传(`route.props`) | 未实现 | `true` / 函数 / 对象 |
| RouterLink 的全局 class 默认值 | 常量 `router-link-active` | 可经 createRouter 的 `linkActiveClass` 配置 |

[上一章:04-navigation-guards.md](04-navigation-guards.md) · [下一章:06-dynamic-and-advanced.md →](06-dynamic-and-advanced.md)