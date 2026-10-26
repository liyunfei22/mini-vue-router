# mini-vue-router

> 为学习 **Vue Router 4** 原理和源码而写的最小实现(TypeScript,Vue 3)。
> **不生产可用,只做教学可用** —— 对外行为与官方对齐,内部是"显式简化"的镜像实现。

- 🔍 镜像官方架构:`createRouter` / history 层 / matcher 层 / 导航守卫管线
- 📚 `docs/` 中文原理文档,7 章从算法到源码逐层拆解(见 [docs/README.md](docs/README.md))
- 🧪 vitest 单测 **142 例**,其中 `tests/parity.spec.ts` 与官方 vue-router **行为对拍**
- 🖥 `examples/` 可运行 demo(history / hash 双模式)

## 快速开始

```bash
npm install
npm run dev      # http://localhost:5173(history 模式)/ /hash.html(hash 模式)
npm test         # 全部单元测试
npm run build    # 库构建(dist/ + .d.ts)+ demo 构建
```

## 目录结构

```
src/              mini 库本体
  ├─ index.ts     createRouter / history / 组件 / hooks 的公共出口
  ├─ router.ts    ⭐ 导航管线:pushWithRedirect → navigate(守卫) → finalizeNavigation
  ├─ matcher/     路由匹配:pathTokenizer(路径编译 + 打分)+ 路由表管理
  ├─ history/     三种 URL 模式(html5 / hash / memory)
  ├─ components/  RouterLink / RouterView
  └─ types.ts · errors.ts · utils.ts · scrollBehavior.ts
examples/         Vite demo(嵌套 / 参数 / 守卫日志 / 动态路由 / 懒加载 / 滚动)
tests/            6 个测试文件,含与官方 vue-router 的 parity 对拍
docs/             ⭐ 原理文档(推荐阅读顺序见 docs/README.md)
```

## 功能对照

| 功能 | mini | 说明 |
|---|---|---|
| createRouter + 三种 history | ✅ | HTML5 / hash / memory |
| 静态 / 参数 / 通配匹配 + 打分排序 | ✅ | `/users/new` > `/users/:id` > 兜底 |
| 嵌套路由 + 空 path 子路由 | ✅ | matched 链与官方一致(parity 锁定) |
| 命名路由 / redirect / alias | ✅ | 含函数式 redirect |
| 七段守卫管线 | ✅ | leave → beforeEach → update → enter → 懒加载 → beforeResolve → afterEach |
| 失败类型 | ✅ | aborted / cancelled / duplicated + isNavigationFailure |
| 动态路由 addRoute / removeRoute | ✅ | 级联清理、alias 一并移除 |
| scrollBehavior | ✅ | savedPosition 三来源 + el 定位 |
| 懒加载 | ✅ | `() => import(...)` 管线内唤醒 |
| RouterLink / RouterView | ✅ | depth 注入链、next(vm)、custom 模式 |

## 学习路线

1. 读 [`docs/README.md`](docs/README.md)(架构总览)
2. 按序读 `docs/01-path-matching.md` → `02-history.md` → `03-navigation-pipeline.md`(核心三章)
3. 对照 [`docs/07-source-map.md`](docs/07-source-map.md) 读本仓库源码,然后去啃官方源码

## 关于与官方的一致性

`tests/parity.spec.ts` 的做法:同一张路由表分别交给 mini 与官方 vue-router,
对比 resolve 的 matched / params / name / fullPath、守卫落点、失败类型。
**任何与官方不一致且不在文档差异表里的行为,以官方为准。**

## 部署提示

demo 的 HTML5 模式刷新深链接需要服务器回退到 `index.html`(vite dev 默认支持;
静态部署如 GitHub Pages 需配置 SPA fallback)。hash 模式(`/hash.html`)无此要求。

> ⚠️ 本项目为学习而写,请勿在生产环境替换 vue-router。简化点清单见 docs/07-source-map.md。