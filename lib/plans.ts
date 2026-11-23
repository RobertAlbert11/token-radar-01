// Farm plans: what a reader should do about a pre-token protocol, before or after it issues one.
// Every plan is derived from the protocol's own record — category, chains, TVL, age — never from a
// hand-written list of names. Each step carries the action, its cost in dollars or gas, its time,
// and what sign of a launch to watch for on the way. The verdict nets the expected reward (the
// implied launch value x the token odds x a share of that value reaching farmers, per dollar of
// competing farming TVL) against every cost: gas, swap fees, and the T-bill the capital forgoes.

import type { SnapshotProtocol } from './model.ts';

export interface CostTier { capital: number; tier: number; band: string }
export function capitalFor(tvlUsd: number): CostTier {
  if (tvlUsd >= 5e9) return { capital: 500, tier: 3, band: 'blue-chip TVL' };
  if (tvlUsd >= 1e9) return { capital: 250, tier: 2, band: 'large TVL' };
  if (tvlUsd >= 1e8) return { capital: 100, tier: 1, band: 'established TVL' };
  return { capital: 50, tier: 0, band: 'small TVL' };
}
export function holdDaysFor(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 90) return 90;
  return ageDays < 365 ? 60 : 45;
}
export function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}
export function gasFor(p: SnapshotProtocol): number {
  const chain = chainOf(p).toLowerCase();
  return chain === 'ethereum' ? 6 : chain === 'bitcoin' || chain === 'solana' ? 1 : 2;
}
const gasPerWeek = (gas: number): number => Math.max(1, Math.ceil(gas / 3));

export interface FarmVerdict {
  capital: number; one_time_gas: number; weekly_gas: number; total_weeks: number;
  total_gas: number; swap_fee: number; capital_charge: number; total_cost: number;
  expected_reward: number; net_usd: number; net_per_hour: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP'; tier: number; tier_label: string;
}
/** Assumptions, all printed on the dashboard: reward share, competing farmers, T-bill, swap fee. */
export const AIRDROP_SHARE = 0.05;
export const FARMER_TVL_SHARE = 0.0002;
export const T_BILL_RATE = 0.0433;
export const SWAP_FEE_RATE = 0.006;
/** The decision rule: FARM clears this $/hour; under it, positive is MARGINAL; zero-or-less SKIP. */
export const FARM_HOURLY = 10;
export function expectedReward(implied: number, odds: number, capital: number, tvlUsd: number): number {
  return implied * odds * AIRDROP_SHARE * (capital / (Math.max(tvlUsd, 1) * FARMER_TVL_SHARE));
}
export function farmVerdict(p: SnapshotProtocol, holdDays: number, capital: number, gas: number, tier: number, implied: number, odds: number): FarmVerdict {
  const oneTimeGas = Math.max(1, gas);
  const totalWeeks = Math.max(1, Math.round(holdDays / 7));
  const totalHours = totalWeeks * 7 * 24;
  const totalGas = Math.round(oneTimeGas + gasPerWeek(gas) * totalWeeks);
  const swapFee = Math.round(capital * SWAP_FEE_RATE * 100) / 100;
  const capitalCharge = Math.round(capital * T_BILL_RATE * (totalWeeks / 52) * 100) / 100;
  const totalCost = Math.round(totalGas + swapFee + capitalCharge);
  const expectedReward = Math.round(implied * odds * AIRDROP_SHARE * (capital / (Math.max(p.tvl_usd, 1) * FARMER_TVL_SHARE)));
  const netUsd = expectedReward - totalCost;
  const netPerHour = Math.round((netUsd / totalHours) * 100) / 100;
  return {
    capital, one_time_gas: oneTimeGas, weekly_gas: gasPerWeek(gas), total_weeks: totalWeeks,
    total_gas: totalGas, swap_fee: swapFee, capital_charge: capitalCharge, total_cost: totalCost,
    expected_reward: expectedReward, net_usd: netUsd, net_per_hour: netPerHour,
    verdict: netPerHour >= FARM_HOURLY ? 'FARM' : netPerHour > 0 ? 'MARGINAL' : 'SKIP',
    tier, tier_label: tier === 3 ? 'blue-chip' : tier === 2 ? 'large TVL' : tier === 1 ? 'established' : 'small',
  };
}

const first = (c: string, ...keys: string[]): boolean => keys.some((k) => c.includes(k));

