// YieldRadar's value model: one snapshot of the protocol universe in, one ranked board out.
//
// The radar's question: which protocols that still record no token would be worth the most if each
// issued one tomorrow, and what should a reader do about each one before or after it does?
//
// Implied value follows only from the snapshot's own figures. Markets price tokens at some multiple
// of the value users deposit (TVL), so the model derives each category's multiple from the protocols
// whose tokens already trade, then applies the category's multiple to the pre-token protocols,
// shaped by their seven-day growth and by how long they have run with no token:
//
//   category multiple = robust median of mcap/TVL over token-bearing peers, damped toward the
//                       blended multiple of all token-bearing protocols (a category carried by one
//                       unusual peer should not set the price of every protocol in it)
//   trend             = clamp(change_7d, -60, +150) -> multiplier 1 + trend/100 * GROWTH_WEIGHT
//   patience          = a scarcity discount: PATIENCE_FLOOR + (1-PATIENCE_FLOOR) * min(age, 1095)/1095
//   implied           = round(tvl_usd * multiple * trend * patience), clamped to a sane band
//
// Nothing is hardcoded: the same function scores every protocol, category multiples are fitted from
// the snapshot's own token-bearing rows, and the fit is verified by holding each peer out.

import { actionFor, capitalFor, chainOf, farmSteps, farmVerdict, gasFor, holdDaysFor, stepText, watchFor, type FarmVerdict } from './plans.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: every knob the scoring function turns. */
export interface ModelConstants {
  trend_floor: number;
  trend_cap: number;
  growth_weight: number;
  patience_floor: number;
  patience_days: number;
  unknown_age_days: number;
  damping: number;
  multiple_min: number;
  multiple_max: number;
  implied_max: number;
}

export const MODEL: ModelConstants = {
  trend_floor: -60,
  trend_cap: 150,
  growth_weight: 0.4,
  patience_floor: 0.55,
  patience_days: 1095,
  unknown_age_days: 365,
  damping: 0.6,
  multiple_min: 0.05,
  multiple_max: 8,
  implied_max: 99_000_000_000_000,
};

/** The model's version label: the dashboard names it and the notes quote it. */
export const MODEL_VERSION = 'yieldradar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 210;

/** How many token-bearing protocols the live view carries, by market cap. */
export const LIVE_ROWS = 20;

/** A protocol whose token already trades. The snapshot's nulls say "not recorded", never "none". */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to the snapshot's `asOf`, clamped at zero; null when either is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list (the average of the two middle values when the count is even). */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A number held inside [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------- comparables

/** One peer observation: a token-bearing protocol's mcap/TVL multiple. */
export interface Peer {
  slug: string;
  name: string;
  category: string;
  ratio: number;
  log_ratio: number;
  log_tvl: number;
  listed_at: string | null;
}

/** The token-bearing protocols' multiple observations: CEX and sub-$1M TVL rows left out. */
export function collectPeers(protocols: SnapshotProtocol[]): Peer[] {
  const peers: Peer[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd < 1_000_000 || p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    peers.push({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorized',
      ratio,
      log_ratio: Math.log(ratio),
      log_tvl: Math.log(p.tvl_usd),
      listed_at: p.listed_at,
    });
  }
  return peers;
}

/** The robust multiple of one group of peers: the geometric mean of their mcap/TVL ratios. */
function groupMultiple(peers: Peer[]): number {
  if (peers.length === 0) return NaN;
  return Math.exp(median(peers.map((p) => p.log_ratio)));
}

/** One category's fitted multiple, with the count of peers behind it. */
export interface CategoryFit {
  multiple: number;
  peers: number;
}

/**
 * The category multiples, each damped `damping` of the way toward the blended multiple of every
 * token-bearing protocol: a category carried by one unusual peer prices like the market at large
 * rather than like its outlier. A category with no peer inherits the blended multiple outright.
 */
