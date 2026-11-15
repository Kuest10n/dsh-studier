# dsh-notara-menu-compat

让 Notara 侧栏会话菜单（置顶/重命名/分支/归档/恢复）在 DSH 0.2.2-rc.1 上恢复工作。

## 背景

Notara bundle（@oh-my-student/dsh-bundle 0.1.x）按 **DSH 0.2.1-rc.4** 的协议实现侧栏：
它从 slot `sidebar.workspaces.session.menu.item` 里找 `entry.options.id` 等于
`archive` / `pin` / `rename` / `fork` 的条目，取其 `inject` 对象调用里面的函数
（`archiveSession(id)` / `pinSession(id)` / `requestSessionRename(id, title)` /
`forkSession(id)` / `unarchiveSession(id)`）。

而 DSH 0.2.2-rc.1 的原生 UI 把会话菜单项迁移到了新的 `ctx.contextMenus` 协议
（`registerSessionMenus` → `ctx.contextMenus.register({id:"session.archive", target:"session", ...})`），
旧的 slot 里不再有这些 action entry。于是 Notara 的 `actions("archive")` 返回
undefined，属性访问同步抛 TypeError，被 Notara 自己的 catch 吞掉，表现为侧栏
红色提示「操作未完成，请重试。」——归档/置顶/重命名/分支全部失效。

本插件不修改任何上游文件，只在 client 半区向旧 slot 补回这 4 个 entry，
函数体直接调用原版 UI 注册的服务 `ctx.get("uiWorkspace")`（与原生 UI 同一实例），
所以行为与原生菜单一致（归档会同时取消置顶、归档当前会话会清空主引用）。

## 行为对照

| Notara 菜单项 | 本插件提供 | 实现 |
| --- | --- | --- |
| 归档会话 | `archiveSession(id)` | `uiWorkspace.archiveSession(id)`，session-active 拒绝时 console.warn（原版会弹「停止并归档」确认框，本插件省略确认，直接拒绝） |
| 恢复会话 | `unarchiveSession(id)` | `uiWorkspace.unarchiveSession(id)` |
| 置顶/取消置顶 | `pinSession` / `unpinSession` | `uiWorkspace.pinSession/unpinSession` |
| 重命名 | `requestSessionRename(id, currentTitle)` | **直接重命名**：`ctx.get("sessions").using(id, {source:"workspaceOperation"}, ref => ref.binding.session.rename(newTitle))`。注意：与原版不同，不弹确认对话框——Notara 传入的 `currentTitle` 被当作新标题直接提交（Notara 行 L400816 传的就是 `row2.renameTitle`）。若你想先改标题再点菜单，请先在输入框改名。 |
| 从这里分支 | `forkSession(id)` | `uiWorkspace.forkSession(id, () => {}, { allowMigration: false })` |

所有失败统一 `console.warn`；Notara 自己的 try/catch 仍会显示「操作未完成，请重试。」。

## 安装

作为 profile 依赖装入（与 dsh-studier-kit 同法）：

```powershell
# profile package.json deps 加
"dsh-notara-menu-compat": "link:E:/studier/dsh-notara-menu-compat"
# dsh.profile.bundles 加 "dsh-notara-menu-compat"
pnpm install --dir <profile 目录>
```

重启实例即生效。无 host 侧代码、无配置项、无副作用（只在 menus 打开时注入）。

## 文件

- `index.js` — client 插件（`dsh.client.platform = "web"`）
