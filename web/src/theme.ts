import { useState } from 'react'

export type Theme = 'light' | 'dark'
const themeKey = 'thuchithue_theme'
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(themeKey)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#131821' : '#f0f0f2')
}
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
    try { localStorage.setItem(themeKey, next) } catch {}
  }
  return { theme, toggleTheme }
}
