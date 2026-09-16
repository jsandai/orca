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

---

## Follow-up: remote split layout collapses intermittently (separate bug)

**Symptom (verified on Windows remote, 2026-09-16):** a host-created split
layout renders on the paired remote, then reverts to a single terminal pane.
Re-activating the worktree restores the split.

**Host side is correct + stable.** `session.tabs.list` on the serve shows the
split `parentLayout.root` persisting across ~60s of polling with no collapse —
the host publishes a stable multi-leaf tree. So the gap is in the remote
*client's* reconcile, not the export.

**Where to look:** `src/renderer/src/runtime/web-session-tabs-sync.ts` →
`chooseRemoteTerminalLayout` → `resolveTerminalLayoutRoot`
(`remote-terminal-layout-resolution.ts`). Precedence is host-authoritative
`parentLayout.root` → prior client root → degenerate synthesize. The collapse
means at some sync the authoritative root stopped covering `leafIds` (a
transient mismatch — e.g. a new leaf published before its layout caught up, or
a leaf-set computed differently mid-stream) and the client stored a degenerate
single-leaf root as `existingRoot`, which then kept winning until the tab was
re-created on re-activation.

**Not the same as the export fix** — `bb64fbc` (record host terminals in
`tabsByWorktree`) is verified and independent. This is a client reconcile bug.

### Refined mechanism (client reconcile)

`buildMirroredTerminalTabs` → `chooseRemoteTerminalLayout` → `resolveTerminalLayoutRoot`.

- `leafIds` = every terminal surface's `leafId` in the snapshot.
- `authoritativeRoot` = `surfaces.find(s => s.parentLayout)?.parentLayout.root`
  — the FIRST surface carrying a layout, assumed uniform across siblings
  (verified: siblings do carry identical roots in steady state).
- Precedence: authoritative → prior `existingRoot` → degenerate synthesize.

Collapse happens when `layoutCoversLeaves(authoritativeRoot, leafIds)` fails —
i.e. the picked root's leaf set ≠ the surfaces' leaf set. That occurs in the
spawn/exit window: a surface lands in `surfaces` before its `parentLayout`
reflects the new leaf (or a leaf drops out mid-update). The degenerate root is
then written into `terminalLayoutsByTabId[tabId]` and, once stored as
`existingRoot`, can shadow a recovering authoritative root on later syncs until
the tab is re-created (re-activation).

**Candidate fix:** in `chooseRemoteTerminalLayout`, pick the `parentLayout`
whose root covers the most of `leafIds` (or exactly all of them) rather than
the first surface with any layout; and/or in `resolveTerminalLayoutRoot`,
prefer an authoritative root that is a strict superset over a stored
`existingRoot`, so a transient degenerate root can't stick. Needs a real remote
client's snapshot log to confirm the exact transient before patching.

### Confirmed on a live Windows remote (DevTools console, 2026-09-16)

Reproduced the collapse with DevTools open on the paired remote. Console shows:

- `[web-session-tabs-sync] synthesized layout for 2 leaves; no authoritative or
  prior tree covered them` — the degenerate fallback firing = the collapse.
- A cascade of `[web-runtime-session] failed to update pane layout:
  tab_not_found` / `failed to activate tab: tab_not_found` — the remote tries to
  update mirrored tabs that aren't in its local store.
- `[terminal-lifecycle] fresh spawn left the pane unbound` — a pane spawned but
  never bound to a leaf.
- `[remote-runtime-pty] host session recovery request failed during reconnect:
  Timed out` and `Could not connect to the remote Orca runtime` — the remote's
  websocket to the host is dropping and re-syncing.

**Refined root cause:** the collapse is a reconnect-resync problem, not pure
layout logic. When the remote's ws to the host drops and reconnects, the resync
rebuilds mirrored tabs from a partial/inconsistent snapshot — `tab_not_found`
errors show the local store lost tabs mid-resync, and `chooseRemoteTerminalLayout`
falls back to a synthesized degenerate root because neither the authoritative
nor prior tree covers the transient leaf set. The split collapses and stays
collapsed until the user re-activates the worktree (which rebuilds the tab).

Two separable defects:
1. ws instability between remote and host (network or serve-side — host logs
   show no disconnects, so likely client-side/network).
2. resync is not layout-preserving — a partial snapshot during reconnect
   collapses a multi-pane split into a degenerate single-leaf layout instead of
   retaining the last good authoritative root until the full state rehydrates.

**Fix direction for (2):** `resolveTerminalLayoutRoot` should not let a
synthesized degenerate root overwrite a previously-good `existingRoot` during a
reconnect resync — prefer retaining the last authoritative root whose leaf set
is a superset, and only synthesize when no prior root ever existed.
