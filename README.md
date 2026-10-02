# dsh-plugin-query-enhance

[English](README.en.md) | [中文](README.md)

一个 DSH Host 侧插件，让"查询当前 profile 的 bundle"这件事变便宜。

它做两件事，两者互补而非二选一：

- **给 list 类 action 的返回瘦身。** `plugin_manager list_bundles` 与
  `plugin_manager list_plugins` 都是管理面，都会回传多于调用方所需的内容。
  `list_bundles` 回传每个 bundle **以及** 该 bundle 声明的完整插件行清单 —— 实测
  某个真实 profile 里，这份回传的大头集中在两个 bundle 上：`@deepseek-ai/dsh-base`
  声明了 **86** 行，`@deepseek-ai/dsh-web-app` 声明了 **85** 行。而 `list_plugins`
  回传的是一页调用方并没有挑选过的插件条目。现在两者都变成每条记录一行摘要。
  投影在 Host 内部、序列化之前完成，所以这些字节是**根本没有产生**，而不是产生了
  再被读者忽略。
- **新增 `plugin_query`**：一个只读工具，接受过滤条件，只回传通过筛选的记录 —— 精细
  到"哪个 bundle 声明了这个模块"。

两条机制都**没有改动 `@deepseek-ai/dsh-plugin-manager`**。核心保持原样，Web 侧边栏
继续直接读服务，卸载这个 bundle 即完全恢复原有行为。

**环境要求**

| | |
|---|---|
| 操作系统 | 不限（插件是纯 JavaScript，不调用任何平台 API） |
| DSH | profile 中挂载了提供 `pluginManager` 服务的管理插件 |
| Node.js | 20+ —— 仅测试与边界自查脚本需要，运行插件本身不需要 |

包名、仓库目录名、Loader 行 id、显示名统一使用同一个标识 ——
**`dsh-plugin-query-enhance`** —— 只有一个名字需要检索。Loader 只读
`package.json`，目录名无关紧要。

---

## 问题，以及量化

`plugin_manager` 有两个 list 动作。两者都只接受 `offset` 与 `limit`，没有按名
字、按状态、按字段的筛选。默认页大小是 25，而一个 profile 大约十来个 bundle，
所以**第一次调用就会把整张表取回来**。分页在这里帮不上忙，因为根本没有"下一页"
可言。

每个 bundle 回传的是管理记录：标识、四个状态布尔值、包描述、完整的 `rows`
声明行数组、它覆盖的内置行，以及可能的错误与诊断。其中 `rows` 占绝对大头。在
本机实测，上面两个 bundle 的声明行序列化后约 **11 KB / 144 行**，约合每行 76
字节，还没算上会进一步增加的实时 `entryId`。

由此引出两个后果，本插件分别应对：

| 后果 | 对应机制 |
|---|---|
| 模型不知道有更合适的工具，直接调 `list_bundles`，为整张表付费 | **投影**：`list_bundles` 照常可用，但每个 bundle 只回一行摘要 |
| 模型**清楚**自己要什么，却没有参数可以表达 | **`plugin_query`**：过滤器进入 schema，筛选在 Host 侧完成，只回命中的记录 |

---

## 安装

安装即 bundle 安装：DSH 会把包写进当前 profile、注册 Loader 行并热应用。不要手工
编辑 profile。

### 1. 把代码放到机器上

```sh
git clone https://github.com/deadbushxw/dsh-plugin-query-enhance "%USERPROFILE%\.dsh\dsh-plugins\dsh-plugin-query-enhance"
```

任何目录都可以，上面的路径只是示例。没有构建步骤。

### 2. 装进一个 profile

在目标 profile 里对 Agent 说，可以用克隆下来的目录，也可以直接用仓库地址：

> 用 `plugin_manager install_bundle` 安装
> `%USERPROFILE%\.dsh\dsh-plugins\dsh-plugin-query-enhance` 这个 bundle。

或者不克隆，直接从 GitHub 安装：

> 用 `plugin_manager install_bundle` 安装
> `github:deadbushxw/dsh-plugin-query-enhance`。

也可以在 GUI 里操作：**设置 → 插件**，把该包目录作为本地 bundle 添加并启用。

