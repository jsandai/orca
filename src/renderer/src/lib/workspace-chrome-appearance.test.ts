import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { resolveWorkspaceChromeStyleVariables } from './workspace-chrome-appearance'

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
