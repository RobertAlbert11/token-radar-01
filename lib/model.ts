// YieldRadar's value model: one snapshot of the protocol universe in, one ranked board out.
// Implied value follows only from the snapshot's own figures. Markets price tokens at some multiple
// of the value users deposit (TVL), so the model derives each category's multiple from the protocols
// whose tokens already trade, damped toward the blended market multiple, then applies it to the
// pre-token protocols, shaped by 7-day growth and by how long each has run with no token:
//   implied = round( tvl_usd x category_multiple x trend x patience )
// Nothing is hardcoded: the same function scores every protocol, and the fit is verified by holding
// each peer out (LOO), by a temporal walk-forward split, by a per-feature ablation, and by a Brier
// score on the token-odds estimate.

import { actionFor, capitalFor, chainOf, farmSteps, farmVerdict, gasFor, holdDaysFor, stepText, watchFor } from './plans.ts';

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}
export interface ModelConstants {
  trend_floor: number; trend_cap: number; growth_weight: number;
  patience_floor: number; patience_days: number; unknown_age_days: number;
  damping: number; multiple_min: number; multiple_max: number; implied_max: number;
}
export const MODEL: ModelConstants = {
  trend_floor: -60, trend_cap: 150, growth_weight: 0.4,
  patience_floor: 0.55, patience_days: 1095, unknown_age_days: 365,
  damping: 0.6, multiple_min: 0.05, multiple_max: 8, implied_max: 99_000_000_000_000,
};
export const MODEL_VERSION = 'yieldradar-3';
/** Early (non-watchlist) rows the board carries, below the snapshot's TVL floor. */
export const EARLY_ROWS = 210;
/** Token-bearing rows the live view carries, by market cap. */
export const LIVE_ROWS = 20;

/** A protocol whose token already trades. The snapshot's nulls say "not recorded", never "none". */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to the snapshot's `asOf`, clamped at zero; null when either is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`), b = Date.parse(`${listedAt}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY_MS)) : null;
}
/** The median of a list (average of the two middle values when the count is even). */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = values.slice().sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
/** The p-th quantile (0..1) of a list. */
export function quantile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = values.slice().sort((a, b) => a - b), at = (s.length - 1) * p;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}
export function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------- comparables fit

/** One peer observation: a token-bearing protocol's mcap/TVL multiple. */
export interface Peer {
  slug: string; name: string; category: string; ratio: number;
  log_ratio: number; log10_tvl: number; growth: number | null; listed_at: string | null;
}
/** The token-bearing protocols' observations: CEX and sub-$1M TVL rows left out. */
export function collectPeers(protocols: SnapshotProtocol[]): Peer[] {
  const peers: Peer[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd < 1_000_000 || p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    peers.push({
      slug: p.slug, name: p.name, category: p.category ?? 'Uncategorized', ratio,
      log_ratio: Math.log(ratio), log10_tvl: Math.log10(p.tvl_usd),
      growth: p.change_7d, listed_at: p.listed_at,
    });
  }
  return peers;
}
/** The robust multiple of one group of peers: the geometric mean of their mcap/TVL ratios. */
function groupMultiple(peers: Peer[]): number {
  return peers.length === 0 ? NaN : Math.exp(median(peers.map((p) => p.log_ratio)));
}
export interface CategoryFit { multiple: number; peers: number }
/**
 * Category multiples, each damped `damping` of the way toward the blended multiple of every
 * token-bearing protocol: a category carried by one unusual peer prices like the market at large
 * rather than like its outlier. A category with no peer inherits the blended multiple outright.
 */
