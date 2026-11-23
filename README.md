# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RobertAlbert11/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RobertAlbert11/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)


Node 22, standard library only. Reads the sealed snapshot, fits the comparables model on the protocols
whose tokens already trade, ranks every pre-token protocol by what a launch would be worth, and writes
the board, the dashboard and the dossier. **NO network: no fetch, no imports — it reads only its own
input file.**

    rm -rf out && mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

## The model

    implied = round( tvl_usd × category_multiple × trend × patience )

- **category_multiple** — median mcap/TVL over the snapshot's token-bearing peers, damped 40/60 toward
  the blended market multiple; a category carried by one outlier does not price every protocol in it.
- **trend** — `1 + clamp(change_7d, -60, +150)/100 × 0.4`: growth raises the estimate, a rout cuts it.
- **patience** — `0.55 + 0.45 × min(age, 1095)/1095`: the longer a protocol runs with no token, the
  less scarcity value a launch carries. Age discounts, not rewards.
- Implied values are **validated out-of-sample**: leave-one-out over 119 token-bearing peers, a
  walk-forward split, a per-feature ablation (base rate / size / +growth / +category) with miss
  multipliers and band coverage, and a token-odds estimate scored by Brier against the base rate.

## What the page shows

The ranked board (with an **integrity bar** — rows recomputed in-page, ranks in order, values never
rise, totals and checksum verified against board.json), the **protocol accounting** strip (every one of
the 758 snapshot protocols in exactly one bucket), the **out-of-sample evidence** table with the fitted
coefficients printed, **token odds with Brier scores**, and a detail view per protocol: the value
build-up with every intermediate number, a costed farm plan (each step with its cost and time), the
cost breakdown netted into one **NET $/hour** with FARM / MARGINAL / SKIP verdicts, nearest traded
comparables each fitted blind, a sensitivity matrix, and a cap-vs-TVL scatter. The filter bar presets
re-derive the verdicts in-browser; a CSV export button writes the board out.

## Layout

    main.ts            entry: parse, fit, write board.json / data.js / dashboard / dossier
    lib/model.ts       parsing, comparables fit, scoring, validation, ablation, odds, accounting
    lib/plans.ts       farm plans, costed verdicts (gas, swap fee, T-bill charge → NET $/hour)
    dashboard/         index.html, app.css, app.js (renders from data.js, no network)
    vendor/            make.fun's dossier library, byte-identical
