// Farm plans: what a reader should do about a pre-token protocol, before or after it issues one.
//
// Every plan is derived from the protocol's own record — category, chains, TVL, age — never from a
// hand-written list of names. A plan is five to eight steps, each with the action, what it costs in
// dollars or gas, how long it takes, and what sign of a launch to watch for on the way.

import type { SnapshotProtocol } from './model.ts';

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(tvlUsd: number): { capital: number; tier: number; band: string } {
  if (tvlUsd >= 5_000_000_000) return { capital: 500, tier: 3, band: 'blue-chip TVL' };
  if (tvlUsd >= 1_000_000_000) return { capital: 250, tier: 2, band: 'large TVL' };
  if (tvlUsd >= 100_000_000) return { capital: 100, tier: 1, band: 'established TVL' };
  return { capital: 50, tier: 0, band: 'small TVL' };
}

/** How long to hold, from the protocol's age: a younger protocol gets a longer qualifying window. */
export function holdDaysFor(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 90) return 90;
  if (ageDays < 365) return 60;
  return 45;
}

/** The chain a farmer would touch first, or a neutral phrase when the record names none. */
export function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas cost of one transaction on the protocol's main chain, in dollars. */
export function gasFor(p: SnapshotProtocol): number {
  const chain = chainOf(p).toLowerCase();
  if (chain === 'ethereum') return 6;
  if (chain === 'bitcoin' || chain === 'solana') return 1;
  return 2;
}

/** The category's core action, in the words a farmer can follow. */
export function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay part of the loan so both sides of the book see you.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain}, half in ETH and half in USDC, and leave it to accrue fees.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, use the app on the far side, and bridge a smaller amount back.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's native asset through ${name} and hold the liquid receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name}, open one small long and one small short so you pay fees on both sides.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position on each side of ${name}'s liveliest market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares without withdrawing.`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset through ${name} on ${chain}, then deposit it back into its savings side.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s tokenized asset on ${chain} and hold it across at least one monthly cycle.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy open for the full term.`;
  if (c.includes('launchpad')) return `Deposit $${capital} into ${name}'s active sale or pool on ${chain} and hold the allocation.`;
  if (c.includes('nft')) return `Make one purchase and one listing on ${name} with $${capital} so both sides of the marketplace see the wallet.`;
  if (c.includes('options')) return `Buy one small call and one small put on ${name} with $${capital} total, and let both expire.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} in several transactions rather than one.`;
  if (c.includes('governance') || c.includes('incentive')) return `Deposit $${capital} into ${name}'s incentive program on ${chain} and vote with the position at least once.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** What sign of a launch to watch for, derived from the category and the wallet's view. */
export function watchFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Watch ${name}'s docs and governance forum for a points program or a token vote, and any new claim page on its own domain.`;
  if (c.includes('dex') || c.includes('yield')) return `Watch for ${name} liquidity mining with its own ticker, and for its symbol appearing on CoinGecko listings.`;
  if (c.includes('bridge')) return `Watch for ${name} to announce an incentive season or points campaign — bridges usually launch a token after one.`;
  if (c.includes('staking') || c.includes('restak')) return `Watch for ${name} to add a governance module; restaking protocols launch tokens with their points redeemable.`;
  if (c.includes('curator') || c.includes('allocator')) return `Watch ${name}'s X account and docs for vault token announcements — curators often reward early depositors pro rata.`;
  if (c.includes('rwa')) return `Watch for regulatory or licensing news from ${name} first; RWA launches follow legal clarity, so a token sign comes late.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Watch ${name}'s trading rewards pages: perps protocols publish fee tiers and points before a token.`;
  return `Watch ${name}'s own site, X account and docs for a points program, a claim page or a token vote.`;
}

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/**
 * A protocol's farm plan: seven steps from wallet setup to record keeping, each with its cost, its
 * time and — where it matters — what to watch for on the way to a launch.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const { capital, tier } = capitalFor(p.tvl_usd);
  const gas = gasFor(p);
  const hold = holdDaysFor(age);
  const exposure = tier >= 2 ? `A position of $${capital} is a moderate sum here: ${p.name}'s TVL is above $1B, so the contract risk is smaller, but never more than you can lose.` : `Keep the position near $${capital}: ${p.name} is ${p.tvl_usd >= 100_000_000 ? 'a mid-size' : 'a small'} protocol with no token yet, so the contracts are less battle-tested.`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under $${Math.max(1, gas)} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week for ${hold} days — a deposit, a withdraw, a swap or a vote — so the wallet is active in more than one monthly snapshot.`,
      cost: `about $${Math.max(1, Math.round(gas / 3))} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Open the protocol's own points or rewards page (if it has one) and register the wallet there; never connect it to a look-alike domain.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: exposure,
      cost: 'the capital stays in the position until the hold ends',
      time: `${hold} days`,
    },
    {
      text: watchFor(p),
      cost: 'nothing but attention',
      time: '5 minutes a week',
    },
    {
      text: `Log the wallet address, every date and transaction hash, and the position size, so you can prove the farm or unwind it fast.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}
