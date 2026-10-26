# mini-vue-router

> 为学习 **Vue Router 4** 原理和源码而写的最小实现(TypeScript,Vue 3)。

- 🔍 镜像官方架构:`createRouter` / history 层 / matcher 层 / 导航守卫管线
- 📚 `docs/` 中文原理文档,从算法到源码逐层拆解(见 [docs/README.md](docs/README.md))
- 🧪 vitest 单测 + 与官方 `vue-router` 行为对拍
- 🖥 `examples/` 可运行 demo(history / hash 两种模式)

## 快速开始

```bash
npm install
npm run dev        # 打开 http://localhost:5173(history 模式)或 /hash.html(hash 模式)
npm test           # 运行单元测试
```

## 目录结构

```
src/            mini 库本体(index / router / types / errors / utils / scrollBehavior)
  ├─ history/   createWebHistory / createWebHashHistory / createMemoryHistory
  ├─ matcher/   路由匹配(tokenizer + 打分算法)
  └─ components/ RouterLink / RouterView
examples/       Vite 演示应用
tests/          vitest 单元测试
docs/           原理文档(推荐阅读顺序见 docs/README.md)
```

## 学习路线

1. 先读 `docs/README.md`(架构总览)
2. 再读 `docs/01-path-matching.md` → `02-history.md` → `03-navigation-pipeline.md`
3. 对照 `docs/07-source-map.md` 阅读本仓库源码,然后去啃官方源码

> ⚠️ 本项目为学习而写:对外行为与官方对齐,内部实现有"显式简化"
> (简化清单见 docs/07-source-map.md),不要在生产环境替换 vue-router。