export function fitMultiples(peers: Peer[], model: ModelConstants): { blended: number; byCategory: Map<string, CategoryFit> } {
  const blended = groupMultiple(peers);
  const groups = groupBy(peers, (p) => p.category);
  const byCategory = new Map<string, CategoryFit>();
  for (const [category, list] of groups) {
    const damped = groupMultiple(list) * (1 - model.damping) + blended * model.damping;
    byCategory.set(category, { multiple: clamp(damped, model.multiple_min, model.multiple_max), peers: list.length });
  }
  return { blended, byCategory };
}
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(key(item));
    if (list === undefined) groups.set(key(item), [item]); else list.push(item);
  }
  return groups;
}
/** The multiple a protocol uses: its category's damped multiple, else the blend. */
export function multipleFor(category: string | null, byCategory: Map<string, CategoryFit>, blended: number, model: ModelConstants): { multiple: number; source: string } {
  const entry = category === null ? undefined : byCategory.get(category);
  if (entry === undefined) return { multiple: clamp(blended, model.multiple_min, model.multiple_max), source: 'blended market multiple (no token-bearing peer in this category)' };
  return { multiple: entry.multiple, source: `geometric mean of ${entry.peers} token-bearing ${category} peer${entry.peers === 1 ? '' : 's'}, damped ${Math.round((1 - model.damping) * 100)}/${Math.round(model.damping * 100)} toward the market blend` };
}

// ---------------------------------------------------------------- scoring

/** The trend multiplier from a 7-day change: growth raises the estimate, a rout cuts it. */
export function trendMultiplier(change7d: number | null, model: ModelConstants): { mult: number; trend: number } {
  const trend = clamp(finite(change7d, 0), model.trend_floor, model.trend_cap);
  return { mult: 1 + (trend / 100) * model.growth_weight, trend };
}
/** The scarcity discount: a protocol that has run longer with no token is priced lower, not higher. */
export function patienceMultiplier(age: number | null, model: ModelConstants): { mult: number; age: number } {
  const a = age ?? model.unknown_age_days;
  return { mult: model.patience_floor + (1 - model.patience_floor) * (Math.min(Math.max(a, 0), model.patience_days) / model.patience_days), age: a };
}
export interface ScoredInputs {
  multiple: number; multiple_source: string; trend_pct: number; trend_mult: number;
  patience_mult: number; age_days: number | null; implied: number;
}
/** The page recomputes a row from its figures; this is the arithmetic both sides share. */
export function impliedFromFigures(tvlUsd: number, multiple: number, trendMult: number, patienceMult: number): number {
  return Math.max(1, Math.round(tvlUsd * multiple * trendMult * patienceMult));
}
/** Score one protocol: TVL x category multiple x trend x patience, clamped to the model's band. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, byCategory: Map<string, CategoryFit>, blended: number, model: ModelConstants): ScoredInputs {
  const m = multipleFor(p.category, byCategory, blended, model);
  const t = trendMultiplier(p.change_7d, model);
  const age = ageDays(asOf, p.listed_at);
  const pat = patienceMultiplier(age, model);
  // The page recomputes the value from the rounded multipliers the data carries, so the board must
  // score from those same rounded figures, never from the unrounded ones.
  const trendMult = round4(t.mult), patienceMult = round4(pat.mult);
  return {
    multiple: m.multiple, multiple_source: m.source, trend_pct: t.trend, trend_mult: trendMult,
    patience_mult: patienceMult, age_days: age,
    implied: Math.round(clamp(impliedFromFigures(p.tvl_usd, m.multiple, trendMult, patienceMult), 1, model.implied_max)),
  };
}

// ---------------------------------------------------------------- validation

/** Held-out prediction for one peer: its category's multiple refitted without it, else the blend. */
function heldOutMultiple(peers: Peer[], category: string, heldOut: string, model: ModelConstants, blended: number): number {
  const train = peers.filter((p) => p.slug !== heldOut && p.category === category);
  const raw = train.length > 0 ? groupMultiple(train) : blended;
  return clamp(raw * (1 - model.damping) + blended * model.damping, model.multiple_min, model.multiple_max);
}
/** The peers' LOO prediction/actual ratios, once per peer: the raw material of every check below. */
function looRatios(peers: Peer[], model: ModelConstants): { slug: string; category: string; r: number; listed_at: string | null }[] {
  const blended = groupMultiple(peers);
  return peers.map((peer) => ({ slug: peer.slug, category: peer.category, listed_at: peer.listed_at, r: heldOutMultiple(peers, peer.category, peer.slug, model, blended) / peer.ratio }));
}
/** Leave-one-out over the mcap/TVL multiple: median abs error, band shares, Pearson r on logs. */
export function leaveOneOut(peers: Peer[], model: ModelConstants) {
  const rs = looRatios(peers, model);
  const errs = rs.map((x) => Math.abs(x.r - 1));
  const n = peers.length;
  const pred = rs.map((x) => Math.log(x.r)), actual = peers.map((p) => p.log_ratio);
  return {
    peers: n,
    median_absolute_error: round4(median(errs)),
    within_half: n ? round4(rs.filter((x) => x.r >= 0.5 && x.r <= 2).length / n) : 0,
    within_third: n ? round4(rs.filter((x) => x.r >= 1 / 3 && x.r <= 3).length / n) : 0,
    correlation: n < 3 ? 0 : round4(pearson(pred, actual)),
  };
}
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i]! - mx, dy = ys[i]! - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2);
}
/**
 * Walk-forward: fit on peers listed by the split date (older 60%), price peers listed after it.
 * Returns null when fewer than 16 dated peers cannot give both halves 8.
 */
