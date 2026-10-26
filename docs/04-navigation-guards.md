# 04 · 导航守卫详解

> 对应官方:`packages/router/src/router.ts`(guardToPromiseFn / extractComponentsGuards / onBeforeRouteLeave 等)
> 本仓库实现:`src/router.ts`

## 1. 三类守卫的注册方式

| 类型 | 写法 | 执行时机 | mini 位置 |
|---|---|---|---|
| 全局 | `router.beforeEach / beforeResolve / afterEach` | 每次导航 | `beforeGuards` 回调容器 |
| 路由级 | 记录上的 `beforeEnter` | 新进入该记录时 | navigate ④ |
| 组件级 | `beforeRouteEnter / Update / Leave` 选项 | 见顺序 | `extractComponentsGuards` |
| 组合式 | `onBeforeRouteLeave / Update`(setup 内) | 同上 | 守卫挂到 record 上 |

## 2. 顺序为什么是这样(推理,不是背)

一次「离开 A 页、进入 B 页」的导航,组件守卫的顺序是:

```
beforeRouteLeave(最深 → 最浅)→ beforeEach → beforeRouteUpdate(浅 → 深)→ beforeEnter → beforeRouteEnter(浅 → 深)→ beforeResolve → afterEach
     ↑ 失激活组件的守卫先跑                                             ↑ 复用组件(参数变化)      ↑ 新进入组件
```

推导逻辑(源码 [`extractChangingRecords`](../src/router.ts) + [`navigate`](../src/router.ts)):

1. **leave 为什么逆序(最深 → 最浅)?** 子组件先离开、父组件后离开,和 DOM 卸载顺序一致;
2. **update 为什么按浅 → 深?** 参数的合并方向是浅层被深层覆盖,浅层守卫先看到「旧参数 + 新参数」更合理(官方语义);
3. **enter 为什么在 leave/update/全局之后?** 进入者还不存在,当然最后处理——它要等所有「旧世界」的守卫放行;
4. **beforeResolve 为什么是最后一个守卫?** 它是「所有异步组件加载完成后的最后一次全局把关」——路由级、组件级守卫都过了,数据也该就绪了,此时再拦截成本最低;
5. **afterEach 为什么失败也执行?** 它是「观测者」不是「拦截者」,第三个参数 `failure` 告诉你这次导航发生了什么。

一个容易忽略的行为(已由 guards 测试锁定):**leave 守卫在 beforeEach 之前就已执行**——即使 beforeEach 后面 abort 了,leave 也已经跑过(官方语义:先跑完管线阶段才中止)。

## 3. next 的全部形态(速查表)

守卫有两种风格,靠**函数参数个数**区分([`guardToPromiseFn`](../src/router.ts),官方同款技巧 `guard.length < 3`):

| 形态 | 效果 | 实现 |
|---|---|---|
| 返回值 `undefined` | 放行 | 返回值交给 next |
| 返回值 `false` | 中止(aborted) | `next(false)` |
| 返回路由目标 | 守卫内重定向 | `next({path})`,抛 NAVIGATION_GUARD_REDIRECT |
| 返回 Error | 报错 | `next(error)` |
| `next()` | 放行(3 参风格) | 直接 resolve |
| `next(false)` | 中止 | 抛 aborted 错误 |
| `next({path})` | 重定向 | 同上 |
| `next(Error)` | 报错 | 原样 reject |
| `next(vm)` | **仅 beforeRouteEnter**:组件挂载后回调 | 存入 `record.enterCallbacks`,见第 5 节 |

两个规则(官方同款):

- **next 只能调一次**:再调 warn 并忽略(canOnlyBeCalledOnce);
- **声明了 next 参数却不调用**:warn + 抛「Invalid navigation guard」(mini 在返回值非 Promise 时同步检查)。

**写守卫的最佳实践**:用返回值风格(不写 next 参数),逻辑干净可测。

## 4. beforeRouteUpdate:参数变化时的复用守卫

```
 /users/1  →  /users/2
 matched: [user-detail] → [user-detail](同一条记录)
```

记录相同 → 组件实例**复用**(不重新挂载,05 章讲原理);此时跑的是 `beforeRouteUpdate` 而不是 leave+enter。在守卫里可以访问 `to.params` 做差异化处理:

```ts
beforeRouteUpdate(to, from) {
  // 同一个组件,参数从 1 变成了 2
}
```

## 5. next(vm):beforeRouteEnter 的特殊能力

`beforeRouteEnter` 的守卫在**组件实例化之前**执行,`this` 不可用。但你可以:

```ts
beforeRouteEnter(to, from, next) {
  next(vm => {
    // 组件挂载完成后回调,此时拿得到实例(拿不到 this 的替代方案)
    vm.xxx()
  })
}
```

机制([`guardToPromiseFn`](../src/router.ts) + [`RouterView`](../src/components/RouterView.ts)):

```
1. next(vm 函数)→ 不 resolve/reject,把函数推入 record.enterCallbacks[name] 队列,守卫放行
2. 导航确认,RouterView 渲染新组件
3. RouterView 的 watch(flush: 'post') 检测到实例挂载:
       record.instances[name] = 实例
       队列里的回调逐个执行 → cb(实例)
       清空队列
```

mini 里组合式 API 的 `onBeforeRouteEnter` 未实现(见 07 章简化清单;官方用 inject 深度 + enterCallbacks 注册,原理相同)。

## 6. 组合式 API 守卫的实现原理

`onBeforeRouteLeave(guard)` 的源码只有四行(官方同思路):

```ts
export function onBeforeRouteLeave(leaveGuard) {
  const activeRecord = inject(matchedRouteKey).value   // 1. 拿到当前深度的 record
  activeRecord.leaveGuards.add(leaveGuard)             // 2. 把守卫挂到 record 上
  onUnmounted(() => activeRecord.leaveGuards.delete(leaveGuard)) // 3. 卸载时注销
}
```

三个关键点:

1. **`matchedRouteKey` 是谁提供的?** RouterView 在渲染时 `provide(matchedRouteKey, matchedRouteRef)`——当前深度的记录。所以这些组合式函数必须在 RouterView 渲染的组件里调用;
2. **守卫为什么要挂到 record 而不是组件上?** navigate ④ 会遍历 `matched` 里每条记录的守卫集合——守卫必须能被管线找到;
3. **为什么用 Set?** 重复注册去重,卸载删除 O(1)。

还有一个精巧的细节(RouterView 的 watch):**实例被复用到新记录时(参数变化),守卫集合会从旧记录迁移到新记录**——这样组件复用时它注册的守卫依然生效。

## 7. 一个容易踩的坑:守卫的多重身份

`beforeEnter` 出现在两个地方:路由表记录上的 `beforeEnter`(navigate ④),和组件解锁……不,组件上是 `beforeRouteEnter`(⑤)。两者都叫「进入守卫」但**执行时机不同**:路由级在组件解析前,组件级在组件即将挂载时。别混。

[上一章:03-navigation-pipeline.md](03-navigation-pipeline.md) · [下一章:05-components.md →](05-components.md)