import type { GlobalSettings } from '../../../shared/global-settings-types'
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