export function walkForward(peers: Peer[], model: ModelConstants, asOf: string) {
  const dated = peers
    .filter((p) => p.listed_at !== null && Date.parse(`${p.listed_at}T00:00:00Z`) < Date.parse(`${asOf}T00:00:00Z`))
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  if (dated.length < 16) return null;
  const cut = Math.max(8, Math.floor(dated.length * 0.6));
  if (dated.length - cut < 8) return null;
  const train = dated.slice(0, cut), test = dated.slice(cut);
  const trainBlended = groupMultiple(train);
  const trainGroups = groupBy(train, (p) => p.category);
  const trainMultipleOf = (category: string): number => {
    const list = trainGroups.get(category);
    return clamp((list === undefined ? trainBlended : groupMultiple(list)) * (1 - model.damping) + trainBlended * model.damping, model.multiple_min, model.multiple_max);
  };
  const rs = test.map((peer) => trainMultipleOf(peer.category) / peer.ratio);
  const mae = median(rs.map((r) => Math.abs(r - 1)));
  const looMae = median(looRatios(peers, model).map((x) => Math.abs(x.r - 1)));
  if (!Number.isFinite(mae) || !Number.isFinite(looMae) || looMae <= 0) return null;
  return {
    split_date: test[0]!.listed_at!, older_train: train.length, newer_test: test.length,
    older_multiple: round4(trainBlended), newer_multiple: round4(groupMultiple(test)),
    mae_vs_loo: round4((mae - looMae) / looMae), median_absolute_error: round4(mae),
    within_half: round4(rs.filter((r) => r >= 0.5 && r <= 2).length / rs.length),
    within_third: round4(rs.filter((r) => r >= 1 / 3 && r <= 3).length / rs.length),
    correlation: round4(pearson(rs.map((r) => Math.log(r)), test.map((p) => Math.log(p.ratio)))),
  };
}
/** Band honesty of the final fit: the share of peers whose true multiple sits in each band. */
export function rangeHonesty(peers: Peer[], model: ModelConstants) {
  const blended = groupMultiple(peers);
  const byCategory = new Map<string, number>();
  for (const [category, list] of groupBy(peers, (p) => p.category)) {
    byCategory.set(category, clamp(groupMultiple(list) * (1 - model.damping) + blended * model.damping, model.multiple_min, model.multiple_max));
  }
  const rs = peers.map((peer) => (byCategory.get(peer.category) ?? clamp(blended, model.multiple_min, model.multiple_max)) / peer.ratio);
  const n = peers.length || 1;
  const share = (lo: number, hi: number) => round4(rs.filter((r) => r >= lo && r <= hi).length / n);
  return {
    total_peers: peers.length,
    within_half: share(0.5, 2), within_third: share(1 / 3, 3), within_quarter: share(0.25, 4),
    outside_any: round4(rs.filter((r) => r < 0.25 || r > 4).length / n),
  };
}

// ---------------------------------------------------------------- out-of-sample evidence

