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
export const MODEL = {
  trend_floor: -60, trend_cap: 150, growth_weight: 0.4,
  patience_floor: 0.55, patience_days: 1095, unknown_age_days: 365,
  damping: 0.6, multiple_min: 0.05, multiple_max: 8, implied_max: 99_000_000_000_000,
};
export const MODEL_VERSION = 'yieldradar-3';

export const EARLY_ROWS = 210;

export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
const DAY_MS = 86_400_000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`), b = Date.parse(`${listedAt}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY_MS)) : null;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = values.slice().sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function quantile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = values.slice().sort((a, b) => a - b), at = (s.length - 1) * p;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}
export function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)); }
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export interface Peer {
  slug: string; name: string; category: string; ratio: number;
  log_ratio: number; log10_tvl: number; growth: number | null; listed_at: string | null;
}

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

function groupMultiple(peers: Peer[]): number {
  return peers.length === 0 ? NaN : Math.exp(median(peers.map((p) => p.log_ratio)));
}
export interface CategoryFit { multiple: number; peers: number }

export function fitMultiples(peers: Peer[], model: typeof MODEL): { blended: number; byCategory: Map<string, CategoryFit> } {
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

export function multipleFor(category: string | null, byCategory: Map<string, CategoryFit>, blended: number, model: typeof MODEL): { multiple: number; source: string } {
  const entry = category === null ? undefined : byCategory.get(category);
  if (entry === undefined) return { multiple: clamp(blended, model.multiple_min, model.multiple_max), source: 'blended market multiple — no token-bearing peer in category' };
  return { multiple: entry.multiple, source: `median of ${entry.peers} token-bearing ${category} peers, damped ${Math.round((1 - model.damping) * 100)}/${Math.round(model.damping * 100)} to the blend` };
}

export function trendMultiplier(change7d: number | null, model: typeof MODEL): { mult: number; trend: number } {
  const trend = clamp(finite(change7d, 0), model.trend_floor, model.trend_cap);
  return { mult: 1 + (trend / 100) * model.growth_weight, trend };
}

export function patienceMultiplier(age: number | null, model: typeof MODEL): { mult: number; age: number } {
  const a = age ?? model.unknown_age_days;
  return { mult: model.patience_floor + (1 - model.patience_floor) * (Math.min(Math.max(a, 0), model.patience_days) / model.patience_days), age: a };
}

export function impliedFromFigures(tvlUsd: number, multiple: number, trendMult: number, patienceMult: number): number {
  return Math.max(1, Math.round(tvlUsd * multiple * trendMult * patienceMult));
}

export function scoreProtocol(p: SnapshotProtocol, asOf: string, byCategory: Map<string, CategoryFit>, blended: number, model: typeof MODEL) {
  const m = multipleFor(p.category, byCategory, blended, model);
  const t = trendMultiplier(p.change_7d, model);
  const age = ageDays(asOf, p.listed_at);
  const pat = patienceMultiplier(age, model);
  const trendMult = round4(t.mult), patienceMult = round4(pat.mult);
  return {
    multiple: m.multiple, multiple_source: m.source, trend_pct: t.trend, trend_mult: trendMult,
    patience_mult: patienceMult, age_days: age,
    implied: Math.round(clamp(impliedFromFigures(p.tvl_usd, m.multiple, trendMult, patienceMult), 1, model.implied_max)),
  };
}

function heldOutMultiple(peers: Peer[], category: string, heldOut: string, model: typeof MODEL, blended: number): number {
  const train = peers.filter((p) => p.slug !== heldOut && p.category === category);
  const raw = train.length > 0 ? groupMultiple(train) : blended;
  return clamp(raw * (1 - model.damping) + blended * model.damping, model.multiple_min, model.multiple_max);
}

function looRatios(peers: Peer[], model: typeof MODEL): { slug: string; category: string; pred: number; r: number; listed_at: string | null }[] {
  const blended = groupMultiple(peers);
  return peers.map((peer) => {
    const pred = heldOutMultiple(peers, peer.category, peer.slug, model, blended);
    return { slug: peer.slug, category: peer.category, listed_at: peer.listed_at, pred, r: pred / peer.ratio };
  });
}

export function leaveOneOut(peers: Peer[], model: typeof MODEL) {
  const rs = looRatios(peers, model);
  const errs = rs.map((x) => Math.abs(x.r - 1));
  const n = peers.length;
  return {
    peers: n,
    median_absolute_error: round4(median(errs)),
    within_half: n ? round4(rs.filter((x) => x.r >= 0.5 && x.r <= 2).length / n) : 0,
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

export function walkForward(peers: Peer[], model: typeof MODEL, asOf: string) {
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
  const preds = test.map((peer) => trainMultipleOf(peer.category));
  const rs = test.map((peer, i) => preds[i]! / peer.ratio);
  const mae = median(rs.map((r) => Math.abs(r - 1)));
  const looMae = median(looRatios(peers, model).map((x) => Math.abs(x.r - 1)));
  if (!Number.isFinite(mae) || !Number.isFinite(looMae) || looMae <= 0) return null;
  return {
    split_date: test[0]!.listed_at!, older_train: train.length, newer_test: test.length,
    older_multiple: round4(trainBlended), newer_multiple: round4(groupMultiple(test)),
    mae_vs_loo: round4((mae - looMae) / looMae), median_absolute_error: round4(mae),
    within_half: round4(rs.filter((r) => r >= 0.5 && r <= 2).length / rs.length),
  };
}

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
    base: 'base rate: one blended mcap/TVL multiple for all peers — kept as the fallback',
    size: 'adds the OLS log10-TVL slope: bigger TVL, smaller multiple. Tested, NOT kept — production prices size via robust per-category medians',
    'size+growth': 'adds 7d growth: tested and NOT kept — walk-forward miss does not beat size alone; growth enters as the clamped trend multiplier',
    'size+growth+category': 'adds category dummies (5+ peers each): category KEPT in damped robust-median form — this OLS row is its lab check',
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
    note: 'odds are the peers\' record by age band, not a promise; Brier below the base-rate baseline means the bands carry signal',
  };
}

export interface Accounting { buckets: { label: string; count: number; note: string }[]; total: number; unbucketed: number }

export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null; token_status: 'pre-token'; on_watchlist: boolean;
  age_days: number | null; implied_value_usd: number;
  model: { multiple: number; multiple_source: string; trend_pct: number; trend_mult: number; patience_mult: number; age_days: number | null };
  farm_steps: string[];
}
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; listed_at: string | null; age_days: number | null;
  implied_value_usd: number; multiple: number; multiple_source: string; trend_mult: number;
  patience_mult: number; on_watchlist: boolean; action: string; exposure: string; watch: string;
  cost_tier: number; hold_days: number; verdict: ReturnType<typeof farmVerdict>;
  comps: { name: string; tvl_usd: number; mcap_usd: number; ratio: number; blind_multiple: number; miss: number }[];
  farm_steps: string[];
}
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: typeof MODEL; model_version: string;
  watchlist_size: number; board_size: number; early_size: number; live_size: number; checksum: string;
  validation: { loo: ReturnType<typeof leaveOneOut>; walk_forward: ReturnType<typeof walkForward>; blended_multiple: number; peers_tested: number };
  evidence: ReturnType<typeof ablationTable>;
  odds: ReturnType<typeof tokenOdds>;
  accounting: Accounting;
  kpis: { implied_total_usd: number; pre_token_rows: number; token_trading_rows: number; watchlist_covered: number; median_category_multiple: number; snapshot_as_of: string; floor_usd: number; protocol_count: number };
  rows: RadarRow[];
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
export function isRankable(p: SnapshotProtocol): boolean {
  return !hasToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !WRAPPED.test(p.name);
}
/** Board ranks every watchlist slug first, then the strongest early rows below the TVL floor. */
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
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
/** One snapshot in: the scored board, the fit, the validation, the evidence, the dashboard rows. */
export function buildRadar(snapshot: Snapshot, model: typeof MODEL = MODEL): { board: BoardRow[]; radar: RadarData } {
  const peers = collectPeers(snapshot.protocols);
  const { blended, byCategory } = fitMultiples(peers, model);
  const chosen = pickBoardProtocols(snapshot);
  const scored = chosen.map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, byCategory, blended, model) }));
  scored.sort((x, y) => y.s.implied - x.s.implied || (x.p.slug < y.p.slug ? -1 : 1));
  const watchlist = new Set(snapshot.watchlist);
  const board: BoardRow[] = scored.map(({ p, s }, i) => ({
    rank: i + 1, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
    tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd, listed_at: p.listed_at,
    gecko_id: p.gecko_id, symbol: p.symbol, token_status: 'pre-token' as const,
    on_watchlist: watchlist.has(p.slug), age_days: s.age_days, implied_value_usd: s.implied,
    model: { multiple: s.multiple, multiple_source: s.multiple_source, trend_pct: s.trend_pct, trend_mult: s.trend_mult, patience_mult: s.patience_mult, age_days: s.age_days },
    farm_steps: farmSteps(p, s.age_days).map(stepText),
  }));
  // nearest traded comparables per row: same-category peers first, each fitted WITHOUT itself
  const compsOf = (p: SnapshotProtocol, tvlUsd: number) => {
    const lt = Math.log10(Math.max(tvlUsd, 1));
    return peers
      .map((peer) => ({ peer, d: Math.abs(peer.log10_tvl - lt) + (peer.category === (p.category ?? 'Uncategorized') ? -0.4 : 0) }))
      .sort((x, y) => x.d - y.d || (x.peer.slug < y.peer.slug ? -1 : 1))
      .slice(0, 5)
      .map(({ peer }) => {
        const blind = heldOutMultiple(peers, peer.category, peer.slug, model, blended);
        return { name: peer.name, tvl_usd: Math.round(Math.pow(10, peer.log10_tvl)), mcap_usd: Math.round(Math.pow(10, peer.log10_tvl) * peer.ratio), ratio: round4(peer.ratio), blind_multiple: round4(blind), miss: round4(Math.max(blind / peer.ratio, peer.ratio / blind)) };
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
    const exposure = tier >= 2
      ? `A $${capital} position is moderate here: TVL above $1B means smaller contract risk — but never more than you can lose.`
      : `Keep the position near $${capital}: ${r.name} is ${r.tvl_usd >= 1e8 ? 'a mid-size' : 'a small'} protocol with no token yet, so its contracts are less battle-tested.`;
    return {
      ...r, model: undefined as never,
      action: actionFor(p, capital, chainOf(p)), exposure, watch: watchFor(p),
      cost_tier: tier, hold_days: hold, verdict, comps: compsOf(p, r.tvl_usd),
    };
  });
  const live = 0;
  const catFit = [...byCategory.values()];
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, checksum: checksumOf(board),
    watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length, live_size: live,
    validation: {
      loo: leaveOneOut(peers, model), walk_forward: walkForward(peers, model, snapshot.as_of),
      blended_multiple: round4(blended), peers_tested: peers.length,
    },
    evidence: ablationTable(peers),
    odds,
    accounting: accounting(snapshot),
    kpis: {
      implied_total_usd: board.reduce((s2, r) => s2 + r.implied_value_usd, 0),
      pre_token_rows: board.length,
      token_trading_rows: snapshot.protocols.filter((p) => hasToken(p) && p.category !== 'CEX').length,
      watchlist_covered: board.filter((r) => watchlist.has(r.slug)).length,
      median_category_multiple: catFit.length ? round4(median(catFit.map((f) => f.multiple))) : round4(blended),
      snapshot_as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, protocol_count: snapshot.protocols.length,
    },
    rows,
  };
  return { board, radar };
}

