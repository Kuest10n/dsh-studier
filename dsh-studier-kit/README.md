# dsh-studier-kit

studier 学习系统的 DSH 工具组。5 个**只读**工具，把 `vault`（四层 Markdown 学习库）的现状投影给会话内 Agent。

一句话定位：**工具做脚手架，不做大脑** —— 不排期、不出题、不判会、不发明复习间隔、不改任何文件；一切决策留给会话 Agent 与本人。

- 形态：DSH bundle（`dsh.bundle.patch` → `cordis.patch.yml`），纯 ESM、零第三方依赖、`inject = ['tools']`
- 宿主：`@deepseek-ai/dsh` 0.2.2-rc.x
- 铁律：只读。错题本的「我的错因 / 正确思路」永远只由本人手写（vault 手写纪律）

## 五个工具

### 1. `studier_review_pool` —— 复习候选池
- 输入：`subject?`、`limit?`（默认 40）
- 池子：错题本 `star==true` 或 `self_state ∈ {半会, 不会}`；知识树 `status==done` 且 `self_state ∈ {半会, 不会}`（**复习池只从 done 挑**）
- 排序：`freq(high→low) → 失分多 → prereq 被引用多 → 日期新`（透明规则，不是自适应算法）
- 附带：`review_count` / `last_review` / kp 双链 / 失分归点 / **卡片就绪度**
- 排除并计数：`authority=ai-generated 且 needs_review=true` 的未核对节点

### 2. `studier_schedule` —— 动态间隔排期
- 输入：`horizon_days?`（默认 7）
- 四桶：`due_today`（今天到期，按逾期天数降序）/ `upcoming`（窗口内）/ `later`（窗口外更晚，**不静默丢弃**）/ `never_reviewed`
- 阶梯（公开、可改）：`不会 = 1 天`；`半会 = 3 + 2×review_count，封顶 7`；`会 = 7 → 14 → 21 → 21`；★ 错题只排周六
- 输出的是**建议值**，排期决策在会话里定；不写 `40周任务表`

### 3. `studier_graph_map` —— 知识图谱双态投影
- 虚态：`authority`（考纲/教材/ai-generated）、`freq`（高考频次）、`prereq_in`（被多少节点当作先修）
- 实态：`status` / `self_state` + 错题本 kp 双链聚合出的 `wrong_count` / `lost_total`
- 复习队列只含**已开始**节点（learning/done）；`status=todo` 的高频节点单列 `not_started`，不混层
- 输出 `priority_queue` / `not_started` / `edges`（prereq 边表）/ `dangling`（悬空双链）

### 4. `studier_tree_status` —— 知识树健康投影
- 输入：`subject?`
- 分布：status / self_state / freq / type / authority
- 结构问题：未核对 ai 节点、悬空 prereq / source_question 双链、错题 kp 断链
- 没有 `id`/`name` 的 md（索引页、笔记页）计入 `skipped_files`，不当节点也不静默吞掉

### 5. `studier_intake_check` —— 周考得分表一致性校验
- 无参数；扫描 `50指标/`（跳过 `_` 前缀）
- 逐份用表格重算 Σ满分 / Σ实得 / rate / ★行数，与 frontmatter 比对（rate 容差 0.005）
- 不猜分：**实得留空的题不进分母**，并单列进 `pending_rows` 留给归类轮问本人
- 结构校验：列数不足 8 列的行、三态（会/半会/不会）与错因类型（知识/执行/熟练）取值写错，都报警

### 卡片就绪度（三个工具都带）
只看 `10知识\卡片\` 下 `<kp-id>.my.md` / `.ai.md` / `.verdict.md` **是否存在**，绝不读正文 —— 读了就等于把「回忆」偷换成「认读」。
`ready = 手写 && AI` 才表示这张卡能进「比对」；判会仍要双证据（卡比对 + 原题重做正确）。

## 安装

本机已验证的路径是**独立的 studier 实例**（`E:\studier\dsh-instance`，见那里的 README）。

1. profile 的 `package.json` 依赖加：`"dsh-studier-kit": "link:E:/studier/dsh-studier-kit"`
2. 同文件 `dsh.profile.bundles` 数组加 `"dsh-studier-kit"`
3. profile 目录跑 `pnpm install`
4. 重启实例（bundle 在启动时 apply）

**vault 路径怎么配**（优先级从低到高：bundles → profile → `$DSH_HOME`）：

- 插件自带 `cordis.patch.yml` 里的 `config.vaultRoot`；
- 或在 `$DSH_HOME\cordis.patch.yml` 写同 id 整行覆盖：

```yaml
- insert:
    - id: dsh-studier-kit
      name: 'dsh-studier-kit'
      config:
        vaultRoot: 'E:\studier\vault'
```

配错（路径不存在 / 不是目录）时，5 个工具都返回 `ok:false` + `vault_missing` / `vault_not_directory` + 一句改配置的提示，不抛栈。

## 自检（改完必跑）

```powershell
cd E:\studier\dsh-studier-kit
node test\run-tests.mjs      # 34 项断言：临时 fixture vault 验规则（不碰真实 vault）
node test\lint-skills.mjs    # 6 个 SKILL.md 的 frontmatter + 运行时 junction 指向
node scripts\self-test.mjs   # 对真实 vault 冒烟：工具形状契约 + execute 不抛错
npm run check                # 上面三条一起跑
```

真实 vault 目前是模板态（错题本 / 指标表只有 `_模板.md`），空数据只能证明「不崩」。**规则正确性靠 fixture**：★ 排周六、半会阶梯封顶、到期日=今天、实得留空不进分母、列数不足、取值域、未核对节点不进池、卡片三件就绪度、vault 配错给提示。

## 设计边界（不做）

- 不写 vault 任何文件（周复盘只出文本，落盘由本人决定）
- 不接 mastery / 确定性引擎，不做 client UI，不做自动判会编排
- 不碰 `.my.md` / `.verdict.md` 的语义；只按 frontmatter 与表格结构读

## 契约出处

`apply(ctx, config)`、`inject`、工具对象形状（含 `output.schema` / `output.render`）对照本机实跑插件 `dsh-video-read` 核实；
bundle / patch 层叠语义对照 Notara-DSH 双宿主包（0.2.1-rc.4 / 0.2.2-rc.1）核实。

> 关键机制：**`output.render` 返回的文本就是模型读到的工具结果**。写成一行摘要，模型就「看不见」细节 —— 所以 5 个工具都输出多段完整报告。

## License

MIT（见 [LICENSE](LICENSE)）。
