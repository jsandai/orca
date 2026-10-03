import { useLayoutEffect, useMemo } from 'react'
import type React from 'react'
import { useAppStore } from '../store'
import { useSystemPrefersDark } from '../components/terminal-pane/use-system-prefers-dark'
import {
  resolveWorkspaceChromeDocumentAppearance,
  resolveWorkspaceChromeStyleVariables
} from './workspace-chrome-appearance'

export function useWorkspaceChromeStyle(): React.CSSProperties | undefined {
  const settings = useAppStore((s) => s.settings)
  const systemPrefersDark = useSystemPrefersDark()
  return useMemo(
    () => resolveWorkspaceChromeStyleVariables(settings, systemPrefersDark),
    [settings, systemPrefersDark]
  )
}

/** Applies match-terminal variables to the document root; returns the light/dark mode to use instead of the app theme. */
export function useWorkspaceChromeDocumentAppearance(): 'dark' | 'light' | undefined {
  const settings = useAppStore((s) => s.settings)
  const systemPrefersDark = useSystemPrefersDark()
  const appearance = useMemo(
    () => resolveWorkspaceChromeDocumentAppearance(settings, systemPrefersDark),
    [settings, systemPrefersDark]
  )
  const variables = appearance?.variables
  useLayoutEffect(() => {
    if (!variables) {
      return undefined
    }
    const style = document.documentElement.style
    for (const [key, value] of Object.entries(variables)) {
      style.setProperty(key, value)
    }
    return () => {
      for (const key of Object.keys(variables)) {
        style.removeProperty(key)
      }
    }
  }, [variables])
  return appearance?.theme
}
