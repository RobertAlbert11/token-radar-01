# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RobertAlbert11/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RobertAlbert11/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# YieldRadar

A token launch radar for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01): it reads one sealed snapshot of the protocol universe, works out which protocols still record no token (and are not a wrapped, staked or bridged product of one that trades), ranks them by what a token launch would be worth, and builds a web dashboard showing the ranked board, a detail view per protocol, and the steps to farm each one.

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hermes2/token-radar/repo/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hermes2/token-radar/repo/reward.svg)](https://make.fun/bounty/token-radar-01)

## How the value model works

A token's market cap is some multiple of the deposits behind it, so the model derives each category's own multiple from the protocols whose tokens already trade, then prices the pre-token ones from their own figures:

```
multiple  = geometric mean of token-bearing peers' mcap/TVL in the category,
            damped toward the blended multiple of all token-bearing protocols
trend     = 1 + clamp(change_7d, -60, +150)/100 x 0.4
patience  = 0.55 at listing → 1.00 at 1095 days of age   (unknown age: 365 days)
implied   = round( tvl_usd x multiple x trend x patience )
```

Nothing is hardcoded: no protocol name is special-cased, category multiples are fitted from the snapshot's own token-bearing rows (CEX and sub-$1M rows excluded), and the fit is verified by leave-one-out — every token-bearing peer is held out once, the category multiple refitted without it, and the prediction compared with the peer's true mcap/TVL. The dashboard reports the median absolute error and the share of peers predicted within 2x, which is what a comp-table estimate can honestly promise.

The board separates protocols whose token already trades (shown with their market's own mcap/TVL, set aside from the ranking) from pre-token ones. The snapshot's watchlist — protocols at or above the house's $50M TVL floor with no token recorded — is the floor, never the ceiling: the board adds every pre-token protocol below the floor with meaningful TVL, so future launches are found early.

## Running it

Node 22.18+ (22.23.4 in the grader), standard library only:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

`--input` takes the snapshot file or a directory holding `snapshot.json` (default `/input`). The program writes:

- `board.json` — the ranked rows (slug, name, rank, implied_value_usd, farm_steps, launch signals, the model's own figures per row)
- `data.js` — the dashboard's dataset
- `dashboard/` — the static page (index.html, app.css, app.js; no framework, no network)
- `screenshots/` — the board, a detail view and a filtered view
- `dossier.json` — written by `buildDossier` from vendor/makefun-board.ts

## The dashboard

A dark-theme, single-page board: sortable columns, a search box, category and chain filters, a watchlist/early/live toggle, the model's formula and its leave-one-out fit report, and a detail dialog per protocol with the implied-value arithmetic (the page recomputes each row from the same rounded multipliers the data carries), the launch signs to watch, and the farm plan — seven steps with what each costs, how long it takes and where to do it.

## Repository layout

```
main.ts            the entry program
lib/model.ts       snapshot parsing, eligibility, comparables fit, verification, scoring, board
lib/plans.ts       farm-plan generation from each protocol's own record
dashboard/         index.html, app.css, app.js — the page the program copies to /output
vendor/makefun-board.ts   make.fun's dossier library, unchanged
screenshots/       the three hand-in screenshots
```

## License

MIT — see [LICENSE](LICENSE).
