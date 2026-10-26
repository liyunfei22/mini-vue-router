# 06 · 动态路由、懒加载、滚动与性能

> 对应官方:`packages/router/src/matcher/index.ts`(addRoute/removeRoute)+ `router.ts`(loadRouteLocation / handleScroll)
> 本仓库实现:`src/matcher/index.ts` + `src/router.ts` + `src/scrollBehavior.ts`

## 1. 动态路由:addRoute / removeRoute

### 1.1 addRoute 做了什么

```ts
router.addRoute({ path: '/dynamic/:id', name: 'dynamic', component: X })
// 或挂到命名父路由下:
router.addRoute('parent', { path: 'child', component: X })
```

对应官方接口,mini 实现(match 顺序):

1. 把记录**归一化**(补全路径、初始化守卫容器);
2. 编译 parser、**按分数二分插入** matchers 数组(排序保持,插入 O(log n));
3. 更新两个索引:name Map、纯静态路径 Map;
4. **递归注册子路由**(children 逐层往下);
5. alias 逐条编译(带 aliasOf 链接);
6. 返回**移除函数**:`() => removeRoute(matcher)` —— 闭包捕获,官方同款(所以常见写法是 `const remove = router.addRoute(...); remove()`)。

新增路由**立即生效**:下一次导航 resolve 就能匹配到它。demo 里的「➕ addRoute 动态路由」按钮演示的就是这个。

### 1.2 removeRoute 的级联清理

```ts
router.removeRoute('grand')   // 只给一个名字
```

实现是 **BFS**([`removeRouteMatcher`](../src/matcher/index.ts)):

```
从目标 matcher 出发
  ├─ 自己从 matchers 数组剔除
  ├─ 清理 name Map / 静态路径 Map
  ├─ 从父记录的 children 剔除
  ├─ 清理 alias 记录
  └─ 递归它的所有 children
```

### 1.3 老生常谈的坑:动态路由与 404

```ts
router.addRoute({ path: '/dynamic', component: X })
// 之后再访问 /dynamic —— 如果此前已匹配过 /:pathMatch(.*)* 兜底……
// 注意:vue-router 4 会保持已解析路由的引用稳定——新路由 AFTER 兜底注册时,
// 若兜底按分数排在前面,新路由可能永远匹配不到(官方同样如此)。
```

——实际上官方处理更好(动态段索引),mini 的线性扫描意味着:新路由分数高于兜底路由时就排在前面,能正常匹配;若是同分落后,则先注册者胜。**建议:兜底路由永远最后注册,动态路由也不要晚于兜底注册**(官方文档同款建议)。

## 2. 懒加载:异步组件在管线的哪个环节被唤醒

```ts
{ path: '/lazy', component: () => import('./pages/lazy') }
```

整个机制只有两个落点:

- **提取组件守卫时**([`extractComponentsGuards`](../src/router.ts)):`guardType === 'beforeRouteEnter'` 的分支会先 `await load(record, component)`——调用 loader 函数,拿到模块后**把 record.components[name] 替换成真实组件**(就地替换,之后渲染直接用缓存,不会重复加载);
- **分支条件**:`typeof component === 'function' && !('displayName' in component) && !component.render && !component.setup` —— 函数且长得不像组件,才当作 loader(官方用 `displayName` 判断,逻辑同款)。

**为什么懒加载放在 beforeRouteEnter 之前?** 因为组件还没加载,`beforeRouteEnter` 的 next(vm) 拿不到实例;而且守卫 ⑤ 的管道必须等组件就绪。加载失败 → 导航失败 → onError(与官方一致)。

demo 的「懒加载」页:Network 面板能看到独立的 `lazy-load-*.js` chunk 在导航时才被请求。

## 3. scrollBehavior 完整图解

```ts
scrollBehavior(to, from, savedPosition) {
  return savedPosition || { top: 0 }
}
```

### 3.1 savedPosition 的三个来源(优先级从高到低)

```
!isPush 且会话内 Map 有记录 → getSavedScrollPosition(getScrollKey(to.fullPath, 0))
                                (back/forward 导航时,离开该页时的滚动已存进会话 Map)
首次导航或非 push → history.state.scroll
                    (push 双重操作里写入的滚动快照)
都没有 → null(交给 scrollBehavior 自己决定)
```

### 3.2 两种返回值([`scrollToPosition`](../src/scrollBehavior.ts))

```ts
// 绝对位置:
{ left: 0, top: 500, behavior: 'smooth' }

// 元素定位:
{ el: '#comment-42', top: 20 }
// 实现:getBoundingClientRect + 当前滚动偏移换算成绝对位置
```

### 3.3 mini 相对官方的简化

官方有一个 `scrollPositions` Map + `getScrollKey` 的完整实现,mini 保留了核心(会话内 Map、state.scroll、el 支持),去掉了:

- `scrollBehavior` 返回 Promise 时的完整等待链(官方有,mini 也有,见 handleScroll);
- 浏览器 `popstate` 前的 `saveScrollPosition` 默认快照——mini 同样在 setupListeners 里保存;
- 简化:位置信息统一 `{ left, top }`,不做 `document.scrollingElement` 差异处理。

## 4. 性能:为什么「排序数组 + 线性扫描」就够了

官方 matcher 的匹配是:**按分数排好序的数组,从头 re.test 线性扫到第一个命中**(官方没有静态 Map、没有段数索引)。这在路由数量到达几千条后才会成为瓶颈——vue-router 官方文档明说「大多数应用(几百条)无感知」。

mini 的取舍:

| 手段 | mini | 官方 | 说明 |
|---|---|---|---|
| 纯静态路径 Map | ✅ | ❌ | 静态路径最常见,Map 查找 O(1) 优于正则测试 |
| 动态段索引 | ❌(文档说明) | ❌ | 官方至今没有,没必要自作主张 |
| 分数排序插入 | ✅ 二分 | ✅ 二分 | 保证「第一个命中 = 最精确」 |

`tests/tokenizer.spec.ts` 的打分排序用例保证排序正确性,parity 保证顺序与官方一致。

## 5. 常用进阶 API 速查(本仓库都支持)

```ts
router.hasRoute('name')            // 是否存在
router.getRoutes()                 // 全部记录(含 alias)
router.resolve({ name, params })   // 不透支导航,纯解析(带 href)
router.isReady()                   // 首次导航完成后 resolve
router.onError(handler)            // 未捕获导航错误(守卫抛错等)
router.beforeEach / beforeResolve / afterEach   // 返回移除函数
```

[上一章:05-components.md](05-components.md) · [下一章:07-source-map.md →](07-source-map.md)