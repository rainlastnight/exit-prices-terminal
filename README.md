# Exit Prices

A local dashboard for watching wallet holdings on **Ethereum** and **Robinhood Chain**
and getting alerted when a coin hits your exit price.

Read-only: you paste an address, nothing is signed and no keys are involved.
No API keys, no accounts, no hosted database.

```bash
npm install
npm run dev     # http://localhost:3000
```

## Where state lives

Wallets, tracked tokens, exit ladders, fired rungs and cost-basis overrides are
in `data/exit-prices.db` (SQLite, gitignored) and survive restarts — there is a
regression test for exactly that in `src/lib/__tests__/persistence.test.ts`.

View preferences — the open position, chart timeframe, trade-marker toggle —
are browser state, kept in `localStorage`.

Delete the DB to reset, but **stop the server first**: it holds the file open,
so deleting it while running appears to do nothing and the old data comes back.

Note that `next dev` refuses to start a second instance from the same directory
even on a different port, so a second `npm run dev` silently talks to the
already-running server.

## Using it

1. Paste a `0x…` address and hit **Scan**. Holdings on both chains are listed,
   ranked by known USD value so airdrop dust sinks to the bottom.
2. Tick the coins you want to track. Untick a tracked coin to stop tracking it.
   Scan more addresses to watch several wallets at once.
3. In that same modal you can switch which wallet is **primary** — the dashboard
   and every headline total then scope to it — or remove a wallet entirely
   (which drops its tracked tokens and their exit plans, so it asks first).
3. Select a position and pick an exit template. Alerts fire as a toast, a
   desktop notification (click *Enable alerts*), and a count in the tab title.
   Each rung fires once.

## Design language

Refined brutalism: **one typeface** (JetBrains Mono, everywhere), **zero border
radius**, true black, hard rules, and colour reserved almost entirely for
meaning. Weight, size and case carry all hierarchy — that constraint is the
brand. Oversized numerals appear once or twice per screen, never routinely.

The dashboard is an **accordion**: each coin owns its detail. Clicking a row
expands the exit ladder, position stats, formula picker and chart nested beneath
it, so there is no separate panel to keep mentally paired with a selection. One
row opens on first load; after that the accordion can be fully closed and stays
closed.

The **ladder rail** (`src/components/LadderRail.tsx`) is the signature object:
one axis showing cost basis → current price → every rung. Positions are
**logarithmic**, because on a linear axis a 10x rung crushes 2x into the left
fifth and destroys the only reading that matters — how much further to go. The
geometry is pure and unit tested in `src/lib/rail.ts`.

The headline is **plan complete**, not net worth. Net worth is what every
portfolio tracker shows; how far through your exit plan you are is what only
this app can say.

Palette is validated, not eyeballed (`dataviz` validator, `--pairs all`):
teal↔red ΔE 12.1 under deuteranopia, worst pair ΔE 30.2 in normal vision.
Signal orange was rejected — ΔE 13.0 against the red, below the normal-vision
floor. Acid lime `#d6ff2e` sits further from both status colours than they do
from each other, so it can never be misread as up or down.

## Exit templates

Three ladders, each selling 100% of the position across tranches:

Three presets, each selling 100% of the position across tranches:

| Template | Ladder |
|---|---|
| **1.5x & 2x** | 50% at 1.5x, 50% at 2x |
| **2x & 4x** | 50% at 2x, 50% at 4x |
| **2x, 5x & 10x** | 30% at 2x, 40% at 5x, 30% at 10x |

…plus **Custom**, where you enter your own multiples and percentages. It shows
the resulting price per rung as you type, remembers the last ladder you built
(so it can be reused across positions), and validates before it will apply:
rungs must be above 1x (this ladder only fires upwards, so anything at or below
cost could never trigger), percentages must total ≤ 100, and duplicate rungs are
rejected. Allocating **less** than 100% is allowed — the remainder is simply
kept, and the panel says how much.

**Multiples are measured from your average cost**, so "2x" means twice what you
actually paid. Without a buy history it falls back to the current price. Prices
are frozen when you apply a template, so a later cost-basis refresh never
silently moves a target you already committed to.

The panel recommends one from what the token has actually done — volatility,
age, drawdown from its high, run from its low, and pool liquidity — and shows
its reasoning. Thin liquidity always pulls the recommendation earlier: a ladder
you cannot fill is worse than no ladder. On a token with $10 of liquidity the
suggestion drops from the 10x ladder to 2x & 4x, and says why.

Once applied you get **distance to next rung, coin allocated, average exit
price, and total target value with its gain over the current position** — plus
the rungs drawn on the chart, filled ones in teal.

## Reached vs sold

