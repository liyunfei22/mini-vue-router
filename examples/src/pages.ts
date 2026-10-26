/**
 * demo 页面组件(全部用渲染函数,避免引入 SFC 编译)
 */
import { h, resolveComponent } from 'vue'

/** 渲染函数里引用注册组件必须显式 resolve */
const RouterLink = () => resolveComponent('router-link')
const RouterView = () => resolveComponent('router-view')

export const Home = {
  name: 'HomePage',
  render: () =>
    h('section', [
      h('h2', '🏠 首页'),
      h('p', '这是一个用 mini-vue-router 驱动的 demo。'),
      h('ul', [
        h('li', '点击上方链接体验导航(注意链接的 active 类)'),
        h('li', '地址栏输入 /users/42 并刷新(HTML5 模式由 dev server 回退)'),
        h('li', '下方的「守卫日志」面板会记录每一次导航经过的守卫'),
      ]),
    ]),
}

export const Users = {
  name: 'UsersPage',
  render: () =>
    h('section', [
      h('h2', '👥 用户列表'),
      h('ul', [
        h('li', [h(RouterLink(), { to: '/users/1' }, () => '用户 1')]),
        h('li', [h(RouterLink(), { to: '/users/2' }, () => '用户 2')]),
        h('li', [h(RouterLink(), { to: '/users/3' }, () => '用户 3')]),
      ]),
    ]),
}

export const UserDetail = {
  name: 'UserDetailPage',
  render() {
    // 通过 this.$route 读取参数(install 时注入的 globalProperties)
    const id = (this as any).$route.params.id
    return h('section', [
      h('h2', `👤 用户 ${id}`),
      h('p', `当前参数:id = ${id}`),
      h('p', [h(RouterLink(), { to: '/users' }, () => '← 返回列表')]),
      h('p', '在地址栏把 id 改成别的数字再回车,观察 beforeRouteUpdate 与组件复用。'),
    ])
  },
}

export const About = {
  name: 'AboutPage',
  render: () =>
    h('section', [
      h('h2', 'ℹ️ 关于'),
      h('p', '本项目是为了学习 Vue Router 4 源码而写的最小实现,文档见 docs/ 目录。'),
      h('p', '完整源码对照:docs/07-source-map.md。'),
    ]),
}

/** 懒加载页面:通过 () => import() 的方式演示导航管线中的组件加载时机 */
export const LazyPage = {
  name: 'LazyPage',
  render: () =>
    h('section', [
      h('h2', '📦 懒加载页面'),
      h('p', '这个页面通过 () => import(...) 注册,首次导航到它时才加载。'),
      h('p', '打开 Network 面板可以看到一个独立的 chunk 被请求。'),
    ]),
}

export const GuardDemo = {
  name: 'GuardDemoPage',
  render: () =>
    h('section', [
      h('h2', '🛡 守卫演示'),
      h('p', '本路由的路由级 beforeEnter 会记录日志;离开时 beforeRouteLeave 也会记录。'),
      h('ul', [
        h('li', [h(RouterLink(), { to: '/guard/secret' }, () => '尝试进入「秘密页」')]),
      ]),
      h('p', '「秘密页」有全局守卫拦截,导航会被中止(aborted)。'),
    ]),
}

export const GuardSecret = {
  name: 'GuardSecretPage',
  render: () => h('section', [h('h2', '🔒 秘密页'), h('p', '你本不该看到我……')]),
}

/** 嵌套路由的父组件:内部放一个 RouterView 渲染子路由 */
export const Parent = {
  name: 'ParentPage',
  render: () =>
    h('section', [
      h('h2', '📂 嵌套路由演示'),
      h('nav', [
        h(RouterLink(), { to: '/parent/child-a' }, () => 'child A'),
        ' ',
        h(RouterLink(), { to: '/parent/child-b' }, () => 'child B'),
      ]),
      // 子路由在这里渲染
      h(RouterView()),
    ]),
}

export const ChildA = {
  name: 'ChildAPage',
  render: () => h('article', [h('h3', 'Child A'), h('p', '嵌套子路由 A 的内容。')]),
}

export const ChildB = {
  name: 'ChildBPage',
  render: () => h('article', [h('h3', 'Child B'), h('p', '嵌套子路由 B 的内容。')]),
}

export const NotFound = {
  name: 'NotFoundPage',
  render: () =>
    h('section', [
      h('h2', '404'),
      h('p', '没有匹配到任何路由(matched 为空时渲染的兜底页)。'),
    ]),
}

/** 一个超长页面,用于演示 scrollBehavior 的滚动恢复 */
export const LongPage = {
  name: 'LongPage',
  render: () =>
    h('section', [
      h('h2', '📜 长页面(scrollBehavior)'),
      ...[...Array(40).keys()].map(i => h('p', `第 ${i + 1} 段占位文本……`)),
    ]),
}