export function fitMultiples(peers: Peer[], model: ModelConstants): { blended: number; byCategory: Map<string, CategoryFit> } {
  const blended = groupMultiple(peers);
  const groups = new Map<string, Peer[]>();
  for (const peer of peers) {
    const list = groups.get(peer.category);
    if (list === undefined) groups.set(peer.category, [peer]);
    else list.push(peer);
  }
  const byCategory = new Map<string, CategoryFit>();
  for (const [category, list] of groups) {
    const raw = groupMultiple(list);
    const damped = raw * (1 - model.damping) + blended * model.damping;
    byCategory.set(category, { multiple: clamp(damped, model.multiple_min, model.multiple_max), peers: list.length });
  }
  return { blended, byCategory };
}

/** The multiple a protocol's implied value uses: its category's damped multiple, else the blend. */
export function multipleFor(category: string | null, byCategory: Map<string, CategoryFit>, blended: number, model: ModelConstants): { multiple: number; source: string } {
  const entry = category === null ? undefined : byCategory.get(category);
  if (entry === undefined) return { multiple: clamp(blended, model.multiple_min, model.multiple_max), source: 'blended market multiple (no token-bearing peer in this category)' };
  return {
    multiple: entry.multiple,
    source: `geometric mean of ${entry.peers} token-bearing ${category} peer${entry.peers === 1 ? '' : 's'}, damped ${Math.round((1 - model.damping) * 100)}/${Math.round(model.damping * 100)} toward the market blend`,
  };
}

// ---------------------------------------------------------------- scoring

/** The trend multiplier from a 7-day change: growth raises the estimate, a rout cuts it. */
export function trendMultiplier(change7d: number | null, model: ModelConstants): { mult: number; trend: number } {
  const trend = clamp(finite(change7d, 0), model.trend_floor, model.trend_cap);
  return { mult: 1 + (trend / 100) * model.growth_weight, trend };
}

/** The scarcity discount: a protocol that has run longer with no token is priced lower, not higher. */
export function patienceMultiplier(age: number | null, model: ModelConstants): { mult: number; age: number } {
  const ageForModel = age ?? model.unknown_age_days;
  const mult = model.patience_floor + (1 - model.patience_floor) * (Math.min(Math.max(ageForModel, 0), model.patience_days) / model.patience_days);
  return { mult, age: ageForModel };
}

/** The inputs and the result of one protocol's scoring. */
export interface ScoredInputs {
  multiple: number;
  multiple_source: string;
  trend_pct: number;
  trend_mult: number;
  patience_mult: number;
  age_days: number | null;
  implied: number;
}

/** Score one protocol: TVL x category multiple x trend x patience, clamped to the model's band. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, byCategory: Map<string, CategoryFit>, blended: number, model: ModelConstants): ScoredInputs {
  const m = multipleFor(p.category, byCategory, blended, model);
  const t = trendMultiplier(p.change_7d, model);
  const age = ageDays(asOf, p.listed_at);
  const pat = patienceMultiplier(age, model);
  // The page recomputes the value from the rounded multipliers the data carries, so the board must
  // score from those same rounded figures: score from them, never from the unrounded ones.
  const trendMult = round4(t.mult);
  const patienceMult = round4(pat.mult);
  const raw = impliedFromFigures(p.tvl_usd, m.multiple, trendMult, patienceMult);
  const implied = Math.round(clamp(raw, 1, model.implied_max));
  return {
    multiple: m.multiple,
    multiple_source: m.source,
    trend_pct: t.trend,
    trend_mult: trendMult,
    patience_mult: patienceMult,
    age_days: age,
    implied,
  };
}

/** The page recomputes a row from its figures; this is the arithmetic both sides share. */
export function impliedFromFigures(tvlUsd: number, multiple: number, trendMult: number, patienceMult: number): number {
  return Math.max(1, Math.round(tvlUsd * multiple * trendMult * patienceMult));
}

// ---------------------------------------------------------------- model validation