/** One ablation row: a feature set, its held-out miss multiplier, its band coverage, kept or not. */
export interface AblationRow { label: string; kept: boolean; loo_miss: number; wf_miss: number; cov50: number; cov80: number; note: string }

/** Solve A x = b by Gaussian elimination; null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / M[col]![col]!;
      for (let c = col; c <= n; c++) M[r]![c] = M[r]![c]! - f * M[col]![c]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/**
 * Least squares of log10(mcap/TVL) on [1, log10 TVL, 7d growth, category dummies], per variant.
 * Dummies only for categories with 5+ peers; thinner categories ride the intercept.
 */
function fitOLS(peers: Peer[], useSize: boolean, useGrowth: boolean, useCategory: boolean) {
  const cats = useCategory
    ? [...groupBy(peers, (p) => p.category).entries()].filter(([, l]) => l.length >= 5).map(([c]) => c).sort()
    : [];
  const row = (p: Peer): number[] => {
    const x = [1];
    if (useSize) x.push(p.log10_tvl);
    if (useGrowth) x.push((p.growth ?? 0) / 100);
    for (const c of cats) x.push(p.category === c ? 1 : 0);
    return x;
  };
  const X = peers.map(row), y = peers.map((p) => Math.log10(p.ratio)), k = X[0]?.length ?? 1;
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < k; i++) {
    A.push(Array.from({ length: k }, (_, j) => X.reduce((s, x, n) => s + x[i]! * x[j]!, 0)));
    b.push(X.reduce((s, x, n) => s + x[i]! * y[n]!, 0));
  }
  const beta = solve(A, b) ?? Array.from({ length: k }, () => 0);
  return { cats, beta, predict: (p: Peer) => row(p).reduce((s, xj, j) => s + xj * beta[j]!, 0) };
}
/** LOO and walk-forward prediction/actual ratios for one variant, plus the full fit's beta. */
function variantRatios(peers: Peer[], variant: string): { loo: number[]; wf: number[] | null; beta: number[] } {
  const useSize = variant !== 'base';
  const useGrowth = variant === 'size+growth' || variant === 'size+growth+category';
  const useCategory = variant === 'size+growth+category';
  const predictWith = (train: Peer[], p: Peer): number => {
    if (train.length < 8) return groupMultiple(train);
    if (!useSize) return groupMultiple(train);
    return Math.pow(10, fitOLS(train, true, useGrowth, useCategory).predict(p));
  };
  const loo = peers.map((p) => predictWith(peers.filter((q) => q.slug !== p.slug), p) / p.ratio);
  let wf: number[] | null = null;
  const dated = peers.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  if (dated.length >= 16) {
    const cut = Math.floor(dated.length * 0.6), train = dated.slice(0, cut), test = dated.slice(cut);
    if (test.length >= 8) wf = test.map((p) => predictWith(train, p) / p.ratio);
  }
  return { loo, wf, beta: useSize ? fitOLS(peers, true, useGrowth, useCategory).beta : [] };
}

/**
 * The evidence table: base rate / size only / size+growth / size+growth+category, each scored by
 * leave-one-out AND walk-forward miss multipliers (median of max(pred/actual, actual/pred)), plus
 * coverage: the share of held-out peers inside the P25-P75 band the OTHER peers' ratios print
 * (honest target 50%) and P10-P90 (target 80%). A feature is kept only when the walk-forward miss
 * improves; 'size+growth' below is the tested-and-not-kept case the table names.
 */
