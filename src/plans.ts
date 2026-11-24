function v(e) {
  return e >= 5e9
    ? { capital: 500, tier: 3, band: "blue-chip TVL" }
    : e >= 1e9
      ? { capital: 250, tier: 2, band: "large TVL" }
      : e >= 1e8
        ? { capital: 100, tier: 1, band: "established TVL" }
        : { capital: 50, tier: 0, band: "small TVL" };
}
function k(e) {
  return e === null ? 45 : e < 90 ? 90 : e < 365 ? 60 : 45;
}
function h(e) {
  return e.chains.length > 0 ? e.chains[0] : "its main chain";
}
function b(e) {
  const a = h(e).toLowerCase();
  return a === "ethereum" ? 6 : a === "bitcoin" || a === "solana" ? 1 : 2;
}
const A = (e) => Math.max(1, Math.ceil(e / 3)),
  d = 0.05,
  u = 2e-4,
  x = 0.0433,
  _ = 0.006,
  M = 10;
function T(e, a, t, o) {
  return e * a * d * (t / (Math.max(o, 1) * u));
}
function D(e, a, t, o, n, s, l) {
  const r = Math.max(1, Math.round(a / 7)),
    p = A(o),
    $ = Math.round(Math.max(1, o) + p * r),
    m = Math.round(t * _ * 100) / 100,
    f = Math.round(t * x * (r / 52) * 100) / 100,
    g = Math.round($ + m + f),
    w = Math.round(s * l * d * (t / (Math.max(e.tvl_usd, 1) * u))),
    y = w - g,
    c = Math.round((y / (r * 168)) * 100) / 100;
  return {
    capital: t,
    one_time_gas: Math.max(1, o),
    weekly_gas: p,
    total_weeks: r,
    total_gas: $,
    swap_fee: m,
    capital_charge: f,
    total_cost: g,
    expected_reward: w,
    net_usd: y,
    net_per_hour: c,
    verdict: c >= M ? "FARM" : c > 0 ? "MARGINAL" : "SKIP",
    tier: n,
    tier_label: n === 3 ? "blue-chip" : n === 2 ? "large TVL" : n === 1 ? "established" : "small",
  };
}
const i = (e, ...a) => a.some((t) => e.includes(t));
function L(e, a, t) {
  const o = (e.category ?? "").toLowerCase(),
    n = e.name,
    s = `$${a}`;
  return i(o, "lend", "cdp", "collateral")
    ? `Supply ${s} of USDC to ${n} on ${t}; borrow a little, repay part \u2014 both sides of the book see you.`
    : i(o, "dex", "yield", "leveraged farm")
      ? `Provide ${s} of liquidity (half ETH, half USDC) to ${n}'s pool on ${t}; leave it to accrue fees.`
      : i(o, "staking", "restak")
        ? `Stake ${s} of the chain's native asset via ${n}; hold the liquid receipt token in the same wallet.`
        : i(o, "perpetual", "derivative")
          ? `Deposit ${s} of USDC as margin on ${n}; open one small long and one small short so both sides pay fees.`
          : i(o, "curator", "allocator")
            ? `Deposit ${s} into a ${n} vault on ${t}; hold the shares.`
            : i(o, "stable")
              ? `Mint ${s} of the stable through ${n} on ${t}, then deposit it into its savings side.`
              : i(o, "rwa")
                ? `Mint ${s} of ${n}'s tokenized asset on ${t}; hold it one monthly cycle.`
                : i(o, "insurance")
                  ? `Buy ${s} of cover from ${n} on ${t} and keep the policy open for the full term.`
                  : i(o, "launchpad")
                    ? `Deposit ${s} into ${n}'s active sale or pool on ${t} and hold the allocation.`
                    : i(o, "nft")
                      ? `One purchase and one listing on ${n} with ${s} \u2014 both sides see the wallet.`
                      : i(o, "options")
                        ? `Buy one small call and one small put on ${n} with ${s} total, and let both expire.`
                        : i(o, "payment")
                          ? `Route ${s} of payments through ${n} in several transactions, not one.`
                          : i(o, "governance", "incentive")
                            ? `Deposit ${s} into ${n}'s incentive program on ${t} and vote with the position at least once.`
                            : i(o, "prediction")
                              ? `Fund ${s} and take one position on each side of ${n}'s liveliest market.`
                              : i(o, "bridge")
                                ? `Bridge ${s} of USDC to ${t} through ${n}, use the app on the far side, and bridge a smaller amount back.`
                                : `Deposit ${s} of USDC into ${n} on ${t} and keep the position open.`;
}
function R(e) {
  const a = (e.category ?? "").toLowerCase(),
    t = e.name;
  return i(a, "lend", "cdp")
    ? `Watch ${t}'s docs and forum for a points program, a token vote, or a claim page on its own domain.`
    : i(a, "dex", "yield")
      ? `Watch for ${t} liquidity mining under its own ticker and its symbol appearing on CoinGecko.`
      : i(a, "staking", "restak")
        ? `Watch for ${t} to add governance; restaking tokens usually launch with points redeemable.`
        : i(a, "curator", "allocator")
          ? `Watch ${t}'s X and docs for vault-token news \u2014 curators often reward early depositors pro rata.`
          : i(a, "rwa")
            ? "Watch for licensing news first: RWA launches follow legal clarity, so a token sign comes late."
            : i(a, "perpetual", "derivative")
              ? `Watch ${t}'s trading-rewards pages: perps publish fee tiers and points before a token.`
              : i(a, "bridge")
                ? "Watch for an incentive season or points campaign \u2014 bridges usually launch a token after one."
                : `Watch ${t}'s own site, X account and docs for a points program, a claim page or a token vote.`;
}
function S(e, a) {
  const t = h(e),
    { capital: o, tier: n } = v(e.tvl_usd),
    s = b(e),
    l = k(a),
    r =
      n >= 2
        ? `A $${o} position is moderate here: ${e.name}'s TVL is above $1B, so contract risk is smaller \u2014 but never more than you can lose.`
        : `Keep the position near $${o}: ${e.name} is ${e.tvl_usd >= 1e8 ? "a mid-size" : "a small"} protocol with no token yet, so its contracts are less battle-tested.`;
  return [
    {
      text: "Use a fresh wallet holding only the farm funds; keep its seed offline.",
      cost: `under $${Math.max(1, s)} gas`,
      time: "5 minutes",
    },
    { text: L(e, o, t), cost: `$${o} capital + ~$${s} gas on ${t}`, time: "15 minutes" },
    {
      text: `One qualifying action each week for ${l} days \u2014 deposit, withdraw, swap or vote \u2014 so the wallet is active in more than one monthly snapshot.`,
      cost: `about $${Math.max(1, Math.round(s / 3))} of gas a week`,
      time: "10 minutes a week",
    },
    {
      text: "Open the protocol's own points page (if any) and register the wallet; never a look-alike domain.",
      cost: "free \u2014 never pay to claim",
      time: "10 minutes",
    },
    { text: r, cost: "capital stays in the position", time: `${l} days` },
    { text: R(e), cost: "attention only", time: "5 min/week" },
    {
      text: "Log the wallet address, every date and tx hash, the position size.",
      cost: "free",
      time: "5 minutes",
    },
  ];
}
function C(e) {
  let a = `${e.text} Cost: ${e.cost}. Time: ${e.time}.`;
  return (
    a.length > 600 && (a = `${a.slice(0, 596)}...`),
    a.length < 20 ? `${a} Hold the position.` : a
  );
}
export {
  d as AIRDROP_SHARE,
  u as FARMER_TVL_SHARE,
  M as FARM_HOURLY,
  _ as SWAP_FEE_RATE,
  x as T_BILL_RATE,
  L as actionFor,
  v as capitalFor,
  h as chainOf,
  T as expectedReward,
  S as farmSteps,
  D as farmVerdict,
  b as gasFor,
  k as holdDaysFor,
  C as stepText,
  R as watchFor,
};