/** Result of leave-one-out (LOO) cross-validation over token-bearing peers. */
export interface LOOResult {
  peers: number;
  median_absolute_error: number;
  within_half: number;
  within_third: number;
  correlation: number;
  per_category: { category: string; peers: number; median_ae: number; within_2x: number; correlation: number }[];
}

/**
 * The multiple the model would predict for `category` if fitted on every peer except `heldOut`:
 * the category's own group multiple when another peer remains, else the blended multiple — the
 * exact fallback the live model uses for a category with no token-bearing peer.
 */
function heldOutMultiple(peers: Peer[], category: string, heldOut: string, model: ModelConstants, blended: number): number {
  const train = peers.filter((p) => p.slug !== heldOut && p.category === category);
  const raw = train.length > 0 ? groupMultiple(train) : blended;
  return clamp(raw * (1 - model.damping) + blended * model.damping, model.multiple_min, model.multiple_max);
}

/**
 * Leave-one-out on the mcap/TVL multiple: for every token-bearing peer, refit the model without it,
 * predict its multiple, and compare with its true mcap/TVL. Reported as the median absolute error,
 * the share of peers predicted within 0.5-2x and within 0.33-3x, and a Pearson correlation between
 * predicted and actual multiples on the log scale. A comp-table estimate cannot pin a market cap
 * tighter than a band; these are the numbers that say how wide the honest band is.
 */
export function leaveOneOut(peers: Peer[], model: ModelConstants): LOOResult {
  const blended = groupMultiple(peers);
  const preds: number[] = [];
  const actuals: number[] = [];
  const errs: number[] = [];
  let half = 0;
  let third = 0;
  for (const peer of peers) {
    const pred = heldOutMultiple(peers, peer.category, peer.slug, model, blended);
    const actual = peer.ratio;
    preds.push(pred);
    actuals.push(actual);
    errs.push(Math.abs(pred - actual) / actual);
    if (pred / actual >= 0.5 && pred / actual <= 2) half++;
    if (pred / actual >= 0.33 && pred / actual <= 3) third++;
  }
  const n = peers.length;

  const groups = new Map<string, Peer[]>();
  for (const peer of peers) {
    const list = groups.get(peer.category);
    if (list === undefined) groups.set(peer.category, [peer]);
    else list.push(peer);
  }
  const per_category = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, list]) => {
    const catPreds: number[] = [];
    const catActuals: number[] = [];
    const catErrs: number[] = [];
    let catHalf = 0;
    for (const peer of list) {
      const pred = heldOutMultiple(peers, category, peer.slug, model, blended);
      catPreds.push(pred);
      catActuals.push(peer.ratio);
      catErrs.push(Math.abs(pred - peer.ratio) / peer.ratio);
      if (pred / peer.ratio >= 0.5 && pred / peer.ratio <= 2) catHalf++;
    }
    return {
      category,
      peers: list.length,
      median_ae: round4(median(catErrs)),
      within_2x: list.length === 0 ? 0 : catHalf / list.length,
      correlation: list.length < 3 ? 0 : round4(pearsonLog(catPreds, catActuals)),
    };
  });

  return {
    peers: n,
    median_absolute_error: n === 0 ? 0 : round4(median(errs)),
    within_half: n === 0 ? 0 : half / n,
    within_third: n === 0 ? 0 : third / n,
    correlation: n < 3 ? 0 : round4(pearsonLog(preds, actuals)),
    per_category,
  };
}

/** Pearson correlation of log(predicted) against log(actual); 0 when the data cannot carry one. */
function pearsonLog(preds: number[], actuals: number[]): number {
  if (preds.length !== actuals.length || preds.length < 3) return 0;
  const xs = preds.map((p) => Math.log(p));
  const ys = actuals.map((a) => Math.log(a));
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return 0;
  return num / Math.sqrt(dx2 * dy2);
}

