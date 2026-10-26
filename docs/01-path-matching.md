# 01 · 路由是怎么匹配的:pathTokenizer 与打分算法

> 对应官方:`packages/router/src/matcher/pathTokenizer.ts` + `pathParserRanker.ts`
> 本仓库实现:`src/matcher/pathTokenizer.ts` + `src/matcher/index.ts`

这是整个 vue-router 最硬核的部分,也是理解「为什么 `/users/new` 一定匹配到静态路由而不是 `/users/:id`」的关键。

## 1. 一句话原理

每条路由的 `path` 会被编译成三样东西:

1. **一个正则** —— 用来判断 URL 匹不匹配;
2. **一组 keys** —— 路径上有哪些参数(`:id`),正则捕获组与 keys 一一对应;
3. **一个打分数组** —— 用来决定「多个路由都能匹配同一个 URL 时,谁更优先」。

matcher 把所有编译好的路由**按分数从高到低排序**,匹配时就线性扫描,取**第一个命中**的。

我们称这条链为:**路径字符串 → tokenize → tokensToParser → TokenParser(matcher 排序依据)**。

## 2. token 类型

`path` 先是按 `/` 切成「段」(segment),每段再扫描出 token。token 只有两类(官方语义,mini 简化实现):

| 写法 | token | 正则源 | 说明 |
|---|---|---|---|
| `/user` | static | `(?:user)` | 静态文本,正则转义 |
| `:id` | param | `([^/]+)` | 普通参数,匹配非空、不含 `/` 的片段 |
| `:id?` | param(optional) | `(?:([^/]+))?` | 可选参数,**未命中时值为 `''`**(官方行为,不是 undefined!) |
| `:id*` | param(repeatable) | 一个捕获组接住 `a/b/c` | 可重复参数,`parse` 时按 `/` 拆成数组 |
| `:id(\d+)` | param(自定义正则) | `((?:\d+))` | 自定义正则里的捕获组会被自动转成非捕获组 |
| `:pathMatch(.*)*` | param(通配) | `(.*)` | 官方推荐的「捕获一切」写法(裸 `*` 官方 v4 已移除) |
| `(/:id)?` | group | `(?:\/([^/]+))?` | **mini 额外支持**的分组语法(官方 v4 已移除,见 07) |

扫描是**逐字符状态机**([`parseSegment`](../src/matcher/pathTokenizer.ts)):

- 遇到 `:` → 读参数名 → 检查 `?`、`*`、`(regexp)` 修饰;
- 遇到 `*` → 警告并当普通字符(官方行为);
- 遇到 `(` → 用「配对括号扫描」把整组当作原子(组内 `/` 先被占位符保护,不会被切段)。

## 3. 编译:正则是怎么拼出来的

看一段简单路径的完整编译过程(源码 [`tokensToParser`](../src/matcher/pathTokenizer.ts)):

```
path: '/user(/:id)?/posts/:postId'
        │     │            │
        ▼     ▼            ▼
segments: ['user(/:id)?'  , 'posts/:postId']
        │
        ▼
tokens(flat): [static:'user', group(static:'/', param:id, optional), static:'posts', param:postId]
        │
        ▼
正则源:  ^/user(?:\/([^/]+))?/posts/([^/]+)$
            └── 组:static '/' 与 param 一起包进 (?:…)?
        │
        ▼
keys: [{name:'id',optional:true}, {name:'postId',optional:false}]   ← 与捕获组一一对应
```

两个细节值得注意:

- **段连接符**:段与段之间用 `/` 连接;但「段是单一可选/可重复参数」时,后缀的 `/` 会被收进可选组 `(?:/…)?`,这就是为什么 `/user(/:id)?` 能匹配 `/user`。
- **可选参数的捕获**:未命中的可选参数在 `parse` 里得到 `''`(不是键缺失)——这是与官方对拍 (`tests/parity.spec.ts`) 校准过的行为。

## 4. 打分算法:优先级的秘密

**为什么需要打分?** 因为可能有多条路由同时匹配同一个 URL:

```
/users/new   (静态)
/users/:id   (参数)
/users/:pathMatch(.*)*  (通配)
```

它们都匹配 `/users/new`,但语义上**静态 > 参数 > 通配**。打分就是为了给它们排个序。

### 4.1 每类 token 的分数(mini 用整数,语义与官方一致)

