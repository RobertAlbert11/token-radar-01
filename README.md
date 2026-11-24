# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RobertAlbert11/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/RobertAlbert11/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)
Node 22, stdlib only. Reads the sealed snapshot, fits the comparables model on the protocols whose
tokens already trade, ranks every pre-token protocol by what a launch would be worth, writes board, dashboard, dossier. **NO network.**

    rm -rf out && mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

## The model

    implied = round( tvl_usd × multiple × trend × patience )

- **multiple** — log10 size curve `log10(mcap/TVL) = a + b·log10 TVL + c·growth` (c clamped ±0.02) plus
  James-Stein-shrunken category offsets `peers/(peers+20)`; clamped 0.05–8x.
- **trend** — `1 + clamp(change_7d, -60, +150)/100 × 0.4`. **patience** — `0.55 + 0.45·min(age,1095)/1095`.
- Validated **out-of-sample**: leave-one-out over 119 peers, walk-forward, per-feature ablation with
  placebo controls (shuffled growth / chain counts of other protocols — must not help, kept out),
  a **200-refit bootstrap** (per-row rank ranges, implied P25–P75/P10–P90 bands, coefficient s.e.),
  and logistic token odds scored by Brier (ten-fold + walk-forward). Shipped: LOO 3.45x, WF 2.15x.

## The page

The ranked board (with an **integrity bar** — rows recomputed in-page, values and checksum verified
against board.json), the **protocol accounting** strip, the **out-of-sample evidence** table with
fitted coefficients ± bootstrap s.e. and placebo rows, **token odds** with per-step Brier and logit
coefficients ± s.e., and a detail view per protocol: value
build-up with bootstrap rank range, costed farm plan, **NET $/hour** verdicts (FARM / MARGINAL / SKIP),
blind comparables, sensitivity matrix, cap-vs-TVL scatter. Presets re-derive verdicts in-browser.

## Layout

    main.ts       entry: parse, fit, write board.json / data.js / dashboard / dossier
    lib/model.ts  parsing, comparables fit, scoring, validation, ablation, odds, accounting
    lib/plans.ts  farm plans, costed verdicts (gas, swap, T-bill charge -> NET $/hour)
    dashboard/    index.html, app.css, app.js (renders from data.js, no network)