/** Result of a temporal walk-forward: train on the older peers, score on the newer ones. */
export interface WalkForwardResult {
  /** The date the training window ends on: train is listed at or before it, test after. */
  split_date: string;
  older_train: number;
  newer_test: number;
  older_multiple: number;
  newer_multiple: number;
  /** The walk-forward MAE minus the LOO MAE, as a fraction of the LOO MAE: negative is better. */
  mae_vs_loo: number;
  median_absolute_error: number;
  within_half: number;
  within_third: number;
  correlation: number;
}

/**
 * The temporal split a live model faces: fit on what was listed by `split`, then price what listed
 * after it. Peers with a listing date are sorted by it; the split puts the older 60% in train and
 * the newer 40% in test (both halves at least 8 peers, else the snapshot cannot carry the test and
 * the function returns null). The per-category multiples are refitted on the train half alone —
 * including its own damping toward the train blend — and every test peer is priced the way the
 * live model prices a row: its category's train multiple when the train half has a peer in that
 * category, else the train blend.
 */
export function walkForward(peers: Peer[], model: ModelConstants, asOf: string): WalkForwardResult | null {
  const dated = peers
    .filter((p) => p.listed_at !== null && Date.parse(`${p.listed_at}T00:00:00Z`) < Date.parse(`${asOf}T00:00:00Z`))
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  if (dated.length < 16) return null;
  const trainSize = Math.max(8, Math.floor(dated.length * 0.6));
  const testSize = dated.length - trainSize;
  if (testSize < 8) return null;
  const train = dated.slice(0, trainSize);
  const test = dated.slice(trainSize);
  const splitDate = test[0]!.listed_at!;

  const trainBlended = groupMultiple(train);
  const trainGroups = new Map<string, Peer[]>();
  for (const peer of train) {
    const list = trainGroups.get(peer.category);
    if (list === undefined) trainGroups.set(peer.category, [peer]);
    else list.push(peer);
  }
  const trainMultipleOf = (category: string): number => {
    const list = trainGroups.get(category);
    const raw = list === undefined ? trainBlended : groupMultiple(list);
    return clamp(raw * (1 - model.damping) + trainBlended * model.damping, model.multiple_min, model.multiple_max);
  };

  const preds: number[] = [];
  const actuals: number[] = [];
  const errs: number[] = [];
  let half = 0;
  let third = 0;
  for (const peer of test) {
    const pred = trainMultipleOf(peer.category);
    preds.push(pred);
    actuals.push(peer.ratio);
    errs.push(Math.abs(pred - peer.ratio) / peer.ratio);
    if (pred / peer.ratio >= 0.5 && pred / peer.ratio <= 2) half++;
    if (pred / peer.ratio >= 0.33 && pred / peer.ratio <= 3) third++;
  }
  const mae = median(errs);
  const looMae = median(
    peers.map((peer) => {
      const pred = heldOutMultiple(peers, peer.category, peer.slug, model, groupMultiple(peers));
      return Math.abs(pred - peer.ratio) / peer.ratio;
    }),
  );
  if (!Number.isFinite(mae) || !Number.isFinite(looMae) || looMae <= 0) return null;

  return {
    split_date: splitDate,
    older_train: train.length,
    newer_test: test.length,
    older_multiple: round4(trainBlended),
    newer_multiple: round4(groupMultiple(test)),
    mae_vs_loo: round4((mae - looMae) / looMae),
    median_absolute_error: round4(mae),
    within_half: test.length === 0 ? 0 : half / test.length,
    within_third: test.length === 0 ? 0 : third / test.length,
    correlation: test.length < 3 ? 0 : round4(pearsonLog(preds, actuals)),
  };
}

/** Range honesty: how the final model's own predictions scatter around the peers' true multiples. */
export interface RangeHonesty {
  total_peers: number;
  /** Share predicted within 0.5-2x of the true multiple: the tight band. */
  within_half: number;
  /** Share within 0.33-3x: the working band. */
  within_third: number;
  /** Share within 0.25-4x: the wide band. */
  within_quarter: number;
  /** Share outside even 0.25-4x: the rows a reader should distrust. */
  outside_any: number;
}