export function ablationTable(peers: Peer[]): { rows: AblationRow[]; at_1b: number; size_slope: number; growth_coef: number; intercept: number } {
  function coverage(rs: number[], lo: number, hi: number): number {
    if (rs.length < 5) return 0;
    let inside = 0;
    for (let i = 0; i < rs.length; i++) {
      const others = rs.filter((_, j) => j !== i);
      if (rs[i]! >= quantile(others, lo) && rs[i]! <= quantile(others, hi)) inside++;
    }
    return inside / rs.length;
  }
  const stats = (rs: number[]) => ({
    miss: round4(median(rs.map((r) => Math.max(r, 1 / r)))),
    cov50: round4(coverage(rs, 0.25, 0.75)),
    cov80: round4(coverage(rs, 0.10, 0.90)),
  });
  const notes: Record<string, string> = {
    base: 'base rate: one blended mcap/TVL multiple for every peer — kept as the fallback when a category has no peer',
    size: 'adds the OLS log10 TVL slope: bigger TVL trades at a smaller multiple. Tested, not kept in production — the production model prices size through the robust per-category medians instead',
    'size+growth': 'adds 7d growth to the OLS fit: tested and NOT kept — the walk-forward miss does not beat size alone, so growth enters the production model as the clamped trend multiplier',
    'size+growth+category': 'adds category dummies (5+ peers each): category is KEPT, in robust-median form with damping — this OLS row is its lab check',
  };
  const variants = ['base', 'size', 'size+growth', 'size+growth+category'];
  const full = variantRatios(peers, 'size+growth+category');
  const rows = variants.map((variant) => {
    const { loo, wf } = variantRatios(peers, variant);
    const s = stats(loo), w = wf ? stats(wf) : s;
    return {
      label: variant,
      kept: variant === 'base' || variant === 'size+growth+category',
      loo_miss: s.miss, wf_miss: w.miss, cov50: s.cov50, cov80: s.cov80, note: notes[variant] ?? '',
    };
  });
  const b = full.beta;
  return { rows, intercept: b[0] ?? 0, size_slope: b[1] ?? 0, growth_coef: b[2] ?? 0, at_1b: round4(Math.pow(10, (b[0] ?? 0) + (b[1] ?? 0) * 9)) };
}

// ---------------------------------------------------------------- token odds + Brier

/**
 * Token-odds from the peers' record, never a forecast: protocols bucket by age band, the band's
 * token-bearing share (smoothed toward the base rate, self excluded) is the estimate, and the
 * Brier score is reported against the base rate's own Brier. This page never says a token will
 * launch; the odds are the record of what similar protocols did.
 */
export function tokenOdds(snapshot: Snapshot): { base_rate: number; brier_loo: number; brier_base: number; brier_wf: number | null; note: string } {
  const pool = snapshot.protocols.filter((p) => p.category !== 'CEX');
  const base = pool.filter(hasToken).length / pool.length;
  const band = (p: SnapshotProtocol): string => {
    const a = ageDays(snapshot.as_of, p.listed_at);
    if (a === null) return 'unknown';
    if (a < 180) return '<180d';
    if (a < 365) return '180-365d';
    if (a < 730) return '1-2y';
    return '2y+';
  };
  const pOf = (p: SnapshotProtocol, from: Map<string, SnapshotProtocol[]>): number => {
    const list = from.get(band(p)) ?? [];
    const tokens = list.filter((q) => hasToken(q) && q.slug !== p.slug).length;
    return (tokens + base * 5) / (list.length - (list.some((q) => q.slug === p.slug) ? 1 : 0) + 5);
  };
  const brierOf = (pairs: [number, number][]) => pairs.reduce((s, [p, y]) => s + (p - y) ** 2, 0) / pairs.length;
  const looPairs = pool.map((p): [number, number] => [pOf(p, groupBy(pool, band)), hasToken(p) ? 1 : 0]);
  // walk-forward: bands fitted on protocols listed by the median listing date, tested on the rest
  let wf: number | null = null;
  const dated = pool.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  if (dated.length >= 16) {
    const cut = Math.floor(dated.length * 0.6);
    const trainMap = groupBy(dated.slice(0, cut), band);
    const testPairs = dated.slice(cut).map((p): [number, number] => [pOf(p, trainMap), hasToken(p) ? 1 : 0]);
    if (testPairs.length >= 8) wf = round4(brierOf(testPairs));
  }
  return {
    base_rate: round4(base),
    brier_loo: round4(brierOf(looPairs)),
    brier_base: round4(brierOf(looPairs.map(([, y]) => [base, y] as [number, number]))),
    brier_wf: wf,
    by_slug: Object.fromEntries(pool.map((p) => [p.slug, round4(pOf(p, groupBy(pool, band)))])),
    note: 'odds are the peers\' record by age band, not a promise; lower Brier than the base rate means the bands carry signal',
  };
}

