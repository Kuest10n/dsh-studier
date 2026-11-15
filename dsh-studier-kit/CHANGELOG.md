# 变更记录

## 1.0.0（2026-11-15）首个可发布版本

最小可发布形态：5 个只读工具 + 6 个周考链路 skill + 独立实例的一键体检/修复。

- 工具：`studier_review_pool`（复习池 + 卡片就绪度）、`studier_schedule`（四桶排期）、`studier_graph_map`（双态图谱）、
  `studier_tree_status`（结构健康）、`studier_intake_check`（得分表一致性）
- 加固：vault 路径配错返回 `vault_missing` / `vault_not_directory` 而非抛栈；无 `id`/`name` 的 md 计入 `skipped_files`；
  三态 / 错因类型取值域校验；`scanned` 拆成 `知识树文件` / `知识树节点` / `知识树跳过`
- 回归：34 项断言（fixture vault），另 6 个 skill 的 frontmatter 与 junction 体检、真实 vault 冒烟
- 文档：README 重写为发布口径（安装 / 配置 / 自检 / 设计边界）

## 0.2.2（2026-11-15）
- 桌面启动器（`launch.ps1` / `stop.ps1` / 图标）与三个兜底修复，详见 `dsh-instance/README.md` 变更记录

## 0.2.1（2026-11-15）
- 卡片就绪度接入复习池 / 排期 / 图谱（只看文件存在性，不读正文）；`studier-peer-test` 先查就绪度再判会

## 0.2.0（2026-11-15）
- 修 5 个真 bug：`toNum('')===0` 让主指标算错；未核对 ai 节点进池；排期超窗条目静默消失；
  图谱把 `status=todo` 混进复习队列；得分表列数不足的行被静默丢弃
- 新增回归测试（fixture vault）、skill 体检、实例一键体检/修复脚本

## 0.1.0（2026-11-14）
- 首个可用版本：3 工具（复习池 / 知识树状态 / 得分表校验）+ 周考链路 skills
