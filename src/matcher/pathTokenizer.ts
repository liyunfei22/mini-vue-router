/**
 * mini path-to-regexp —— 路由路径的"编译器"
 *
 * 输入:`/user/:id(\d+)?/posts/:postId*` 这类路由路径字符串
 * 输出:TokenParser { re, keys, score, parse, stringify }
 *
 * 对应官方源码:packages/router/src/matcher/pathTokenizer.ts + pathParserRanker.ts
 * (官方用一条巨型正则做 tokenize,这里用手写状态机,更易读)
 */
import type { RouteParams, RouteParamsRaw } from '../types'
import { warn } from '../utils'

// ------------------------------------------------------------------
// token 类型
// ------------------------------------------------------------------

export interface PathTokenStatic {
  type: 'static'
  value: string
  /** 分组内部产生的 '/' :只进正则,不参与打分 */
  slashOnly?: boolean
}

export interface PathTokenParam {
  type: 'param'
  name: string
  /** 参数的正则源(默认 [^/]+ ,可自定义如 \d+ ) */
  regexpSource: string
  optional: boolean
  repeatable: boolean
}

export interface PathTokenGroup {
  type: 'group'
  tokens: PathToken[]
  /** 组是否以 '?' 结尾(整段可选),正则整体用 (?:...) 包裹 */
  optional: boolean
}

export type PathToken = PathTokenStatic | PathTokenParam | PathTokenGroup

export interface PathSegment {
  tokens: PathToken[]
}

export interface TokenParser {
  /** 编译好的最终正则:捕获组下标与 keys 一一对应 */
  re: RegExp
  keys: { name: string; repeatable: boolean; optional: boolean }[]
  /**
   * 打分数组:按 token 展平后的每项分数(static 20 / param 11 / optional 9 ...)
   * 比较规则:逐位字典序,第一个不同位分数大者胜;前缀完全相同时元素少者胜;全等时注册早者胜
   */
  score: number[]
  /** 用正则匹配路径,提取参数(未命中的可选参数不出现在结果中) */
  parse(path: string): RouteParams
  /** 用参数反向生成路径(命名路由跳转用);缺失必填参数时 warn 并返回空串 */
  stringify(params: RouteParamsRaw): string
}

// ------------------------------------------------------------------
// 打分常量
// 与官方语义一致(静态 > 普通参数 > 可选/可重复参数 > 通配),数值做了简化取整
// 注意:官方静态段分数与字符数成正比,mini 固定 20 —— 见 docs/07 简化清单
// ------------------------------------------------------------------

export const TOKEN_SCORE = {
  STATIC: 20,
  PARAM: 11,
  OPTIONAL: 9,
  REPEATABLE: 8,
  OPTIONAL_REPEATABLE: 7,
  WILDCARD: 6,
} as const

// ------------------------------------------------------------------
// 小工具
// ------------------------------------------------------------------

const MASK_CHAR = '~' // 分组内 '/' 的占位符(路径里几乎不会出现,防止分组被误切成段)

const escapeRegExp = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 尽力解码,失败时返回原文 */
function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isSlashToken(t: PathToken): t is PathTokenStatic {
  return t.type === 'static' && t.value === '/'
}

/**
 * 从 start 开始找与之配对的右括号(深度感知,跳过转义字符)
 * 返回右括号下标;找不到时返回 -1
 */
