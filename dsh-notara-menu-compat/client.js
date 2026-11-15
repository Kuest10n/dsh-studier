/**
 * dsh-notara-menu-compat — client half.
 *
 * Re-provides the four session-menu action entries that Notara's sidebar
 * expects in slot "sidebar.workspaces.session.menu.item" under the old
 * (0.2.1-rc.4) protocol. DSH 0.2.2-rc.1 moved these actions to
 * ctx.contextMenus, so Notara's actions(id) lookup
 *   entries(slot).find(e => e.options.id === id)?.inject?.()
 * returns undefined and every menu action dies with "操作未完成，请重试。".
 *
 * Client entries are served through the web boot ModuleLoader: the file must
 * register itself with window.__ModuleLoader__.load({id, factory}) and return
 * the plugin object from the factory (same shape as every @oh-my-student and
 * @deepseek-ai client bundle).
 *
 * Contract per the slots service (dsh-client-ui-slots lib/index.js):
 *  - entry.options is built ONLY from top-level register fields
 *    (key/id/order/label/priority/...) — so options.id === register options.id;
 *  - a "list" slot requires options.id and uniqueness per priority;
 *  - inject is stored as-is and Notara CALLS it (`inject?.()`), so inject must
 *    be a factory function returning the action object (same as the native
 *    archiveInjected/pinInjected/... factories);
 *  - every entry needs a component (renderEntry does jsx(Comp) with no null
 *    guard) — a noop `() => null` is enough because Notara never renders these
 *    entries, it only reads entry.inject.
 *
 * All functions delegate to the same UiWorkspaceService instance the native
 * UI registered, so behaviour (unpin-on-archive, clearMain, pin conflicts)
 * matches the native menus exactly.
 */

window.__ModuleLoader__.load({
  id: "dsh-notara-menu-compat",
  factory(require) {
    const SLOT = "sidebar.workspaces.session.menu.item";

    const warn = (what) => (reason) => {
      try {
        console.warn(`[dsh-notara-menu-compat] ${what} failed:`, reason);
      } catch {
        /* console unavailable */
      }
    };

    const plugin = {
      name: "dsh-notara-menu-compat",
      inject: ["slots", "uiWorkspace", "sessions", "workspaces"],
      apply(ctx) {
        const uiWorkspace = () => {
          const svc = ctx.get("uiWorkspace");
          if (!svc) throw new Error("uiWorkspace service unavailable");
          return svc;
        };

        const sessions = () => {
          const svc = ctx.get("sessions");
          if (!svc) throw new Error("sessions service unavailable");
          return svc;
        };

        /** Direct rename (no dialog): mirror of the native renameSession hop. */
        async function renameSession(sessionId, title) {
          const result = await sessions().using(
            sessionId,
            { source: "workspaceOperation" },
            (reference) => reference.binding.session.rename(title)
          );
          if (!result.ok) throw new Error(result.error?.message ?? "rename failed");
        }

        // Inject factories — Notara invokes them: actions(id)?.inject?.()
        const archiveInjected = () => ({
          archiveSession: (sessionId) => {
            try {
              uiWorkspace().archiveSession(sessionId).catch(warn("archive"));
            } catch (reason) {
              warn("archive")(reason);
            }
          },
          unarchiveSession: async (sessionId) => {
            await uiWorkspace().unarchiveSession(sessionId);
          },
        });
        const pinInjected = () => ({
          pinSession: (sessionId) => {
            try {
              uiWorkspace().pinSession(sessionId).catch(warn("pin"));
            } catch (reason) {
              warn("pin")(reason);
            }
          },
          unpinSession: (sessionId) => {
            try {
              uiWorkspace().unpinSession(sessionId).catch(warn("unpin"));
            } catch (reason) {
              warn("unpin")(reason);
            }
          },
        });
        const renameInjected = () => ({
          requestSessionRename: async (sessionId, currentTitle) => {
            const next = typeof currentTitle === "string" ? currentTitle.trim() : "";
            if (!next) throw new Error("rename skipped: empty title");
            await renameSession(sessionId, next);
          },
        });
        const forkInjected = () => ({
          forkSession: (sessionId) => {
            try {
              uiWorkspace()
                .forkSession(sessionId, () => {}, { allowMigration: false })
                .catch(warn("fork"));
            } catch (reason) {
              warn("fork")(reason);
            }
          },
        });

        const noop = () => null;
        ctx.slots.inject(SLOT, function* () {
          yield ctx.slots.register({
            name: SLOT,
            id: "archive",
            order: 600,
            inject: archiveInjected,
          }, noop);
          yield ctx.slots.register({
            name: SLOT,
            id: "pin",
            order: 100,
            inject: pinInjected,
          }, noop);
          yield ctx.slots.register({
            name: SLOT,
            id: "rename",
            order: 200,
            inject: renameInjected,
          }, noop);
          yield ctx.slots.register({
            name: SLOT,
            id: "fork",
            order: 300,
            inject: forkInjected,
          }, noop);
        });
      },
    };

    return plugin;
  },
});
