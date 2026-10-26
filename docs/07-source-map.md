# 07 · mini ↔ 官方对照表 + 简化点清单 + 继续啃官方

> 本仓库的存在意义:让你读完 mini 之后,能**无痛地**去读官方 vue-router 源码。
> 这一章告诉你:每个 mini 文件对应官方的哪个文件、哪些地方被简化了、以及从哪读起。

## 1. 文件对照表

| mini | 官方(packages/router/src/) | 说明 |
|---|---|---|
| `src/index.ts` | `index.ts` | 公共 API 出口 |
| `src/router.ts` | `router.ts` | createRouter 本体 |
| `src/matcher/index.ts` | `matcher/index.ts` | 路由表管理与 resolve |
| `src/matcher/pathTokenizer.ts` | `matcher/pathTokenizer.ts` + `matcher/pathParserRanker.ts` | 编译 + 打分 |
| `src/history/html5.ts` | `history/html5.ts` | HTML5 模式 |
| `src/history/hash.ts` | `history/hash.ts` | hash 模式 |
| `src/history/memory.ts` | `history/memory.ts` | 内存模式 |
| `src/history/common.ts` | `history/common.ts` | base 规范化、位置解析 |
| `src/components/RouterView.ts` | `RouterView.ts` | 视图渲染器 |
| `src/components/RouterLink.ts` | `RouterLink.ts` | 导航链接 |
| `src/scrollBehavior.ts` | `scrollBehavior.ts` | 滚动恢复 |
| `src/types.ts` | `types.ts` + `router.ts`(类型部分) | 公开类型 |
| `src/errors.ts` | `errors.ts` | 导航失败 |
| `src/utils.ts` | `utils.ts` | 工具函数 |
| `tests/*` | `__tests__/*` | 测试(官方有 900+ 用例,mini 142 个) |

## 2. 简化点诚实清单

下面每一条都是**主动简化**,不是没写。如果你要深入,这些就是官方与你(mini)之间的知识鸿沟。

### 匹配器

- **打分数值**:mini 用整数(20/11/9/8/6),官方 `computeScore` 用浮点并按静态字符数加权;`comparePathParserScore` 官方还有 `token_rank`(备份排名)参与同分比较。**对拍已证明常见场景两边排序一致**。
- **tokenize 方式**:官方一条巨型正则(可以一次性扫完 token 类型),mini 手写逐字符状态机(可读性优先)。官方正则也支持更多路径语法细节(如 `+` 可重复符)。
- **分组 `(/:id)?`**:mini 额外支持;官方 v4 分组语法已废弃,写这种路径的读者会得到「无匹配」。parity 测试刻意避开。
- **裸通配 `*`**:两边都按「字面量处理、无法匹配」处理(官方 v4 行为),必须写 `:pathMatch(.*)*`。
- **可选参数未命中**:两边都是 `''`(不是 undefined)——对拍校准过的坑。

### 路由器

- **守卫上下文**:官方守卫的 `this` 是组件实例、用 `runWithContext(app.runWithContext)` 包执行;mini 直接 call(record.instances[viewName])。
- **`onBeforeRouteEnter` 组合式 API**:mini 未实现(警告占位);官方通过 inject 当前 record + routeLocationKey 注册,与 option 版走同一套管线。
- **守卫内重定向上限**:mini 10 次,官方 30 次。
- **`router.listening` / `markAsReady` 的细节**:mini 有 listening 标志但没做「popstate 时 temporarily 挂起」的官方细节(popstate 期间的 guard redirect 回退处理)。
- **resolve 的 URL 编码**:官方对 params 有 encode/decode 分层(encodeParam、degree of URI encoding);mini 只做一次 decodeURIComponent + stringify。
- **RouterView 的 `route` prop、命名视图 props 透传**:未实现。
- **RouterLink 的默认 class 来源**:mini 用常量,官方可经 `createRouter({ linkActiveClass })` 配置。
- **install 的 devtools 集成**:官方有 `addDevtools`(Vue Devtools 插件);mini 无。
- **`clearRoutes()` / `destroy()` 等 API**:mini 未实现 `clearRoutes`(官方 4.4+ 加了清空全部路由)。

### history / 滚动

- **jsdom 限制的降级**:`scrollRestoration` 缺失时静默跳过;popstate 在 jsdom 里手动 dispatch(测试细节,实现里是标准监听)。
- **滚动位置**:不做 `document.scrollingElement` 差异处理;`scrollToPosition` 只支持窗口滚动与 el。
- **`location.key`(官方 excess 版本的多标签页状态归并)**:mini 无。

### 类型

- 官方完整类型体操(`RouteRecordRaw` 的联合拆分、`RouteLocationMatched`、strict 类型)mini 全部做了化简,但公开 API 签名与官方一致,迁移无摩擦。

## 3. 继续啃官方的推荐路线

如果 mini 读完了,建议按这个顺序打开官方仓库(vuejs/router → packages/router/src):

```
0. 先读官方文档 navigation-guards 的“导航解析流程”章节(11 步)
1. index.ts         → 公共 API,和 mini 几乎一模一样,秒过
2. router.ts        → createRouter:注意 runWithContext / markAsReady / setupListeners 的细节
3. matcher/index.ts → matchit 与 mini 的差异:getRecordMatcher、option 传递、
                      以及最值得读的 resolve(空 path 子路由的处理更显式)
4. matcher/pathTokenizer.ts → 巨型正则 tokenize(对照 mini 状态机,殊途同归)
5. matcher/pathParserRanker.ts → 官方打分(浮点 + 长度 + token_rank)
6. history/*        → 官方多了 location.key 与多标签页处理
7. RouterView.ts    → route props、实例注册的完整逻辑
8. RouterLink.ts    → 完整版 useLink(含 routeLocationKey 上下文)
9. router.ts 的 extractComponentsGuards → 异步组件的守卫提取细节
```

啃完官方源码后,再回头看 mini,你会发现:**mini 不是缩水版,而是一张官方源码的「映射图」**——每个函数都能在官方找到原型,每种简化都有对照说明。

## 4. 已知差异速查(遇到行为不同先查这里)

| 场景 | mini 行为 | 官方行为 |
|---|---|---|
| `/user(/:id)?` 样式路径 | 匹配(match 分组) | 不匹配(分组已废弃) |
| 裸 `*` 路径 | 不匹配(字面量 + warn) | 不匹配 |
| 守卫内重定向死循环 | 10 次上限 | 30 次上限 |
| `onBeforeRouteEnter` 组合式 | warn 占位 | 可用(inject 注册) |
| 可选参数缺失 | `''` | `''`(一致!) |
| 未匹配 URL | matched=[] 正常导航 | 同(一致) |
| 不存在的命名路由 | resolve/push 同步抛错 | 同(一致) |

> 最后一条纪律:如果发现 mini 与官方行为不一致且不在上表,**以官方为准修 mini**(这正是 `tests/parity.spec.ts` 存在的意义)。

[上一章:06-dynamic-and-advanced.md](06-dynamic-and-advanced.md) · [返回 docs 首页](README.md)