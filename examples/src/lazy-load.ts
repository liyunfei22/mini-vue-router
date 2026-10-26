/**
 * 懒加载页面模块:被 router.ts 的 () => import('./lazy-load') 引用
 */
import { h } from 'vue'

export const LazyLoaded = {
  name: 'LazyLoadedPage',
  render: () =>
    h('section', [
      h('h2', '📦 懒加载完成'),
      h('p', '这个模块只有在导航到 /lazy 时才会被请求。'),
      h('p', 'Network 面板里可以看到一个独立的 chunk(lazy-load-*.js)。'),
    ]),
}