A rung firing only means **price reached that level** — it cannot know whether
you sold. Treating those as the same would let the app claim a sale that never
happened, and would hide the case that matters most: price blew through a
target and nothing was sold.

So rungs are reconciled against the wallet's actual on-chain sells (the same
history that builds the cost basis), giving four states:

| State | Meaning |
|---|---|
| **pending** | Price has not reached this rung |
| **! missed** | Price reached it, no sale found — flagged in red |
| **~ partial** | Some of the tranche was sold |
| **✓ sold** | The tranche was sold at or above this level |

Sells are matched **highest rung first**, so one large sale at 10x is credited
to the 10x tranche rather than marking the whole ladder complete. Tranche sizes
come from the position size **when the plan was set** (`plan_balance`), not the
live balance — otherwise selling would shrink every remaining target and a
half-executed plan would keep looking finished.

The per-position header reads "% SOLD" from this reconciliation. The dashboard
headline "Plan complete" still counts rungs *reached*, because reconciling every
position would mean a transfer-history fetch per row on every poll.

### Stale plan base

Rung prices are frozen when a ladder is applied, deliberately — so a cost-basis
refresh can never silently move a target you committed to. The side effect is
that buying more later raises your average cost and quietly makes "2x" no longer
2x of anything. When the base drifts ≥2% the panel says so and offers a one-click
**re-base**, which re-applies the same multiples at today's cost.

## PNL and cost basis

Cost basis is estimated from the wallet's on-chain transfers, each priced
against the closest historical candle, then run through weighted-average-cost
accounting. It drives unrealised PNL, realised PNL, and the exit multiples.

It is an estimate, and the UI says so. A transfer is not necessarily a trade —
an airdrop or bridge-in looks like a buy at that moment's market price — and a
transfer older than the pool's candle history cannot be priced at all. **Click
the average cost to override it**; a manual value wins outright.

The chart marks the wallet's own buys and sells, and draws the average cost as
a dotted line — the level every multiple is measured from. Hovering the chart
reads out **FDV first, price second**.

## FDV vs market cap

These are different numbers and the dashboard shows both, labelled.
For `$STONKBROKER` at the time of writing:

```
total supply   2,416,122,424      (verified on-chain via totalSupply)
price          $0.03067

FDV = total       x price = $74.1M   ← what OpenSea displays
MC  = circulating x price = $48.3M   ← what GeckoTerminal displays
                                       circulating is 65.1% of total
```

FDV leads each row because it is near-always available; market cap shows only
when circulating-supply data exists, and is otherwise `—`. It is never silently
replaced by FDV. Note that DexScreener reports FDV under *both* its `fdv` and
`marketCap` fields, so its `marketCap` is not a market cap.

## Data sources

All public, all keyless, all CORS-open.

| Source | Used for |
|---|---|
| [Blockscout](https://eth.blockscout.com) (per chain) | token discovery, balances, native price, transfer history |
| [DexScreener](https://docs.dexscreener.com/api/reference) | canonical spot price, liquidity, 24h change |
| [GeckoTerminal](https://api.geckoterminal.com) | total/circulating supply, pools, OHLCV candles |
| Public JSON-RPC | `totalSupply` fallback |

OpenSea is deliberately not used: its v2 API returns `401` without a key, and
the FDV figure it displays is already available from GeckoTerminal.

### Rate limits

GeckoTerminal's ~30 req/min is the binding constraint and trips easily. Every
outbound call goes through `src/lib/cache.ts`, which serves from SQLite, collapses
concurrent identical requests into one fetch, waits on a per-host token bucket,
backs off on 429, and falls back to stale data rather than failing. Twelve
simultaneous chart loads produce one upstream request.

## Two traps worth knowing

Both are covered by tests in `src/lib/__tests__/`:

- **Pool choice changes the price.** `$HOODWORKS` quotes **7.5× apart** across its
  two pools ($0.00000129 at $10.34 liquidity vs $0.00000973 at $3.06). Always the
  deepest pool wins. Thin pools are flagged in the chart footer.
- **An unpriced token must not borrow a neighbour's price.** Tokens are batched
  30-per-request, and a token with no pair of its own resolves to `null` — never
  to whatever else was in the batch. Rules never evaluate against a null price,
  so a token with no feed stays silent instead of firing a phantom alert.

## Tests

```bash
npm test
```

Covers alert latching (fires once, re-arms on edit), never firing on a missing
price, FDV↔price threshold conversion, pool selection, threshold parsing,
ladder maths (allocation-weighted average exit, target value, distance to next
rung), the strategy heuristic including the thin-liquidity guard, and
weighted-average cost accounting with partial history.