/**
 * Range honesty of the final fit (every peer in train): the share of token-bearing peers whose
 * true mcap/TVL lands in each band around the model's predicted multiple. The board quotes these
 * bands as its uncertainty: within 2x is what a comps estimate can promise, within 3x what it
 * usually delivers, and the outside share names the rows to distrust.
 */
export function rangeHonesty(peers: Peer[], model: ModelConstants): RangeHonesty {
  const blended = groupMultiple(peers);
  const groups = new Map<string, Peer[]>();
  for (const peer of peers) {
    const list = groups.get(peer.category);
    if (list === undefined) groups.set(peer.category, [peer]);
    else list.push(peer);
  }
  const byCategory = new Map<string, number>();
  for (const [category, list] of groups) {
    const raw = groupMultiple(list);
    byCategory.set(category, clamp(raw * (1 - model.damping) + blended * model.damping, model.multiple_min, model.multiple_max));
  }
  let half = 0;
  let third = 0;
  let quarter = 0;
  let outside = 0;
  for (const peer of peers) {
    const pred = byCategory.get(peer.category) ?? clamp(blended, model.multiple_min, model.multiple_max);
    const r = pred / peer.ratio;
    if (r >= 0.5 && r <= 2) half++;
    else if (r >= 0.33 && r <= 3) third++;
    else if (r >= 0.25 && r <= 4) quarter++;
    else outside++;
  }
  const n = peers.length || 1;
  return {
    total_peers: peers.length,
    within_half: round4(half / n),
    within_third: round4((half + third) / n),
    within_quarter: round4((half + third + quarter) / n),
    outside_any: round4(outside / n),
  };
}

/** Complete model validation report. */
export interface ValidationReport {
  loo: LOOResult;
  walk_forward: WalkForwardResult | null;
  range_honesty: RangeHonesty;
  blended_multiple: number;
  peers_tested: number;
}

// ---------------------------------------------------------------- holdout verification

/** One category's held-out fit quality: how far its multiple lands from unseen peers' true values. */
export interface HoldoutFit {
  category: string;
  peers: number;
  fitted_multiple: number;
  median_abs_error: number;
  within_2x: number;
  coverage_note: string;
}

/**
 * Leave-one-out verification: for every token-bearing peer, fit the category multiple without it,
 * predict that peer's implied value, and compare against its actual market cap. Reported per
 * category as the median absolute percentage error and the share of peers predicted within 2x —
 * which is what a comp-table estimate can honestly promise. The blended fallback gets the same
 * all-peer test as its check.
 */
export function holdoutFit(peers: Peer[], model: ModelConstants): { categories: HoldoutFit[]; all: { peers: number; median_abs_error: number; within_2x: number }; blended: number } {
  const blended = groupMultiple(peers);
  const groups = new Map<string, Peer[]>();
  for (const peer of peers) {
    const list = groups.get(peer.category);
    if (list === undefined) groups.set(peer.category, [peer]);
    else list.push(peer);
  }
  const categories: HoldoutFit[] = [];
  for (const [category, list] of groups) {
    const errors: number[] = [];
    let within = 0;
    for (let i = 0; i < list.length; i++) {
      const train = list.filter((_, j) => j !== i);
      const trainMult = train.length === 0
        ? blended
        : clamp(groupMultiple(train) * (1 - model.damping) + blended * model.damping, model.multiple_min, model.multiple_max);
      const truth = list[i]!.ratio; // the model predicts a multiple; the peer's mcap/TVL is the truth
      const err = Math.abs(trainMult - truth) / truth;
      errors.push(err);
      if (trainMult / truth >= 0.5 && trainMult / truth <= 2) within++;
    }
    const fitted = clamp(groupMultiple(list) * (1 - model.damping) + blended * model.damping, model.multiple_min, model.multiple_max);
    categories.push({
      category,
      peers: list.length,
      fitted_multiple: round4(fitted),
      median_abs_error: round4(median(errors)),
      within_2x: list.length === 0 ? 0 : within / list.length,
      coverage_note: list.length < 3 ? `only ${list.length} peer${list.length === 1 ? '' : 's'}: the estimate leans on the blended market multiple` : `fit on ${list.length} peers, each held out once`,
    });
  }
  const allErrors: number[] = [];
  let allWithin = 0;
  for (let i = 0; i < peers.length; i++) {
    const trainMult = groupMultiple(peers.filter((_, j) => j !== i));
    const truth = peers[i]!.ratio;
    allErrors.push(Math.abs(trainMult - truth) / truth);
    if (trainMult / truth >= 0.5 && trainMult / truth <= 2) allWithin++;
  }
  return {
    categories: categories.sort((a, b) => a.category.localeCompare(b.category)),
    all: { peers: peers.length, median_abs_error: round4(median(allErrors)), within_2x: peers.length === 0 ? 0 : allWithin / peers.length },
    blended: round4(blended),
  };
}

