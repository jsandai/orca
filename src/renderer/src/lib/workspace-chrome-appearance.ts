import type { GlobalSettings } from '../../../shared/global-settings-types'
import { isTerminalBackgroundLight } from './terminal-title-contrast'
import {
  resolveTerminalSurfaceVariables,
  type LeftSidebarStyleVariables,
  type TerminalSurfaceSettings
} from './left-sidebar-appearance'

type WorkspaceChromeAppearanceSettings = TerminalSurfaceSettings &
  Pick<GlobalSettings, 'workspaceChromeAppearanceMode'>

/** Variables scoped onto the title bar, tab strip, and status bar; undefined keeps the app theme. */
export function resolveWorkspaceChromeStyleVariables(
  settings: WorkspaceChromeAppearanceSettings | null | undefined,
  systemPrefersDark: boolean
): LeftSidebarStyleVariables | undefined {
  if (settings?.workspaceChromeAppearanceMode !== 'match-terminal') {
    return undefined
  }
  const vars = resolveTerminalSurfaceVariables(settings, systemPrefersDark)
  const background = vars['--background']
  return {
    ...vars,
    // Why: these bars paint --bg-titlebar, and tabs paint --card; the 4% card lift would read as a separate strip.
    '--bg-titlebar': background,
    '--card': background
  }
}

/** Root variables and light/dark mode that bring the whole app onto the terminal theme. */
export function resolveWorkspaceChromeDocumentAppearance(
  settings: WorkspaceChromeAppearanceSettings | null | undefined,
  systemPrefersDark: boolean
): { variables: LeftSidebarStyleVariables; theme: 'dark' | 'light' } | undefined {
  if (settings?.workspaceChromeAppearanceMode !== 'match-terminal') {
    return undefined
  }
  // Why: terminal opacity would make every menu and dialog see-through, so the app uses the solid color.
  const vars = resolveTerminalSurfaceVariables(
    { ...settings, terminalBackgroundOpacity: undefined },
    systemPrefersDark
  )
  const theme = isTerminalBackgroundLight(vars['--background']) ? 'light' : 'dark'
  return {
    variables: {
      ...vars,
      '--bg-titlebar': vars['--background'],
      // Why: popovers keep the card lift so they stay distinct from the surface behind them.
      '--popover': vars['--card'],
      '--popover-foreground': vars['--foreground'],
      // Why: the sidebar's 9% accent vanishes on a lifted popover; match the menu hover (white/14, black/8).
      '--accent': `color-mix(in srgb, ${vars['--foreground']} ${theme === 'dark' ? 14 : 8}%, ${vars['--background']})`
    },
    // Why: status, badge, and diff colors are tuned per mode; pick the one that suits the terminal background.
    theme
  }
}
