# Orca remote-client terminal rendering — diagnosis + candidate fix

**Bug:** terminals created on the host (via `orca terminal create` / `terminal split`,
or programmatically by a sub-agent spawner) never appear on the remote client.
Locally they render fine; the remote sees none of them.

**Repo:** `stablyai/orca` (public, MIT) → local clone at `/home/dev/orca-src`.
**Probed:** 2026-09-16, against `main` @ `eaddccf`.
**Status:** candidate patch APPLIED in `src/main/runtime/orca-runtime.ts` —
`pnpm run typecheck:node` and `oxlint` both clean. Not yet runtime-verified
against a live remote client (see "What I could NOT verify").

---

## Root cause

There are **two parallel session models** for terminals:

| Store | Owner | Written by | Read by |
| --- | --- | --- | --- |
| `session.tabsByWorktree` | `Store` (`src/main/persistence.ts`) | the **renderer** via `session:set` / `session:patch` IPC (`src/main/ipc/session.ts`) | `exportRemoteWorkspaceSession` → the remote snapshot |
| `mobileSessionTabsByWorktree` | `OrcaRuntime` (`src/main/runtime/orca-runtime.ts:2119`) | `publishPtyBackedMobileSessionTerminal` (main) | the mobile/headless session surface |

A terminal created **in the app** goes through the renderer: the renderer adds a
`TerminalTab` to its zustand store (`useAppStore.tabsByWorktree`), which persists
to `Store` via `session:patch`, which `exportRemoteWorkspaceSession` then
projects into `tabsByWorktreePath` for the remote.

A terminal created **on the host** (CLI / sub-agent / headless) takes the
*background* branch of `OrcaRuntime.createTerminal`
(`src/main/runtime/orca-runtime.ts:17412`):

```ts
const shouldCreateInBackground =
  worktreeSelector !== undefined &&
  ((!requiresRendererFocus && opts.rendererBacked !== true) ||
    (opts.rendererBacked === true && rendererWindow === null))
```

`rendererBacked !== true` → `shouldCreateInBackground` → the PTY is spawned
directly in main via `ptyController.spawn`, then published **only** to
`mobileSessionTabsByWorktree` via `publishPtyBackedMobileSessionTerminal`
(`:17570`). It never enters `session.tabsByWorktree` — there's no renderer to
write it, and the background path doesn't patch the workspace session itself.

`exportRemoteWorkspaceSession` (`src/shared/remote-workspace-session-projection.ts`)
reads **only** `session.tabsByWorktree` → so the host-created terminal is
invisible to the remote projection → the remote client renders nothing.

**In short:** host-created terminals are written to the mobile-session store but
not the workspace-session store, and the remote projection only reads the latter.

---

## The fix (applied)

When a host-created terminal is spawned in the background, also write a
`TerminalTab` into `session.tabsByWorktree` so `exportRemoteWorkspaceSession`
picks it up. Applied in `src/main/runtime/orca-runtime.ts`:

1. Added `patchWorkspaceSession?: Store['patchWorkspaceSession']` to
   `RuntimeStore` (`:820`) — it previously exposed only `get`/`set`.
2. Added `recordHostTerminalInWorkspaceSession(worktreeId, {tabId, ptyId,
   title, startupCwd, launchAgent})` (`:3636`) — appends a `TerminalTab` to
   `tabsByWorktree[worktreeId]` via `store.patchWorkspaceSession`, idempotent
   (skips when the tabId is already present, e.g. a renderer adopted it).
3. Called it in `createTerminal`'s background branch (`:17638`), right after
   `publishPtyBackedMobileSessionTerminal`, guarded on `pty`.

Verified: `pnpm run typecheck:node` clean, `oxlint` clean.

Notes on the patch:

- `tabsByWorktree` patches go through the full-normalization path
  (`workspaceSessionPatchNeedsFullNormalization` → `setWorkspaceSession`), which
  applies the stale-PTY protections — good, that's the correct write path.
- `sortOrder` must be the next index for that worktree's tab list (append).
- `id` should be the `tabId` minted earlier in the function (already a UUID).
- Guard on the tab not already being present (idempotent — a renderer-backed
  create may have already written it).

## What I could NOT verify (needs a remote client)

I confirmed the *host* side end-to-end: a background spawn writes to
`mobileSessionTabsByWorktree` and not `tabsByWorktree`, and
`exportRemoteWorkspaceSession` only reads the latter. What I can't confirm
without a live remote client attached to this host:

1. **That the remote actually renders `tabsByWorktree` terminals.** The
   projection exports them; whether the remote's renderer instantiates a PTY
   view for a host-created `ptyId` is a client-side question. If the remote
   needs the PTY to be *reachable* (not just listed), the fix may also need the
   terminal's stream to be exposed to the remote — a second, separate step.
2. **Whether the remote treats host-created vs renderer-created tabs
   differently** in its own session store.

So: the patch above fixes the *export* gap — the terminal now appears in the
remote's workspace snapshot. Whether the remote then *renders* it is the part to
verify on your Windows client in the morning. If it still doesn't render after
the tab lands in the snapshot, the next place to look is the remote's
terminal-instantiation path (does it lazily create a PTY view for each
`tabsByWorktreePath` entry, or only for ones it created itself).

## Suggested verification once you're at the remote

1. Build/run the patched host (`pnpm dev`), connect the remote client.
2. `orca terminal create` on the host → check the remote's workspace snapshot
   now contains the tab (`tabsByWorktreePath[<path>]` has a new entry).
3. If the tab is in the snapshot but nothing renders → the gap is remote-side
   PTY instantiation, not export. If it renders → done.
