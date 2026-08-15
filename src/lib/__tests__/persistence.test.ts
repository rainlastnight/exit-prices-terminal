import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Durability: everything the user sets up must survive a process restart.
 *
 * The app writes through a module-level connection, so this test writes with
 * the real store and then reads back through a *separate* connection opened
 * on the same file — which is what a restarted server does.
 */

let dir: string
let dbPath: string
let store: typeof import('../store')

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'exit-prices-test-'))
  dbPath = join(dir, 'test.db')
  process.env.EXIT_PRICES_DB = dbPath
  store = await import('../store')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Read back the way a restarted process would: a fresh connection. */
const reopen = () => new Database(dbPath, { readonly: true })

describe('persistence across restart', () => {
  it('keeps the wallet', () => {
    store.addWallet('0xD34F61f11E5181d16E74d17a316Ab3ed181Aa9E0', 'RH')

    const db = reopen()
    const rows = db.prepare('SELECT address, label FROM wallets').all() as Array<{
      address: string
      label: string
    }>
    db.close()

    expect(rows).toHaveLength(1)
    expect(rows[0].address).toBe('0xd34f61f11e5181d16e74d17a316ab3ed181aa9e0')
  })

  it('keeps tracked tokens', () => {
    const wallet = store.listWallets()[0]
    store.addTracked({
      walletId: wallet.id,
      chainId: 4663,
      tokenAddress: '0xe934e36a439c94017b64a3fece66af12099abf50',
      symbol: 'STONKBROKER',
      decimals: 18,
      balanceRaw: '1200000000000000000000',
    })

    const db = reopen()
    const rows = db.prepare('SELECT symbol FROM tracked').all() as Array<{ symbol: string }>
    db.close()

    expect(rows.map((r) => r.symbol)).toEqual(['STONKBROKER'])
  })

  it('keeps the exit ladder and which template produced it', () => {
    const tracked = store.listTracked()[0]
    store.setTranches(
      tracked.id,
      [
        { multiple: 2, pct: 50, price: 0.04 },
        { multiple: 4, pct: 50, price: 0.08 },
      ],
      'x2x4',
      1000,
    )

    const db = reopen()
    const template = (db.prepare('SELECT template_id FROM tracked WHERE id = ?').get(tracked.id) as {
      template_id: string
    }).template_id
    const tranches = db
      .prepare('SELECT multiple, pct, price FROM tranches ORDER BY sort')
      .all() as Array<{ multiple: number; pct: number; price: number }>
    db.close()

    expect(template).toBe('x2x4')
    expect(tranches).toEqual([
      { multiple: 2, pct: 50, price: 0.04 },
      { multiple: 4, pct: 50, price: 0.08 },
    ])
  })

  it('keeps a fired rung latched, so it does not re-alert after a restart', () => {
    const tracked = store.listTracked()[0]
    const rung = store.listTranches(tracked.id)[0]
    store.latchTranche(rung.id)

    const db = reopen()
    const fired = (db.prepare('SELECT fired FROM tranches WHERE id = ?').get(rung.id) as {
      fired: number
    }).fired
    db.close()

    expect(fired).toBe(1)
  })

  it('keeps a manual cost-basis override', () => {
    const tracked = store.listTracked()[0]
    store.setManualCost(tracked.id, 0.0123)

    const db = reopen()
    const row = db.prepare('SELECT avg_cost_manual FROM tracked WHERE id = ?').get(tracked.id) as {
      avg_cost_manual: number
    }
    db.close()

    expect(row.avg_cost_manual).toBe(0.0123)
  })

  it('re-tracking an existing token preserves its ladder', () => {
    const wallet = store.listWallets()[0]
    const before = store.listTranches(store.listTracked()[0].id).length

    // Re-scanning a wallet re-submits tokens already tracked; that must not
    // wipe the exit plan attached to them.
    store.addTracked({
      walletId: wallet.id,
      chainId: 4663,
      tokenAddress: '0xe934e36a439c94017b64a3fece66af12099abf50',
      symbol: 'STONKBROKER',
      decimals: 18,
      balanceRaw: '9999000000000000000000',
    })

    expect(store.listTracked()).toHaveLength(1)
    expect(store.listTranches(store.listTracked()[0].id)).toHaveLength(before)
  })
})
