# dsh-peach-persona ·「人设」

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）加一个设置页：**分段配置 agent 的人设**，并记录每一次注入。

- 设置 → **人设**：12 个字段，分「身份 / 说话方式 / 行为准则」三组
- 保存后渲染成一段人设正文，作为系统提示词的一段注入到每次请求
- **注入记录**：哪一次真的注入过、多少字、什么时间——"到底生效没有"不用再猜
- **看最终长什么样**：不保存也能预览渲染结果

> 出厂**不带任何人设**。12 个字段默认为空，内容全由使用者自己填。

---

## 装

### 前提

- DSH 桌面版或 `dsh web` 版
- 知道自己的 profile 名（桌面版是 `desktop`）

### 步骤

```powershell
# 1) 拿到源码（放哪都行，下面路径只是示例）
git clone https://github.com/clf0913/dsh-peach-persona.git "$env:USERPROFILE\.dsh\plugins\dsh-peach-persona"

# 2) 以本地 link 方式装进 profile
#    dsh.cmd 的路径按你的安装位置替换
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "link:$env:USERPROFILE\.dsh\plugins\dsh-peach-persona"

# 3) 重启应用（必须）
```

> **装完必须重启应用。** DSH 的 HMR 会把新 bundle 热挂进组成树，但插件自身的 JS 模块不会热加载。
> 上面这些命令是在 Windows 桌面版上验证过的形态；Linux / macOS 没有验证过。

## 第一次用

1. **设置 → 人设**
2. 12 个字段都是空的，填你自己的
3. 最省事的起手：先填 **名字**、**对你的称呼**、**共事约定**，其余留空也行（空字段整行省略）
4. 点「看最终长什么样」预览，再点**保存**
5. **下一回合生效**（正在跑的那一步不会变）
6. 想确认真的生效了：看底部**注入记录**，有记录就是真的装配过

## 字段

| 组 | 字段 | 说明 |
|---|---|---|
| 身份 | 名字 | 它会把自己叫这个名字 |
| 身份 | 简称 | 留空就不提简称 |
| 身份 | 对你的称呼 | 它怎么称呼你 |
| 身份 | 自称 | 跟你说话时它用哪个词指代自己（我 / 本人 / 俺）；名字是「别人怎么指代它」，两件事 |
| 身份 | 关系定位 | 接在「是」后面，如「你的工作搭子」 |
| 身份 | 语言 | 留空则整行省略 |
| 说话方式 | 说话基调 | 语气、要不要奉承、用不用语气词 |
| 说话方式 | 篇幅 | 回话长度和信息密度 |
| 说话方式 | 分歧时怎么办 | 它不同意你时怎么做 |
| 行为准则 | 小块标题 | 留空则无标题行 |
| 行为准则 | 共事约定 | 一条一行，建议自己编号 |
| 行为准则 | 禁忌 / 不做什么 | 留空则整段省略 |