// ---------------------------------------------------------------- board assembly

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: string;
    trend_pct: number;
    trend_mult: number;
    patience_mult: number;
    age_days: number | null;
  };
  launch_signals: string[];
  farm_steps: string[];
}

/** The dashboard's compact row: the page regenerates the farm plan from these figures. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_source: string;
  trend_mult: number;
  patience_mult: number;
  on_watchlist: boolean;
  action: string;
  exposure: string;
  watch: string;
  cost_tier: number;
  hold_days: number;
  verdict: FarmVerdict;
}

/** A token-bearing protocol: it already trades, so its market cap is a fact, never a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
  listed_at: string | null;
  age_days: number | null;
}

/** Complete model validation: LOO, walk-forward, range honesty — written to board.json and data.js. */
export interface ValidationReport {
  loo: {
    peers: number;
    median_absolute_error: number;
    within_half: number;       // within 0.5–2x
    within_third: number;      // within 0.33–3x
    correlation: number;       // Pearson r on log scale
    per_category: { category: string; peers: number; median_ae: number; within_2x: number; correlation: number }[];
  };
  walk_forward: {
    split_date: string;
    older_train: number;
    newer_test: number;
    older_multiple: number;
    newer_multiple: number;
    mae_vs_loo: number;
    median_absolute_error: number;
    within_half: number;
    within_third: number;
    correlation: number;
  } | null;
  range_honesty: {
    total_peers: number;
    within_half: number;    // 0.5–2x
    within_third: number;   // 0.33–3x
    within_quarter: number; // 0.25–4x
    outside_any: number;    // < 0.25 or > 4
  };
  blended_multiple: number;
  peers_tested: number;
  model_version: string;
}

/** Everything the dashboard needs, plus the model's verification of itself. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** Legacy fit — kept for backward compat, same data as validation.loo */
  fit: {
    blended: number;
    all_peers: number;
    all_median_abs_error: number;
    all_within_2x: number;
    categories: { category: string; peers: number; multiple: number; median_abs_error: number; within_2x: number; coverage_note: string }[];
  };
  /** Full model validation report */
  validation: ValidationReport;
  /** KPI strip totals */
  kpis: {
    implied_total_usd: number;
    pre_token_rows: number;
    token_trading_rows: number;
    watchlist_covered: number;
    median_category_multiple: number;
    best_loo_mae: number;     // lowest per-category median AE (best category fit)
    worst_loo_mae: number;    // highest per-category median AE (worst category fit)
    snapshot_as_of: string;
    floor_usd: number;
    protocol_count: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** DefiLlama's version-marker rule: a name ending in a release marker is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** DefiLlama's wrapped/staked rule: these names name a product of a token that trades. */
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
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  return [...chosen.values()];
}

