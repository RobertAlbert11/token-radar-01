(() => {
'use strict';
var D = window.RADAR;
if (!D) return;
var app = document.getElementById('app');
var state = { q: '', cat: 'all', chain: 'all', list: 'all', sort: 'rank', dir: 1, sel: null,
deposit: null, drop: 0, horizon: null, preset: null };
function fmtUsd(n) {
if (n === null || n === undefined || !isFinite(n)) return 'n/a';
var neg = n < 0 ? '-' : ''; n = Math.abs(n);
if (n >= 1e9) return neg + '$' + (n / 1e9).toFixed(2) + 'B';
if (n >= 1e6) return neg + '$' + (n / 1e6).toFixed(1) + 'M';
if (n >= 1e3) return neg + '$' + Math.round(n / 1e3) + 'K';
return neg + '$' + Math.round(n);
}
function fmtPct(n, d) { return (n === null || !isFinite(n)) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(d === undefined ? 1 : d) + '%'; }
function fmtPct0(n) { return (n === null || !isFinite(n)) ? 'n/a' : Math.round(n * 100) + '%'; }
function fmtAge(d) { return d === null || d === undefined ? '?' : d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.round(d) + 'd'; }
function fmtMult(n) { return (n === null || !isFinite(n)) ? 'n/a' : n.toFixed(2) + 'x'; }
function el(tag, attrs) {
var node = document.createElement(tag);
if (attrs) Object.keys(attrs).forEach((k) => {
var v = attrs[k];
if (v === null || v === undefined) return;
if (k === 'class') node.className = v;
else if (k === 'text') node.textContent = v;
else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
else node.setAttribute(k, v);
});
for (var i = 2; i < arguments.length; i++) {
var c = arguments[i];
if (c === null || c === undefined) continue;
if (Array.isArray(c)) c.forEach((x) => { if (x) node.appendChild(x); });
else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
else node.appendChild(c);
}
return node;
}
function table(head, body, cls) {
return el('div', { class: 'table-wrap' },
el('table', { class: cls || '' },
el('thead', null, el('tr', null, head.map((h) => { return el('th', { scope: 'col', text: h[0], class: h[1] || null }); }))),
body));
}
function td(t, cls) { return el('td', { class: cls || null, text: String(t) }); }
function impliedOf(r) { return Math.max(1, Math.round(r.tvl_usd * r.multiple * r.trend_mult * r.patience_mult)); }
var ASSUME = { airdrop: 0.05, farmerTvl: 0.0002, tbill: 0.0433, swap: 0.006, farmHourly: 10 };
function verdictOf(r) {
var v = r.verdict;
var capital = state.deposit || v.capital;
var weeks = state.horizon ? state.horizon / 7 : v.total_weeks;
var holdDays = state.horizon || v.total_weeks * 7;
var odds = (D.odds.by_slug && D.odds.by_slug[r.slug]) || D.odds.base_rate;
var ev = r.implied_value_usd * odds * (ASSUME.airdrop * (1 - state.drop)) * (capital / Math.max(r.tvl_usd, 1) / ASSUME.farmerTvl);
var gas = v.one_time_gas + v.weekly_gas * weeks;
var swap = capital * ASSUME.swap;
var charge = capital * ASSUME.tbill * (weeks / 52);
var cost = gas + swap + charge;
var net = ev - cost;
var perHour = net / (weeks * 168);
return { capital: capital, weeks: weeks, ev: ev, gas: gas, swap: swap, charge: charge, cost: cost,
net: net, perHour: perHour, verdict: perHour >= ASSUME.farmHourly ? 'FARM' : perHour > 0 ? 'MARGINAL' : 'SKIP' };
}
function checksum(rows) {
var h = 0x811c9dc5;
rows.forEach((r) => {
var s = r.rank + ':' + r.slug + ':' + r.implied_value_usd + '\n';
for (var i = 0; i < s.length; i++) {
h ^= s.charCodeAt(i);
h = Math.imul(h, 0x01000193) >>> 0;
}
});
return ('00000000' + h.toString(16)).slice(-8);
}
function integrityBar() {
var rows = D.rows;
var re = rows.map(impliedOf);
var reOk = re.every((v, i) => v === rows[i].implied_value_usd);
var ordered = rows.every((r, i) => r.rank === i + 1);
var falling = rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd);
var distinct = new Set(rows.map((r) => r.implied_value_usd)).size === rows.length;
var total = rows.reduce((s, r) => s + r.implied_value_usd, 0);
var wl = rows.filter((r) => r.on_watchlist).length;
var sum = D.accounting.buckets.reduce((s, b) => s + b.count, 0) === D.accounting.total;
var cs = checksum(rows) === D.checksum;
var bits = [
'this table = board.json',
re.length + ' of ' + re.length + ' rows recomputed in-page: ' + (reOk ? 'match' : 'MISMATCH'),
'ranks 1–' + rows.length + ' in order: ' + (ordered ? 'yes' : 'NO'),
'values never rise: ' + (falling && distinct ? 'yes' : 'NO'),
'total equals ' + fmtUsd(total),
'watchlist ' + wl + '/' + D.watchlist_size + ' ranked',
'accounting buckets sum to ' + D.accounting.total + ': ' + (sum ? 'yes' : 'NO'),
'checksum ' + D.checksum + (cs ? ' matches board.json' : ' MISMATCH'),
];
return el('div', { class: 'integrity' },
el('strong', { text: 'Integrity bar: ' }), el('span', { text: bits.join(' · ') }));
}
function accountingStrip() {
var a = D.accounting;
var sum = a.buckets.reduce((s, b) => s + b.count, 0);
return el('section', { class: 'card' },
el('h2', { text: 'Accounting — ' + a.total + ' protocols, one bucket each' }),
table([['Bucket'], ['Count', 'num'], ['Why']],
el('tbody', null, a.buckets.map((b) => {
return el('tr', null, td(b.label), td(b.count, 'num'), td(b.note, 'sub'));
}))),
el('p', { class: 'footnote ' + (sum === a.total ? 'ok' : 'bad'), text: 'buckets sum to ' + sum + ' of ' + a.total + (sum === a.total ? ' — no silent drops' : ' — MISMATCH') }));
}
function evidenceCard() {
var e = D.evidence, v = D.validation;
var coef = el('div', { class: 'kv' },
el('div', null, el('span', { text: 'Fitted: log10 mcap/TVL = a + b·log10 TVL + c·growth + dummies' }), el('b', { text: 'a=' + e.intercept.toFixed(3) + ', b=' + e.size_slope.toFixed(3) + ', c=' + e.growth_coef.toFixed(3) })),
el('div', null, el('span', { text: 'Implied multiple at $1B TVL (size term)' }), el('b', { text: fmtMult(e.at_1b) })),
el('div', null, el('span', { text: 'Age curve, pre-token side' }), el('b', { text: 'F(age) = ' + D.model.patience_floor + ' + ' + (1 - D.model.patience_floor).toFixed(2) + ' · min(age, ' + D.model.patience_days + ')/' + D.model.patience_days })),
el('div', null, el('span', { text: 'Production multiple' }), el('b', { text: 'robust per-category medians, damped ' + Math.round((1 - D.model.damping) * 100) + '/' + Math.round(D.model.damping * 100) + ' — the ablation is its lab check' })));
var tbl = table([['Feature set'], ['Kept', 'num'], ['LOO miss', 'num'], ['WF miss', 'num'], ['P25–P75 cov (≈50%)', 'num'], ['P10–P90 cov (≈80%)', 'num']],
el('tbody', null, e.rows.map((r) => {
return el('tr', null, td(r.label), td(r.kept ? 'kept' : 'not kept', r.kept ? 'ok' : 'sub'),
td(r.loo_miss.toFixed(2) + 'x', 'num'), td(r.wf_miss.toFixed(2) + 'x', 'num'),
td(fmtPct0(r.cov50), 'num'), td(fmtPct0(r.cov80), 'num'));
})));
var notes = el('ul', { class: 'notes' }, e.rows.map((r) => { return el('li', { text: r.label + ' — ' + r.note }); }));
var wf = v.walk_forward;
return el('section', { class: 'card' },
el('h2', { text: 'Out-of-sample evidence — per-feature ablation' }),
el('p', { class: 'sub', text: 'Miss = median of max(pred/actual, actual/pred) over held-out peers (2.0 = typical peer missed by 2x). Coverage = share of held-out peers inside the error band fitted from the OTHER peers, against the stated band size.' }),
coef, tbl, notes,
wf ? el('p', { class: 'footnote', text: 'Walk-forward ' + wf.split_date + ': ' + wf.older_train + ' train, ' + wf.newer_test + ' test — train blend ' + fmtMult(wf.older_multiple) + ' → ' + fmtMult(wf.newer_multiple) + ', MAE ' + fmtPct0(wf.median_absolute_error) + ' (' + (wf.mae_vs_loo <= 0 ? '-' : '+') + Math.abs(Math.round(wf.mae_vs_loo * 100)) + '% vs LOO).' })
: el('p', { class: 'footnote', text: 'Too few dated peers for walk-forward; LOO is the honest test here.' }));
}
function oddsCard() {
var o = D.odds;
return el('section', { class: 'card' },
el('h2', { text: 'Token odds — the peers\u2019 record, never a forecast' }),
el('p', { class: 'sub ok', text: 'No forecast of a launch: the odds are what the snapshot\u2019s own protocols did, bucketed by age. Implied value is a launch\u2019s size IF one comes.' }),
el('div', { class: 'kv' },
el('div', null, el('span', { text: 'Base rate: protocols with a token recorded' }), el('b', { text: fmtPct0(o.base_rate) })),
el('div', null, el('span', { text: 'Brier, age-band estimate (leave-one-out)' }), el('b', { class: o.brier_loo < o.brier_base ? 'ok' : 'bad', text: o.brier_loo.toFixed(4) })),
el('div', null, el('span', { text: 'Brier, base-rate-only baseline' }), el('b', { text: o.brier_base.toFixed(4) })),
el('div', null, el('span', { text: 'Brier, walk-forward (older bands → newer test)' }), el('b', { text: o.brier_wf === null ? 'n/a' : o.brier_wf.toFixed(4) }))),
el('p', { class: 'footnote', text: o.note }));
}
function modelCard() {
var m = D.model;
return el('section', { class: 'card' },
el('h2', { text: 'How implied value is computed' }),
el('div', { class: 'formula', text: 'implied = round( tvl_usd × category_multiple × trend × patience ), trend = 1 + clamp(change_7d,' + m.trend_floor + ',' + m.trend_cap + ')/100×' + m.growth_weight + ', patience = ' + m.patience_floor + '+0.45·min(age,' + m.patience_days + ')/' + m.patience_days }),
el('div', { class: 'kv' },
el('div', null, el('span', { text: 'Category multiple' }), el('b', { text: 'median peer mcap/TVL, damped to the blend (' + fmtMult(D.validation.blended_multiple) + ')' })),
el('div', null, el('span', { text: 'Trend' }), el('b', { text: 'clamped ' + m.trend_floor + '…' + m.trend_cap + '% × ' + m.growth_weight })),
el('div', null, el('span', { text: 'Patience' }), el('b', { text: '' + m.patience_floor + ' at listing → 1.00 at ' + m.patience_days + 'd; unknown age = ' + m.unknown_age_days + 'd' })),
el('div', null, el('span', { text: 'Band' }), el('b', { text: 'clamped ' + m.multiple_min + '–' + m.multiple_max + 'x' }))),
el('p', { class: 'sub', text: 'One function scores every protocol; no name is special-cased. Age discounts, not rewards: longer with no token, less scarcity value.' }));
}
function scatter(host, slug) {
var W = 560, H = 300;
var pts = [], seen = new Set();
D.rows.forEach((r) => { if (r.comps) r.comps.forEach((c) => { if (!seen.has(c.name)) { seen.add(c.name); pts.push(c); } }); });
var x0 = 5.5, x1 = 10.5, y0 = 5.5, y1 = 11.5;
var X = (x) => (x - x0) / (x1 - x0) * 100;
var Y = (y) => (1 - (y - y0) / (y1 - y0)) * 100;
var e = D.evidence;
var curve = [];
for (var t = x0; t <= x1; t += 0.25) curve.push(X(t).toFixed(2) + '%,' + Y((1 + e.size_slope) * t + e.intercept).toFixed(2) + '%');
var box = el('div', { class: 'scatter', style: 'width:' + W + 'px;height:' + H + 'px;' });
box.appendChild(el('div', { class: 'fitline', style: 'clip-path:polygon(' + curve.join(',') + ');' }));
pts.slice(0, 500).forEach((c) => {
box.appendChild(el('i', { class: 'dot', style: 'left:' + X(Math.log10(c.tvl_usd)).toFixed(2) + '%;top:' + Y(Math.log10(c.mcap_usd)).toFixed(2) + '%;' }));
});
if (slug) {
var r = D.rows.filter((q) => q.slug === slug)[0];
if (r) box.appendChild(el('i', { class: 'dot mark', style: 'left:' + X(Math.log10(r.tvl_usd)).toFixed(2) + '%;top:' + Y(Math.log10(r.implied_value_usd)).toFixed(2) + '%;' }));
}
box.appendChild(el('span', { class: 'ax x', text: 'log10 TVL →' }));
box.appendChild(el('span', { class: 'ax y', text: '↑ log10 market cap (fitted line: a=' + e.intercept.toFixed(2) + ', b=' + e.size_slope.toFixed(2) + ')' }));
host.appendChild(box);
}
function controls(categories, chains) {
var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain…', value: state.q });
search.addEventListener('input', () => { state.q = search.value; render(); });
var catSel = el('select', { id: 'cat' }, el('option', { value: 'all', text: 'All categories' }),
categories.map((c) => { return el('option', { value: c, text: c }); }));
catSel.value = state.cat;
catSel.addEventListener('change', () => { state.cat = catSel.value; render(); });
var chainSel = el('select', { id: 'chain' }, el('option', { value: 'all', text: 'All chains' }),
chains.map((c) => { return el('option', { value: c, text: c }); }));
chainSel.value = state.chain;
chainSel.addEventListener('change', () => { state.chain = chainSel.value; render(); });
var dep = el('select', { id: 'dep' },
[null, 50, 100, 250, 500, 1000, 5000].map((d) => { return el('option', { value: d === null ? '' : String(d), text: d === null ? 'Default capital' : '$' + d + ' deposit' }); }));
dep.value = state.deposit === null ? '' : String(state.deposit);
dep.addEventListener('change', () => { state.deposit = dep.value ? Number(dep.value) : null; render(); });
var drop = el('select', { id: 'drop' },
[0, 0.2, 0.4].map((d) => { return el('option', { value: String(d), text: d === 0 ? 'Reward haircut 0%' : 'Reward haircut ' + Math.round(d * 100) + '%' }); }));
drop.value = String(state.drop);
drop.addEventListener('change', () => { state.drop = Number(drop.value); render(); });
var hor = el('select', { id: 'hor' },
[null, 30, 60, 90].map((d) => { return el('option', { value: d === null ? '' : String(d), text: d === null ? 'Default hold' : d + '-day hold' }); }));
hor.value = state.horizon === null ? '' : String(state.horizon);
hor.addEventListener('change', () => { state.horizon = hor.value ? Number(hor.value) : null; render(); });
function chip(key, label, preset) {
return el('button', { class: 'chip', type: 'button', 'aria-pressed': state.list === key ? 'true' : 'false', text: label,
onclick: () => { state.list = key; if (preset) Object.assign(state, preset); render(); } });
}
var csv = el('button', { class: 'chip', type: 'button', text: 'Export CSV', onclick: exportCsv });
return el('div', { class: 'controls' },
el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
el('div', { class: 'field' }, el('label', { for: 'cat', text: 'Category' }), catSel),
el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
el('div', { class: 'field' }, el('label', { for: 'dep', text: 'Deposit' }), dep),
el('div', { class: 'field' }, el('label', { for: 'drop', text: 'Reward' }), drop),
el('div', { class: 'field' }, el('label', { for: 'hor', text: 'Horizon' }), hor),
el('div', { class: 'field' }, el('span', { class: 'label', text: 'Presets' }),
el('div', { class: 'chips' },
chip('all', 'All rows'), chip('watchlist', 'Watchlist 40'),
chip('farm', 'FARM verdicts', { preset: 'farm' }),
chip('growth', 'TVL growing ≥10%', { preset: 'growth' }),
csv)));
}
function presetFilter(r) {
if (state.preset === 'farm') return verdictOf(r).verdict === 'FARM';
if (state.preset === 'growth') return (r.change_7d || 0) >= 10;
return true;
}
function exportCsv() {
var head = 'rank,name,category,chains,tvl_usd,change_7d,age_days,implied_value_usd,multiple,trend_mult,patience_mult,verdict,net_per_hour,total_cost,expected_reward\n';
var body = filtered().map((r) => {
var v = verdictOf(r);
return [r.rank, r.name, r.category || '', r.chains.join('|'), r.tvl_usd, r.change_7d === null ? '' : r.change_7d,
r.age_days === null ? '' : r.age_days, r.implied_value_usd, r.multiple, r.trend_mult, r.patience_mult,
v.verdict, v.perHour.toFixed(2), Math.round(v.cost), Math.round(v.ev)].join(',');
}).join('\n');
var a = el('a', { href: 'data:text/csv;charset=utf-8,' + encodeURIComponent(head + body), download: 'yieldradar-board.csv' });
document.body.appendChild(a); a.click(); a.remove();
}
function sortHeader(key, label) {
var active = state.sort === key;
return el('th', { scope: 'col' }, el('button', { type: 'button',
onclick: () => { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; } render(); } },
label, active ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null));
}
function filtered() {
var q = state.q.trim().toLowerCase();
return D.rows.filter((r) => {
if (state.cat !== 'all' && (r.category || 'Uncategorized') !== state.cat) return false;
if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
if (state.list === 'watchlist' && !r.on_watchlist) return false;
if (state.list === 'farm' || state.list === 'growth') { if (!presetFilter(r)) return false; }
if (!q) return true;
return [r.name, r.slug, r.category, r.chains.join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
});
}
function sorted(list) {
var key = state.sort, dir = state.dir;
return list.slice().sort((a, b) => {
var av, bv;
if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
else if (key === 'net') { av = verdictOf(a).perHour; bv = verdictOf(b).perHour; }
else { av = -a.rank; bv = -b.rank; }
return av < bv ? -dir : av > bv ? dir : a.slug < b.slug ? -1 : 1;
});
}
function boardTable() {
var list = sorted(filtered());
var max = Math.max.apply(null, list.map((r) => r.implied_value_usd)) || 1;
var tbody = el('tbody');
list.forEach((r) => {
var v = verdictOf(r);
tbody.appendChild(el('tr', { tabindex: '0', onclick: () => { openDetail(r.slug); },
onkeydown: (e) => { if (e.key === 'Enter') openDetail(r.slug); } },
td(r.rank, 'num'),
el('td', null, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorized') + ' · ' + r.chains.slice(0, 2).join(', ') })),
td(fmtUsd(r.tvl_usd), 'num'),
td(fmtPct(r.change_7d), 'num ' + ((r.change_7d || 0) >= 0 ? 'pos' : 'neg')),
td(fmtAge(r.age_days), 'num'),
el('td', null, el('div', { class: 'implied' },
el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(2, Math.round(r.implied_value_usd / max * 100)) + '%' })),
el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))),
td(v.verdict, 'num ' + v.verdict.toLowerCase()),
td((v.perHour >= 0 ? '+' : '') + '$' + v.perHour.toFixed(2) + '/h', 'num'),
td(r.on_watchlist ? 'watchlist' : 'early', 'num')));
});
return el('div', { class: 'panel' },
el('p', { class: 'caption', text: 'Ranked by implied launch value — fitted from the snapshot\u2019s comparables. NET $/h recomputes live with the deposit, haircut and horizon controls. Select a row for its build-up, farm plan, comparables and sensitivity.' }),
table([['#'], ['Protocol'], ['TVL', 'num'], ['7d', 'num'], ['Age', 'num'], ['Implied value'], ['Verdict', 'num'], ['NET $/h', 'num'], ['List', 'num']], tbody));
}
function openDetail(slug) {
var r = null;
for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) { r = D.rows[i]; break; }
if (!r) return;
state.sel = slug;
var v = verdictOf(r);
var re = impliedOf(r);
var dialog = el('dialog', { class: 'detail' });
dialog.addEventListener('close', () => { state.sel = null; });
var head = el('div', { class: 'detail-head' },
el('div', null,
el('span', { class: 'sub', text: 'Rank ' + r.rank + ' of ' + D.board_size + (r.on_watchlist ? ' · watchlist' : ' · early') }),
el('h2', { text: r.name }),
el('span', { class: 'sub', text: (r.category || 'Uncategorized') + ' · ' + r.chains.join(', ') })),
el('button', { class: 'close', type: 'button', text: '✕', onclick: () => { dialog.close(); } }));
dialog.appendChild(head);
dialog.appendChild(el('section', { class: 'sec' },
el('h3', { text: 'Value build-up — the literal formula, every step recomputable' }),
el('div', { class: 'hero' }, el('b', { text: fmtUsd(r.implied_value_usd) }), el('span', { text: 'implied launch value (' + D.model_version + ' model)' })),
el('div', { class: 'equation' },
el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { text: fmtUsd(r.tvl_usd) })),
el('div', null, el('span', { text: '× multiple — ' + r.multiple_source }), el('b', { text: fmtMult(r.multiple) })),
el('div', null, el('span', { text: '× trend (7d ' + (r.change_7d === null ? 'n/a → 0' : fmtPct(r.change_7d)) + '): 1 + t/100×' + D.model.growth_weight }), el('b', { text: r.trend_mult.toFixed(3) + 'x' })),
el('div', null, el('span', { text: '× patience: F(age=' + fmtAge(r.age_days) + ') = ' + D.model.patience_floor + '+0.45·min(age,' + D.model.patience_days + ')/' + D.model.patience_days }), el('b', { text: r.patience_mult.toFixed(3) + 'x' })),
el('div', { class: 'result' }, el('span', { text: '= launch value (in-page recompute: ' + fmtUsd(re) + (re === r.implied_value_usd ? ' ✓ matches board.json' : ' ✗ differs') + ')' }), el('b', { text: fmtUsd(r.implied_value_usd) }))),
el('div', { class: 'equation odds' },
el('div', null, el('span', { text: '× token odds (age-band record)' }), el('b', { text: fmtPct0((D.odds.by_slug && D.odds.by_slug[r.slug]) || D.odds.base_rate) })),
el('div', { class: 'result' }, el('span', { text: '= value × odds — the launch in expectation' }), el('b', { text: fmtUsd(r.implied_value_usd * ((D.odds.by_slug && D.odds.by_slug[r.slug]) || D.odds.base_rate)) })))));
var steps = farmStepsOf(r);
dialog.appendChild(el('section', { class: 'sec' },
el('h3', { text: 'Farm plan — ' + steps.length + ' steps, each costed and timed' }),
el('ol', { class: 'steps' }, steps.map((s) => {
return el('li', null, el('div', null, el('b', { text: s.text }), el('span', { class: 'meta', text: 'Cost: ' + s.cost + ' · Time: ' + s.time })));
}))));
dialog.appendChild(el('section', { class: 'sec' },
el('h3', { text: 'Cost breakdown → one number: NET $/hour' }),
el('div', { class: 'equation' },
el('div', null, el('span', { text: 'Gas (' + r.verdict.one_time_gas + '+' + r.verdict.weekly_gas + '/wk × ' + v.weeks + 'w)' }), el('b', { text: '$' + v.gas.toFixed(2) })),
el('div', null, el('span', { text: 'Swap fee (' + (ASSUME.swap * 100).toFixed(1) + '% of $' + v.capital + ' round trip)' }), el('b', { text: '$' + v.swap.toFixed(2) })),
el('div', null, el('span', { text: 'Capital charge (T-bill ' + (ASSUME.tbill * 100).toFixed(2) + '% × ' + v.weeks + '/52 of $' + v.capital + ')' }), el('b', { text: '$' + v.charge.toFixed(2) })),
el('div', null, el('span', { text: '− cost' }), el('b', { text: '$' + v.cost.toFixed(2) })),
el('div', null, el('span', { text: '+ reward (implied × odds × ' + (ASSUME.airdrop * 100) + '% ÷ farmers = ' + (ASSUME.farmerTvl * 100) + '% of TVL)' }), el('b', { text: '$' + fmtUsd(v.ev).slice(1) })),
el('div', { class: 'result' }, el('span', { text: '= NET $/hr (' + '$' + (v.net >= 0 ? '+' : '') + v.net.toFixed(2) + ' over ' + Math.round(v.weeks * 168) + 'h)' }), el('b', { text: (v.perHour >= 0 ? '+' : '') + '$' + v.perHour.toFixed(2) + '/h' }))),
el('p', { class: 'footnote', text: 'Rule: FARM clears $' + ASSUME.farmHourly + '/h; MARGINAL is positive under it; SKIP loses money. Here: ' + v.verdict + ' — ranks by value, not hype.' })));
var deposits = [50, 250, 1000, 5000], drops = [0, 0.2, 0.4];
var sBody = el('tbody');
deposits.forEach((dep) => {
var cells = drops.map((drop) => {
var save = { deposit: state.deposit, drop: state.drop };
state.deposit = dep; state.drop = drop;
var vv = verdictOf(r);
state.deposit = save.deposit; state.drop = save.drop;
return td((vv.net >= 0 ? '+' : '') + '$' + Math.round(vv.net), 'num ' + (vv.net >= 0 ? 'pos' : 'neg'));
});
sBody.appendChild(el('tr', null, td('$' + dep + ' deposit', 'num'), cells[0], cells[1], cells[2]));
});
dialog.appendChild(el('section', { class: 'sec' },
el('h3', { text: 'Sensitivity — NET $ over the hold, deposit × reward haircut (all costs included)' }),
table([[''], ['Drop 0%', 'num'], ['Drop 20%', 'num'], ['Drop 40%', 'num']], sBody)));
dialog.appendChild(el('section', { class: 'sec' },
el('h3', { text: 'Nearest traded comparables — each fitted WITHOUT itself' }),
table([['Peer', 'num'], ['TVL', 'num'], ['Market cap', 'num'], ['mcap/TVL', 'num'], ['Blind fit', 'num'], ['Miss', 'num']],
el('tbody', null, r.comps.map((c) => {
return el('tr', null, td(c.name), td(fmtUsd(c.tvl_usd), 'num'), td(fmtUsd(c.mcap_usd), 'num'),
td(fmtMult(c.ratio), 'num'), td(fmtMult(c.blind_multiple), 'num'), td(c.miss.toFixed(2) + 'x', 'num ' + (c.miss <= 2 ? 'pos' : 'neg')));
}))),
el('p', { class: 'footnote', text: 'Each peer\u2019s multiple was fitted from the OTHER peers, never itself; Miss = max(fit/actual, actual/fit).' })));
var sc = el('section', { class: 'sec' });
sc.appendChild(el('h3', { text: 'Cap vs TVL — peers, the fitted size curve, and this protocol (marked)' }));
scatter(sc, slug);
dialog.appendChild(sc);
dialog.appendChild(el('p', { class: 'footnote', text: r.listed_at ? 'Tracked since ' + r.listed_at + '. No token = the snapshot records none; odds are the peers\u2019 record; costs are estimates. Not financial advice.' : 'No listing date recorded; costs are estimates. Not financial advice.' }));
document.getElementById('dialog-root').appendChild(dialog);
if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
}
function farmStepsOf(r) {
return r.farm_steps.map((t) => {
var at = t.indexOf(' Cost: '), tm = t.indexOf('. Time: ');
return { text: t.slice(0, at), cost: t.slice(at + 7, tm), time: t.slice(tm + 8, -1) };
});
}
function masthead() {
return el('header', { class: 'top' },
el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'YieldRadar' })),
el('span', { class: 'nonet', text: 'NO network · no fetch · reads only its own data.js' }),
el('span', { class: 'sub', text: 'snapshot ' + D.as_of + ' · ' + D.model_version + ' · ' + D.accounting.total + ' protocols · checksum ' + D.checksum }));
}
function kpiStrip() {
var k = D.kpis, v = D.validation;
function kpi(label, value, sub, cls) {
return el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: label }),
el('b', { class: 'kpi-value ' + (cls || ''), text: value }), el('span', { class: 'kpi-sub', text: sub }));
}
return el('section', { class: 'kpi-strip' },
kpi('Watchlist ranked', k.watchlist_covered + ' / ' + D.watchlist_size, 'floor, never ceiling', 'ok'),
kpi('Pre-token rows', String(k.pre_token_rows), 'no token yet'),
kpi('Token comps set aside', String(k.token_trading_rows), 'anchor the fit'),
kpi('Implied value, total', fmtUsd(k.implied_total_usd), 'board total', 'ok'),
kpi('LOO within 2x', fmtPct0(v.loo.within_half), 'held-out peers ±2x'),
kpi('Brier vs base rate', D.odds.brier_loo.toFixed(3) + ' vs ' + D.odds.brier_base.toFixed(3), 'below baseline', D.odds.brier_loo < D.odds.brier_base ? 'ok' : ''));
}
function render() {
app.textContent = '';
var cats = Array.from(new Set(D.rows.map((r) => r.category || 'Uncategorized'))).sort();
var chains = Array.from(new Set(D.rows.reduce((a, r) => a.concat(r.chains), []))).sort();
var shell = el('div', { class: 'shell' });
shell.appendChild(masthead());
shell.appendChild(kpiStrip());
shell.appendChild(integrityBar());
shell.appendChild(controls(cats, chains));
shell.appendChild(boardTable());
var duo = el('div', { class: 'duo' });
duo.appendChild(evidenceCard());
duo.appendChild(oddsCard());
shell.appendChild(duo);
var duo2 = el('div', { class: 'duo' });
duo2.appendChild(modelCard());
duo2.appendChild(accountingStrip());
shell.appendChild(duo2);
app.appendChild(shell);
if (state.sel) openDetail(state.sel);
}
render();
window.addEventListener('keydown', (e) => {
if (e.key === 'Escape') { var d = document.querySelector('dialog[open]'); if (d) d.close(); }
});
})();
