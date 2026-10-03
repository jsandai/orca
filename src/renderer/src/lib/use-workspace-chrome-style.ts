import { useMemo } from 'react'
import type React from 'react'
import { useAppStore } from '../store'
import { useSystemPrefersDark } from '../components/terminal-pane/use-system-prefers-dark'
import { resolveWorkspaceChromeStyleVariables } from './workspace-chrome-appearance'

export function useWorkspaceChromeStyle(): React.CSSProperties | undefined {
  const settings = useAppStore((s) => s.settings)
  const systemPrefersDark = useSystemPrefersDark()
  return useMemo(
    () => resolveWorkspaceChromeStyleVariables(settings, systemPrefersDark),
    [settings, systemPrefersDark]
  )
}
