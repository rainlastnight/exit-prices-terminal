import { getDb } from './db'

/**
 * Shared TTL cache + per-host rate limiting for the public APIs.
 *
 * This exists because GeckoTerminal's free tier is ~30 req/min and trips a 429
 * almost immediately under normal dashboard use (chart reloads, timeframe
 * switches). Every outbound call goes through `cachedFetch`, which:
 *   1. serves from the SQLite cache when fresh,
 *   2. collapses concurrent identical requests into one in-flight fetch,
 *   3. waits on a per-host token bucket before hitting the network,
 *   4. retries 429s with backoff (honouring Retry-After),
 *   5. falls back to a *stale* cache entry rather than failing the request.
 */

interface HostLimit {
  /** Requests allowed per window */
  capacity: number
  /** Window length in ms */
  windowMs: number
}

const HOST_LIMITS: Record<string, HostLimit> = {
  // Documented ~30/min. We stay under it deliberately.
  'api.geckoterminal.com': { capacity: 25, windowMs: 60_000 },
  // Documented 300/min on token endpoints.
  'api.dexscreener.com': { capacity: 240, windowMs: 60_000 },
  // Observed x-ratelimit-limit: 10 per ~1s window.
  'eth.blockscout.com': { capacity: 8, windowMs: 1_000 },
  'robinhoodchain.blockscout.com': { capacity: 8, windowMs: 1_000 },
  // CoinGecko public tier is roughly 10-30/min depending on load.
  'api.coingecko.com': { capacity: 10, windowMs: 60_000 },
}

const DEFAULT_LIMIT: HostLimit = { capacity: 60, windowMs: 60_000 }

/** Sliding-window timestamps of recent requests, per host. */
const hostHits = new Map<string, number[]>()
/** Absolute time until which a host is in 429 penalty. */
const hostPenalty = new Map<string, number>()
/** Dedup of concurrent identical requests. */
const inFlight = new Map<string, Promise<unknown>>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function limitFor(host: string): HostLimit {
  return HOST_LIMITS[host] ?? DEFAULT_LIMIT
}

/**
 * Block until this host has a free slot in its sliding window, then claim it.
 * Serialised naturally by the single-threaded event loop.
 */
async function acquireSlot(host: string): Promise<void> {
  const { capacity, windowMs } = limitFor(host)

  for (;;) {
    const now = Date.now()

    const penaltyUntil = hostPenalty.get(host) ?? 0
    if (penaltyUntil > now) {
      await sleep(penaltyUntil - now)
      continue
    }

    const hits = (hostHits.get(host) ?? []).filter((t) => now - t < windowMs)
    if (hits.length < capacity) {
      hits.push(now)
      hostHits.set(host, hits)
      return
    }

    // Wait until the oldest hit falls out of the window.
    const waitMs = windowMs - (now - hits[0]) + 25
    hostHits.set(host, hits)
    await sleep(waitMs)
  }
}

function readCache(key: string, opts: { allowStale?: boolean } = {}): string | null {
  const db = getDb()
  const row = db.prepare('SELECT body, expires_at FROM api_cache WHERE key = ?').get(key) as
    | { body: string; expires_at: number }
    | undefined
  if (!row) return null
  if (!opts.allowStale && row.expires_at < Date.now()) return null
  return row.body
}

function writeCache(key: string, body: string, ttlMs: number) {
  getDb()
    .prepare(
      `INSERT INTO api_cache (key, body, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at`,
    )
    .run(key, body, Date.now() + ttlMs)
}

export interface CachedFetchOptions {
  /** How long the response stays fresh. */
  ttlMs: number
  /** Max attempts on 429 / 5xx / network error. */
  retries?: number
  /** Override the cache key (defaults to the URL). */
  key?: string
}

/**
 * Fetch JSON with caching, rate limiting, dedup and stale fallback.
 * Returns `null` when the resource is genuinely unavailable (e.g. 404), which
 * callers should treat as "no data" rather than as an error.
 */
export async function cachedFetch<T>(url: string, opts: CachedFetchOptions): Promise<T | null> {
  const key = opts.key ?? url
  const retries = opts.retries ?? 3

  const fresh = readCache(key)
  if (fresh !== null) return JSON.parse(fresh) as T

  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T | null>

  const task = (async (): Promise<T | null> => {
    const host = new URL(url).host

    for (let attempt = 0; attempt <= retries; attempt++) {
      await acquireSlot(host)

      try {
        const res = await fetch(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(20_000),
        })

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after'))
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30_000, 2_000 * 2 ** attempt)
          hostPenalty.set(host, Date.now() + backoff)
          continue
        }

        // Missing resource is a legitimate "no data" answer; cache it briefly
        // so a dead token doesn't get retried on every poll.
        if (res.status === 404) {
          writeCache(key, 'null', Math.min(opts.ttlMs, 60_000))
          return null
        }

        if (!res.ok) {
          if (attempt < retries) {
            await sleep(Math.min(10_000, 500 * 2 ** attempt))
            continue
          }
          throw new Error(`${res.status} ${res.statusText}`)
        }

        const text = await res.text()
        writeCache(key, text, opts.ttlMs)
        return JSON.parse(text) as T
      } catch (err) {
        if (attempt < retries) {
          await sleep(Math.min(10_000, 500 * 2 ** attempt))
          continue
        }
        // Last resort: serve stale rather than breaking the dashboard.
        const stale = readCache(key, { allowStale: true })
        if (stale !== null) {
          console.warn(`[cache] serving stale ${key}: ${(err as Error).message}`)
          return JSON.parse(stale) as T
        }
        console.error(`[cache] failed ${key}: ${(err as Error).message}`)
        return null
      }
    }

    const stale = readCache(key, { allowStale: true })
    return stale !== null ? (JSON.parse(stale) as T) : null
  })()

  inFlight.set(key, task)
  try {
    return await task
  } finally {
    inFlight.delete(key)
  }
}

/** Drop expired rows. Cheap; call opportunistically. */
export function pruneCache(): void {
  getDb().prepare('DELETE FROM api_cache WHERE expires_at < ?').run(Date.now() - 3_600_000)
}

/** Test/debug helper: how many live requests a host has made in its window. */
export function _hostUsage(host: string): number {
  const { windowMs } = limitFor(host)
  const now = Date.now()
  return (hostHits.get(host) ?? []).filter((t) => now - t < windowMs).length
}
