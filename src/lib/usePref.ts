'use client'

import { useEffect, useState } from 'react'

/**
 * A piece of UI state that survives a reload.
 *
 * Positions, ladders and cost overrides live in SQLite, but view preferences —
 * which position is open, the chart timeframe, whether trade markers are shown
 * — were component state and reset on every refresh. They belong to the browser
 * rather than the database, so they live in localStorage.
 *
 * Reads happen after mount: touching localStorage during render would make the
 * server and client markup disagree and trigger a hydration error.
 */
export function usePref<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`exit-prices:${key}`)
      if (raw !== null) setValue(JSON.parse(raw) as T)
    } catch {
      // Corrupt or unavailable storage should never break the dashboard.
    }
    setLoaded(true)
  }, [key])

  useEffect(() => {
    if (!loaded) return
    try {
      window.localStorage.setItem(`exit-prices:${key}`, JSON.stringify(value))
    } catch {
      /* quota or private mode — ignore */
    }
  }, [key, value, loaded])

  return [value, setValue, loaded] as const
}