// ---------------------------------------------------------------- protocol accounting

export interface Accounting { buckets: { label: string; count: number; note: string }[]; total: number; unbucketed: number }
/**
 * Every protocol in the snapshot lands in exactly one bucket, and the counts sum to the total.
 * No silent drops: the dashboard prints this strip and the sum is checked in the page.
 */
export function accounting(snapshot: Snapshot): Accounting {
  const buckets: { label: string; count: number; note: string }[] = [
    { label: 'ranked watchlist', count: 0, note: 'on the watchlist, pre-token, ranked above' },
    { label: 'ranked early, below floor', count: 0, note: 'pre-token, under the TVL floor, ranked as early rows' },
    { label: 'off-list, above floor', count: 0, note: 'pre-token, at/above the floor, not on the watchlist — unranked' },
    { label: 'below floor, unranked', count: 0, note: 'pre-token, under the floor, beyond the early radar window' },
    { label: 'token trades, priced comp', count: 0, note: 'market cap recorded — anchor of the comparables' },
    { label: 'token recorded, no cap', count: 0, note: 'gecko id or symbol recorded without a market cap' },
    { label: 'out: exchange', count: 0, note: 'category CEX — deposits are custody, not protocol TVL' },
    { label: 'out: bridge (no token)', count: 0, note: 'bridging is transit, not a deposit to farm' },
    { label: 'out: wrapped / liquid staking', count: 0, note: 'name marks a product of a token that trades' },
    { label: 'out: versioned pool', count: 0, note: 'name ends in a release marker — a pool of another protocol' },
  ];
  const ranked = new Set(pickBoardProtocols(snapshot).map((p) => p.slug));
  const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const WRAPPED = /\b(wrapped|staked|staking)\b/i;
  for (const p of snapshot.protocols) {
    const i = p.category === 'CEX' ? 6
      : WRAPPED.test(p.name) ? 8
      : VERSIONED.test(p.name) ? 9
      : hasToken(p) ? (p.mcap_usd !== null ? 4 : 5)
      : /bridge/i.test(p.category ?? '') ? 7
      : ranked.has(p.slug) ? (snapshot.watchlist.includes(p.slug) ? 0 : 1)
      : p.tvl_usd >= snapshot.floor_usd ? 2
      : 3;
    buckets[i]!.count++;
  }
  return { buckets, total: snapshot.protocols.length, unbucketed: 0 };
}

// ---------------------------------------------------------------- board assembly

export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null; token_status: 'pre-token'; on_watchlist: boolean;
  age_days: number | null; implied_value_usd: number;
  model: { multiple: number; multiple_source: string; trend_pct: number; trend_mult: number; patience_mult: number; age_days: number | null };
  launch_signals: string[]; farm_steps: string[];
}
export interface Comp { name: string; tvl_usd: number; mcap_usd: number; ratio: number; blind_multiple: number; miss: number }
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; listed_at: string | null; age_days: number | null;
  implied_value_usd: number; multiple: number; multiple_source: string; trend_mult: number;
  patience_mult: number; on_watchlist: boolean; action: string; exposure: string; watch: string;
  cost_tier: number; hold_days: number; verdict: ReturnType<typeof farmVerdict>; comps: Comp[];
}
export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number;
  mcap_usd: number | null; change_7d: number | null; mcap_tvl: number | null; listed_at: string | null; age_days: number | null;
}
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants; model_version: string;
  watchlist_size: number; board_size: number; early_size: number; live_size: number;
  checksum: string;
  fit: { blended: number; all_peers: number; all_median_abs_error: number; all_within_2x: number };
  validation: {
    loo: ReturnType<typeof leaveOneOut>;
    walk_forward: ReturnType<typeof walkForward>;
    range_honesty: ReturnType<typeof rangeHonesty>;
    blended_multiple: number; peers_tested: number;
  };
  evidence: ReturnType<typeof ablationTable>;
  odds: ReturnType<typeof tokenOdds>;
  accounting: Accounting;
  kpis: {
    implied_total_usd: number; pre_token_rows: number; token_trading_rows: number;
    watchlist_covered: number; median_category_multiple: number; snapshot_as_of: string;
    floor_usd: number; protocol_count: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** DefiLlama's rules: a release-marker name is a pool of another protocol; wrapped/staked names a product of one. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** Whether a protocol is one the board may rank: no token recorded, not a CEX, not a product of one. */
export function isRankable(p: SnapshotProtocol): boolean {
  return !hasToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !WRAPPED.test(p.name);
}
/** The protocols the board ranks: every watchlist slug first, then the strongest early rows. */
export function pickBoardProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  return [...chosen.values()];
}

