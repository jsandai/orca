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

**Profile already copied** to `~/.config/orca-dev` (8.8MB — settings,
workspaces, and the pairing credentials `orca-devices.json` +
`orca-e2ee-keypair.json`, perms preserved). You do NOT need to re-pair the
remote — the device token + E2EE keypair came across as a matched set.

**One thing to handle: the websocket port.** The remote client connects to
`ws://<host>:6768` (default, with a persisted fallback). Both the installed
Orca and the dev build want that port, and `orca-runtime.json` (the runtime
pointer) is rewritten per launch — whichever binds 6768 is what your remote
client reaches. So:

1. **Quit the installed Orca** (or it holds 6768 and the remote hits the
   unpatched app).
2. Run the patched build: `cd /home/dev/orca-src && pnpm start`
   (uses `~/.config/orca-dev`, serves the remote on 6768).
3. On the host, `orca terminal create` (or spawn a pi subagent).
4. On the remote, check whether the terminal appears.

**Reading the result:**
- Terminal renders on remote → done, the export gap was the whole bug.
- Terminal is in the remote's `tabsByWorktreePath` snapshot but doesn't render
  → the remaining gap is remote-side PTY instantiation (does the remote lazily
  create a PTY view for a host `ptyId`, or only for terminals it created
  itself). That's a separate trace — point me at the remote's
  terminal-instantiation code.

**If the remote can't connect at all:** the dev build may have taken a fallback
port if 6768 was still held. Check `~/.config/orca-dev/orca-runtime.json` for
the actual `websocket` endpoint and point the remote at that port.
