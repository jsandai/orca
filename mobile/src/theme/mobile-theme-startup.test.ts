import { afterEach, describe, expect, it, vi } from 'vitest'

describe('palette chosen at startup', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('uses the default palette unless true black was set first', async () => {
    const theme = await import('./mobile-theme')
    expect(theme.isTrueBlackActive).toBe(false)
    expect(theme.colors.bgBase).toBe('#111111')
  })

  it('uses the true black palette when set before the theme loads', async () => {
    const state = await import('./true-black-state')
    state.setTrueBlackAtStartup(true)
    const theme = await import('./mobile-theme')
    expect(theme.isTrueBlackActive).toBe(true)
    expect(theme.colors).toBe(theme.trueBlackColors)
  })
})