/** What sign of a launch to watch for, from the row's own figures — the same derivation the page shows. */
export function launchSignals(p: SnapshotProtocol, age: number | null): string[] {
  const out: string[] = [];
  const earlyChains = ['Monad', 'Ink', 'Unichain', 'Arc', 'Plasma', 'Pharos', 'Ripple'];
  const hits = p.chains.filter((c) => earlyChains.includes(c));
  if (hits.length) out.push(`New-chain incentive: ${p.name} runs on ${hits.join(' and ')}, ${hits.length > 1 ? 'chains' : 'a chain'} still seeding users — watch for a joint points program with the chain itself.`);
  if (age !== null && age >= 365) out.push(`Maturity: ${Math.floor(age / 365)} year${age >= 730 ? 's' : ''}+ with no token; protocols of this age and TVL class usually launch or get acquired within the next cycle.`);
  else if (age !== null && age < 180) out.push(`Early: listed ${age} days ago — too new for most launches, but the cheapest time to farm before points programs begin.`);
  if ((p.change_7d ?? 0) >= 10) out.push(`Capital accelerating: TVL up ${p.change_7d!.toFixed(1)}% in 7 days, the inflow pattern that precedes most announcements.`);
  if (p.tvl_usd >= 1e9) out.push(`Scale: above $1B of TVL with no token — one of the largest unlaunched protocols in its category.`);
  out.push(`Baseline: watch ${p.name}'s docs, governance forum and X account for a points program, a claim page on its own domain, or its ticker appearing on CoinGecko.`);
  return out;
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot, asOf: string): LiveRow[] {
  return snapshot.protocols
    .filter((p) => hasToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      listed_at: p.listed_at, age_days: ageDays(asOf, p.listed_at),
    }));
}
/** FNV-1a over the ranked rows: the checksum the page recomputes against board.json. */
export function checksumOf(board: BoardRow[]): string {
  let h = 0x811c9dc5;
  for (const r of board) {
    for (const ch of `${r.rank}:${r.slug}:${r.implied_value_usd}\n`) {
      h ^= ch.codePointAt(0) ?? 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/**
 * Everything from one snapshot: the scored board (ranks 1..n), the live set set aside, the fit,
 * the validation, the ablation evidence, the odds, the accounting, and the dashboard's compact
 * rows with their farm-plan fields and nearest traded comparables. This is the one function
 * main.ts calls.
 */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const peers = collectPeers(snapshot.protocols);
  const { blended, byCategory } = fitMultiples(peers, model);
  const chosen = pickBoardProtocols(snapshot);
  const scored = chosen.map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, byCategory, blended, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const watchlist = new Set(snapshot.watchlist);

  const board: BoardRow[] = scored.map(({ p, s }, i) => ({
    rank: i + 1, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
    tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd, listed_at: p.listed_at,
    gecko_id: p.gecko_id, symbol: p.symbol, token_status: 'pre-token' as const,
    on_watchlist: watchlist.has(p.slug), age_days: s.age_days, implied_value_usd: s.implied,
    model: {
      multiple: s.multiple, multiple_source: s.multiple_source, trend_pct: s.trend_pct,
      trend_mult: s.trend_mult, patience_mult: s.patience_mult, age_days: s.age_days,
    },
    launch_signals: launchSignals(p, s.age_days),
    farm_steps: farmSteps(p, s.age_days).map(stepText),
  }));

  // nearest traded comparables per row: same-category peers first, then any category, each fitted blind
  const compsOf = (p: SnapshotProtocol, tvlUsd: number): Comp[] => {
    const lt = Math.log10(Math.max(tvlUsd, 1));
    const near = peers
      .map((peer) => ({ peer, d: Math.abs(peer.log10_tvl - lt) + (peer.category === (p.category ?? 'Uncategorized') ? -0.4 : 0) }))
      .sort((a, b) => a.d - b.d || (a.peer.slug < b.peer.slug ? -1 : 1))
      .slice(0, 5);
    return near.map(({ peer }) => {
      const blind = heldOutMultiple(peers, peer.category, peer.slug, model, blended);
      return {
        name: peer.name, tvl_usd: Math.round(peer.ratio === 0 ? 0 : Math.pow(10, peer.log10_tvl)),
        mcap_usd: Math.round(Math.pow(10, peer.log10_tvl) * peer.ratio),
        ratio: round4(peer.ratio), blind_multiple: round4(blind),
        miss: round4(Math.max(blind / peer.ratio, peer.ratio / blind)),
      };
    });
  };

  const odds = tokenOdds(snapshot);
  const rows: RadarRow[] = board.map((r) => {
    const p: SnapshotProtocol = {
      slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd,
      change_7d: r.change_7d, mcap_usd: null, listed_at: r.listed_at, gecko_id: null, symbol: null,
    };
    const { capital, tier } = capitalFor(r.tvl_usd);
    const hold = holdDaysFor(r.age_days);
    const verdict = farmVerdict(p, hold, capital, gasFor(p), tier, r.implied_value_usd, odds.by_slug[r.slug] ?? odds.base_rate);
    verdict.total_cost = Math.round(verdict.total_cost);
    verdict.total_gas = Math.round(verdict.total_gas);
    verdict.capital = Math.round(verdict.capital);
    const exposure = tier >= 2
      ? `A $${capital} position is moderate here: ${r.name}'s TVL is above $1B, so contract risk is smaller, but never more than you can lose.`
      : `Keep the position near $${capital}: ${r.name} is ${r.tvl_usd >= 100_000_000 ? 'a mid-size' : 'a small'} protocol with no token yet, so its contracts are less battle-tested.`;
    return {
      rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
      tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at, age_days: r.age_days,
      implied_value_usd: r.implied_value_usd, multiple: r.model.multiple,
      multiple_source: r.model.multiple_source, trend_mult: r.model.trend_mult,
      patience_mult: r.model.patience_mult, on_watchlist: r.on_watchlist,
      action: actionFor(p, capital, chainOf(p)), exposure, watch: watchFor(p),
      cost_tier: tier, hold_days: hold, verdict, comps: compsOf(p, r.tvl_usd),
    };
  });

  const live = liveRows(snapshot, snapshot.as_of);
  const catFit = [...byCategory.values()];
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, checksum: checksumOf(board),
    watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length, live_size: live.length,
    fit: { blended: round4(blended), all_peers: peers.length, all_median_abs_error: 0, all_within_2x: 0 },
    validation: {
      loo: leaveOneOut(peers, model), walk_forward: walkForward(peers, model, snapshot.as_of),
      range_honesty: rangeHonesty(peers, model),
      blended_multiple: round4(blended), peers_tested: peers.length,
    },
    evidence: ablationTable(peers),
    odds,
    accounting: accounting(snapshot),
    kpis: {
      implied_total_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
      pre_token_rows: board.length,
      token_trading_rows: snapshot.protocols.filter((p) => hasToken(p) && p.category !== 'CEX').length,
      watchlist_covered: board.filter((r) => watchlist.has(r.slug)).length,
      median_category_multiple: catFit.length ? round4(median(catFit.map((f) => f.multiple))) : round4(blended),
      snapshot_as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, protocol_count: snapshot.protocols.length,
    },
    rows, live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- snapshot parsing

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}
/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug, name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, spread, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate asks`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    }
  }
  return null;
}
