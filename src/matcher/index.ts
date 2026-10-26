/**
 * createRouterMatcher —— 路由表的管理器
 *
 * 职责:
 *  - addRoute / removeRoute / hasRoute / getRoutes:注册与清理
 *  - resolve:把用户给的"目标"(字符串 / {name} / {path})解析成完整 RouteLocation
 *
 * 核心数据结构:按 score 排序的 matchers 数组 + name / 静态路径两个索引。
 * 匹配时取"第一个正则命中的 matcher"(score 排序保证最精确的在前)。
 *
 * 对应官方源码:packages/router/src/matcher/index.ts
 */
import { comparePathParserScore, tokensToParser, type TokenParser } from './pathTokenizer'
import { parseQuery, stringifyQuery, warn } from '../utils'
import type {
  RouteComponents,
  RouteLocation,
  RouteLocationNamedRaw,
  RouteLocationPathRaw,
  RouteLocationRaw,
  RouteParams,
  RouteRecordName,
  RouteRecordNormalized,
  RouteRecordRaw,
  RouteRecordRedirectOption,
  RouteQuery,
} from '../types'

// ------------------------------------------------------------------
// Matcher:一条"可以直接被匹配"的路由记录
// ------------------------------------------------------------------

export interface Matcher {
  record: RouteRecordNormalized
  parent: Matcher | undefined
  children: Matcher[]
  parser: TokenParser
  /** alias 路由共享主记录的 record,通过 aliasOf 标记 */
  aliasOf?: Matcher
  /** 本记录的 alias matcher 列表(级联删除时需要一并移除) */
  aliases: Matcher[]
}

export interface MatcherLocation {
  /** 被匹配到的 matcher(可能为 undefined = 404) */
  matched: Matcher[]
  location: RouteLocation
}

// ------------------------------------------------------------------
// 记录归一化
// ------------------------------------------------------------------

function normalizePath(path: string): string {
  // 去尾部斜杠(官方 normalizePath 同样处理);根路径 '/' 保留
  if (path === '/') return path
  return path.replace(/\/+$/, '')
}

interface NormalizeOptions {
  parent?: Matcher
}

function normalizeRouteRecord(
  record: RouteRecordRaw,
  options: NormalizeOptions = {},
): RouteRecordNormalized {
  const { parent } = options
  // components 为 null 表示"分组节点"(官方称 phantom record):占住 matched 链但不渲染
  const components: RouteComponents | null =
    record.component != null
      ? { default: record.component }
      : record.components != null
        ? { ...record.components }
        : null

  // 归一化 path:父路径拼接
  let path: string
  if (parent && parent.record) {
    if (record.path.startsWith('/')) {
      // 以 '/' 开头的子路径被视为"绝对路径"(官方行为:仍保留在 matched 链中,但路径就是它自己)
      warn(`子路由的 path 不应以 "/" 开头:"${record.path}"`)
      path = record.path
    } else if (record.path === '') {
      path = parent.record.path
    } else {
      path = parent.record.path === '/' ? '/' + record.path : parent.record.path + '/' + record.path
    }
  } else {
    path = record.path
  }
  path = normalizePath(path)

  let alias: string[] | undefined = undefined
  if (record.alias) {
    alias = Array.isArray(record.alias) ? record.alias : [record.alias]
    if (parent && parent.record) {
      alias = alias.map(a =>
        a.startsWith('/') ? a : parent.record.path === '/' ? '/' + a : parent.record.path + '/' + a,
      )
    }
  }

  const normalized: RouteRecordNormalized = {
    path,
    name: record.name,
    components,
    redirect: record.redirect as RouteRecordRedirectOption | undefined,
    alias,
    beforeEnter: record.beforeEnter,
    meta: record.meta || {},
    children: [],
    // 运行期字段(守卫注册 / 组件实例 / next(vm) 回调)
    instances: {},
    leaveGuards: new Set(),
    updateGuards: new Set(),
    enterCallbacks: {},
  }
  return normalized
}

const mergeMeta = (...metas: Array<RouteRecordNormalized['meta']>): Record<string, unknown> =>
  Object.assign({}, ...metas)

// ------------------------------------------------------------------
// createRouterMatcher
// ------------------------------------------------------------------

