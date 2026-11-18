# dsh-studier

**DSH 学习工作台插件**——把 DeepSeek Harness（DSH）变成一个围绕纸面学习闭环的个人学习系统：周考卷照片 → 逐题得分 → 错题归类 → 手写闪卡 → 间隔重做。

> 「插件做脚手架，不做大脑。」所有工具只读你的学习库（vault），绝不替你写错题本、绝不先看你的手写卡。

## 组成

| 包 | 说明 | 类型 |
| --- | --- | --- |
| [`dsh-studier-kit/`](dsh-studier-kit/) | 5 个只读学习工具：复习池 / 知识树体检 / 周考卷校验 / 动态间隔排期 / 知识图谱双态投影 | 自研 |
| [`dsh-notara-menu-compat/`](dsh-notara-menu-compat/) | 修复 Notara bundle 在 DSH 0.2.2-rc.1 下「无法归档对话」的兼容插件 | 自研 |
| `scripts/patch-vault-delete.mjs` | 补上 Notara bundle 缺失的「资料库文件删除」——后端 `delete` RPC + 前端删除按钮，对齐 pnpm store 全部副本（幂等，`--check/--apply/--reapply/--restore`） | 自研补丁 |
| `scripts/patch-notara-math.mjs` | 修 0.2.2-rc.1 双宿主 `math-adapter.mjs` web 分支漏 `wb()`（`mathFromMarkdown`）导致聊天里 `$...$` 整段消失；对齐 7 份副本 | 自研补丁 |
| `scripts/patch-presets-presentas.mjs` | 修 Notara presets 0.1.1 无条件调 `ctx.tools.presentAs`（DSH 0.2.2 已移除）导致教学子会话/团队通道报 TypeError；改为条件调用 | 自研补丁 |
| [`scripts/`](scripts/) | `repair.mjs`（一键修复/体检，六步自动打以上三个补丁）、`install.ps1`（安装+体检）、桌面启动器 `launch.ps1` / `stop.ps1` + 图标、三个补丁的回归测试 | 自研 |
| [`profile.package.json.example`](profile.package.json.example) | 独立瘦身 DSH web 实例的 profile 清单模板 | 配置样例 |

与 [Notara-DSH](https://github.com/TongZi2003/Notara-DSH)（@oh-my-student/dsh-bundle）配合使用——本仓库**不含** Notara 本体，只含自研增量与适配层。Notara 提供资料工作台 / 图谱 / 日历 / 课堂计时；dsh-studier 在其上补调度、投影与周考链路。

## 五个工具（dsh-studier-kit 1.x）

| 工具 | 功能 |
| --- | --- |
| `studier_review_pool` | 复习候选池：错题（★ 或 不会/半会）+ 知识树节点（done 且 不会/半会），按 高频 → 失分 → 被依赖 排序；AI 生成且未核对的节点不进池 |
| `studier_tree_status` | 知识树健康投影：分布统计、未核对节点、悬空 prereq/source_question 双链、错题 kp 断链 |
| `studier_intake_check` | 周考卷得分表逐行重算（Σ满分/Σ实得/rate/★行数）与 frontmatter 声明值比对；实得留空的题不进分母；取值域校验 |
| `studier_schedule` | 动态间隔排期：不会=1天 / 半会=3天起每次+2封顶7 / 会=7→14→21 扩张；★ 隔周重做只排周六；四桶输出（今天到期/窗口内/窗口外/从未复习） |
| `studier_graph_map` | 知识图谱双态投影：虚态（考纲权重×频次×被依赖数）× 实态（掌握状态×失分），透明排序规则，输出优先复习队列 |

配套 6 个周考 skill（weekend-intake / kp-classify / math-tutor / card-judge / weekly-plan / peer-test）见 `dsh-instance/skills/`——属个人学习内容，不随本仓库分发，可按自己学习库定制。

## 快速开始

前置：Node ≥ 24、pnpm ≥ 10、一个 DSH 0.2.2-rc.1 实例（`$DSH_HOME` 指向独立目录）。

```powershell
# 1. 克隆并安装 Notara bundle（另见 https://github.com/TongZi2003/Notara-DSH）
git clone https://github.com/<you>/dsh-studier.git
cd dsh-studier

# 2. profile 配置：复制 profile.package.json.example 到 $DSH_HOME\profiles\web\package.json
#    按注释改 file:/link: 路径后 pnpm install

# 3. 一键体检/修复（六步：缺件修补 + junction + host-adapter〔先修正 math-adapter 源〕 + skills 校验 + 三个兼容补丁，幂等）
#    重装 / 升级宿主后重跑一次即可
node scripts/repair.mjs

# 4. 启动
powershell -File scripts/launch.ps1
```

### vault（学习库）约定

工具读取一个 Obsidian 风格四层库：

```
vault/
├── 00资料/
├── 10知识/
│   ├── 知识树/     # 节点 md：frontmatter id/name/type/freq/status/self_state/prereq…
│   ├── 错题本/     # 错题 md：score_full/score_got/self_state/star/kp 双链/wrong_reason
│   └── 卡片/       # <kp-id>.my.md（手写）/.ai.md（AI）/ .verdict.md（本人判）
├── 20经验/
├── 30模式/
├── 40周任务表/
└── 50指标/         # 周考得分表：| 题号 | 满分 | 实得 | 三态 | ★ | …
```

vault 根路径写在 `$DSH_HOME\cordis.patch.yml`（同 id 覆盖 notara-vault-sqlite 行）：

```yaml
- insert:
    - id: notara-vault-sqlite
      name: '@oh-my-student/plugin-vault-sqlite'
      config:
        root: 'E:\your\vault'
```

## 自检

```powershell
cd dsh-studier-kit
pnpm test        # 34 项回归（fixture vault，不碰真实数据）
npm run self-test  # 真实 vault 冒烟（形状契约 + 不抛错）

# 三个补丁的体检与回归（在仓库根目录）
node scripts/patch-vault-delete.mjs --check          # 资料库删除：全副本 applied
node scripts/test-vault-delete.mjs                  # 删除 RPC fixture：15 项
node scripts/patch-notara-math.mjs --check          # LaTeX：7 份 math-adapter 源已修
node scripts/patch-presets-presentas.mjs --check   # presentAs：3 份 policy.js 已修
node scripts/test-presets-presentas.mjs             # presentAs 单元：8 项
node scripts/repair.mjs --check                    # 实例六步体检（应报「全部已就绪」）
```

## 已知边界与设计红线

- **手写不可外包**：`.my.md` 与错题本「我的错因/正确思路」段永远本人手写，工具只判文件存在性、绝不读正文。
- **双证据判会**：卡片比对通过 + 原题重做正确，两条证据齐了才允许 `self_state=会`。
- **插件做脚手架不做大脑**：排期建议透明可解释（阶梯规则公开），不写自适应算法，决策在人。
- 目标宿主 = `@deepseek-ai/dsh 0.2.2-rc.1`；Notara 子包 0.1.1 peer 钉 0.2.1-rc.4，需 `dsh plugin allow-version` 授 7 项豁免（install.ps1 自动做）。

## License

MIT — 任意使用。
