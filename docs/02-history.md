# 02 · URL 是怎么被读写的:history 层

> 对应官方:`packages/router/src/history/html5.ts` + `hash.ts` + `memory.ts` + `common.ts`
> 本仓库实现:`src/history/*`

## 1. 统一的 History 接口

三种模式共享同一个接口(官方 `_History`,mini 在 [`src/types.ts`](../src/types.ts) 的 `History`):

```ts
interface History {
  base: string                          // 规范化后的 base('/app';hash 模式 '/app/#')
  location: string                      // 当前 location(不含 base 前缀,随导航实时更新)
  listen(cb: (to: string, from: string) => void): () => void   // 订阅导航事件
  push(to: string, data?): void         // 压入一条新历史
  replace(to: string, data?): void      // 覆盖当前历史
  go(delta: number): void               // 前进/后退
  createHref(location: string): string  // 拼完整 URL(RouterLink href 用)
}
```

**设计意图**:router 只依赖这个接口,不关心你用的是哪种模式。切换模式 = 换一个 history 实例,RouterOptions.history 一行改动。

## 2. createWebHistory:HTML5 模式

### 2.1 三个核心机制

**① state 模型** —— 每次导航都把「导航上下文」写进 `history.state`:

```ts
interface NavigationHistoryState {
  back: string | null      // 前一条 URL
  current: string          // 当前 URL
  forward: string | null   // 后一条 URL
  position: number         // 导航深度:前进/后退用差值判断方向
  scroll?: { left, top }   // 离开该页时的滚动快照
}
```

**② push 的“双重操作”**(官方原版算法,[`push`](../src/history/html5.ts)):

```
push('/users')
  ├─ 第一步 replaceState:更新「当前条目」的 state
  │     → 把 forward 指向 /users,写入离开前的滚动快照
  │     → 这样「整页刷新后按浏览器按钮」能恢复完整上下文
  └─ 第二步 pushState:压入新条目
        → back 指向离开的位置,position + 1
```

为什么需要两步而不是直接 pushState?因为 **pushState 不会修改旧条目的 state**——直接 push 的话,旧条目的 forward 永远是 null,浏览器前进按钮会失去方向信息。先 replace 旧条目、再 push 新条目,back/forward 链才完整。

**③ popstate 监听** —— 浏览器前进/后退时:

```
popstate 事件
  ├─ event.state 存在 → 正常前进/后退:同步 state + location,触发所有 listen 回调
  └─ event.state 为 null → 外部导航(地址栏手输等)→ 用 replace 补齐一个干净 state
```

另外 `scrollRestoration = 'manual'`:关闭浏览器自带的滚动恢复,交给 scrollBehavior 统一管理。

### 2.2 base 的规范化(坑点)

[`normalizeBase`](../src/history/common.ts) 是个**有官方对拍细节**的函数:

```
'/app/'  → '/app'
'/app'   → '/app'
''       →（浏览器取 <base> 标签,否则 '/'）
'/'      → ''        ← 注意:根路径规范化成空串!
```

为什么根路径 `'/'` 要变成 `''`?因为 `createHref(base, location) = base.replace(/\/$/, '') + location`——如果 base 是 `'/'`,`'/' + '/users'` 会拼出 `//users` 双斜杠。官方实测如此,mini 对齐(parity 锁定)。

## 3. createWebHashHistory:几乎零成本复用

教学点:**hash 模式 = HTML5 模式,只是 base 带了个 `#`。**

```ts
export function createWebHashHistory(base?: string): History {
  base = window.location.host
    ? base || window.location.pathname + window.location.search
    : ''
  if (!base.includes('#')) base += '#'
  return createWebHistory(base)   // ← 直接复用!
}
```

原理:`#` 之后的内容**不会发给服务器**(这是 hash 的历史用途:锚点),所以:

- `pushState` 的 URL 只写 `#` 之后的部分(`changeLocation` 里 `base.slice(hashIndex) + to`);
- `popstate` 在 hash 变化时同样触发(浏览器行为);
- 读 location 时从 `window.location.hash` 取(`createCurrentLocation` 的 hash 分支)。

**零成本复用的原因**:底层机制(history.state、popstate、push/replace)全部由浏览器提供,hash 模式只是换了个「读写源」。这就是为什么官方和 mini 的 hash 实现加起来不到 20 行。

## 4. createMemoryHistory:测试 / SSR 专用

没有浏览器可用时(单测、SSR),用**数组 + 游标**模拟历史栈:

```ts
let queue: Array<[string, unknown]> = [['/', {}]]  // 历史条目
let position = 0                                    // 当前游标

push('/a')    → queue.push,游标前进
replace('/b') → queue.splice(游标处, 1) 后覆盖
go(delta)     → 游标夹紧移动(0 ≤ position ≤ queue.length-1)
                → 触发 listen 回调(router 据此重新导航)
```

两个细节:后退后 push 会**截断后面的条目**(所有路由器同款语义);`go` 触发监听器,模拟浏览器 popstate 的效果。

`tests/history.spec.ts` 对 memory 测到最细;jsdom 里测 html5 的状态机时,`history.go()` 不会真的触发 popstate(jsdom 限制),测试用手动 `dispatchEvent(new PopStateEvent(...))` 驱动。

## 5. 滚动位置:state.scroll + 会话内 Map

scrollBehavior 需要知道「上次离开这个页面时滚到哪了」,数据有两个来源:

| 场景 | 来源 | 机制 |
|---|---|---|
| back/forward | `history.state.scroll` | push 时写入旧条目的滚动快照;浏览器回退时事件 state 里带着它 |
| 会话内返回 | `scrollPositions` Map | `setupListeners` 里,popstate 触发导航前 `saveScrollPosition(key, 当前滚动)`;key 是 `position + fullPath` |

见 [`src/scrollBehavior.ts`](../src/scrollBehavior.ts) 与 06 章的滚动一节。

## 6. 一次真实的「浏览器前进」

把 2.1 的三块拼起来,走一遍用户按浏览器「后退」按钮:

```
1. 浏览器触发 popstate,event.state = 之前 push 时写入的条目
2. position 差值 < 0 → 判断为「后退」
3. history 监听器:先 saveScrollPosition(保存当前页滚动),再 resolve(to) 开始导航
4. 导航管线跑完 → finalizeNavigation(isPush=false)→ 不写 URL(URL 已经是它了)
   → currentRoute 更新 → RouterView 重渲染
5. handleScroll:取 savedPosition(来自 state.scroll 或 Map)→ scrollToPosition
```

[上一章:01-path-matching.md](01-path-matching.md) · [下一章:03-navigation-pipeline.md →](03-navigation-pipeline.md)