变更生效时 `plugin_manager` 会返回 `application: "applied"`。若返回
`restart-required`，重启 DSH。用新代码替换已安装的包同样需要重启，因为 Host 会
缓存模块实例。

### 3. 确认它能用

先请求 bundle 列表，看返回的形状：

```
plugin_manager list_bundles
```

现在每条记录只带 `name`、`version`、`enabled`、`installed`、`optional`、
`removable` 与 `rowCount`，没有 `rows` 数组、没有 `description`、没有 `meta`。
再问一个只有新工具能回答的问题：

```
plugin_query match="cordis-plugin-hmr"
```

第一次回答是每个 bundle 一行、第二次回答指名了声明该模块的 bundle —— 两半都
在工作。

### 卸载

```
plugin_manager remove_bundle dsh-plugin-query-enhance
```

不会留下任何残留。`list_bundles` 恢复为回传完整表格。

---

## 用法

### 现在 list 类调用回传什么

动作本身没变，包括 `offset`、`limit`、`total` 与 `nextOffset`。只是每条记录更小。
bundle 长这样：

```json
{"entries":[{"name":"@deepseek-ai/dsh-web-app","version":"0.1.2-alpha.1","enabled":true,
"installed":false,"optional":false,"removable":false,"rowCount":85}],
"total":11,"nextOffset":null}
```

被去掉的字段，以及为什么可以去掉：

| 字段 | 为什么可以去掉 |
|---|---|
| `rows` | 大头。需要时用 `plugin_query includeRows=true` 指定单个 bundle 取回 |
| `description` | 包自带的说明文字，写给在包管理器里浏览的人看 |
| `meta` | 本地化标题、描述与图标路径，供 Web 客户端渲染；该路径本就不经过这里 |
| `overrides` | bundle 覆盖的内置行 id；已归结为 `overrideCount` |
| `error.diagnostic`、`error.incompatible` | 长文本失败详情。错误的 **code** 保留，因为决定下一步的是它 |

另有两个字段专门说明"被省略了什么"：`rowCount` 始终存在，使读者能区分"这个
bundle 不声明任何插件"和"这份回答把声明行藏起来了"；`overrideCount` 仅在确有覆盖
时出现。

插件条目长这样：

```json
{"entries":[{"entryId":"timer","moduleName":"@deepseek-ai/cordis-plugin-timer",
"enabled":true,"fiberPhase":"active"}],"total":187,"nextOffset":25}
```

摘要唯一丢弃的字段是 `patchId`：它是寻址该条目的 profile patch 行 id，没有任何
已文档化的操作以它为参数。`entryId` 保留，因为 `set_plugin` 收的就是它；
`readOnlyReason` 也保留，因为它解释了某个操作被拒绝的原因。

需要 id 去调 `set_plugin`？`plugin_query name="..." includeRows=true` 可以取回某个
bundle 声明的行，而 `list_plugins` 的摘要本身就是带 `entryId` 的。再多的内容 ——
完整的 bundle 记录、插件条目的 `patchId`、错误诊断 —— 只由 `plugin_query` 配合
`detail: "full"` 提供，那是唯一会返回完整记录的路径。

### `plugin_query`

只读，不接受任何会改变状态的参数，也不需要审批。

| 参数 | 适用范围 | 含义 |
|---|---|---|
| `kind` | 两者 | `"bundles"`（默认）或 `"plugins"`，后者查询单个插件条目 |
| `name` | bundles | 精确的 bundle 包名，例如 `@deepseek-ai/dsh-base` |
| `match` | 两者 | 不区分大小写的子串，匹配包名、描述，以及 bundle 声明行的模块名 |
| `enabled` | 两者 | 只保留保存的启用状态等于该值的记录 |
| `installed` | bundles | 只保留已安装状态等于该值的 bundle |
| `optional` | bundles | 只保留"出厂关闭、供用户自行开启"的 bundle |
| `hasError` | bundles | `true` 只保留加载失败的；`false` 只保留加载正常的 |
| `detail` | 两者 | `"summary"`（默认）或 `"full"`，后者是含描述与声明行的管理记录 |
| `includeRows` | bundles | 在摘要中一并带上声明的插件行 |
| `limit` | 两者 | 页大小，1 到 100，默认 **10** |
| `offset` | 两者 | 在**筛选后**结果中的零基偏移，默认 0 |

