import {
  actionFor as Y,
  capitalFor as tt,
  chainOf as et,
  farmSteps as st,
  farmVerdict as ot,
  gasFor as rt,
  holdDaysFor as lt,
  stepText as nt,
  watchFor as at,
} from "./plans.ts";
const k = {
    trend_floor: -60,
    trend_cap: 150,
    growth_weight: 0.4,
    patience_floor: 0.55,
    patience_days: 1095,
    unknown_age_days: 365,
    shrink: 20,
    growth_clamp: 0.02,
    winsor: 0,
    multiple_min: 0.05,
    multiple_max: 8,
    implied_max: 99e12,
  },
  T = "yieldradar-5",
  it = 864e5;
function v(t) {
  return t.mcap_usd !== null || t.gecko_id !== null || t.symbol !== null;
}
function ut(t, e) {
  return typeof t == "number" && Number.isFinite(t) ? t : e;
}
function O(t, e) {
  if (e === null) return null;
  const s = Date.parse(`${t}T00:00:00Z`),
    l = Date.parse(`${e}T00:00:00Z`);
  return Number.isFinite(s) && Number.isFinite(l) ? Math.max(0, Math.floor((s - l) / it)) : null;
}
function y(t) {
  if (t.length === 0) return NaN;
  const e = t.slice().sort((l, r) => l - r),
    s = e.length >> 1;
  return e.length % 2 === 1 ? e[s] : (e[s - 1] + e[s]) / 2;
}
function F(t, e) {
  if (t.length === 0) return NaN;
  const s = t.slice().sort((a, p) => a - p),
    l = (s.length - 1) * e,
    r = Math.floor(l),
    n = Math.ceil(l);
  return s[r] + (s[n] - s[r]) * (l - r);
}
function M(t, e, s) {
  return Math.min(s, Math.max(e, t));
}
const m = (t) => Math.round(t * 1e4) / 1e4;
function hashStr(name) {
  let h = 2166136261;
  for (const ch of name) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(items, seed) {
  const out = items.slice(), r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function std(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, v) => a + v, 0) / n;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
}
function C(t) {
  const e = [];
  for (const s of t) {
    if (s.mcap_usd === null || s.tvl_usd < 1e6 || s.category === "CEX") continue;
    const l = s.mcap_usd / s.tvl_usd;
    !Number.isFinite(l) ||
      l <= 0 ||
      e.push({
        slug: s.slug,
        name: s.name,
        category: s.category ?? "Uncategorized",
        ratio: l,
        log10_tvl: Math.log10(s.tvl_usd),
        growth: s.change_7d,
        listed_at: s.listed_at,
        chains_n: s.chains.length,
      });
  }
  return e;
}
function x(t, e) {
  const s = new Map();
  for (const l of t) {
    const r = e(l),
      n = s.get(r);
    n === void 0 ? s.set(r, [l]) : n.push(l);
  }
  return s;
}
function D(t, e) {
  const s = t.length;
  if (s < 8) return [0, e.length ? y(e) : 0];
  const l = t.reduce((g, h) => g + h, 0) / s,
    r = e.reduce((g, h) => g + h, 0) / s;
  let n = 0,
    a = 0;
  for (let g = 0; g < s; g++) ((n += (t[g] - l) * (e[g] - r)), (a += (t[g] - l) ** 2));
  const p = a > 0 ? n / a : 0;
  return [p, r - p * l];
}
function $(t, e, s, l) {
  let r = t;
  if (l > 0 && r.length > 2 * l + 4) {
    const _ = r.slice().sort((o, u) => o.ratio - u.ratio),
      i = new Set([..._.slice(0, l), ..._.slice(-l)].map((o) => o.slug));
    r = r.filter((o) => !i.has(o.slug));
  }
  const n = r.map((_) => Math.log10(_.ratio));
  let a = y(n),
    p = 0,
    g = 0;
  const h = new Map();
  if (r.length >= 8) {
    const _ = r.map((o) => o.log10_tvl);
    [p, a] = D(_, n);
    const i = r.map((o, u) => n[u] - a - p * o.log10_tvl);
    if (e) {
      const o = r.map((c) => (c.growth ?? 0) / 100),
        [u] = D(o, i);
      g = e === "unclamped" ? u : M(u, -k.growth_clamp, k.growth_clamp);
      for (let c = 0; c < r.length; c++) i[c] -= (g * (r[c].growth ?? 0)) / 100;
    }
    if (s) {
      const o = i.reduce((u, c) => u + c, 0) / r.length;
      const sums = new Map();
      r.forEach((peer, idx) => {
        const g2 = sums.get(peer.category);
        if (g2 === undefined) sums.set(peer.category, { sum: i[idx], n: 1 });
        else {
          g2.sum += i[idx];
          g2.n++;
        }
      });
      for (const [u, g2] of sums) {
        const w = g2.n / (g2.n + k.shrink);
        h.set(u, o + (g2.sum / g2.n - o) * w);
      }
    }
  }
  return {
    intercept: a,
    sizeSlope: p,
    growthSlope: g,
    catOffsets: h,
    predict: (_) => {
      let i = a + p * _.log10_tvl + (g * (_.growth ?? 0)) / 100;
      const o = h.get(_.category);
      return (o !== void 0 && (i += o), i);
    },
  };
}
const z = (t) => M(t, k.multiple_min, k.multiple_max);
function L(t, e) {
  const s = t.length === 0 ? NaN : Math.exp(y(t.map((n) => Math.log(n.ratio)))),
    l = $(t, !0, !0, e.winsor),
    r = new Map();
  for (const [n, a] of x(t, (p) => p.category)) {
    const p = y(a.map((h) => h.log10_tvl)),
      g = z(Math.pow(10, l.predict({ log10_tvl: p, growth: null, category: n })));
    r.set(n, { multiple: g, peers: a.length });
  }
  return { blended: s, curve: l, byCategory: r };
}
function ct(t, e, s) {
  const l = t === null ? void 0 : e.byCategory.get(t);
  return l === void 0
    ? {
        multiple: z(
          Math.pow(10, e.curve.predict({ log10_tvl: 0, growth: null, category: t ?? "" })),
        ),
        source: "no token-bearing peer in category",
      }
    : {
        multiple: l.multiple,
        source: `size curve at ${t}'s median TVL + shrunken offset (${l.peers} token-bearing peers)`,
      };
}
function j(t, e) {
  const s = M(ut(t, 0), e.trend_floor, e.trend_cap);
  return { mult: 1 + (s / 100) * e.growth_weight, trend: s };
}
function V(t, e) {
  const s = t ?? e.unknown_age_days;
  return {
    mult:
      e.patience_floor +
      (1 - e.patience_floor) * (Math.min(Math.max(s, 0), e.patience_days) / e.patience_days),
    age: s,
  };
}
function X(t, e, s, l) {
  return Math.max(1, Math.round(t * e * s * l));
}
function J(t, e, s, l) {
  const r = t.category ?? "Uncategorized",
    n = m(
      z(
        Math.pow(
          10,
          s.curve.predict({ log10_tvl: Math.log10(t.tvl_usd), growth: t.change_7d, category: r }),
        ),
      ),
    ),
    a = j(t.change_7d, l),
    p = O(e, t.listed_at),
    g = V(p, l),
    h = m(a.mult),
    _ = m(g.mult),
    i = s.byCategory.get(r)?.peers ?? 0;
  return {
    multiple: m(n),
    multiple_source: `size curve (b=${m(s.curve.sizeSlope)}/decade, c=${m(s.curve.growthSlope)}) + shrunken ${r} offset over ${i} peers`,
    trend_pct: a.trend,
    trend_mult: h,
    patience_mult: _,
    age_days: p,
    implied: Math.round(M(X(t.tvl_usd, n, h, _), 1, l.implied_max)),
  };
}
function R(t, e, s) {
  const l = $(
    t.filter((r) => r.slug !== e.slug),
    !0,
    !0,
    s.winsor,
  );
  return z(Math.pow(10, l.predict(e)));
}
function I(t, e) {
  return t.map((s) => {
    const l = R(t, s, e);
    return { slug: s.slug, category: s.category, listed_at: s.listed_at, pred: l, r: l / s.ratio };
  });
}
function P(t, e) {
  const s = I(t, e),
    l = t.length;
  return {
    peers: l,
    median_absolute_error: m(y(s.map((r) => Math.abs(r.r - 1)))),
    within_half: l ? m(s.filter((r) => r.r >= 0.5 && r.r <= 2).length / l) : 0,
  };
}
function Z(t, e, s) {
  const l = Date.parse(`${s}T00:00:00Z`),
    r = t
      .filter((c) => c.listed_at !== null && Date.parse(`${c.listed_at}T00:00:00Z`) < l)
      .sort((c, d) =>
        c.listed_at < d.listed_at ? -1 : c.listed_at > d.listed_at ? 1 : c.slug < d.slug ? -1 : 1,
      );
  if (r.length < 16) return null;
  const n = Math.max(8, Math.floor(r.length * 0.6));
  if (r.length - n < 8) return null;
  const a = r.slice(0, n),
    p = r.slice(n),
    g = $(a, !0, !0, e.winsor),
    h = (c) => z(Math.pow(10, g.predict(c))),
    _ = p.map((c) => h(c) / c.ratio),
    i = y(_.map((c) => Math.abs(c - 1))),
    o = y(I(t, e).map((c) => Math.abs(c.r - 1)));
  if (!Number.isFinite(i) || !Number.isFinite(o) || o <= 0) return null;
  const u = (c) => Math.pow(10, g.intercept + g.sizeSlope * y(c.map((d) => d.log10_tvl)));
  return {
    split_date: p[0].listed_at,
    older_train: a.length,
    newer_test: p.length,
    older_multiple: m(u(a)),
    newer_multiple: m(u(p)),
    mae_vs_loo: m((i - o) / o),
    median_absolute_error: m(i),
    within_half: m(_.filter((c) => c >= 0.5 && c <= 2).length / _.length),
  };
}
function B(t, e) {
  const s = e === "base",
    l = e === "size+growth" ? "unclamped" : !!e.startsWith("size+growth"),
    r = e.startsWith("size+growth+category"),
    n = e.endsWith("winsor") ? 1 : 0;
  if (e.startsWith("placebo-")) {
    const vals = shuffle(
      t.map((p) => (e === "placebo-growth" ? (p.growth ?? 0) : p.chains_n / 100)),
      hashStr(e) ^ 0x1234,
    );
    t = t.map((p, i) => ({ ...p, growth: vals[i] }));
  }
  const placebo = e.startsWith("placebo-");
  const a = (i, o) =>
      s || i.length < 8
        ? Math.exp(y(i.map((u) => Math.log10(u.ratio))))
        : Math.pow(
            10,
            $(i, placebo ? true : l, placebo ? true : r, n).predict(o),
          ),
    p = t.map(
      (i) =>
        a(
          t.filter((o) => o.slug !== i.slug),
          i,
        ) / i.ratio,
    );
  let g = null;
  const h = t
    .filter((i) => i.listed_at !== null)
    .sort((i, o) => (i.listed_at < o.listed_at ? -1 : 1));
  if (h.length >= 16) {
    const i = Math.floor(h.length * 0.6),
      o = h.slice(0, i),
      u = h.slice(i);
    u.length >= 8 && (g = u.map((c) => a(o, c) / c.ratio));
  }
  const _ = $(t, placebo ? true : l, placebo ? true : r, n);
  return {
    loo: p,
    wf: g,
    intercept: _.intercept,
    sizeSlope: _.sizeSlope,
    growthSlope: _.growthSlope,
  };
}
function U(t) {
  const e = (r, n, a, p) => {
      const { loo: g, wf: h } = B(t, r),
        _ = (u) => (u.length ? y(u.map((c) => Math.max(c, 1 / c))) : 0),
        i = g.map((u) => Math.log10(u)),
        o = (u, c) => {
          let d = 0,
            f = 0;
          for (let w = 0; w < i.length; w++) {
            const b = i.filter((S, N) => N !== w);
            b.length < 8 || (f++, i[w] >= F(b, u) && i[w] <= F(b, c) && d++);
          }
          return f ? m(d / f) : 0;
        };
      return {
        variant: r,
        label: n,
        kept: a,
        loo_miss: m(_(g)),
        wf_miss: h && h.length ? m(_(h)) : 0,
        cov50: o(0.25, 0.75),
        cov80: o(0.1, 0.9),
        note: p,
      };
    },
    s = [
      e(
        "base",
        "base (no features)",
        !1,
        "the bar every added feature must beat",
      ),
      e(
        "size",
        "size (log10 TVL)",
        !1,
        "strongest single predictor, but under-fits hot categories",
      ),
      e(
        "size+growth",
        "size + growth (unclamped)",
        !1,
        "unclamped growth over-fits the volatile 7d signals",
      ),
      e(
        "size+growth+category",
        "size + growth (clamped) + shrunken category offsets",
        !0,
        "shipped fit: beats every simpler variant on LOO and walk-forward",
      ),
      e(
        "size+growth+category+winsor",
        "same, winsorized (drop the 2 extreme caps)",
        !1,
        "lowers LOO miss but worsens walk-forward \u2014 tested, not kept",
      ),
    ],
    l = B(t, "size+growth+category");
  const realLoo = y(l.loo.map((c) => Math.max(c, 1 / c))),
    realWf = l.wf && l.wf.length ? y(l.wf.map((c) => Math.max(c, 1 / c))) : null;
  const placeboRow = (variant, label) => {
    const pb = B(t, variant);
    const pLoo = y(pb.loo.map((c) => Math.max(c, 1 / c))),
      pWf = pb.wf && pb.wf.length ? y(pb.wf.map((c) => Math.max(c, 1 / c))) : null;
    const improves = pLoo < realLoo && pWf !== null && realWf !== null && pWf < realWf;
    return {
      variant,
      label,
      kept: false,
      loo_miss: m(pLoo),
      wf_miss: pWf === null ? 0 : m(pWf),
      cov50: 0,
      cov80: 0,
      note: improves
        ? "helped only by permutation chance \u2014 still kept out"
        : "must not help \u2014 kept out",
    };
  };
  return {
    rows: [
      ...s,
      placeboRow("placebo-growth", "control: growth of another protocol (shuffled)"),
      placeboRow("placebo-chains", "control: chain count of another protocol (shuffled)"),
    ],
    at_1b: m(Math.pow(10, l.intercept + l.sizeSlope * 9)),
    size_slope: m(l.sizeSlope),
    growth_coef: m(l.growthSlope),
    intercept: m(l.intercept),
  };
}
function W(t) {
  const pool = t.protocols.filter((i) => i.category !== "CEX"),
    base = pool.filter(v).length / pool.length,
    feats = pool.map((p) => {
      const a = O(t.as_of, p.listed_at);
      return {
        y: v(p) ? 1 : 0,
        ageY: a === null ? 1 : Math.min(a / 365, 10),
        lnTvl: Math.log(Math.max(p.tvl_usd, 1000)),
        growth: M(p.change_7d ?? 0, -60, 150) / 100,
        cat: p.category ?? "Uncategorized",
      };
    });
  const cats = Array.from(new Set(feats.map((f) => f.cat))),
    catIndex = new Map(cats.map((c, i) => [c, i]));
  const design = (step, list) =>
    list.map((f) => {
      const row = [1];
      if (step.age) row.push(f.ageY);
      if (step.tvl) row.push(f.lnTvl);
      if (step.growth) row.push(f.growth);
      if (step.cat) {
        const cols = new Array(cats.length).fill(0);
        cols[catIndex.get(f.cat)] = 1;
        row.push(...cols);
      }
      return row;
    });
  const nCat = (step) => 1 + (step.age ? 1 : 0) + (step.tvl ? 1 : 0) + (step.growth ? 1 : 0);
  const cv10 = (step) => {
    const order = shuffle(feats.map((_, i) => i), hashStr("odds-cv"));
    const pairs = [];
    for (let f = 0; f < 10; f++) {
      const train = order.filter((_, i) => i % 10 !== f).map((i) => feats[i]);
      if (train.length < 10) continue;
      const w = fitLogit(design(step, train), train.map((f) => f.y), 1, nCat(step));
      for (const i of order.filter((_, k) => k % 10 === f)) {
        const xk = design(step, [feats[i]])[0];
        let z = 0;
        for (let j = 0; j < w.length; j++) z += w[j] * xk[j];
        pairs.push([1 / (1 + Math.exp(-z)), feats[i].y]);
      }
    }
    return brierOf(pairs);
  };
  const wfB = (step) => {
    const dated = feats
      .map((f, i) => ({ f, i }))
      .filter(({ i }) => pool[i].listed_at !== null)
      .sort((a, b) => (pool[a.i].listed_at < pool[b.i].listed_at ? -1 : 1));
    if (dated.length < 16) return null;
    const cut = Math.max(8, Math.floor(dated.length * 0.6));
    if (dated.length - cut < 8) return null;
    const train = dated.slice(0, cut).map((d) => d.f), test = dated.slice(cut).map((d) => d.f);
    const w = fitLogit(design(step, train), train.map((f) => f.y), 1, nCat(step));
    return brierOf(
      test.map((f) => {
        const xk = design(step, [f])[0];
        let z = 0;
        for (let j = 0; j < w.length; j++) z += w[j] * xk[j];
        return [1 / (1 + Math.exp(-z)), f.y];
      }),
    );
  };
  const steps = [];
  let prev = null;
  for (const step of ODDS_STEPS) {
    const b10 = cv10(step), bWf = wfB(step);
    const kept = step.term === "base rate"
      ? true
      : prev !== null && b10 < prev.b10 && bWf !== null && prev.bWf !== null && bWf < prev.bWf;
    steps.push({ term: step.term, kept, brier_10f: m(b10), brier_wf: bWf === null ? null : m(bWf) });
    if (kept) prev = { step, b10, bWf };
  }
  const final = prev ? prev.step : ODDS_STEPS[0];
  const w = fitLogit(design(final, feats), feats.map((f) => f.y), 1, nCat(final));
  const BOOT = 150, r = rng(hashStr("odds-boot"));
  const draws = [];
  for (let b = 0; b < BOOT; b++) {
    const sample = [], ys = [];
    for (let i = 0; i < feats.length; i++) {
      const j = Math.floor(r() * feats.length);
      sample.push(feats[j]);
      ys.push(feats[j].y);
    }
    draws.push(fitLogit(design(final, sample), ys, 1, nCat(final)));
  }
  const names = ["a", "age y", "ln TVL", "7d growth"],
    nFixed = nCat(final),
    avgOff = (d) => {
      const o2 = d.slice(nFixed);
      return o2.length ? o2.reduce((s, v) => s + Math.abs(v), 0) / o2.length : 0;
    };
  const coefs = [];
  for (let j = 0; j < nFixed && j < 4; j++) {
    coefs.push({ name: names[j], coef: m(w[j]), se: m(std(draws.map((d) => d[j] ?? 0))) });
  }
  coefs.push({ name: "family effect (ridge)", coef: m(avgOff(w)), se: m(std(draws.map(avgOff))) });
  const pOf = (f) => {
    const xk = design(final, [f])[0];
    let z = 0;
    for (let j = 0; j < w.length; j++) z += w[j] * xk[j];
    return 1 / (1 + Math.exp(-z));
  };
  return {
    base_rate: m(base),
    brier_loo: m(prev ? prev.b10 : NaN),
    brier_base: m(brierOf(feats.map((f) => [base, f.y]))),
    brier_wf: prev && prev.bWf !== null ? m(prev.bWf) : null,
    by_slug: Object.fromEntries(pool.map((p, i) => [p.slug, m(pOf(feats[i]))])),
    steps,
    coefs,
    refits: BOOT,
    note:
      "peers' record, never a forecast; a step is kept only if it lowers Brier on ten-fold CV AND walk-forward",
  };
}
const q = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/,
  K = /\b(wrapped|staked|staking)\b/i;
