// English / Telugu switch.
//
// Strings are written in English in the code and wrapped in t(): the English text
// is the key, so a missing translation simply shows English. Templates use {name}
// placeholders: t('{n} voters', { n: fmtInt(42) }).
//
// The choice is kept per browser (localStorage 'biq-lang', shared with the login
// page). Changing it re-renders the app from the root (see main.tsx).
import { useSyncExternalStore } from 'react'
import { TE } from './i18n.te'

export type Lang = 'en' | 'te'
const KEY = 'biq-lang'

function initial(): Lang {
  try {
    return localStorage.getItem(KEY) === 'te' ? 'te' : 'en'
  } catch {
    return 'en'
  }
}

let lang: Lang = initial()
const listeners = new Set<() => void>()
const apply = () => {
  document.documentElement.lang = lang === 'te' ? 'te' : 'en'
}
apply()

export const getLang = () => lang

export function setLang(l: Lang) {
  if (l === lang) return
  lang = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* per-browser convenience only */
  }
  apply()
  listeners.forEach((f) => f())
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => lang,
  )
}

const missing = new Set<string>()

/** Translate an English UI string (and fill {placeholders}). */
export function t(en: string, vars?: Record<string, string | number>): string {
  let s = en
  if (lang === 'te') {
    const hit = TE[en]
    if (hit !== undefined) s = hit
    else if (import.meta.env.DEV && !missing.has(en)) {
      missing.add(en)
      console.warn('[i18n] no Telugu for:', JSON.stringify(en))
    }
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
  return s
}

/** Locale for dates in the current language. */
export const dateLocale = () => (lang === 'te' ? 'te-IN' : 'en-IN')