function findMatchingParen(str: string, start: number): number {
  let depth = 0
  for (let i = start; i < str.length; i++) {
    const ch = str[i]!
    if (ch === '\\') {
      i++ // 跳过转义字符
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 去掉自定义正则中的捕获组:() 一律转 (?:)
 * 原因:参数的捕获由本模块外层包裹,内部如果再有捕获组会导致
 * 捕获组下标与 keys 错位(官方对这种情况也是告警处理)
 */
function removeRegexpGroups(segment: string): string {
  if (!segment.includes('(')) return segment
  let result = ''
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (ch === '\\') {
      result += ch + (segment[i + 1] ?? '')
      i++
      continue
    }
    if (ch === '(' && segment[i + 1] !== '?' && segment[i + 1] !== ':') {
      warn(`自定义正则中的捕获组已自动转为非捕获组:"${segment}"`)
      result += '(?:'
      continue
    }
    result += ch
  }
  return result
}

// ------------------------------------------------------------------
// tokenize —— 路径字符串 → PathSegment[]
//
// 步骤:
//  1. 定位分组 ( ... ) ,把组内的 '/' 用占位符遮住(分组是原子的,不能被 '/' 切断)
//  2. 按 '/' 切成段
//  3. 逐段解析出 token 流(:参数、* 通配、分组)
// ------------------------------------------------------------------

export function tokenizePath(path: string): PathSegment[] {
  if (!path.startsWith('/')) {
    warn(`路径应以 "/" 开头:"${path}"`)
    path = '/' + path
  }

  // 1. 遮住分组内的 '/'
  const masked = path.replace(/\(((?:\\.|[^\\()])*)\)/g, (_all, inner: string) => {
    return '(' + inner.replace(/\//g, MASK_CHAR) + ')'
  })

  // 2. 按 '/' 切段(第 0 段是根前缀,恒为空)
  const rawSegments = masked.split('/')
  const segments: PathSegment[] = []
  rawSegments.forEach((seg, i) => {
    if (i === 0) {
      segments.push({ tokens: parseSegment(seg) })
    } else if (seg !== '' && seg !== MASK_CHAR) {
      // 空段(重复斜杠/尾斜杠)跳过;单占位符段一般是组根的 '/',交给组内处理
      segments.push({ tokens: parseSegment(seg) })
    }
  })

  return segments
}

/**
 * 解析单个段(不含 '/'):识别 ":" 参数、"*" 通配、"(:id)?" 分组
 */
function parseSegment(segment: string): PathToken[] {
  const tokens: PathToken[] = []
  let i = 0
  const len = segment.length
  let staticBuffer = ''

  const flushStatic = () => {
    if (staticBuffer) {
      tokens.push({ type: 'static', value: staticBuffer })
      staticBuffer = ''
    }
  }

  while (i < len) {
    const char = segment[i]!

    if (char === ':') {
      flushStatic()
      i++
      // 参数名 [a-zA-Z0-9_]+
      const nameMatch = /^[a-zA-Z0-9_]+/.exec(segment.slice(i))
      if (!nameMatch) {
        // 单独的 ':' 无法解析,视为普通字符(官方同样放宽)
        staticBuffer += ':'
        continue
      }
      const name = nameMatch[0]
      i += name.length

      // 可选的自定义正则 :id(\d+)
      let regexpSource = '[^/]+'
      if (segment[i] === '(') {
        const close = findMatchingParen(segment, i)
        if (close === -1) {
          warn(`参数 "${name}" 的正则缺少右括号:"${segment}"`)
        } else {
          regexpSource = removeRegexpGroups(segment.slice(i + 1, close))
          i = close + 1
        }
      }

      // 可选符 '?' / 可重复符 '*'
      let optional = false
      let repeatable = false
      if (segment[i] === '?') {
        optional = true
        i++
      } else if (segment[i] === '*') {
        repeatable = true
        i++
      }

      tokens.push({ type: 'param', name, regexpSource, optional, repeatable })
    } else if (char === '*') {
      // 官方 vue-router v4 已移除裸通配符 `*` 的语法(必须写 `:pathMatch(.*)*`)
      // 这里按官方行为处理:视为普通字符,路由因此几乎不会被匹配到
      warn(`路径中的裸 "*" 不是官方语法,请使用 ":pathMatch(.*)*": "${segment}"`)
      staticBuffer += '*'
      i++
    } else if (char === '(') {
      // 分组 (:id)? —— 段内的原子单元
      flushStatic()
      const close = findMatchingParen(segment, i)
      if (close === -1) {
        warn(`路由路径中分组缺少右括号:"${segment}"`)
        break
      }
      const innerRaw = segment
        .slice(i + 1, close)
        .split(MASK_CHAR)
        .join('/') // 还原被遮住的 '/'
      const optional = segment[close + 1] === '?'
      const innerTokens = parseGroupContent(innerRaw)

      if (optional) {
        tokens.push({ type: 'group', tokens: innerTokens, optional })
      } else {
        // 不带 '?' 的分组:直接展开(官方支持的范围更广,mini 见 docs/07)
        tokens.push(...innerTokens)
      }
      i = close + 1 + (optional ? 1 : 0)
    } else {
      staticBuffer += char
      i++
    }
  }

  flushStatic()
  return tokens
}

/**
 * 解析分组内容:组内可能有 '/' 与 ":" 参数。
 * 组内的 '/' 只参与正则(标记 slashOnly,不打分),参数照常解析
 */
function parseGroupContent(content: string): PathToken[] {
  return parseSegment(content).map(t => {
    if (isSlashToken(t)) return { type: 'static', value: '/', slashOnly: true }
    return t
  })
}

// ------------------------------------------------------------------
// 打分
// ------------------------------------------------------------------

function paramScore(optional: boolean, repeatable: boolean, isWildcard: boolean): number {
  if (isWildcard) return TOKEN_SCORE.WILDCARD
  if (optional && repeatable) return TOKEN_SCORE.OPTIONAL_REPEATABLE
  if (optional) return TOKEN_SCORE.OPTIONAL
  if (repeatable) return TOKEN_SCORE.REPEATABLE
  return TOKEN_SCORE.PARAM
}

function tokenScore(t: PathToken, groupOptional = false): number {
  switch (t.type) {
    case 'static':
      return TOKEN_SCORE.STATIC
    case 'param':
      return paramScore(groupOptional || t.optional, t.repeatable, t.name === 'pathMatch')
    case 'group': {
      // 组比分:内部 token 去掉 slashOnly 后求和;组可选时内部参数按可选计
      let sum = 0
      for (const inner of t.tokens) {
        if (isSlashToken(inner) && inner.slashOnly) continue
        sum += tokenScore(inner, t.optional)
      }
      return sum || TOKEN_SCORE.STATIC
    }
  }
}

/** 单个 token → 正则源(不含段连接符 '/';参数带自己的捕获组) */
function tokenSource(t: PathToken): string {
  switch (t.type) {
    case 'static':
      return escapeRegExp(t.value)
    case 'param':
      if (t.name === 'pathMatch') {
        // 通配:一个捕获组接住所有字符(含 '/');可重复语义由 parse 的 split 实现
        return `(${t.regexpSource})`
      }
      if (t.repeatable) {
        // 可重复参数:一个捕获组捕获 "a/b/c"(多段值拼在一起)
        return `((?:${t.regexpSource})(?:/${t.regexpSource})*)`
      }
      if (t.optional) {
        return `(?:(${t.regexpSource}))?`
      }
      return `(${t.regexpSource})`
    case 'group': {
      const inner = t.tokens.map(tokenSource).join('')
      return t.optional ? `(?:${inner})?` : inner
    }
  }
}

/**
 * 段级正则源:
 * - 段是"单一可选/可重复/通配参数"时,前导 '/' 并入可选组 → `(?:/…)?`
 *   这样 `/user/:id?` 能匹配 `/user`(组内没有 '/' 时整体缺席)
 * - 其余情况:普通段,连接符 '/' + 全部 token 源
 */
function segmentSource(segment: PathSegment): string {
  if (segment.tokens.length === 0) return '' // 根空段/被过滤的空段:不贡献正则
  const single = segment.tokens.length === 1
  const first = segment.tokens[0]!
  if (single && first.type === 'param' && (first.optional || first.repeatable || first.name === 'pathMatch')) {
    // 可选/可重复参数段:整体可能缺席(零次重复、可选未命中),用 (?:/…) 包住并加 '?'
    return '(?:/' + tokenSource(first) + ')?'
  }
  return '/' + segment.tokens.map(tokenSource).join('')
}

// ------------------------------------------------------------------
// 编译成 TokenParser
// ------------------------------------------------------------------

export function tokensToParser(path: string): TokenParser {
  const segments = tokenizePath(path)

  // 根路径 '/' 特判
  if (path === '/' && segments.length === 1 && segments[0]!.tokens.length === 0) {
    return rootParser()
  }

  // ---- 1. 收集 keys 与 score(展平分组) ----
  const keys: TokenParser['keys'] = []
  const score: number[] = []
  const walk = (tokens: PathToken[], groupOptional: boolean) => {
    for (const t of tokens) {
      if (t.type === 'group') {
        walk(t.tokens, groupOptional || t.optional)
        continue
      }
      if (t.type === 'param') {
        keys.push({ name: t.name, repeatable: t.repeatable, optional: groupOptional || t.optional })
      }
      score.push(tokenScore(t, groupOptional))
    }
  }
  for (const seg of segments) walk(seg.tokens, false)

  // ---- 2. 组装正则 ----
  const source = segments.map(segmentSource).join('')
  const re = new RegExp('^' + source + '$')

  // ---- 3. parse:正则捕获 → 参数 ----
  const parse = (p: string): RouteParams => {
    const matched = re.exec(p)
    if (!matched) return {}
    const params: RouteParams = {}
    keys.forEach((key, index) => {
      const value = matched[index + 1]
      if (value === undefined) {
        // 可选参数未命中:官方行为是给空串(不是省略键)
        params[key.name] = ''
        return
      }
      const decoded = decodeParam(value)
      // repeatable 参数按 '/' 分段;空串保持 ''(官方同,如 pathMatch 默认值)
      params[key.name] = key.repeatable ? (decoded === '' ? '' : decoded.split('/')) : decoded
    })
    return params
  }

  // ---- 4. stringify:参数 → 路径(命名路由跳转用) ----
  const stringify = (params: RouteParamsRaw): string => {
    // 不以 '/' 开头:第一个真实段(i > 0)会负责给出开头的 '/'
    let path = ''
    // 段间 '/' 先记账;若紧随的可选参数缺席,则连同它一起丢弃
    let pendingSlash = false
    let missingRequired = false

    const append = (v: string) => {
      if (pendingSlash) path += '/'
      pendingSlash = false
      path += v
    }

    // 处理单个 token;分组内部参数继承"组可选"语义
    const emit = (t: PathToken, inOptionalGroup: boolean) => {
      if (t.type === 'group') {
        for (const inner of t.tokens) emit(inner, inOptionalGroup || t.optional)
        return
      }
      if (t.type === 'static') {
        if (t.value === '/') {
          pendingSlash = true // 组内 '/' 与段间 '/' 语义一致:跟随下一个有效 token
        } else {
          append(t.value)
        }
        return
      }
      const value = params[t.name]
      if (value === undefined || value === null) {
        if (inOptionalGroup || t.optional) {
          // 可选参数缺失:丢弃紧邻的 '/' → 段整体缺席
          // (下一个 token 写入时会重新置 pendingSlash)
          return
        }
        if (!missingRequired) warn(`缺少必填参数 "${t.name}"`)
        missingRequired = true
        return
      }
      append(Array.isArray(value) ? value.join('/') : String(value))
    }

    for (let i = 0; i < segments.length; i++) {
      pendingSlash = i > 0 // 段间需要斜杠(第 0 段是根前缀,不需要)
      for (const t of segments[i]!.tokens) emit(t, false)
    }
    return missingRequired ? '' : path
  }

  return { re, keys, score, parse, stringify }
}

/** 根路径 '/' 的解析器 */
function rootParser(): TokenParser {
  const re = /^\/$/
  return {
    re,
    keys: [],
    score: [],
    parse: () => ({}),
    stringify: () => '/',
  }
}

/**
 * 比较两个 score 数组:返回 >0 表示 a 更优先(排序后应排在 b 前面)
 * 规则:逐位字典序,第一个不同位分数大者胜;前缀相同则短者胜;全相同返回 0(保持注册顺序)
 */
export function comparePathParserScore(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]! ? 1 : -1
  }
  if (a.length === b.length) return 0
  return a.length < b.length ? 1 : -1
}