/** The category's core action, in the words a farmer can follow. */
export function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase(), n = p.name, k = `$${capital}`;
  if (first(c, 'lend', 'cdp', 'collateral')) return `Supply ${k} of USDC to ${n} on ${chain}; borrow a little and repay part — both sides of the book see you.`;
  if (first(c, 'dex', 'yield', 'leveraged farm')) return `Provide ${k} of liquidity (half ETH, half USDC) to ${n}'s pool on ${chain}; leave it to accrue fees.`;
  if (first(c, 'staking', 'restak')) return `Stake ${k} of the chain's native asset via ${n}; hold the liquid receipt token in the same wallet.`;
  if (first(c, 'perpetual', 'derivative')) return `Deposit ${k} of USDC as margin on ${n}; open one small long and one small short so both sides pay fees.`;
  if (first(c, 'curator', 'allocator')) return `Deposit ${k} into a ${n} vault on ${chain}; hold the shares without withdrawing.`;
  if (first(c, 'stable')) return `Mint ${k} of the stable asset through ${n} on ${chain}, then deposit it back into its savings side.`;
  if (first(c, 'rwa')) return `Mint ${k} of ${n}'s tokenized asset on ${chain} and hold it across at least one monthly cycle.`;
  if (first(c, 'insurance')) return `Buy ${k} of cover from ${n} on ${chain} and keep the policy open for the full term.`;
  if (first(c, 'launchpad')) return `Deposit ${k} into ${n}'s active sale or pool on ${chain} and hold the allocation.`;
  if (first(c, 'nft')) return `One purchase and one listing on ${n} with ${k} so both sides see the wallet.`;
  if (first(c, 'options')) return `Buy one small call and one small put on ${n} with ${k} total, and let both expire.`;
  if (first(c, 'payment')) return `Route ${k} of payments through ${n} in several transactions, not one.`;
  if (first(c, 'governance', 'incentive')) return `Deposit ${k} into ${n}'s incentive program on ${chain} and vote with the position at least once.`;
  if (first(c, 'prediction')) return `Fund ${k} and take one position on each side of ${n}'s liveliest market.`;
  if (first(c, 'bridge')) return `Bridge ${k} of USDC to ${chain} through ${n}, use the app on the far side, and bridge a smaller amount back.`;
  return `Deposit ${k} of USDC into ${n} on ${chain} and keep the position open.`;
}
/** What sign of a launch to watch for, from the category and the wallet's view. */
export function watchFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase(), n = p.name;
  if (first(c, 'lend', 'cdp')) return `Watch ${n}'s docs and forum for a points program, a token vote, or a claim page on its own domain.`;
  if (first(c, 'dex', 'yield')) return `Watch for ${n} liquidity mining under its own ticker and its symbol appearing on CoinGecko.`;
  if (first(c, 'staking', 'restak')) return `Watch for ${n} to add governance; restaking tokens usually launch with points redeemable.`;
  if (first(c, 'curator', 'allocator')) return `Watch ${n}'s X and docs for vault-token news — curators often reward early depositors pro rata.`;
  if (first(c, 'rwa')) return `Watch for licensing news first: RWA launches follow legal clarity, so a token sign comes late.`;
  if (first(c, 'perpetual', 'derivative')) return `Watch ${n}'s trading-rewards pages: perps publish fee tiers and points before a token.`;
  if (first(c, 'bridge')) return `Watch for an incentive season or points campaign — bridges usually launch a token after one.`;
  return `Watch ${n}'s own site, X account and docs for a points program, a claim page or a token vote.`;
}

export interface FarmStep { text: string; cost: string; time: string }

/** A protocol's farm plan: seven steps from wallet setup to record keeping, each costed and timed. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const { capital, tier } = capitalFor(p.tvl_usd);
  const gas = gasFor(p);
  const hold = holdDaysFor(age);
  const exposure = tier >= 2
    ? `A $${capital} position is moderate here: ${p.name}'s TVL is above $1B, so contract risk is smaller — but never more than you can lose.`
    : `Keep the position near $${capital}: ${p.name} is ${p.tvl_usd >= 1e8 ? 'a mid-size' : 'a small'} protocol with no token yet, so its contracts are less battle-tested.`;
  return [
    { text: 'Use a fresh wallet holding only the farm funds; keep its seed phrase offline.', cost: `under $${Math.max(1, gas)} of gas for the first transaction`, time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas on ${chain}`, time: '15 minutes to set up' },
    { text: `One qualifying action each week for ${hold} days — deposit, withdraw, swap or vote — so the wallet is active in more than one monthly snapshot.`, cost: `about $${Math.max(1, Math.round(gas / 3))} of gas a week`, time: '10 minutes a week' },
    { text: `Open the protocol's own points page (if any) and register the wallet there; never a look-alike domain.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: exposure, cost: 'the capital stays in the position until the hold ends', time: `${hold} days` },
    { text: watchFor(p), cost: 'nothing but attention', time: '5 minutes a week' },
    { text: 'Log the wallet address, every date and tx hash, and the position size — proof of the farm, fast to unwind.', cost: 'nothing but the log', time: '5 minutes' },
  ];
}
/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s.length < 20 ? `${s} Hold the position.` : s;
}