export interface Accounting { buckets: { label: string; count: number; note: string }[]; total: number; unbucketed: number }
/** Every snapshot protocol lands in exactly one bucket; the counts must sum to the total. */
export function accounting(snapshot: Snapshot): Accounting {
  const defs: [string, string][] = [
    ['ranked watchlist', 'on the watchlist, pre-token, ranked'],
    ['ranked early, below floor', 'pre-token, under the floor, ranked as early rows'],
    ['off-list, above floor', 'pre-token, at/above the floor, not watchlisted — unranked'],
    ['below floor, unranked', 'pre-token, under the floor, beyond the early window'],
    ['token trades, priced comp', 'market cap recorded — anchors the comparables'],
    ['token recorded, no cap', 'gecko id or symbol recorded, no market cap'],
    ['out: exchange', 'category CEX — custody, not protocol TVL'],
    ['out: bridge (no token)', 'bridging is transit, not a farmable deposit'],
    ['out: wrapped / liquid staking', 'name marks a product of a traded token'],
    ['out: versioned pool', 'name ends in a release marker — a pool of another protocol'],
  ];
  const counts = new Array(defs.length).fill(0);
  const ranked = new Set(pickBoardProtocols(snapshot).map((p) => p.slug));
  for (const p of snapshot.protocols) {
    const i = p.category === 'CEX' ? 6
      : WRAPPED.test(p.name) ? 8
      : VERSIONED.test(p.name) ? 9
      : hasToken(p) ? (p.mcap_usd !== null ? 4 : 5)
      : /bridge/i.test(p.category ?? '') ? 7
      : ranked.has(p.slug) ? (snapshot.watchlist.includes(p.slug) ? 0 : 1)
      : p.tvl_usd >= snapshot.floor_usd ? 2
      : 3;
    counts[i]!++;
  }
  return { buckets: defs.map(([label, note], i) => ({ label, count: counts[i]!, note })), total: snapshot.protocols.length, unbucketed: 0 };
}

export class SnapshotError extends Error {}
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  const o = raw as Record<string, unknown>;
  const bad = (why: string): never => { throw new SnapshotError(`snapshot.json ${why}`); };
  if (typeof o !== 'object' || o === null || Array.isArray(o)) bad('is not a JSON object');
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) bad('has no as_of date');
  if (typeof o.source !== 'string') bad('has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) bad('has no floor_usd');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) bad('lacks protocols or a watchlist of slugs');
  const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null => typeof v === 'string' ? v : null;
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || !Number.isFinite(p.tvl_usd as number)) bad(`protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug, name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number, change_7d: num(p.change_7d), mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at), gecko_id: str(p.gecko_id), symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate asks`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all rows share implied value $${board[0]!.implied_value_usd}`;
  }
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug}: implied ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) return `${r.slug}: farm step of ${n} characters`;
    }
  }
  return null;
}

