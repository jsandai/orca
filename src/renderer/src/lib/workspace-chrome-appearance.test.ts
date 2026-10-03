import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import {
  resolveWorkspaceChromeDocumentAppearance,
  resolveWorkspaceChromeStyleVariables
} from './workspace-chrome-appearance'

function settings(overrides = {}) {
  return {
    ...getDefaultSettings(tmpdir()),
    ...overrides
  }
}

describe('resolveWorkspaceChromeStyleVariables', () => {
  it('keeps the app theme by default', () => {
    expect(resolveWorkspaceChromeStyleVariables(settings(), true)).toBeUndefined()
  })

  it('paints the bars and tabs with the terminal background and text tokens', () => {
    const vars = resolveWorkspaceChromeStyleVariables(
      settings({
        workspaceChromeAppearanceMode: 'match-terminal',
        terminalColorOverrides: { background: '#000000', foreground: '#ff7edb' }
      }),
      true
    )

    expect(vars).toMatchObject({
      '--bg-titlebar': '#000000',
      '--card': '#000000',
      '--background': '#000000',
      '--foreground': '#ff7edb'
    })
    expect(vars?.['--muted-foreground']).toContain('#ff7edb 62%')
  })

  it('is independent of the left sidebar appearance', () => {
    expect(
      resolveWorkspaceChromeStyleVariables(
        settings({ leftSidebarAppearanceMode: 'match-terminal' }),
        true
      )
    ).toBeUndefined()
  })
})

describe('resolveWorkspaceChromeDocumentAppearance', () => {
  it('leaves the document alone by default', () => {
    expect(resolveWorkspaceChromeDocumentAppearance(settings(), true)).toBeUndefined()
  })

  it('uses the solid terminal color so menus are not see-through', () => {
    const appearance = resolveWorkspaceChromeDocumentAppearance(
      settings({
        workspaceChromeAppearanceMode: 'match-terminal',
        terminalColorOverrides: { background: '#000000', foreground: '#ff7edb' },
        terminalBackgroundOpacity: 0.5
      }),
      true
    )

    expect(appearance?.variables['--background']).toBe('#000000')
    expect(appearance?.variables['--popover']).toBe(appearance?.variables['--card'])
    expect(appearance?.variables['--popover']).toContain('#ff7edb 4%')
    expect(appearance?.theme).toBe('dark')
  })

  it('switches the app to light mode for a light terminal background', () => {
    const appearance = resolveWorkspaceChromeDocumentAppearance(
      settings({
        theme: 'dark',
        workspaceChromeAppearanceMode: 'match-terminal',
        terminalColorOverrides: { background: '#fffcf0', foreground: '#100f0f' }
      }),
      true
    )

    expect(appearance?.theme).toBe('light')
  })
})