| token | 分数 |
|---|---|
| 静态 static | 20 |
| 普通参数 :id | 11 |
| 可重复参数 :id* | 8 |
| 可选参数 :id? | 9 |
| 通配 :pathMatch(.*)* | 6 |

> mini 简化的两处(官方在 `pathParserRanker.ts` 用了浮点 + 长度加权):静态段分数与字符数无关;相同语义的 token 分数不细分。排序的相对顺序完全一致,已由 parity 对拍锁定。

### 4.2 比较规则([`comparePathParserScore`](../src/matcher/pathTokenizer.ts))

score 是一个数组(每段展平成 token 分数),比较时:

1. **逐位字典序**:第一个不同的位,分数大者胜;
2. **前缀相同时,数组短者胜**(`/users` 胜过 `/users/:id/xx`);
3. **完全相同 → 注册早者胜**(数组插入时保持稳定序)。

### 4.3 手算三个例子

```
/users/new  → [20,    20]      ┐
/users/:id  → [20,    11]      ├→ 逐位比较:/users/new 胜出 ✓
/users/*    → [20,    6 ]      ┘

/optional/:id?  → [20, 9 ]    ← 可选参数比必需参数低,因为它能匹配的场景更少
/optional/:id   → [20, 11]      (先注册谁都不影响:可选参数永远排在必需参数后面)

/files/:id*      → [20, 8 ]    ← 可重复参数也低于必需参数
/files/:pathMatch(.*)* → [20, 6]
```

## 5. resolve:一次匹配的单步追踪

以 URL `/users/5/posts` 为例([`matcher.resolve`](../src/matcher/index.ts) 做了四件事):

```
1. 拆出 path / query / hash        path='/users/5/posts'
2. 找 matcher:
     ① pathToStaticMatcher 精确索引(纯静态路径,Map 查找,O(1))
     ② 都没有 → 按分数排序的数组线性扫描,re.test 第一个命中者
        → 命中 '/users/:id/posts'(分数 [20,11,20] > [20,11,11]? 见下)
3. 构建 matched 链:沿 parent 链回溯
        [users, user-posts],每条记录的 path 都是自己的完整路径
4. 合并参数:链上每个 matcher 用自己的 parser 解析一遍全路径,浅层被深层覆盖
        users 解析出 { id:'5' },user-posts 解析出 { postId: 无 }hmm
        → 实际是 user-posts 的 parser 解析整个路径得到 params,
          再沿链合并 → { id:'5' }
```

注意第 2 步的细节:**同一个 URL 会被多条路由匹配时,判断顺序就是分数排序后的数组顺序**。mini 还加了一个官方没有的「纯静态路径 Map」做精确索引(纯静态路径最常见,查 Map 比正则快;官方是纯线性扫描,几百条路由内没有性能差异,见 06 章)。

### 5.1 空 path 子路由:matched 链的隐藏成员

```ts
{ path: '/parent', component: Parent, children: [{ path: '', name: 'parent-home' }] }
```

`''` 子路由的完整路径就是父路径 `/parent`。访问 `/parent` 时,**两个记录都在 matched 链里**:

```
matched = [parent, parent-home]
```

mini 的实现([`buildMatched`](../src/matcher/index.ts)):主 matcher 之后,**路径与之完全相同且正则命中的后续 matcher** 也会并入链,再按深度排序。这正是「`/parent` 的解析 name 是 `parent-home`」的原因(官方同款,parity 锁定)。

## 6. 与官方源码的差异速览

| 项 | mini | 官方 |
|---|---|---|
| tokenize 方式 | 手写状态机,逐字符可读 | 一条巨型正则 |
| 打分数值 | 整数 20/11/9/8/6 | 浮点 + 长度加权(`pathParserRanker`) |
| 静态路径索引 | 有(Map) | 无(纯线性) |
| 分组 `(/:id)?` | 支持(mini 扩展) | v4 已移除,不匹配 |
| 裸通配 `*` | 按官方行为:字面量 | 不匹配 |

为什么敢简化?**`tests/parity.spec.ts` 用同一张路由表对拍两边 resolve 的 matched/params/name/fullPath,结果必须完全一致**——简化掉的是「如何算出同样的结果」,而不是结果本身。

[下一章:02-history.md →](02-history.md)