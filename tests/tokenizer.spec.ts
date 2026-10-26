/**
 * tokenizer 单元测试:mini path-to-regexp 的解析、编译、打分
 */
import { describe, it, expect, vi } from 'vitest'
import {
  tokensToParser,
  tokenizePath,
  comparePathParserScore,
  TOKEN_SCORE,
  type PathToken,
} from '../src/matcher/pathTokenizer'

function parser(pattern: string) {
  return tokensToParser(pattern)
}

/** 测试辅助:把 token 输出成可读字符串(static 输出文本,param 输出 `:name`) */
function describeTokens(t: PathToken) {
  if (t.type === 'group') return '(group)'
  return t.type === 'static' ? `"${t.value}"` : `:${t.name}`
}

describe('tokenizePath —— 路径扫描', () => {
  it('静态路径', () => {
    const segments = tokenizePath('/users/new')
    expect(segments.map(s => s.tokens.map(describeTokens))).toEqual([[], ['"users"'], ['"new"']])
  })

  it('参数 token :id', () => {
    const segments = tokenizePath('/users/:id')
    const param = segments[2]!.tokens[0]!
    expect(param).toMatchObject({ type: 'param', name: 'id', optional: false, repeatable: false })
  })

  it('可选参数 :id?', () => {
    const segments = tokenizePath('/users/:id?')
    const param = segments[2]!.tokens[0]!
    expect(param).toMatchObject({ type: 'param', name: 'id', optional: true, repeatable: false })
  })

  it('可重复参数 :id*', () => {
    const segments = tokenizePath('/files/:id*')
    const param = segments[2]!.tokens[0]!
    expect(param).toMatchObject({ type: 'param', name: 'id', optional: false, repeatable: true })
  })

  it('自定义正则 :id(\\d+)', () => {
    const p = parser('/users/:id(\\d+)')
    expect(p.re.test('/users/123')).toBe(true)
    expect(p.re.test('/users/abc')).toBe(false)
  })

  it('正则中的捕获组会被转为非捕获组', () => {
    const p = parser('/users/:id((a|b)c)')
    expect(p.re.test('/users/ac')).toBe(true)
    expect(p.re.test('/users/bc')).toBe(true)
    expect(p.re.test('/users/cc')).toBe(false)
  })

  it('通配符 :pathMatch(.*)* —— 官方推荐的捕获一切写法', () => {
    const p = parser('/files/:pathMatch(.*)*')
    expect(p.re.test('/files/a')).toBe(true)
    expect(p.re.test('/files/a/b/c.txt')).toBe(true)
    expect(p.re.test('/files')).toBe(true) // 零次重复
  })

  it('裸通配符 * 不解析(官方 v4 已移除该语法,按字面量处理)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = parser('/files/*')
    expect(p.re.test('/files/a')).toBe(false) // 只可能命中字面 '/files/*'
    expect(p.re.test('/files/*')).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('分组 (/:id)? —— 整段可选', () => {
    const p = parser('/user(/:id)?')
    expect(p.re.test('/user')).toBe(true)
    expect(p.re.test('/user/5')).toBe(true)
    expect(p.re.test('/user/')).toBe(false)
    expect(p.keys.map(k => k.name)).toEqual(['id'])
  })

  it('不带 ? 的分组被直接展开', () => {
    const p = parser('/user(/:id)')
    expect(p.re.test('/user/5')).toBe(true)
    expect(p.re.test('/user')).toBe(false)
  })

  it('静态字符会被转义', () => {
    const p = parser('/a.b/c-d')
    expect(p.re.test('/aXb/c-d')).toBe(false)
    expect(p.re.test('/a.b/c-d')).toBe(true)
  })
})

describe('tokensToParser —— 匹配与参数提取', () => {
  it('普通参数提取', () => {
    const p = parser('/users/:id')
    expect(p.re.exec('/users/5')).toBeTruthy()
    expect(p.parse('/users/5')).toEqual({ id: '5' })
  })

  it('可选参数未命中时为空串(官方同)', () => {
    const p = parser('/users/:id?')
    expect(p.parse('/users')).toEqual({ id: '' })
    expect(p.parse('/users/7')).toEqual({ id: '7' })
  })

  it('可重复参数提取为数组;零次重复时为空串(官方同)', () => {
    const p = parser('/files/:id*')
    expect(p.parse('/files/a/b/c')).toEqual({ id: ['a', 'b', 'c'] })
    expect(p.parse('/files')).toEqual({ id: '' })
  })

  it('通配参数提取为数组(含斜杠分段)', () => {
    const p = parser('/files/:pathMatch(.*)*')
    expect(p.parse('/files/a/b.txt')).toEqual({ pathMatch: ['a', 'b.txt'] })
    expect(p.parse('/files')).toEqual({ pathMatch: '' })
  })

  it('URL 编码参数会被解码', () => {
    const p = parser('/users/:id')
    expect(p.parse('/users/%E5%BC%A0%E4%B8%89')).toEqual({ id: '张三' })
  })

  it('stringify —— 参数反向生成路径', () => {
    const p = parser('/users/:id/posts/:postId')
    expect(p.stringify({ id: '5', postId: '8' })).toBe('/users/5/posts/8')
  })

  it('stringify —— 可重复参数拼成多段', () => {
    const p = parser('/files/:id*')
    expect(p.stringify({ id: ['a', 'b'] })).toBe('/files/a/b')
  })

  it('stringify —— 可选参数缺失时连斜杠一起丢弃', () => {
    const p = parser('/user(/:id)?')
    expect(p.stringify({})).toBe('/user')
    expect(p.stringify({ id: '5' })).toBe('/user/5')
  })

  it('stringify —— 缺失必填参数时返回空串', () => {
    const p = parser('/users/:id')
    expect(p.stringify({})).toBe('')
  })

  it('parse/stringify 往返一致', () => {
    const p = parser('/groups/:gid/users/:uid')
    const params = p.parse('/groups/g1/users/u2')
    expect(p.stringify(params)).toBe('/groups/g1/users/u2')
  })
})

describe('打分排序', () => {
  // 简化断言:直接用 comparePathParserScore 比较两两优先级
  const cmp = (a: string, b: string) => comparePathParserScore(parser(a).score, parser(b).score)

  it('静态段 > 参数段 > 通配段', () => {
    expect(cmp('/users', '/users/:id')).toBeGreaterThan(0)
    expect(cmp('/users/:id', '/users/:pathMatch(.*)*')).toBeGreaterThan(0)
  })

  it('相同前缀:段更具体者优先', () => {
    // /users/new (静态) 应排在 /users/:id (参数) 前面
    expect(cmp('/users/new', '/users/:id')).toBeGreaterThan(0)
  })

  it('纯静态路径只比段数:短者胜', () => {
    // /users 匹配不到 /users/:id 的 URL,但同前缀时短者优先是文档承诺的规则
    expect(cmp('/users', '/users/:id/nested')).toBeGreaterThan(0)
  })

  it('必需参数 > 可选参数', () => {
    expect(cmp('/users/:id', '/users/:id?')).toBeGreaterThan(0)
  })

  it('必需参数 > 可重复参数', () => {
    expect(cmp('/files/:id', '/files/:id*')).toBeGreaterThan(0)
  })

  it('可重复参数 > 通配', () => {
    expect(cmp('/files/:id*', '/files/:pathMatch(.*)*')).toBeGreaterThan(0)
  })

  it('同分时返回 0(保持注册顺序)', () => {
    expect(cmp('/users/:id', '/users/:uid')).toBe(0)
    expect(cmp('/a/x', '/a/y')).toBe(0)
  })

  it('打分数组的内容与 TOKEN_SCORE 常量一致', () => {
    expect(parser('/users/:id').score).toEqual([TOKEN_SCORE.STATIC, TOKEN_SCORE.PARAM])
    expect(parser('/files/:pathMatch(.*)*').score).toEqual([TOKEN_SCORE.STATIC, TOKEN_SCORE.WILDCARD])
    expect(parser('/users/:id?').score[1]).toBe(TOKEN_SCORE.OPTIONAL)
  })

  it('nested 场景:完整排序', () => {
    const wildcard = '/users/:pathMatch(.*)*'
    const order = ['/users/new', '/users/:id', wildcard].map(p => parser(p).score)
    const sorted = [...order].sort((a, b) => comparePathParserScore(b, a) || 0)
    expect(sorted.map(s => s.join(','))).toEqual([...order].map(s => s.join(',')))
  })
})