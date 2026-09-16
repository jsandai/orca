import { describe, expect, it, vi } from 'vitest'
import type { TerminalPaneLayoutNode } from '../../../shared/types'
import { layoutCoversLeaves, resolveTerminalLayoutRoot } from './remote-terminal-layout-resolution'

const verticalSplit: TerminalPaneLayoutNode = {
  type: 'split',
  direction: 'vertical',
  first: { type: 'leaf', leafId: 'a' },
  second: { type: 'leaf', leafId: 'b' }
}

describe('layoutCoversLeaves', () => {
  it('is true when the tree has exactly the leaves', () => {
    expect(layoutCoversLeaves(verticalSplit, ['a', 'b'])).toBe(true)
  })
  it('is false when a leaf is missing from the tree', () => {
    expect(layoutCoversLeaves({ type: 'leaf', leafId: 'a' }, ['a', 'b'])).toBe(false)
  })
  it('is false when the tree has an extra leaf', () => {
    expect(layoutCoversLeaves(verticalSplit, ['a'])).toBe(false)
  })
  it('is false for a null tree', () => {
    expect(layoutCoversLeaves(null, ['a'])).toBe(false)
  })
})

describe('resolveTerminalLayoutRoot', () => {
  it('uses the authoritative tree verbatim — direction is preserved', () => {
    // Why: the "Split Right renders as down" bug was re-deriving direction
    // instead of trusting the host tree. The authoritative tree must win.
    const root = resolveTerminalLayoutRoot({
      authoritativeRoot: verticalSplit,
      leafIds: ['a', 'b']
    })
    expect(root).toBe(verticalSplit)
    expect(root?.type === 'split' && root.direction).toBe('vertical')
  })

  it('falls back to the prior client tree (keeping direction) when authoritative does not cover the leaves', () => {
    // A transitional snapshot where the host tree is momentarily stale/partial
    // must NOT collapse to a guessed direction — keep the known-good tree.
    const root = resolveTerminalLayoutRoot({
      authoritativeRoot: { type: 'leaf', leafId: 'a' }, // stale single-leaf
      existingRoot: verticalSplit,
      leafIds: ['a', 'b']
    })
    expect(root).toBe(verticalSplit)
  })

  it('never invents a split direction: synthesis only fires (and is reported) when no tree covers the leaves', () => {
    const onSynthesize = vi.fn()
    resolveTerminalLayoutRoot({
      authoritativeRoot: undefined,
      existingRoot: undefined,
      leafIds: ['a', 'b'],
      onSynthesize
    })
    expect(onSynthesize).toHaveBeenCalledWith(2)
  })

  it('does not report synthesis for a single leaf (direction is irrelevant)', () => {
    const onSynthesize = vi.fn()
    const root = resolveTerminalLayoutRoot({ leafIds: ['a'], onSynthesize })
    expect(root).toEqual({ type: 'leaf', leafId: 'a' })
    expect(onSynthesize).not.toHaveBeenCalled()
  })

  it('returns null for no leaves', () => {
    expect(resolveTerminalLayoutRoot({ leafIds: [] })).toBeNull()
  })

  it('prefers authoritative over an also-covering existing tree', () => {
    const horizontalSplit: TerminalPaneLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', leafId: 'a' },
      second: { type: 'leaf', leafId: 'b' }
    }
    const root = resolveTerminalLayoutRoot({
      authoritativeRoot: verticalSplit,
      existingRoot: horizontalSplit,
      leafIds: ['a', 'b']
    })
    expect(root).toBe(verticalSplit)
  })

  it('keeps a superset prior tree when the incoming leaf set shrank transiently', () => {
    // Why: a reconnect/resync can report a subset of the real panes (a surface
    // drops out mid-update). The prior split tree contains every incoming leaf
    // plus the momentarily-absent one — keep it instead of collapsing to a
    // degenerate chain. This is the remote split-collapse fix.
    const threeLeaf: TerminalPaneLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      first: verticalSplit, // a,b
      second: { type: 'leaf', leafId: 'c' }
    }
    const onSynthesize = vi.fn()
    const root = resolveTerminalLayoutRoot({
      authoritativeRoot: undefined, // no usable host tree this sync
      existingRoot: threeLeaf,
      leafIds: ['a', 'b'], // 'c' transiently absent
      onSynthesize
    })
    expect(root).toBe(threeLeaf)
    expect(onSynthesize).not.toHaveBeenCalled()
  })

  it('still synthesizes when the prior tree does not contain an incoming leaf', () => {
    // A genuinely new leaf (not just a transiently-absent one) can't be placed
    // without a direction — degenerate is the honest fallback.
    const onSynthesize = vi.fn()
    const root = resolveTerminalLayoutRoot({
      existingRoot: verticalSplit, // a,b
      leafIds: ['a', 'b', 'c'], // 'c' is new
      onSynthesize
    })
    expect(onSynthesize).toHaveBeenCalledWith(3)
    expect(root?.type).toBe('split')
  })

  it('still synthesizes when the prior tree is a strict subset (leaf removed for real)', () => {
    // If the incoming set has a leaf the prior tree never had AND the prior
    // tree has none extra, there's nothing richer to keep.
    const onSynthesize = vi.fn()
    resolveTerminalLayoutRoot({
      existingRoot: { type: 'leaf', leafId: 'a' },
      leafIds: ['a', 'b'],
      onSynthesize
    })
    expect(onSynthesize).toHaveBeenCalledWith(2)
  })
})
