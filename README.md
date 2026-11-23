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

Nothing is hardcoded: no protocol name is special-cased, category multiples are fitted from the snapshot's own token-bearing rows (CEX and sub-$1M rows excluded).

## How the model validates itself

The dashboard carries a **Model validation** panel whose numbers are computed in `main.ts` from the snapshot's own data — nothing is typed in:

- **Leave-one-out (LOO).** Every token-bearing peer is held out once, the model refitted without it, and the multiple predicted for the held-out peer compared with its true mcap/TVL. The panel reports the median absolute error, the share of peers predicted within 0.5–2x and within 0.33–3x, and a Pearson correlation between predicted and actual multiples on the log scale — plus the same per category (categories with 3+ peers shown; thin categories say so and lean on the blended multiple).
- **Walk-forward (temporal split).** Peers with listing dates are sorted; the older 60% train the multiples (with their own damping), the newer 40% — unseen by that fit — score it. The panel reports the test MAE, within-2x share, correlation, and the MAE difference vs LOO, so a reader can see the fit survive time, not just one held-out peer at a time. When too few peers carry dates, the panel says so rather than inventing a split.
- **Range honesty.** The share of peers whose true multiple lands in each band around the model's prediction — 0.5–2x (tight), 0.33–3x (working), 0.25–4x (wide) — and the share outside all three, which is the part of the board a reader should distrust.

A comps estimate cannot pin a market cap tighter than a band; these are the numbers that say how wide the honest band is.

## Costed farm verdicts

Each protocol's farm plan carries a concrete verdict, derived from the protocol's own record — capital from the TVL tier ($50/$100/$250/$500), gas from its main chain ($6 Ethereum, $1 Solana/Bitcoin, $2 elsewhere), one qualifying action a week over the hold window (45–90 days by age):

```
Est. cost: ~$258 · Time: 6 weeks · Avg $/hr: $0.26
           ($250 capital + $8 gas)   (258 ÷ 1,008h)
```

The verdict banner sits at the top of the detail view, next to the full implied-value arithmetic (TVL × multiple × trend × patience, each term's number shown with its source), the launch signs to watch, and the validation figures for the row's own category.

## The board at a glance

The page opens on a **KPI strip** (watchlist covered, pre-token vs token-trading rows, implied-value total, median category multiple, LOO accuracy, best/worst per-category MAE) and a one-line **data-integrity strip** (snapshot as_of, TVL floor, protocol count, peers held out, walk-forward result). Below it: the sortable, filterable board; the model's formula; the validation panel; and a live-token table of the comparables, set aside from the ranking.

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

A dark-theme, single-page board: a KPI strip and data-integrity line up top; sortable columns; a search box; category and chain filters; a watchlist/early/live toggle; the model's formula and its validation panel (leave-one-out, walk-forward, range-honesty bands); and a detail dialog per protocol with the costed verdict banner (est. cost · time · avg $/hr), the implied-value arithmetic (the page recomputes each row from the same rounded multipliers the data carries), the launch signs to watch, the validation figures for the row's own category, and the farm plan — seven steps with what each costs, how long it takes and where to do it.

## Repository layout

```
main.ts            the entry program: parse, fit, validate, score, write
lib/model.ts       snapshot parsing, eligibility, comparables fit, validation (LOO, walk-forward,
                   range honesty), scoring, board assembly
lib/plans.ts       farm plans and costed verdicts ($/hr) from each protocol's own record
dashboard/         index.html, app.css, app.js — the page the program copies to /output
vendor/makefun-board.ts   make.fun's dossier library, unchanged
screenshots/       the three hand-in screenshots
```

## License

MIT — see [LICENSE](LICENSE).
