// Why: no imports, so mobile-theme (loaded by tests and the web entry too) never pulls in a native
// module. true-black-startup sets this before any screen evaluates mobile-theme.
let enabledAtStartup = false

export function setTrueBlackAtStartup(enabled: boolean): void {
  enabledAtStartup = enabled
}

export function trueBlackAtStartup(): boolean {
  return enabledAtStartup
}
