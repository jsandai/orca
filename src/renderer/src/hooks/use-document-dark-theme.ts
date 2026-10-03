import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import { resolveWorkspaceChromeDocumentAppearance } from '@/lib/workspace-chrome-appearance'

/** Resolved document theme that re-renders when a `system` theme flips with the OS. */
export function useDocumentDarkTheme(): boolean {
  const systemPrefersDark = useSystemPrefersDark()
  const settings = useAppStore((s) => s.settings)
  // Why: match-terminal picks light/dark from the terminal background; editors and previews must agree.
  // Resolved in a memo, not the store selector, which reruns on every store update.
  const matched = useMemo(
    () => resolveWorkspaceChromeDocumentAppearance(settings, systemPrefersDark)?.theme,
    [settings, systemPrefersDark]
  )
  if (matched) {
    return matched === 'dark'
  }
  const theme = settings?.theme ?? 'system'
  return theme === 'system' ? systemPrefersDark : theme === 'dark'
}