字段族参考了两处公开资料：[Character Card V2 规范](https://github.com/bradennapier/character-cards-v2/blob/main/data.md)（name / description / personality / system_prompt / post_history_instructions）与 ChatGPT custom instructions 的「关于你 + 该怎么回答」两分法。

## 文件都在哪

以 `$DSH_HOME`（通常 `~/.dsh`）为根：

| 路径 | 内容 |
|---|---|
| `persona/persona.json` | 字段表，**编辑源**，设置页读写它 |
| `persona/persona.md` | 由字段渲染出来的**产物**，注入只读它 |
| `persona/persona.md.bak` | 每次保存前的上一版 |
| `persona/growth.md` | **成长记录**：跟使用者相处中学到的东西，独立注入（上限 4000 字） |
| `persona/state.json` | 表单锁定状态 `{ locked, lockedAt }` |
| `persona/inject.jsonl` | 注入记录（只在渲染文本变化时追加一行） |

`persona.md` 中间那个 `---` 行是分段约定：前段进系统提示词开头（人设前缀位），后段进第一方指导之后（相当于"最后说的话"）。

## 成长记录（跟人设分开的一份）

`persona/growth.md` 是**第三块**提示词内容，注册成独立段 `peach:growth`（order 3，上限 4000 字），跟人设分开：

- **人设**（`persona.md`）回答"你是谁"——名字、称呼、语气、行为准则，改一次基本不动。
- **成长**（`growth.md`）回答"相处中学到了什么"——使用者的偏好、踩过的坑、说话习惯，可以一直追加。

这样两者互不污染：调语气不必动成长记录，加一条经验也不必重写人设。

### 谁能写进去：提议 → 采纳

成长段**不是** agent 想加就加的。写入分两条路：

1. **人自己加**：设置页里直接输入一条，或手改 `growth.md`（一行一条 `- xxx`）。立即生效。
2. **agent 提议**：agent 把候选写进 `persona/growth-pending.jsonl`（一行一个 JSON：`{"text": "...", "reason": "..."}`），
   这条**只出现在设置页的「待确认」区，不会被注入**。使用者点「采纳」它才搬进 `growth.md`；点「丢弃」就删掉。

> 这条设计的用意：让 agent 能提出"我学到了什么"，但不能自己给自己加规矩。

### 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/growth/add` | 直接加一条（`{text}`） |
| POST | `/growth/delete` | 删一条（`{text}` 精确匹配） |
| POST | `/growth/approve` | 采纳一条提议（`{id}`），id 由内容算出 |
| POST | `/growth/reject` | 丢弃一条提议（`{id}`） |

`GET /state` 返回的 `growth` 里有 `entries`（已采纳）、`pending`（待确认）、`chars` / `max`（字数与上限）。

**上限是硬的**：超过 4000 字的部分会被**静默截断**——不注入、也不报错。所以一条写一件事，别攒流水账。

## 锁定表单

设计定型之后，可以在设置页把表单**锁定**：表单收起，只留「重新编辑」和成长记录。
状态存在 `persona/state.json`（`{ "locked": true, "lockedAt": "..." }`），对应接口 `POST /lock` 与 `POST /unlock`。

锁定只影响界面，不改注入行为——锁着照样注入，人设该怎么生效还是怎么生效。想改字段就点「重新编辑」。

## 实现要点（二次开发的人会关心）

- 注入走 `systemPrompt.section()`，注册三段：`peach:persona`（order 1）、`peach:growth`（order 3）、`peach:persona-tail`（order 10201）。
- **必须声明 `export const inject = ['systemPrompt', 'webServer']`。**
  `ctx.get(name)` 只回答"此刻有没有"，**不会等**。不写 `inject` 的话，装包时靠 HMR 在已运行的树上激活能正常工作，冷启动时服务还没就绪 → 人设段和 HTTP 路由一起静默消失，而且没有任何报错。
- 渲染对空字段整行省略，所以"什么都没填"等于"什么都不注入"，不会渲染出「你是，是……」这类残句。
- 正文里的 `{{model}}` / `{{provider}}` / `{{cwd}}` 是宿主已注册的模板变量，原样保留；**其他 `{{xxx}}` 会降级成 `{xxx}`**——未注册的变量会让整轮渲染抛错。
- 保存是「临时文件 + rename」原子写，覆盖前留 `.bak`。

## 测试

自带测试，不依赖任何第三方库，不需要运行中的 DSH，也不碰你真实的 `~/.dsh`（临时目录建在系统 temp 下，跑完删掉）。路径全部相对本包推导，换机器、换目录都能跑。

```bash
node test/run.mjs            # 一次跑完
node test/render.mjs         # 渲染器契约：空就是空、名字 ≠ 自称、空字段整行省略
node test/smoke-host.mjs     # 宿主冒烟：假 ctx 跑通提示词段注册 + HTTP 接口 + 全新安装
node test/check-release.mjs  # 发布检查：清单/补丁/本地化/图标/默认全空/不泄漏作者人设
```

**装插件不需要这些文件**——删掉 `test/` 不影响插件运行，它们只是给想验证或二次开发的人看的。

`check-release.mjs` 里有一条 `no author persona strings shipped`：扫描整个包有没有作者自己的名字或自称。fork 后想加默认人设的话，先想清楚——那会一起发给所有使用者。

## 卸载

```powershell
& "<dsh.cmd 路径>" plugin --profile desktop remove dsh-peach-persona
```

`remove` 子命令的写法以你的 DSH 版本为准。手动兜底：从 `profiles/<profile>/package.json` 的 `dependencies` 和 `dsh.profile.bundles` 里各删掉一行，再删 `profiles/<profile>/node_modules/dsh-peach-persona`，然后重启。

## 它只管人设，不管你的记忆

**这个插件不依赖、也不假设你用什么记忆系统。** 它管三件事：人设字段、成长记录、注入记录。装在干净的机器上，功能照样完整——只是成长记录从零开始积累。

如果你已经在用别的记忆插件（笔记、知识库、日志，什么格式都行），可以**手动连上去**，只为一个用处：**新增成长记录时帮你查重**，免得同一件事记两遍。

### 怎么连

1. 设置 → 人设 → 成长记录 → 点「**探测本机记忆**」
2. 它会去找几个常见位置（`$DSH_HOME/memory`、`$DSH_HOME/memories`），列出**候选**——不点「连接」它一个字节都不会读
3. 连上之后，你新增一条成长时会先查重；命中就停下来问「仍然添加 / 算了」

连不上、没有、或者你不想连，界面就显示「未连接」，**不报错、不空转**。

### 想接别的位置？

连接记录存在 `persona/memory-sources.json`，格式就是：

```json
{ "sources": [ { "path": "D:\\我的记忆库", "label": "工作笔记", "kind": "markdown" } ] }
```

指向任何**含 markdown 的目录**即可（递归两层，单文件 ≤512 KB，最多 300 个文件）。查重只看行级相似度，**不会改你的记忆文件**。

### 更好的做法：让你的 agent 来提炼

真正需要"跨记忆源思考"的是 agent，不是插件。所以最省事的接法是：

> 告诉你的 agent：「你有空读一下我的记忆文件，发现有价值的模式就写进 `persona/growth-pending.jsonl`，我确认后再进成长记录。」

插件只负责"接收提议 + 让人拍板"，它永远不需要知道你记忆系统的格式。

## 已知限制

- 只对提供 `webServer` 服务的 profile（`web` / `desktop`）生效
- 人设是**全局一份**，不按工作区区分；要"不同项目不同人格"，请用工作区各自的 `AGENTS.md`
- 手改 `persona.md` 不会回写到字段表；页面会提示"文件被外部改过"，你一保存就会按字段覆盖它
- **不提供记忆功能**：不做检索、不做归档、不做待办。那些交给专门的记忆插件，本插件只通过 `memory-sources.json` 做查重
- 外部记忆查重是**朴素的行级相似度**（CJK 二元组 + 英文词，命中 ≥3 个 token），会漏也会误报——它是提醒，不是判据
- 仅在 Windows 桌面版上实际验证过

## License

[MIT](LICENSE)
