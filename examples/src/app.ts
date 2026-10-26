/**
 * demo 主布局:导航菜单 + 守卫日志面板 + 路由出口
 */
import { h, ref, resolveComponent } from 'vue'
import type { Router } from '@mini/types'

const RouterLink = () => resolveComponent('router-link')
const RouterView = () => resolveComponent('router-view')

export function createAppComponent(router: Router, mode: 'history' | 'hash') {
  // 守卫日志面板的数据源:轮询 window.__guardLog(由 router.ts 的守卫写入)
  const guardLog = ref('')
  setInterval(() => {
    if (window.__guardLog && window.__guardLog !== guardLog.value) {
      guardLog.value = window.__guardLog
    }
  }, 120)

  return {
    name: 'App',
    render: () =>
      h('div', { class: 'app-shell' }, [
        h('header', [
          h('h1', '🚀 mini-vue-router demo'),
          h('p', {
            class: 'mode-tag',
          }, `模式:${mode} | ${location.origin}${mode === 'hash' ? '/hash.html' : '/'}`),
        ]),
        h('nav', { class: 'main-nav' }, [
          h(RouterLink(), { to: '/' }, () => '首页'),
          h(RouterLink(), { to: '/users' }, () => '用户'),
          h(RouterLink(), { to: '/parent/child-a' }, () => '嵌套'),
          h(RouterLink(), { to: '/guard' }, () => '守卫演示'),
          h(RouterLink(), { to: '/long' }, () => '长页面'),
          h(RouterLink(), { to: '/lazy' }, () => '懒加载'),
          h(RouterLink(), { to: '/about' }, () => '关于'),
          h('button', { onClick: () => router.addRoute({ path: '/dynamic', name: 'dynamic', component: DynamicPage }) }, '➕ addRoute 动态路由'),
          h(RouterLink(), { to: '/dynamic' }, () => '动态页'),
        ]),
        h('main', [
          h(RouterView()),
        ]),
        h('aside', { class: 'guard-panel' }, [
          h('h3', '🛡 守卫日志'),
          h('pre', guardLog.value || '尚未发生导航……'),
        ]),
      ]),
  }
}

/** addRoute 动态添加的页面 */
const DynamicPage = {
  name: 'DynamicPage',
  render: () => h('section', [h('h2', '⚡ 动态路由'), h('p', '这个页面是点击按钮后通过 router.addRoute() 动态注册的。')]),
}