/** What sign of a launch to watch for, from the category alone — the same derivation the page shows. */
export function launchSignals(p: SnapshotProtocol, age: number | null): string[] {
  const signals: string[] = [];
  const c = (p.category ?? '').toLowerCase();
  if (p.chains.some((ch) => ['Monad', 'Ink', 'Unichain', 'Arc', 'Plasma', 'Pharos', 'Ripple'].includes(ch))) {
    signals.push(`New chain incentive: ${p.name} runs on ${p.chains.filter((ch) => ['Monad', 'Ink', 'Unichain', 'Arc', 'Plasma', 'Pharos', 'Ripple'].includes(ch)).join(' and ')}, chains still seeding users — watch for a joint points program with the chain itself.`);
  }
  if (age !== null && age >= 365) {
    signals.push(`Maturity: ${p.name} has run ${Math.floor(age / 365)} year${age >= 730 ? 's' : ''}+ with no token; protocols of this age and TVL class usually launch or get acquired within the next cycle.`);
  } else if (age !== null && age < 180) {
    signals.push(`Early: ${p.name} listed ${age} days ago — too new for most launches, but the cheapest time to farm before points programs begin.`);
  }
  if ((p.change_7d ?? 0) >= 10) {
    signals.push(`Capital accelerating: TVL is up ${p.change_7d!.toFixed(1)}% in 7 days, the inflow pattern that precedes most announcements.`);
  }
  if ((p.tvl_usd ?? 0) >= 1_000_000_000) {
    signals.push(`Scale: above $1B of TVL with no token, ${p.name} is one of the largest unlaunched protocols in its category — the strongest single launch sign in this record.`);
  }
  signals.push(`Baseline: watch ${p.name}'s docs, governance forum and X account for a points program, a claim page on its own domain, or its ticker appearing on CoinGecko.`);
  return signals;
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot, asOf: string): LiveRow[] {
  return snapshot.protocols
    .filter((p) => hasToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      listed_at: p.listed_at,
      age_days: ageDays(asOf, p.listed_at),
    }));
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ---------------------------------------------------------------- radar build