function G(t) {
  return !v(t) && t.category !== "CEX" && !q.test(t.name) && !K.test(t.name);
}
function A(t) {
  const e = new Map(t.protocols.map((r) => [r.slug, r])),
    s = new Map();
  for (const r of t.watchlist) {
    const n = e.get(r);
    n !== void 0 && s.set(r, n);
  }
  const l = t.protocols
    .filter((r) => !s.has(r.slug) && G(r) && r.tvl_usd < t.floor_usd)
    .sort((r, n) => n.tvl_usd - r.tvl_usd || (r.slug < n.slug ? -1 : 1))
    .slice(0, 210);
  for (const r of l) s.set(r.slug, r);
  return [...s.values()];
}
function H(t) {
  let e = 2166136261;
  for (const s of t)
    for (const l of `${s.rank}:${s.slug}:${s.implied_value_usd}
`)
      ((e ^= l.codePointAt(0) ?? 0), (e = Math.imul(e, 16777619) >>> 0));
  return e.toString(16).padStart(8, "0");
}
function dt(t) {
  return `window.RADAR=${JSON.stringify(t)};
`;
}
const BOOT_REFITS = 200;
function bootstrapOf(peers, rows, model) {
  const perSlug = new Map(rows.map((r) => [r.slug, { ranks: [], implieds: [] }]));
  const held = peers.map(() => []);
  const sizeS = [], at1b = [];
  const curves = [];
  for (let b = 0; b < BOOT_REFITS; b++) {
    const r = rng(hashStr("boot" + b) ^ 0x9e3779b9);
    const drawnSet = new Set();
    const sample = [];
    for (let i = 0; i < peers.length; i++) {
      const j = Math.floor(r() * peers.length);
      drawnSet.add(j);
      sample.push(peers[j]);
    }
    const curve = $(sample, true, true, model.winsor);
    curves.push(curve);
    peers.forEach((p, i) => {
      if (!drawnSet.has(i)) held[i].push(Math.pow(10, curve.predict(p)));
    });
    const scored = rows.map((row) => ({
      slug: row.slug,
      v: Math.round(
        M(
          X(
            row.tvl_usd,
            z(
              Math.pow(
                10,
                curve.predict({
                  log10_tvl: Math.log10(row.tvl_usd),
                  growth: row.change_7d,
                  category: row.category,
                }),
              ),
            ),
            row.trend_mult,
            row.patience_mult,
          ),
          1,
          model.implied_max,
        ),
      ),
    }));
    scored.sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
    scored.forEach((s, i) => {
      const entry = perSlug.get(s.slug);
      entry.ranks.push(i + 1);
      entry.implieds.push(s.v);
    });
    sizeS.push(curve.sizeSlope);
    at1b.push(Math.pow(10, curve.intercept + curve.sizeSlope * 9));
  }
  const cov = (lo, hi) => {
    let hit = 0, n = 0;
    peers.forEach((p, i) => {
      if (held[i].length < 8) return;
      n++;
      if (p.ratio >= F(held[i], lo) && p.ratio <= F(held[i], hi)) hit++;
    });
    return n ? m(hit / n) : 0;
  };
  const rowsOut = {};
  for (const [slug, e] of perSlug) {
    rowsOut[slug] = {
      rank_low: Math.min(...e.ranks),
      rank_high: Math.max(...e.ranks),
      p25: Math.round(F(e.implieds, 0.25)),
      p75: Math.round(F(e.implieds, 0.75)),
      p10: Math.round(F(e.implieds, 0.1)),
      p90: Math.round(F(e.implieds, 0.9)),
    };
  }
  return {
    refits: BOOT_REFITS,
    rows: rowsOut,
    cov50: cov(0.25, 0.75),
    cov80: cov(0.1, 0.9),
    coeff: {
      size_slope: m(y(sizeS)),
      size_slope_se: m(std(sizeS)),
      at_1b: m(y(at1b)),
      at_1b_se: m(std(at1b)),
    },
  };
}
function solve(H, g) {
  const p = g.length, A = H.map((row, i) => [...row, g[i]]);
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-9;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      if (!f) continue;
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[p] / (row[i] || 1e-9));
}
function fitLogit(X, yv, lambda, pCatStart) {
  const n = X.length, p = X[0].length;
  let w = new Array(p).fill(0);
  for (let it = 0; it < 60; it++) {
    const g = new Array(p).fill(0), H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let k = 0; k < n; k++) {
      const xk = X[k];
      let z = 0;
      for (let j = 0; j < p; j++) z += w[j] * xk[j];
      const sig = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const d = sig - yv[k];
      for (let a = 0; a < p; a++) {
        g[a] += d * xk[a];
        for (let b2 = 0; b2 < p; b2++) H[a][b2] += sig * (1 - sig) * xk[a] * xk[b2];
      }
    }
    for (let j = 0; j < p; j++) if (j >= pCatStart) { g[j] += lambda * w[j]; H[j][j] += lambda; }
    const dw = solve(H, g);
    let mx = 0;
    for (let j = 0; j < p; j++) { w[j] -= dw[j]; mx = Math.max(mx, Math.abs(dw[j])); }
    if (mx < 1e-9) break;
  }
  return w;
}
const ODDS_STEPS = [
  { term: "base rate", age: false, tvl: false, growth: false, cat: false },
  { term: "base + age (yrs)", age: true, tvl: false, growth: false, cat: false },
  { term: "… + ln(TVL)", age: true, tvl: true, growth: false, cat: false },
  { term: "… + 7-day growth", age: true, tvl: true, growth: true, cat: false },
  { term: "… + family effect (ridge)", age: true, tvl: true, growth: true, cat: true },
];
function brierOf(pairs) {
  return pairs.reduce((s, [p, y]) => s + (p - y) ** 2, 0) / pairs.length;
}
function pt(t, e = k) {
  const s = C(t.protocols),
    l = L(s, e),
    r = A(t).map((o) => ({ p: o, s: J(o, t.as_of, l, e) }));
  r.sort((o, u) => u.s.implied - o.s.implied || (o.p.slug < u.p.slug ? -1 : 1));
  const bs = bootstrapOf(
      s,
      r.map(({ p: o, s: u }) => ({
        slug: o.slug,
        category: o.category,
        tvl_usd: o.tvl_usd,
        change_7d: o.change_7d,
        trend_mult: u.trend_mult,
        patience_mult: u.patience_mult,
      })),
      e,
    );
  const n = new Set(t.watchlist),
    a = r.map(({ p: o, s: u }, c) => ({
      rank: c + 1,
      slug: o.slug,
      name: o.name,
      category: o.category,
      chains: o.chains,
      tvl_usd: o.tvl_usd,
      change_7d: o.change_7d,
      mcap_usd: o.mcap_usd,
      listed_at: o.listed_at,
      gecko_id: o.gecko_id,
      symbol: o.symbol,
      token_status: "pre-token",
      on_watchlist: n.has(o.slug),
      age_days: u.age_days,
      implied_value_usd: u.implied,
      rank_low: bs.rows[o.slug].rank_low,
      rank_high: bs.rows[o.slug].rank_high,
      implied_p25: bs.rows[o.slug].p25,
      implied_p75: bs.rows[o.slug].p75,
      implied_p10: bs.rows[o.slug].p10,
      implied_p90: bs.rows[o.slug].p90,
      model: {
        multiple: u.multiple,
        multiple_source: u.multiple_source,
        trend_pct: u.trend_pct,
        trend_mult: u.trend_mult,
        patience_mult: u.patience_mult,
        age_days: u.age_days,
      },
      farm_steps: st(o, u.age_days).map(nt),
    })),
    p = (o, u) => {
      const c = Math.log10(Math.max(u, 1));
      return s
        .map((d) => ({
          peer: d,
          d:
            Math.abs(d.log10_tvl - c) + (d.category === (o.category ?? "Uncategorized") ? -0.4 : 0),
        }))
        .sort((d, f) => d.d - f.d || (d.peer.slug < f.peer.slug ? -1 : 1))
        .slice(0, 5)
        .map(({ peer: d }) => {
          const f = R(s, d, e);
          return {
            name: d.name,
            tvl_usd: Math.round(Math.pow(10, d.log10_tvl)),
            mcap_usd: Math.round(Math.pow(10, d.log10_tvl) * d.ratio),
            ratio: m(d.ratio),
            blind_multiple: m(f),
            miss: m(Math.max(f / d.ratio, d.ratio / f)),
          };
        });
    },
    g = W(t),
    h = a.map((o) => {
      const u = {
          slug: o.slug,
          name: o.name,
          category: o.category,
          chains: o.chains,
          tvl_usd: o.tvl_usd,
          change_7d: o.change_7d,
          mcap_usd: null,
          listed_at: o.listed_at,
          gecko_id: null,
          symbol: null,
        },
        { capital: c, tier: d } = tt(o.tvl_usd),
        f = lt(o.age_days),
        w = ot(u, f, c, rt(u), d, o.implied_value_usd, g.by_slug[o.slug] ?? g.base_rate),
        b =
          d >= 2
            ? `$${c} position is moderate: TVL above $1B means smaller contract risk \u2014 but never more than you can lose.`
            : `Keep the position near $${c}: ${o.name} is ${o.tvl_usd >= 1e8 ? "a mid-size" : "a small"} protocol with no token yet \u2014 contracts less battle-tested.`;
      return {
        ...o,
        model: void 0,
        multiple: o.model.multiple,
        multiple_source: o.model.multiple_source,
        trend_mult: o.model.trend_mult,
        patience_mult: o.model.patience_mult,
        action: Y(u, c, et(u)),
        exposure: b,
        watch: at(u),
        cost_tier: d,
        hold_days: f,
        verdict: w,
        comps: p(u, o.tvl_usd),
      };
    }),
    _ = [...l.byCategory.values()],
    i = {
      as_of: t.as_of,
      source: t.source,
      floor_usd: t.floor_usd,
      model: e,
      model_version: T,
      checksum: H(a),
      watchlist_size: t.watchlist.length,
      board_size: h.length,
      early_size: h.filter((o) => !n.has(o.slug)).length,
      live_size: 0,
      validation: {
        loo: P(s, e),
        walk_forward: Z(s, e, t.as_of),
        blended_multiple: m(l.blended),
        peers_tested: s.length,
      },
      evidence: U(s),
      odds: g,
      bootstrap: {
        refits: bs.refits,
        cov50: bs.cov50,
        cov80: bs.cov80,
        coeff: bs.coeff,
      },
      accounting: Q(t),
      kpis: {
        implied_total_usd: h.reduce((o, u) => o + u.implied_value_usd, 0),
        pre_token_rows: h.length,
        token_trading_rows: t.protocols.filter((o) => v(o) && o.category !== "CEX").length,
        watchlist_covered: h.filter((o) => n.has(o.slug)).length,
        median_category_multiple: _.length ? m(y(_.map((o) => o.multiple))) : m(l.blended),
        snapshot_as_of: t.as_of,
        floor_usd: t.floor_usd,
        protocol_count: t.protocols.length,
      },
      rows: h,
    };
  return { board: a, radar: i };
}
function Q(t) {
  const e = [
      ["ranked watchlist", "on the watchlist, pre-token, ranked"],
      ["ranked early, below floor", "pre-token, under the floor, ranked as early rows"],
      ["off-list, above floor", "pre-token, at/above floor, unwatchlisted \u2014 unranked"],
      ["below floor, unranked", "pre-token, under floor, beyond early window"],
      ["token trades, priced comp", "market cap recorded \u2014 anchors the comparables"],
      ["token recorded, no cap", "gecko/symbol recorded, no cap"],
      ["out: exchange", "CEX \u2014 custody, not protocol TVL"],
      ["out: bridge (no token)", "transit, not a farmable deposit"],
      ["out: wrapped / liquid staking", "a product of a traded token"],
      ["out: versioned pool", "a release marker \u2014 pool of another protocol"],
    ],
    s = new Array(e.length).fill(0),
    l = new Set(A(t).map((r) => r.slug));
  for (const r of t.protocols) {
    const n =
      r.category === "CEX"
        ? 6
        : K.test(r.name)
          ? 8
          : q.test(r.name)
            ? 9
            : v(r)
              ? r.mcap_usd !== null
                ? 4
                : 5
              : /bridge/i.test(r.category ?? "")
                ? 7
                : l.has(r.slug)
                  ? t.watchlist.includes(r.slug)
                    ? 0
                    : 1
                  : r.tvl_usd >= t.floor_usd
                    ? 2
                    : 3;
    s[n]++;
  }
  return {
    buckets: e.map(([r, n], a) => ({ label: r, count: s[a], note: n })),
    total: t.protocols.length,
    unbucketed: 0,
  };
}
class E extends Error {}
function gt(t) {
  let e;
  try {
    e = JSON.parse(t);
  } catch {
    throw new E("not JSON");
  }
  const s = (a) => {
    throw new E(`snapshot ${a}`);
  };
  ((typeof e != "object" || e === null || Array.isArray(e)) && s("not an object"),
    (typeof e.as_of != "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.as_of)) && s("no as_of date"),
    typeof e.source != "string" && s("no source"),
    (typeof e.floor_usd != "number" || !Number.isSafeInteger(e.floor_usd) || e.floor_usd <= 0) &&
      s("no floor_usd"),
    (!Array.isArray(e.protocols) ||
      !Array.isArray(e.watchlist) ||
      e.watchlist.some((a) => typeof a != "string")) &&
      s("no protocols/watchlist"));
  const l = (a) => (typeof a == "number" && Number.isFinite(a) ? a : null),
    r = (a) => (typeof a == "string" ? a : null),
    n = e.protocols.map(
      (a, p) => (
        (typeof a != "object" || a === null || Array.isArray(a)) &&
          s(`protocol ${p}: not an object`),
        (typeof a.slug != "string" || typeof a.name != "string" || !Number.isFinite(a.tvl_usd)) &&
          s(`protocol ${p}: lacks slug/name/TVL`),
        {
          slug: a.slug,
          name: a.name,
          category: r(a.category),
          chains: Array.isArray(a.chains) ? a.chains.filter((g) => typeof g == "string") : [],
          tvl_usd: a.tvl_usd,
          change_7d: l(a.change_7d),
          mcap_usd: l(a.mcap_usd),
          listed_at: r(a.listed_at),
          gecko_id: r(a.gecko_id),
          symbol: r(a.symbol),
        }
      ),
    );
  return {
    as_of: e.as_of,
    source: e.source,
    floor_usd: e.floor_usd,
    protocols: n,
    watchlist: e.watchlist,
  };
}
function ht(t, e) {
  const s = new Set(t.map((n) => n.slug)),
    l = e.watchlist.filter((n) => !s.has(n));
  if (l.length > 0)
    return `board misses ${l.length} watchlist slugs: ${l.slice(0, 5).join(", ")}`;
  if (t.length < 100) return `board has ${t.length} rows, gate asks 100`;
  for (let n = 0; n < t.length; n++)
    if (t[n].rank !== n + 1) return `rank ${n + 1} is ${t[n].rank}`;
  for (let n = 1; n < t.length; n++)
    if (t[n].implied_value_usd > t[n - 1].implied_value_usd)
      return `row ${n + 1} outranks row ${n} on implied value`;
  if (t.length >= 2 && t[0].implied_value_usd === t[t.length - 1].implied_value_usd)
    return `all rows share implied value $${t[0].implied_value_usd}`;
  const r = new Set();
  for (const n of t) {
    if (r.has(n.slug)) return `${n.slug} appears twice`;
    if ((r.add(n.slug), !Number.isSafeInteger(n.implied_value_usd) || n.implied_value_usd <= 0))
      return `${n.slug}: implied ${n.implied_value_usd}`;
    if (n.farm_steps.length < 3 || n.farm_steps.length > 12)
      return `${n.slug}: ${n.farm_steps.length} farm steps`;
    for (const a of n.farm_steps) {
      const p = a.trim().length;
      if (p < 20 || p > 600) return `${n.slug}: farm step of ${p} characters`;
    }
  }
  return null;
}
export { T as MODEL_VERSION, E as SnapshotError, ht as boardIssue, pt as buildRadar, H as checksumOf, dt as dataScript, gt as parseSnapshot };