多个条件之间是 **AND**。`kind: "plugins"` 搭配 bundle 专用过滤器会报错，而不是被
静默忽略；`name` 或 `match` 传空串同样报错 —— 空过滤器会悄悄匹配一切，而这正是
本包要避免的结果。

每次回答都带 `total`（清单总量）、`matched`（通过筛选的数量）与 `nextOffset`。
`total`/`matched` 这组字段让"零结果"不再有歧义：`matched: 0` 而 `total: 11` 意味着
bundle 存在但被筛掉了，不必为了确认这一点再发一次不带条件的调用。

示例：

```
plugin_query name="@deepseek-ai/dsh-base"
plugin_query match="cordis-plugin-hmr"          # 哪个 bundle 声明了这个模块？
plugin_query enabled=false                        # 哪些是关闭的？
plugin_query hasError=true detail="full"          # 某个东西为什么加载失败？
plugin_query optional=true                        # 哪些是出厂关闭的？
plugin_query kind="plugins" enabled=false limit=50
```

---

## 配置

没有配置文件，也没有设置页。两项设置都在该 bundle 自己的 `cordis.patch.yml` 里，
由包导出的 `Config` schema 校验。改这里并重新安装该 bundle。

```yaml
- insert:
    - id: dsh-plugin-query-enhance
      name: 'dsh-plugin-query-enhance'
      config:
        intercept: true
        defaultDetail: summary
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `intercept` | `true` | 是否对 `plugin_manager list_bundles` 的结果做投影。设为 `false` 可保留工具但不再改写该动作的输出 |
| `defaultDetail` | `"summary"` | 调用未指定 `detail` 时 `plugin_query` 采用的详细级别 |

---

## 实现方式

两个扩展点，不 fork：

| 机制 | 扩展点 | 为什么选它 |
|---|---|---|
| 投影 | `tools/post-execute` | 工具运行时把它文档化为"转换结果"的位置，也是插件能触及的、唯一能改变模型从**另一个**工具收到什么的点。它同时覆盖两个 list action，因为调用方会挑哪一个无法预判 |
| 查询工具 | `ctx.tools.register()` 加 `pluginManager` 服务 | 新增工具不会与任何东西冲突；而该服务正是管理工具自己读取的来源 |

三个值得说明的取舍：

- **投影在做出任何判断之前先调用 `next()`**，即使是对它要改写的调用。一个不向下
  委托就返回决定的 waterfall 监听器会终止它身后整条链 —— 比如一个本该记录或拦截
  该调用的工具钩子插件。改写"整条链最终达成的决定"，并在别人已经替换结果时让位，
  才能保住其他插件的决定。
- **无法解析的载荷原样放行。** 一个跑不起来的投影必须对调用方零成本，绝不能破坏
  一次本来可用的管理调用。同一道护栏也覆盖未来改变信封结构的 Host。
- **工具用注册表实际校验的原始 JSON Schema 定义**，而不是走官方 `defineTool` 辅助
  函数。那个辅助函数住在 `@deepseek-ai/dsh-tools` 里，引入它会让本包绑死在某个
  Host 包的某个版本上：克隆下来要先联网解析依赖才能加载，Host 升级还可能让两份副本
  失去同步。注册表公开的契约是 `ctx.tools.register()`，而它接收的正是编译后的形式。
  代价是辅助函数本该安装的参数校验，改由这里手写并测试覆盖。

---

## 仓库边界

**这个仓库可以直接公开发布，而本节是让这句话可被检验、而不是一句声明的契约。**

### 提交什么

源码、测试、工具脚本、文档与元数据：

```
.gitattributes  .gitignore  LICENSE
README.md  README.en.md
package.json  cordis.patch.yml
icon.svg  locale/{en,zh}.json
lib/**                 插件本体
test/**                测试套件，无需安装即可运行
tools/verify-repo-boundary.mjs   下文所述的边界自查脚本
```

### 有意不提交什么

| 排除项 | 原因 |
|---|---|
| `DESIGN.md` | 内部工作稿。其中引用了撰写时所在机器的绝对目录，发布即泄露该机器的布局 |
| `node_modules/` | 可由 `package.json` 复现；在 diff 里只是噪声 |
| `package-lock.json`、`pnpm-lock.yaml`、`yarn.lock` | 安装由 DSH 的 `install_bundle`（pnpm）负责。多一份锁文件只会描述另一个解析器并造成漂移 |
| `*.bak`、`*.orig`、`*.rej`、`*.log` | 编辑与安装过程中留下的本地临时产物 |
| `config.json`、`plugin-data/`、`.env*`、`*.pem`、`*.key`、`.credentials.yaml` | 运行状态与凭据。本插件两样都没有，这些模式是第二道防线 |
| 编辑器与系统噪声（`.vscode/`、`.DS_Store`、`Thumbs.db` 等） | 不属于本项目 |

本项目不含任何密钥：它不保存账号、令牌或 API key，也不发起网络请求。

### 自己验证这条边界

```sh
npm run verify-boundary
```

`verify-boundary` 读取的是 **git 会发布的文件集合**（`git ls-files`），而不是工作
区：未被跟踪的本地文件正是这条边界要挡住的东西。它会报告机器相关的绝对路径、
凭据形态的文本、运行状态与异常大文件，并在发现任何问题时以非零码退出。每次推送
前运行一次。

---

## 开发

```sh
npm test        # 全部测试；无需安装
npm run verify-boundary
```

测试套件没有任何依赖，也没有副作用：它不碰文件系统、不联网、不接触 Host。这并非
偶然 —— `lib/config.js` 刻意不 import 任何东西，唯一的运行时依赖单独放在
`lib/schema.js`，因此测试所引入的模块都不需要解析依赖。只有当你想加载
`lib/index.js` 本身时，才需要 `npm install`。

结构与拆分理由：

| 文件 | 职责 |
|---|---|
| `lib/index.js` | 入口。接上 waterfall 监听器与工具，并负责拆除 |
| `lib/config.js` | 常量与生效设置。不引任何东西 |
| `lib/schema.js` | `Config` schema。唯一带依赖的文件 |
| `lib/shape.js` | 剥离展示元数据，两条机制共用 |
| `lib/project.js` | 机制一：把整份 list 载荷归结为摘要，两个 action 共用 |
| `lib/intercept.js` | 机制一：`tools/post-execute` 监听器 |
| `lib/filter.js` | 机制二：查询引擎 |
| `lib/tool.js` | 机制二：工具定义与参数契约 |

---

## 已知限制

- **无法扩展管理工具自身的 schema。** 插件不能给另一个插件注册的工具加参数，所以
  list 类调用只能被默认**瘦身**，无法被过滤。过滤是 `plugin_query` 的职责；投影是
  给"仍然伸手去够老工具"的调用方准备的兜底。
- **`list_plugins` 本来就被管理工具剥掉了一层。** 它在返回前已去掉展示元数据；
  投影在这里再去掉 `patchId` 并保持同一信封，所以收益真实但有限，大头仍然是
  `list_bundles`。
- **对声明行很多的 bundle，`detail: "full"` 依然很大。** 它按定义就是管理记录。用
  `match` 可以把行收窄到命中的那些，通常这才让它变得可负担。
- **若 `pluginManager` 服务不存在，`plugin_query` 不会出现。** 投影那一半照常工作，
  只是不注册该工具。可通过插件自身的 debug 日志区分这两种情况。
- **该工具会给每次请求增加一点固定开销。** 无论是否使用，它的 schema 与描述都会
  被发送。描述刻意写短正是为此；而投影那一半零开销。
- **没有设置页。** 两项设置都是行配置，在 `cordis.patch.yml` 中修改。加一个设置页
  意味着把字段标记为 volatile 并附带一个客户端半边，对两个布尔值来说动静太大。
- **投影是策略，不是过滤器。** 它决定的是"没有更好的问法时 `list_bundles` 回传
  什么"。`intercept: false` 可精确恢复原行为。

## 许可证

[MIT](LICENSE) © 2026 deadbushxw。