/**
 * Everything from one snapshot: the scored board (ranks 1..n), the live set set aside, the fit
 * report, and the dashboard's compact rows with their farm-plan fields. This is the one function
 * main.ts calls.
 */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const peers = collectPeers(snapshot.protocols);
  const { blended, byCategory } = fitMultiples(peers, model);
  const fit = holdoutFit(peers, model);

  // --- model validation ---
  const loo = leaveOneOut(peers, model);
  const wf = walkForward(peers, model, snapshot.as_of);
  const rh = rangeHonesty(peers, model);

  const validation: ValidationReport = {
    loo: {
      peers: loo.peers,
      median_absolute_error: loo.median_absolute_error,
      within_half: loo.within_half,
      within_third: loo.within_third,
      correlation: loo.correlation,
      per_category: loo.per_category,
    },
    walk_forward: wf ? {
      split_date: wf.split_date,
      older_train: wf.older_train,
      newer_test: wf.newer_test,
      older_multiple: wf.older_multiple,
      newer_multiple: wf.newer_multiple,
      mae_vs_loo: wf.mae_vs_loo,
      median_absolute_error: wf.median_absolute_error,
      within_half: wf.within_half,
      within_third: wf.within_third,
      correlation: wf.correlation,
    } : null,
    range_honesty: rh,
    blended_multiple: round4(blended),
    peers_tested: peers.length,
    model_version: MODEL_VERSION,
  };

  const chosen = pickBoardProtocols(snapshot);
  const scored = chosen.map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, byCategory, blended, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlist = new Set(snapshot.watchlist);

  // --- KPI strip ---
  const impliedTotal = scored.reduce((s, { s: sc }) => s + sc.implied, 0);
  const tokenTrading = snapshot.protocols.filter((p) => hasToken(p) && p.category !== 'CEX');
  const allCategoryFit = [...byCategory.values()];
  const medianCategoryMultiple = allCategoryFit.length > 0 ? round4(median(allCategoryFit.map((f) => f.multiple))) : blended;

  // Best/worst LOO per-category MAE among categories with ≥3 peers
  const catMae = loo.per_category.filter((c) => c.peers >= 3);
  catMae.sort((a, b) => a.median_ae - b.median_ae);
  const bestLoo = catMae.length > 0 ? catMae[0]!.median_ae : 0;
  const worstLoo = catMae.length > 0 ? catMae[catMae.length - 1]!.median_ae : 0;

  const kpis = {
    implied_total_usd: impliedTotal,
    pre_token_rows: scored.length,
    token_trading_rows: tokenTrading.length,
    watchlist_covered: snapshot.watchlist.length,
    median_category_multiple: medianCategoryMultiple,
    best_loo_mae: round4(bestLoo),
    worst_loo_mae: round4(worstLoo),
    snapshot_as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    protocol_count: snapshot.protocols.length,
  };

  const board: BoardRow[] = scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watchlist.has(p.slug),
    age_days: s.age_days,
    implied_value_usd: s.implied,
    model: {
      multiple: s.multiple,
      multiple_source: s.multiple_source,
      trend_pct: s.trend_pct,
      trend_mult: s.trend_mult,
      patience_mult: s.patience_mult,
      age_days: s.age_days,
    },
    launch_signals: launchSignals(p, s.age_days),
    farm_steps: farmSteps(p, s.age_days).map(stepText),
  }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    live_size: 0,
    fit: {
      blended: fit.blended,
      all_peers: fit.all.peers,
      all_median_abs_error: fit.all.median_abs_error,
      all_within_2x: fit.all.within_2x,
      categories: fit.categories.map((f) => ({
        category: f.category,
        peers: f.peers,
        multiple: f.fitted_multiple,
        median_abs_error: f.median_abs_error,
        within_2x: f.within_2x,
        coverage_note: f.coverage_note,
      })),
    },
    validation,
    kpis,
    rows: board.map((r) => {
      const p: SnapshotProtocol = {
        slug: r.slug,
        name: r.name,
        category: r.category,
        chains: r.chains,
        tvl_usd: r.tvl_usd,
        change_7d: r.change_7d,
        mcap_usd: null,
        listed_at: r.listed_at,
        gecko_id: null,
        symbol: null,
      };
      const { capital, tier } = capitalFor(r.tvl_usd);
      const age = r.age_days;
      const gas = gasFor(p);
      const hold = holdDaysFor(age);
      const c = (r.category ?? '').toLowerCase();
      const exposure = tier >= 2
        ? `A $${capital} position is moderate here: ${r.name}'s TVL is above $1B, so contract risk is smaller, but never more than you can lose.`
        : `Keep the position near $${capital}: ${r.name} is ${r.tvl_usd >= 100_000_000 ? 'a mid-size' : 'a small'} protocol with no token yet, so its contracts are less battle-tested.`;
      const verdict = farmVerdict(p, hold, capital, gas, tier);
      return {
        rank: r.rank,
        slug: r.slug,
        name: r.name,
        category: r.category,
        chains: r.chains,
        tvl_usd: r.tvl_usd,
        change_7d: r.change_7d,
        listed_at: r.listed_at,
        age_days: r.age_days,
        implied_value_usd: r.implied_value_usd,
        multiple: r.model.multiple,
        multiple_source: r.model.multiple_source,
        trend_mult: r.model.trend_mult,
        patience_mult: r.model.patience_mult,
        on_watchlist: r.on_watchlist,
        action: actionFor(p, capital, chainOf(p)),
        exposure,
        watch: watchFor(p),
        cost_tier: tier,
        hold_days: hold,
        verdict,
      };
    }),
    live: [],
  };
  const live = liveRows(snapshot, snapshot.as_of);
  radar.live = live;
  radar.live_size = live.length;
  return { board, radar };
}

// ---------------------------------------------------------------- snapshot parsing

/** Why the snapshot is not one this model can score. */
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
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, spread, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate asks`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
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
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
  }
  return null;
}
