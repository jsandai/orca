import { useAppStore } from '@/store'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import { resolveWorkspaceChromeDocumentAppearance } from '@/lib/workspace-chrome-appearance'

/** Resolved document theme that re-renders when a `system` theme flips with the OS. */
export function useDocumentDarkTheme(): boolean {
  const systemPrefersDark = useSystemPrefersDark()
  // Why: match-terminal picks light/dark from the terminal background; editors and previews must agree.
  // Selecting a string keeps unrelated settings writes from re-rendering every editor.
  const matched = useAppStore(
    (s) => resolveWorkspaceChromeDocumentAppearance(s.settings, systemPrefersDark)?.theme
  )
  const theme = useAppStore((s) => s.settings?.theme ?? 'system')
  if (matched) {
    return matched === 'dark'
  }
  return theme === 'system' ? systemPrefersDark : theme === 'dark'
}
