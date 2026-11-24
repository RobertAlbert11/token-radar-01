# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RobertAlbert11/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/RobertAlbert11/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)


Node 22, standard library only. Reads the sealed snapshot, fits the comparables model on the
protocols whose tokens already trade, ranks every pre-token protocol by what a launch would be worth,
and writes the board, the dashboard and the dossier. **NO network.**

    rm -rf out && mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

## The model

    implied = round( tvl_usd × category_multiple × trend × patience )

- **category_multiple** — a least-squares size curve in log10 space, `log10(mcap/TVL) = a + b·log10 TVL
  + c·growth` (c clamped ±0.02), with per-category intercept offsets shrunk toward the global intercept
  James-Stein-style, weight `peers/(peers+20)`; clamped to 0.05–8x. A small category cannot drag the curve.
- **trend** — `1 + clamp(change_7d, -60, +150)/100 × 0.4`: growth raises it, a rout cuts it.
- **patience** — `0.55 + 0.45 × min(age, 1095)/1095`: age discounts, not rewards.
- Validated **out-of-sample**: leave-one-out over 119 peers, walk-forward, per-feature ablation with
  miss multipliers and band coverage (a winsorized variant dropping the 2 extreme caps lowers LOO miss
  but worsens walk-forward — tested, not kept), token odds scored by Brier. Shipped: LOO 3.45x, WF 2.15x.

## What the page shows

The ranked board (with an **integrity bar** — rows recomputed in-page, ranks in order, values never
rise, totals and checksum verified against board.json), the **protocol accounting** strip (all 758
protocols in one bucket), the **out-of-sample evidence** table with the fitted coefficients, **token
odds with Brier scores**, and a detail view per protocol: value build-up, a costed farm plan, cost
breakdown netted into one **NET $/hour** with FARM / MARGINAL / SKIP verdicts, nearest traded
comparables each fitted blind, a sensitivity matrix, a cap-vs-TVL scatter. Filter presets re-derive
verdicts in-browser; a CSV export button writes the board.

## Layout

    main.ts            entry: parse, fit, write board.json / data.js / dashboard / dossier
    lib/model.ts       parsing, comparables fit, scoring, validation, ablation, odds, accounting
    lib/plans.ts       farm plans, costed verdicts (gas, swap, T-bill charge → NET $/hour)
    dashboard/         index.html, app.css, app.js (renders from data.js, no network)
