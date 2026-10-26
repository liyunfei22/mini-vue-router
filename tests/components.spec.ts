/**
 * RouterLink / RouterView 组件测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { h, resolveComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createRouter } from '../src/router'
import { createMemoryHistory } from '../src/history/memory'

beforeEach(() => {
  document.body.innerHTML = ''
})

const Page = { render: () => h('div', 'page') }
const Home = { render: () => h('div', 'home') }

function makeRouter(routes: any[] = []) {
  return createRouter({
    history: createMemoryHistory(),
    routes:
      routes.length > 0
        ? routes
        : [
            { path: '/', name: 'home', component: Home },
            { path: '/users', name: 'users', component: Page },
            { path: '/users/:id', name: 'user', component: Page },
            { path: '/posts', name: 'posts', component: Page },
          ],
  })
}

/** 挂载一个渲染 RouterLink 的 App */
function mountLink(router: any, props: Record<string, any>, slot?: (ctx: any) => any) {
  const App = {
    render: () =>
      h(
        resolveComponent('RouterLink'),
        { ...props },
        slot ? { default: slot } : {},
      ),
  }
  return mount(App, { global: { plugins: [router] } })
}

describe('RouterLink', () => {
  it('渲染 <a href>;导航到目标后才出现 active 类', async () => {
    const router = makeRouter()
    const wrapper = mountLink(router, { to: '/users' })
    await router.push('/users')
    await new Promise(r => setTimeout(r, 0))
    const a = wrapper.find('a')
    expect(a.attributes('href')).toBe('/users')
    expect(a.attributes('class')).toBe('router-link-active router-link-exact-active')
  })

  it('父路由链接在子页面 active 但非 exactActive', async () => {
    const router = makeRouter([
      {
        path: '/parent',
        name: 'parent',
        component: Page,
        children: [{ path: 'child', name: 'parent-child', component: Page }],
      },
    ])
    const wrapper = mountLink(router, { to: '/parent' })
    // 导航到子页面:parent 记录仍在 matched 链中(第 0 条)
    await router.push('/parent/child')
    await new Promise(r => setTimeout(r, 0))
    const a = wrapper.find('a')
    expect(a.classes()).toContain('router-link-active')
    // 不是最后一条记录 → 非 exactActive;aria-current 不设置
    expect(a.classes()).not.toContain('router-link-exact-active')
    expect(a.attributes('aria-current')).toBeUndefined()
  })

  it('参数不同不算 active', async () => {
    const router = makeRouter()
    const wrapper = mountLink(router, { to: '/users/1' })
    await router.push('/users/2')
    await new Promise(r => setTimeout(r, 0))
    const a = wrapper.find('a')
    expect(a.classes()).not.toContain('router-link-active')
  })

  it('点击导航到目标', async () => {
    const router = makeRouter()
    const wrapper = mountLink(router, { to: '/users' })
    await router.push('/')
    await wrapper.find('a').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(router.currentRoute.value.path).toBe('/users')
  })

  it('ctrl/command 点击不拦截(浏览器新标签行为)', async () => {
    const router = makeRouter()
    const wrapper = mountLink(router, { to: '/users' })
    await router.push('/')
    await wrapper.find('a').trigger('click', { ctrlKey: true })
    await new Promise(r => setTimeout(r, 0))
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('replace 属性:点击后走 replace(不新增历史条目)', async () => {
    const router = makeRouter()
    const wrapper = mountLink(router, { to: '/users', replace: true })
    // 先等 install 的首次导航完成(它用 replace 占位历史),再 push 一条可回退的历史
    await router.isReady()
    await router.push('/posts') // 历史:[ '/', '/posts' ]
    await wrapper.find('a').trigger('click') // replace → 历史:[ '/', '/users' ](未新增)
    await new Promise(r => setTimeout(r, 10))
    expect(router.currentRoute.value.path).toBe('/users')
    router.go(-1)
    await new Promise(r => setTimeout(r, 10))
    // 若点击走的是 push,back 会回到 '/posts';replace 不新增条目 → 直接回更早的 '/'
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('custom 模式:不渲染 <a>,插槽拿到导航能力', async () => {
    const router = makeRouter()
    const wrapper = mountLink(
      router,
      { to: '/users', custom: true },
      ({ navigate, isActive }: any) => h('button', { onClick: navigate }, isActive ? 'active-btn' : 'btn'),
    )
    await router.push('/users')
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.find('a').exists()).toBe(false)
    const btn = wrapper.find('button')
    expect(btn.text()).toBe('active-btn')
    await btn.trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(router.currentRoute.value.path).toBe('/users')
  })
})

describe('RouterView', () => {
  const Child = { render: () => h('div', 'child-content') }
  const Parent = {
    render: () => h('div', [h('div', 'parent-content'), h(resolveComponent('router-view'))]),
  }

  function mountApp(router: any) {
    const App = {
      render: () => {
        const view = h(resolveComponent('router-view'))
        return h('div', [view])
      },
    }
    return mount(App, { global: { plugins: [router] } })
  }

  it('嵌套 RouterView 按 depth 取记录', async () => {
    const router = makeRouter([
      {
        path: '/parent',
        component: Parent,
        children: [{ path: 'child', component: Child }],
      },
    ])
    const wrapper = mountApp(router)
    await router.push('/parent/child')
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.html()).toContain('parent-content')
    expect(wrapper.html()).toContain('child-content')
    wrapper.unmount()
  })

  it('命名视图:components 按 name 渲染', async () => {
    const Sidebar = { render: () => h('div', 'sidebar-content') }
    const router = makeRouter([
      { path: '/multi', components: { default: Page, sidebar: Sidebar } },
    ])
    const App = {
      render: () => h('div', [
        h(resolveComponent('router-view')),
        h(resolveComponent('router-view'), { name: 'sidebar' }),
      ]),
    }
    const wrapper = mount(App, { global: { plugins: [router] } })
    await router.push('/multi')
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.html()).toContain('page')
    expect(wrapper.html()).toContain('sidebar-content')
    wrapper.unmount()
  })

  it('参数变化:同一实例被复用,不重新挂载', async () => {
    let setupCount = 0
    const Detail = {
      setup() {
        setupCount++
        return () => h('div', `detail-${setupCount}`)
      },
    }
    const router = makeRouter([{ path: '/d/:id', component: Detail }])
    const wrapper = mountApp(router)
    await router.push('/d/1')
    await new Promise(r => setTimeout(r, 0))
    // 第一次挂载:setup 一次
    expect(wrapper.html()).toContain('detail-1')
    await router.push('/d/2')
    await new Promise(r => setTimeout(r, 0))
    // 参数变化:组件类型相同 → 复用实例,setup 不再执行
    expect(setupCount).toBe(1)
    wrapper.unmount()
  })

  it('v-slot 插槽模式可包裹组件(配合 Transition/KeepAlive 用法)', async () => {
    const router = makeRouter([{ path: '/x', component: Page }])
    const App = {
      render: () => {
        const view = h(resolveComponent('RouterView'), null, {
          default: (params: any) => {
            return h('div', { class: 'slot-wrapper' }, [params.Component])
          },
        })
        return h('div', [view])
      },
    }
    const wrapper = mount(App, { global: { plugins: [router] } })
    await router.push('/x')
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.find('.slot-wrapper').exists()).toBe(true)
    expect(wrapper.html()).toContain('page')
    wrapper.unmount()
  })
})