export function createRouterMatcher(routes: RouteRecordRaw[]): {
  addRoute: (parentOrRoute: RouteRecordName | RouteRecordRaw, route?: RouteRecordRaw) => () => void
  removeRoute: (name: RouteRecordName) => void
  hasRoute: (name: RouteRecordName) => boolean
  getRoutes: () => RouteRecordNormalized[]
  resolve: (rawLocation: RouteLocationRaw, currentLocation?: RouteLocation) => MatcherLocation
} {
  const matchers: Matcher[] = []
  const nameToMatcher: Map<RouteRecordName, Matcher> = new Map()
  // 纯静态路径的精确索引(mini 优化:官方是线性扫描,见 docs/06 说明)
  const pathToStaticMatcher: Map<string, Matcher> = new Map()

  // ---- 排序插入(score 越大越靠前;同分保持注册顺序) ----
  function insertMatcher(matcher: Matcher) {
    let index = matchers.length
    // 二分查找第一个"不弱于"新 matcher 的位置,保证相等 score 的稳定序
    for (let start = 0, end = matchers.length - 1; start <= end; ) {
      const mid = (start + end) >> 1
      const cmp = comparePathParserScore(matcher.parser.score, matchers[mid]!.parser.score)
      // cmp > 0:新 matcher 更优先,应排在其前 → 向左搜索
      if (cmp > 0) {
        index = mid
        end = mid - 1
      } else {
        start = mid + 1
      }
    }
    matchers.splice(index, 0, matcher)
  }

  /** 创建 matcher(含 alias),插入索引 */
  function createRouteRecordMatcher(record: RouteRecordNormalized, parent?: Matcher, aliasOf?: Matcher): Matcher {
    const parser = tokensToParser(record.path)
    // 把参数 keys 拷到记录上(RouterLink 的 active 判定要用)
    ;(record as any).keys = parser.keys
    const matcher: Matcher = {
      record,
      parent,
      children: [],
      parser,
      aliasOf,
      aliases: [],
    }
    insertMatcher(matcher)

    if (record.name) {
      if (!aliasOf) {
        if (nameToMatcher.has(record.name)) {
          warn(`Duplicate route name: "${String(record.name)}". This may lead to unexpected behavior.`)
        }
        // alias 不占用名称:按名字跳转永远解析到主记录
        nameToMatcher.set(record.name, matcher)
      }
    }
    if (matcher.parser.keys.length === 0 && !aliasOf) {
      // 纯静态路径:建立精确索引(aliases 不建,避免抢占主路径)
      if (!pathToStaticMatcher.has(record.path)) {
        pathToStaticMatcher.set(record.path, matcher)
      }
    }
    return matcher
  }

  // ---- addRoute ----
  function addRoute(parentOrRoute: RouteRecordName | RouteRecordRaw, route?: RouteRecordRaw): () => void {
    let parent: Matcher | undefined
    let record: RouteRecordRaw

    if (route != null) {
      // 传了 name + route:加到命名父路由下面
      if (typeof parentOrRoute !== 'string' && typeof parentOrRoute !== 'symbol') {
        warn('addRoute 的父路由必须传 name')
        return () => {}
      }
      parent = nameToMatcher.get(parentOrRoute)
      if (!parent) {
        warn(`Cannot find parent route with name "${String(parentOrRoute)}"`)
        return () => {}
      }
      record = route
    } else {
      record = parentOrRoute as RouteRecordRaw
    }

    const normalized = normalizeRouteRecord(record, { parent })
    const matcher = createRouteRecordMatcher(normalized, parent)
    parent?.children.push(matcher)

    // alias:记录复制一份(path 为别名路径,官方同款),aliasOf 指向主记录
    // —— alias 命中时 matched 链里的记录 path 是别名路径,name/redirect 仍是主记录的
    if (normalized.alias) {
      for (const aliasPath of normalized.alias) {
        const aliasRecord: RouteRecordNormalized = {
          ...normalized,
          path: aliasPath,
          aliasOf: normalized,
        }
        const aliasMatcher = createRouteRecordMatcher(aliasRecord, parent, matcher)
        matcher.aliases.push(aliasMatcher)
      }
    }

    // 递归注册子路由
    if (record.children) {
      for (const child of record.children) {
        addChild(child, matcher)
      }
    }

    // 返回移除函数(removeRoute 的闭包语义,官方同)
    return () => removeRouteMatcher(matcher)
  }

  /** 递归注册子路由(到指定父 matcher 下) */
  function addChild(child: RouteRecordRaw, parent: Matcher) {
    const normalized = normalizeRouteRecord(child, { parent })
    const matcher = createRouteRecordMatcher(normalized, parent)
    parent.children.push(matcher)

    if (normalized.alias) {
      for (const aliasPath of normalized.alias) {
        const aliasRecord: RouteRecordNormalized = {
          ...normalized,
          path: aliasPath,
          aliasOf: normalized,
        }
        const aliasMatcher = createRouteRecordMatcher(aliasRecord, parent, matcher)
        matcher.aliases.push(aliasMatcher)
      }
    }
    if (child.children) {
      for (const grand of child.children) {
        addChild(grand, matcher)
      }
    }
  }

  // ---- removeRoute ----
  function removeRouteMatcher(matcher: Matcher | undefined) {
    if (!matcher) return
    // BFS 级联移除(含 alias、递归 children)
    const queue: Matcher[] = [matcher, ...matcher.aliases]
    while (queue.length) {
      const current = queue.shift()!
      const index = matchers.indexOf(current)
      if (index !== -1) matchers.splice(index, 1)
      if (current.record.name) {
        nameToMatcher.delete(current.record.name)
      }
      if (current.parser.keys.length === 0) {
        pathToStaticMatcher.delete(current.record.path)
      }
      // 从父的 children 中移除(alias 记录同样挂在 parent.children 下,若存在)
      if (current.parent) {
        const siblings = current.parent.children
        const siblingIndex = siblings.indexOf(current)
        if (siblingIndex !== -1) siblings.splice(siblingIndex, 1)
      }
      queue.push(...current.children, ...current.aliases)
    }
  }

  function removeRoute(name: RouteRecordName): void {
    removeRouteMatcher(nameToMatcher.get(name))
  }

  function hasRoute(name: RouteRecordName): boolean {
    return nameToMatcher.has(name)
  }

  function getRoutes(): RouteRecordNormalized[] {
    return matchers.map(m => m.record)
  }

  // ---- 定位 matcher ----
  function findMatcher(path: string): Matcher | undefined {
    // 1) 纯静态路径:精确索引(最常命中)
    const staticMatcher = pathToStaticMatcher.get(path)
    if (staticMatcher) return staticMatcher
    // 2) 动态路由:按顺序线性扫描,取第一个 re 命中的
    for (const matcher of matchers) {
      if (matcher.parser.re.test(path)) return matcher
    }
    return undefined
  }

  /**
   * 构建 matched 链。
   * 除了主 matcher 的"父 → 子"链,还要把注册在主 matcher 之后、
   * 路径与之完全相同且正则可命中的 matcher 并入(空 path 的子路由:
   * 它的完整路径 == 父路径,导航到父路径时必须同时匹配到它)。
   * 全部候选按深度排序后去重 —— 与官方行为一致(/parent → [parent, parent-home])
   */
  function buildMatched(matcher: Matcher | undefined, path: string): Matcher[] {
    if (!matcher) return []
    const chain: Matcher[] = []
    const seen = new Set<Matcher>()

    // 1) 候选 = 主 matcher + 主 matcher 之后"同路径且可命中"的 matcher
    const candidates: Matcher[] = [matcher]
    const start = matchers.indexOf(matcher) + 1
    for (let i = start; i < matchers.length; i++) {
      const m = matchers[i]!
      if (m.record.path === path && m.parser.re.test(path)) candidates.push(m)
    }

    // 2) 每个候选沿 parent 回溯成完整链,按深度排序去重
    const depthOf = (m: Matcher): number => {
      let depth = 0
      let current: Matcher | undefined = m
      while (current) {
        depth++
        current = current.parent
      }
      return depth
    }
    for (const m of candidates) {
      const parents: Matcher[] = []
      let current: Matcher | undefined = m
      while (current) {
        parents.unshift(current)
        current = current.parent
      }
      for (const p of parents) {
        if (!seen.has(p)) {
          seen.add(p)
          chain.push(p)
        }
      }
    }
    // 深度排序(同一深度保持注册顺序 —— JS sort 稳定)
    chain.sort((a, b) => depthOf(a) - depthOf(b))
    return chain
  }

  // ---- resolve ----
  /**
   * 把 "用户可以写的目标" 解析成完整的 RouteLocation。
   * 支持:纯字符串路径、{ path }、{ name, params }(参数会 stringify 回路径再 parse 归一)
   */
  function resolve(rawLocation: RouteLocationRaw, _currentLocation?: RouteLocation): MatcherLocation {
    // 1. 拆出 path / query / hash
    let path: string
    let query: RouteQuery = {}
    let hash = ''
    let explicitName: RouteRecordName | undefined

    if (typeof rawLocation === 'string' || rawLocation == null) {
      const str = (rawLocation as string) || ''
      const questionIndex = str.indexOf('?')
      const hashIndex = str.indexOf('#')
      const pathEnd = questionIndex === -1 ? (hashIndex === -1 ? str.length : hashIndex) : questionIndex
      const searchPart =
        questionIndex === -1 ? '' : str.slice(questionIndex + 1, hashIndex === -1 ? undefined : hashIndex)
      hash = hashIndex === -1 ? '' : str.slice(hashIndex)
      query = parseQuery(searchPart)
      path = str.slice(0, pathEnd)
    } else {
      const obj = rawLocation as RouteLocationPathRaw & Partial<RouteLocationNamedRaw>
      if (obj.name !== undefined) {
        explicitName = obj.name
        // 命名路由:路径由参数 stringify 生成
        const matcher = nameToMatcher.get(obj.name)
        if (!matcher) {
          warn(`Route with name "${String(obj.name)}" does not exist`)
          const fallbackPath = obj.path || '/'
          // 返回空 matched(由 router 层决定如何处理)
          return makeResult(fallbackPath, obj.query || {}, hashOf(obj), [], {} as RouteParams, explicitName)
        }
        let generated = matcher.parser.stringify(obj.params || {})
        if (!generated) {
          // 缺失必填参数:stringify 返回空串,回退到记录原始路径
          generated = matcher.record.path
        }
        path = generated
        query = obj.query || {}
        hash = hashOf(obj)
      } else {
        path = obj.path || ''
        query = obj.query || {}
        hash = hashOf(obj)
      }
    }

    // 2. 定位 matcher 并解析参数
    const matcher = findMatcher(path)
    const chain = buildMatched(matcher, path)

    // 参数:父 matcher 的参数也要参与(比如嵌套路由的父段参数)
    let params: RouteParams = {}
    if (matcher) {
      for (const m of chain) {
        const parsed = m.parser.parse(path)
        params = { ...params, ...parsed }
      }
    }

    // 3. 组装结果
    // name 取 matched 链最后一条记录的 name(官方同款:
    // '/parent' 的 '' 子路由在最深处,resolve 的 name 是它)
    const name = explicitName ?? (chain.length ? chain[chain.length - 1]!.record.name : undefined)
    return makeResult(path, query, hash, chain, params, name)
  }

  function makeResult(
    path: string,
    query: RouteQuery,
    hash: string,
    chain: Matcher[],
    params: RouteParams,
    name: RouteRecordName | undefined,
  ): MatcherLocation {
    path = normalizePath(path) || '/'
    const fullPath = path + stringifyQuery(query) + hash
    return {
      matched: chain,
      location: {
        path,
        fullPath,
        name,
        params,
        query,
        hash,
        redirectedFrom: undefined,
        matched: chain.map(m => m.record),
        meta: mergeMeta(...chain.map(m => m.record.meta)),
      },
    }
  }

  // 注册初始路由表
  if (routes) {
    for (const route of routes) {
      addRoute(route)
    }
  }

  return { addRoute, removeRoute, hasRoute, getRoutes, resolve }
}

/** 从对象目标中取 hash(带 '#' ) */
function hashOf(obj: { hash?: string }): string {
  return obj.hash ?? ''
}