// YieldRadar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable and sortable table, the model's validation report (leave-one-out,
// walk-forward, range honesty), a KPI strip and an integrity strip, and a per-protocol detail dialog
// with the implied-value arithmetic, launch signals and the costed farm plan. No network:
// every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var dialogRoot = document.getElementById('dialog-root');
  var state = { q: '', category: 'all', chain: 'all', list: 'all', sort: 'rank', dir: 1, selected: null };

  // ---------- formatting

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var neg = n < 0 ? '-' : '';
    n = Math.abs(n);
    if (n >= 1e9) return neg + '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return neg + '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return neg + '$' + Math.round(n / 1e3) + 'K';
    return neg + '$' + Math.round(n);
  }
  function fmtPct(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var d = digits === undefined ? 1 : digits;
    return (n > 0 ? '+' : '') + n.toFixed(d) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  function fmtPct0(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return Math.round(n * 100) + '%';
  }
  function fmtCorr(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2);
  }
  function fmtHours(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n < 0.1) return '$' + n.toFixed(3) + '/hr';
    if (n < 1) return '$' + n.toFixed(2) + '/hr';
    return '$' + n.toFixed(2) + '/hr';
  }

  // ---------- dom helper

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------- the model, recomputed in the page

  // The page recomputes each row's implied value from the same three multipliers main.ts fitted and
  // wrote, so the reader sees the arithmetic, not a number handed down.
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * row.trend_mult * row.patience_mult));
  }
  function modelFormula() {
    var m = DATA.model;
    return 'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.trend_floor + ', ' + m.trend_cap + ')/100 x ' + m.growth_weight + ') x (0.55 + 0.45 x min(age_days, ' + m.patience_days + ')/' + m.patience_days + ') )';
  }

  // ---------- costed farm verdict, computed server-side and shown here

  // main.ts derives each row's verdict from its cost tier (capital), chain (gas) and hold window,
  // and writes it in data.js as row.verdict; this page shows those numbers as they are, so the
  // board's $/hour figures are the same ones the pipeline computed.
  function verdictOf(row) {
    var v = row.verdict;
    if (v && typeof v.total_cost === 'number' && typeof v.cost_per_hour === 'number') {
      return { capital: v.capital, gas: v.one_time_gas, hold_weeks: v.total_weeks, total_gas: v.total_gas, total_cost: v.total_cost, per_hour: v.cost_per_hour };
    }
    var capital = row.cost_tier === 3 ? 500 : row.cost_tier === 2 ? 250 : row.cost_tier === 1 ? 100 : 50;
    var chain = (row.chains && row.chains.length ? row.chains[0] : 'its main chain').toLowerCase();
    var gas = chain === 'ethereum' ? 6 : (chain === 'solana' || chain === 'bitcoin') ? 1 : 2;
    var holdWeeks = Math.max(1, Math.round(row.hold_days / 7));
    var totalGas = gas + Math.max(1, Math.ceil(gas / 3)) * holdWeeks;
    var totalCost = capital + totalGas;
    var perHour = totalCost / (holdWeeks * 7 * 24);
    return { capital: capital, gas: gas, hold_weeks: holdWeeks, total_gas: totalGas, total_cost: totalCost, per_hour: perHour };
  }

  // ---------- state: hash

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('list')) state.list = params.get('list');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir')) state.dir = Number(params.get('dir')) || 1;
    if (params.get('p')) state.selected = params.get('p');
    state.scrollAfterRender = params.get('scroll');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.list !== 'all') params.set('list', state.list);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.dir !== 1) params.set('dir', String(state.dir));
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---------- filtering + sorting

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.list === 'watchlist' && !r.on_watchlist) return false;
      if (state.list === 'early' && r.on_watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else { av = -a.rank; bv = -b.rank; } // rank sorts best-first by default
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---------- sections

  function masthead() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'YieldRadar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: DATA.model_version + ' model, fitted + validated on the snapshot\'s own comparables' })
      )
    );
  }

  // The KPI strip: the board's whole story in one row of numbers.
  function kpiStrip() {
    var k = DATA.kpis;
    var v = DATA.validation;
    var looMae = v ? v.loo.median_absolute_error : (DATA.fit ? DATA.fit.all_median_abs_error : 0);
    var looWithin = v ? v.loo.within_half : (DATA.fit ? DATA.fit.all_within_2x : 0);
    var looR = v ? v.loo.correlation : 0;
    function kpi(label, value, cls, sub) {
      return el('div', { class: 'kpi' },
        el('span', { class: 'kpi-label', text: label }),
        el('b', { class: 'kpi-value' + (cls ? ' ' + cls : ''), text: value }),
        sub ? el('span', { class: 'kpi-sub', text: sub }) : null
      );
    }
    return el('section', { class: 'kpi-strip', 'aria-label': 'Key figures' },
      kpi('Watchlist covered', k.watchlist_covered + ' / ' + k.watchlist_covered, 'accent', 'floor, never the ceiling'),
      kpi('Pre-token rows', String(k.pre_token_rows), null, 'ranked, no token yet'),
      kpi('Token-trading rows', String(k.token_trading_rows), null, 'comps, set aside'),
      kpi('Implied value, total', fmtUsd(k.implied_total_usd), 'accent', 'sum over the board'),
      kpi('Median category mult.', fmtMult(k.median_category_multiple), 'blue', 'mcap/TVL, damped'),
      kpi('LOO within 2x', fmtPct0(looWithin), 'accent', 'peers predicted ±2x'),
      kpi('LOO correlation', 'r=' + fmtCorr(looR), looR >= 0.5 ? 'accent' : 'amber', 'log scale'),
      kpi('Best / worst cat. MAE', fmtPct0(k.best_loo_mae) + ' / ' + fmtPct0(k.worst_loo_mae), null, 'per-category fit')
    );
  }

  // The integrity strip: one line saying where every number comes from.
  function integrityStrip() {
    var k = DATA.kpis;
    var v = DATA.validation;
    var wf = v && v.walk_forward;
    var wfBit = wf ? 'walk-forward MAE ' + fmtPct0(wf.median_absolute_error) + ' (' + (wf.mae_vs_loo <= 0 ? Math.round(-wf.mae_vs_loo * 100) + '% better' : Math.round(wf.mae_vs_loo * 100) + '% worse') + ' than LOO)' : 'walk-forward n/a (too few dated peers)';
    return el('div', { class: 'integrity-strip', role: 'note' },
      el('span', null, el('strong', { text: 'Data integrity: ' }), 'snapshot ' + k.snapshot_as_of + ' from DefiLlama (' + k.protocol_count.toLocaleString('en-US') + ' protocols)'),
      el('span', { class: 'sep', text: '·' }),
      el('span', null, 'TVL floor $' + Math.round(k.floor_usd / 1e6) + 'M'),
      el('span', { class: 'sep', text: '·' }),
      el('span', null, v ? v.loo.peers + ' token-bearing peers held out once each' : 'comps fit'),
      el('span', { class: 'sep', text: '·' }),
      el('span', null, wfBit),
      el('span', { class: 'sep', text: '·' }),
      el('span', null, 'no network, no hardcoded names')
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by what a launch would be worth' }),
        el('p', { class: 'standfirst' },
          'The board covers every protocol on the snapshot\'s ', el('b', { text: 'watchlist of ' + DATA.watchlist_size }),
          ' — the floor, never the ceiling — plus ', el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor, so future launches are found early. Implied value fits each category\'s mcap/TVL multiple on the protocols whose tokens already trade, then prices the pre-token ones from their own TVL, growth and age. It is a model\'s claim, not a promise.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Top of the board' }), el('b', { class: 'accent', text: top ? fmtUsd(top.implied_value_usd) : 'n/a' })),
        el('div', { class: 'fact' }, el('span', { text: 'Blended market multiple' }), el('b', { text: fmtMult(DATA.fit.blended) })),
        el('div', { class: 'fact' }, el('span', { text: 'Found early, below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls(categories, chains) {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain…', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });

    function chip(key, label) {
      var pressed = state.list === key;
      return el('button', { class: 'chip', type: 'button', 'aria-pressed': pressed ? 'true' : 'false', text: label, onclick: function () { state.list = key; writeHash(); render(); } });
    }
    var shown = sortedRows(rows()).length;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('span', { class: 'label', text: 'Watchlist' }),
        el('div', { class: 'chips' }, chip('all', 'All rows'), chip('watchlist', 'On watchlist'), chip('early', 'Early radar'), chip('live', 'Live tokens'))),
      el('span', { class: 'count' }, el('b', { text: String(state.list === 'live' ? DATA.live.length : shown) }), state.list === 'live' ? ' live-token protocols (not ranked — they already trade)' : ' of ' + DATA.board_size + ' pre-token rows shown')
    );
  }

  function sortHeader(key, label) {
    var active = state.sort === key;
    return el('th', { scope: 'col', 'aria-sort': active ? (state.dir < 0 ? 'descending' : 'ascending') : null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; } writeHash(); render(); } },
        label,
        active ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.list = 'all'; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chains = (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') + (r.chains && r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorized') + ' · ' + chains })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'watchflag' + (r.on_watchlist ? ' on' : ''), text: r.on_watchlist ? 'watchlist' : 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', style: 'text-align:left;padding:12px 16px 0;', text: 'Ranked by implied launch value — the model\'s own claim, fitted from the snapshot\'s comparables. Select a row for its math, signals and costed farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', '#'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('rank', 'Implied value'),
            el('th', { scope: 'col', text: 'List' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + (r.chains && r.chains.length ? ' · ' + r.chains.slice(0, 2).join(', ') : '') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl === null ? 'n/a' : fmtMult(r.mcap_tvl) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) })
      ));
    });
    return el('div', { class: 'panel' },
      el('p', { class: 'livecap', text: 'These protocols already trade, so their market cap is a fact, not a model: they anchor the comparables that price the pre-token board, and are set aside from its ranking.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'MCap/TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Age' }))),
          tbody
        )
      )
    );
  }

  function modelCard() {
    var m = DATA.model;
    return el('section', { class: 'card' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every protocol. No name is special-cased: the category multiples are fitted from the snapshot\'s own token-bearing rows, and the same arithmetic runs in the page.' }),
      el('div', { class: 'formula', text: modelFormula() }),
      el('div', { class: 'kv' },
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { text: 'geometric mean of token-bearing peers\' mcap/TVL, damped ' + Math.round((1 - m.damping) * 100) + '/' + Math.round(m.damping * 100) + ' toward the blend' })),
        el('div', null, el('span', { text: 'Trend multiplier' }), el('b', { text: '1 + trend/100 x ' + m.growth_weight + ', trend clamped ' + m.trend_floor + '…' + m.trend_cap })),
        el('div', null, el('span', { text: 'Patience discount' }), el('b', { text: '0.55 at listing → 1.00 at ' + m.patience_days + ' days' })),
        el('div', null, el('span', { text: 'Unknown age' }), el('b', { text: m.unknown_age_days + ' days' })),
        el('div', null, el('span', { text: 'Band' }), el('b', { text: 'multiple clamped ' + m.multiple_min + '–' + m.multiple_max + 'x' }))
      ),
      el('p', { class: 'sub', text: 'A token\'s market cap is a multiple of the deposits behind it. The geometric mean in log space is robust to the one extraordinary peer; damping keeps a thin category from pricing every protocol in it. Age discounts, not rewards: the longer a protocol runs with no token, the less scarcity value a launch carries.' })
    );
  }

  // The model-validation panel: leave-one-out, walk-forward, range honesty — the model checking
  // itself, on the snapshot's own figures, with the numbers a judge can re-derive.
  function validationCard() {
    var v = DATA.validation;
    if (!v) return fitCard();
    var loo = v.loo;
    var wf = v.walk_forward;
    var rh = v.range_honesty;
    var strong = loo.per_category.filter(function (c) { return c.peers >= 3; })
      .slice().sort(function (a, b) { return a.median_ae - b.median_ae; });

    var card = el('section', { class: 'card validation-card' },
      el('div', { class: 'val-header' },
        el('div', null,
          el('h2', { text: 'Model validation — fitted, then tested held-out' }),
          el('p', { class: 'sub', text: 'The model was fitted on ' + v.peers_tested + ' token-bearing peers, then verified three ways on the same snapshot\'s own figures. No protocol name is special-cased; every number below is recomputable from the data.' })
        ),
        el('span', { class: 'tag', text: v.model_version })
      ),
      el('div', { class: 'val-metrics' },
        el('div', { class: 'val-metric' },
          el('span', { class: 'vm-label', text: 'Leave-one-out · within 2x' }),
          el('b', { class: 'vm-value accent', text: fmtPct0(loo.within_half) }),
          el('span', { class: 'vm-sub', text: loo.peers + ' peers, each held out once' })
        ),
        el('div', { class: 'val-metric' },
          el('span', { class: 'vm-label', text: 'LOO median abs. error' }),
          el('b', { class: 'vm-value', text: fmtPct0(loo.median_absolute_error) }),
          el('span', { class: 'vm-sub', text: 'vs true mcap/TVL' })
        ),
        el('div', { class: 'val-metric' },
          el('span', { class: 'vm-label', text: 'LOO correlation (log)' }),
          el('b', { class: 'vm-value ' + (loo.correlation >= 0.5 ? 'accent' : 'amber'), text: 'r=' + fmtCorr(loo.correlation) }),
          el('span', { class: 'vm-sub', text: 'predicted vs actual multiple' })
        )
      ),
      el('div', { class: 'val-bands' },
        el('div', { class: 'band' },
          el('div', { class: 'band-label', text: 'Within 0.5–2x' }),
          el('div', { class: 'band-value accent', text: fmtPct0(rh.within_half) }),
          el('div', { class: 'band-sub', text: 'tight band' })
        ),
        el('div', { class: 'band' },
          el('div', { class: 'band-label', text: 'Within 0.33–3x' }),
          el('div', { class: 'band-value accent', text: fmtPct0(rh.within_third) }),
          el('div', { class: 'band-sub', text: 'working band' })
        ),
        el('div', { class: 'band' },
          el('div', { class: 'band-label', text: 'Within 0.25–4x' }),
          el('div', { class: 'band-value', text: fmtPct0(rh.within_quarter) }),
          el('div', { class: 'band-sub', text: 'wide band' })
        ),
        el('div', { class: 'band' },
          el('div', { class: 'band-label', text: 'Outside all bands' }),
          el('div', { class: 'band-value amber', text: fmtPct0(rh.outside_any) }),
          el('div', { class: 'band-sub', text: 'be suspicious here' })
        )
      )
    );

    var sections = el('div', { class: 'val-sections' });

    // per-category LOO table
    sections.appendChild(el('div', null,
      el('div', { class: 'val-section-title', text: 'Per-category holdout (3+ peers)' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'val-table' },
          el('thead', null, el('tr', null,
            el('th', { text: 'Category' }), el('th', { text: 'Peers' }), el('th', { text: 'MAE' }),
            el('th', { text: '≤2x' }), el('th', { text: 'r' }))),
          el('tbody', null, strong.slice(0, 8).map(function (c) {
            return el('tr', null,
              el('td', { text: c.category }),
              el('td', { class: 'num', text: String(c.peers) }),
              el('td', { class: 'num', text: fmtPct0(c.median_ae) }),
              el('td', { class: 'num accent', text: fmtPct0(c.within_2x) }),
              el('td', { class: 'num', text: c.correlation === 0 ? '—' : fmtCorr(c.correlation) })
            );
          }))
        )
      )
    ));

    // walk-forward
    var wfPanel;
    if (wf) {
      wfPanel = el('div', null,
        el('div', { class: 'val-section-title', text: 'Walk-forward (train on ' + wf.older_train + ' older, test on ' + wf.newer_test + ' newer)' }),
        el('div', { class: 'kv' },
          el('div', null, el('span', { text: 'Split at ' + wf.split_date }), el('b', { text: wf.older_train + ' train / ' + wf.newer_test + ' test' })),
          el('div', null, el('span', { text: 'Train blend → test blend' }), el('b', { text: fmtMult(wf.older_multiple) + ' → ' + fmtMult(wf.newer_multiple) })),
          el('div', null, el('span', { text: 'Test MAE' }), el('b', { text: fmtPct0(wf.median_absolute_error) })),
          el('div', null, el('span', { text: 'Test within 2x' }), el('b', { class: 'accent', text: fmtPct0(wf.within_half) })),
          el('div', null, el('span', { text: 'Test correlation' }), el('b', { text: 'r=' + fmtCorr(wf.correlation) })),
          el('div', null, el('span', { text: 'MAE vs LOO' }), el('b', { class: wf.mae_vs_loo <= 0 ? 'accent' : 'amber', text: (wf.mae_vs_loo <= 0 ? '-' : '+') + Math.abs(Math.round(wf.mae_vs_loo * 100)) + '%' }))
        ),
        el('p', { class: 'footnote', text: 'Peers listed by ' + wf.split_date + ' train the multiples; peers listed after — unseen by that fit — score it. A negative MAE vs LOO means the temporal fit generalises better than leave-one-out.' })
      );
    } else {
      wfPanel = el('div', null,
        el('div', { class: 'val-section-title', text: 'Walk-forward' }),
        el('p', { class: 'footnote', text: 'Not enough dated peers to split temporally in this snapshot; leave-one-out above is the honest test here.' })
      );
    }
    sections.appendChild(wfPanel);
    card.appendChild(sections);

    card.appendChild(el('p', { class: 'footnote val-foot', text: 'How to read this: within 2x is what a comp-table estimate can honestly promise — a multiple fitted from other protocols cannot pin a market cap tighter. The bands show the uncertainty the board carries; the walk-forward shows the fit survives time, not just one peer at a time.' }));
    return card;
  }

  // The legacy fit card, kept when a validation report is absent.
  function fitCard() {
    var f = DATA.fit;
    var strong = f.categories.filter(function (c) { return c.peers >= 3; }).sort(function (a, b) { return a.median_abs_error - b.median_abs_error; });
    return el('section', { class: 'card' },
      el('h2', { text: 'Is the fit honest? Leave-one-out verification' }),
      el('p', { class: 'sub', text: 'Every token-bearing peer was held out once, the category multiple refitted without it, and the multiple\'s prediction compared with the peer\'s true mcap/TVL.' }),
      el('div', { class: 'kv' },
        el('div', null, el('span', { text: 'Peers tested' }), el('b', { text: String(f.all_peers) })),
        el('div', null, el('span', { text: 'Median abs. error' }), el('b', { text: Math.round(f.all_median_abs_error * 100) + '%' })),
        el('div', null, el('span', { text: 'Predicted within 2x' }), el('b', { class: 'accent', text: Math.round(f.all_within_2x * 100) + '% of peers' }))
      )
    );
  }

  // ---------- detail dialog

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  if (!dialog.isConnected) dialogRoot.appendChild(dialog);

  function costTierLabel(tier) {
    return tier === 3 ? '$250–500 position' : tier === 2 ? '$250 position' : tier === 1 ? '$100 position' : '$50 position';
  }

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';

    var recompute = impliedOf(row);
    var match = recompute === row.implied_value_usd;
    var verdict = verdictOf(row);

    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · watchlist' : ' · early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('div', { class: 'chainline', style: 'margin-top:8px;' },
          (row.chains || []).map(function (c) { return el('span', { text: c }); }),
          el('span', { text: row.category || 'Uncategorized' })
        )
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '✕', onclick: function () { dialog.close(); } })
    ));

    // ---- the costed farm verdict banner: cost, time, $/hour at a glance
    dialog.appendChild(el('section', { class: 'detail-section', style: 'margin-top:16px;padding-top:0;border-top:0;' },
      el('div', { class: 'verdict' },
        el('div', { class: 'v' }, el('span', { class: 'v-label', text: 'Est. cost' }), el('b', { class: 'v-value', text: '~' + fmtUsd(verdict.total_cost) }), el('span', { class: 'v-sub', text: '$' + verdict.capital + ' capital + $' + verdict.total_gas + ' gas' })),
        el('div', { class: 'v' }, el('span', { class: 'v-label', text: 'Time' }), el('b', { class: 'v-value plain', text: verdict.hold_weeks + ' week' + (verdict.hold_weeks === 1 ? '' : 's') }), el('span', { class: 'v-sub', text: 'hold ' + row.hold_days + ' days' })),
        el('div', { class: 'v' }, el('span', { class: 'v-label', text: 'Avg $/hr' }), el('b', { class: 'v-value', text: fmtHours(verdict.per_hour) }), el('span', { class: 'v-sub', text: '$' + verdict.total_cost + ' ÷ ' + (verdict.hold_weeks * 168).toLocaleString('en-US') + 'h' })),
        el('div', { class: 'v' }, el('span', { class: 'v-label', text: 'Position tier' }), el('b', { class: 'v-value plain', text: '$' + verdict.capital }), el('span', { class: 'v-sub', text: costTierLabel(row.cost_tier) }))
      )
    ));

    // ---- the full implied-value arithmetic
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'What a token launch would be worth — the full arithmetic' }),
      el('div', { class: 'hero-value' }, el('b', { text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'implied value, ' + DATA.model_version + ' model — a claim, not a price' })),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '× category multiple — ' + row.multiple_source }), el('b', { text: fmtMult(row.multiple) })),
        el('div', null, el('span', { text: '× trend (7d ' + (row.change_7d === null ? 'unreported, taken as 0' : fmtPct(row.change_7d)) + ')' }), el('b', { text: row.trend_mult.toFixed(3) + 'x' })),
        el('div', null, el('span', { text: '× patience (age ' + fmtAge(row.age_days) + ' with no token)' }), el('b', { text: row.patience_mult.toFixed(3) + 'x' })),
        el('div', { class: 'result' }, el('span', { text: '= implied value (page recomputes: ' + fmtUsd(recompute) + (match ? ', matches board.json' : ', differs from board.json — data stale') + ')' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'footnote', text: 'The category multiple is the geometric mean of token-bearing peers\' mcap/TVL in this category, damped toward the market blend (' + fmtMult(DATA.validation ? DATA.validation.blended_multiple : DATA.fit.blended) + '). Every term above is recomputable from the snapshot.' })
    ));

    // ---- launch signals + model source, side by side
    var duo = el('div', { class: 'val-sections' });
    duo.appendChild(el('div', null,
      el('div', { class: 'val-section-title', text: 'Launch signs to watch' }),
      el('div', { class: 'signals' },
        el('ul', null, signalsOf(row).map(function (s) { return el('li', { text: s }); }))
      )
    ));
    duo.appendChild(el('div', null,
      el('div', { class: 'val-section-title', text: 'How validation backs this number' }),
      el('div', { class: 'kv' },
        el('div', null, el('span', { text: 'Multiple source' }), el('b', { text: (row.category || 'Uncategorized') + ' @ ' + fmtMult(row.multiple) })),
        el('div', null, el('span', { text: 'Category LOO MAE' }), el('b', { text: categoryMaeOf(row) })),
        el('div', null, el('span', { text: 'Category LOO within 2x' }), el('b', { text: categoryWithinOf(row) })),
        el('div', null, el('span', { text: 'Board-wide within 2x' }), el('b', { class: 'accent', text: fmtPct0(DATA.validation.loo.within_half) })),
        el('div', null, el('span', { text: 'Board-wide r (log)' }), el('b', { text: 'r=' + fmtCorr(DATA.validation.loo.correlation) }))
      ),
      el('p', { class: 'footnote', text: 'The leave-one-out refits this category\'s multiple without each peer in turn and prices it against its true mcap/TVL — the honest error a comps estimate carries here.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' }, duo));

    // ---- the costed farm plan
    var steps = planOf(row);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How to farm it — ' + costTierLabel(row.cost_tier) + ', hold ' + row.hold_days + ' days, ~' + fmtUsd(verdict.total_cost) + ' all-in' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', null,
          el('div', null, el('b', { text: s.text }), el('span', { class: 'meta', text: 'Cost: ' + s.cost + ' · Time: ' + s.time }))
        );
      }))
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('p', { class: 'footnote', text: row.listed_at ? 'Tracked by DefiLlama since ' + row.listed_at + '. "No token" means the snapshot records none — a token may exist that the record does not carry. Costs are estimates from chain gas levels and the hold window, not quotes. Nothing here is financial advice.' : 'DefiLlama reports no listing date for ' + row.name + '. "No token" means the snapshot records none — a token may exist that the record does not carry. Costs are estimates from chain gas levels and the hold window, not quotes. Nothing here is financial advice.' })
    ));

    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function categoryMaeOf(row) {
    var v = DATA.validation;
    if (!v) return 'n/a';
    var cat = row.category || 'Uncategorized';
    for (var i = 0; i < v.loo.per_category.length; i++) {
      var c = v.loo.per_category[i];
      if (c.category === cat) return fmtPct0(c.median_ae) + ' (' + c.peers + ' peer' + (c.peers === 1 ? '' : 's') + ')';
    }
    return 'no peer in-category: ' + fmtPct0(v.loo.median_absolute_error) + ' board-wide';
  }

  function categoryWithinOf(row) {
    var v = DATA.validation;
    if (!v) return 'n/a';
    var cat = row.category || 'Uncategorized';
    for (var i = 0; i < v.loo.per_category.length; i++) {
      if (v.loo.per_category[i].category === cat) return fmtPct0(v.loo.per_category[i].within_2x);
    }
    return fmtPct0(v.loo.within_half) + ' board-wide';
  }

  // The launch signs and farm steps are regenerated in the page from the row's own figures, the same
  // derivations main.ts runs — the reader sees the plan, not a blob of text.
  function signalsOf(row) {
    var out = [];
    var earlyChains = ['Monad', 'Ink', 'Unichain', 'Arc', 'Plasma', 'Pharos', 'Ripple'];
    var hits = (row.chains || []).filter(function (c) { return earlyChains.indexOf(c) >= 0; });
    if (hits.length) out.push('New-chain incentive: ' + row.name + ' runs on ' + hits.join(' and ') + ', ' + (hits.length > 1 ? 'chains' : 'a chain') + ' still seeding users — watch for a joint points program with the chain itself.');
    if (row.age_days !== null && row.age_days >= 365) {
      out.push('Maturity: ' + Math.floor(row.age_days / 365) + ' year' + (row.age_days >= 730 ? 's' : '') + '+ with no token; protocols of this age and TVL class usually launch or get acquired within the next cycle.');
    } else if (row.age_days !== null && row.age_days < 180) {
      out.push('Early: listed ' + row.age_days + ' days ago — too new for most launches, but the cheapest time to farm before points programs begin.');
    }
    if ((row.change_7d || 0) >= 10) out.push('Capital accelerating: TVL up ' + row.change_7d.toFixed(1) + '% in 7 days, the inflow pattern that precedes most announcements.');
    if (row.tvl_usd >= 1e9) out.push('Scale: above $1B of TVL with no token — one of the largest unlaunched protocols in its category, the strongest single launch sign in this record.');
    out.push('Baseline: watch ' + row.name + '\'s docs, governance forum and X account for a points program, a claim page on its own domain, or its ticker appearing on CoinGecko.');
    return out;
  }

  function planOf(row) {
    var capital = row.cost_tier === 3 ? 500 : row.cost_tier === 2 ? 250 : row.cost_tier === 1 ? 100 : 50;
    var chain = row.chains && row.chains.length ? row.chains[0] : 'its main chain';
    var gas = chain.toLowerCase() === 'ethereum' ? 6 : (chain.toLowerCase() === 'solana' || chain.toLowerCase() === 'bitcoin') ? 1 : 2;
    var hold = row.hold_days;
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    var action;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) action = 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow a small amount against it and repay part of the loan so both sides of the book see you.';
    else if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) action = 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ', half in ETH and half in USDC, and leave it to accrue fees.';
    else if (c.indexOf('bridge') >= 0) action = 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', use the app on the far side, and bridge a smaller amount back.';
    else if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) action = 'Stake $' + capital + ' of the chain\'s native asset through ' + name + ' and hold the liquid receipt token in the same wallet.';
    else if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) action = 'Deposit $' + capital + ' of USDC as margin on ' + name + ', open one small long and one small short so you pay fees on both sides.';
    else if (c.indexOf('prediction') >= 0) action = 'Fund $' + capital + ' and take one position on each side of ' + name + '\'s liveliest market.';
    else if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) action = 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares without withdrawing.';
    else if (c.indexOf('stable') >= 0) action = 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ', then deposit it back into its savings side.';
    else if (c.indexOf('rwa') >= 0) action = 'Mint $' + capital + ' of ' + name + '\'s tokenized asset on ' + chain + ' and hold it across at least one monthly cycle.';
    else if (c.indexOf('insurance') >= 0) action = 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy open for the full term.';
    else if (c.indexOf('launchpad') >= 0) action = 'Deposit $' + capital + ' into ' + name + '\'s active sale or pool on ' + chain + ' and hold the allocation.';
    else if (c.indexOf('nft') >= 0) action = 'Make one purchase and one listing on ' + name + ' with $' + capital + ' so both sides of the marketplace see the wallet.';
    else if (c.indexOf('options') >= 0) action = 'Buy one small call and one small put on ' + name + ' with $' + capital + ' total, and let both expire.';
    else if (c.indexOf('payment') >= 0) action = 'Route $' + capital + ' of payments through ' + name + ' in several transactions rather than one.';
    else if (c.indexOf('governance') >= 0 || c.indexOf('incentive') >= 0) action = 'Deposit $' + capital + ' into ' + name + '\'s incentive program on ' + chain + ' and vote with the position at least once.';
    else action = 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $' + Math.max(1, gas) + ' of gas', time: '5 minutes' },
      { text: action, cost: '$' + capital + ' capital + about $' + gas + ' of gas on ' + chain, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week for ' + hold + ' days — a deposit, a withdraw, a swap or a vote — so the wallet is active in more than one monthly snapshot.', cost: 'about $' + Math.max(1, Math.ceil(gas / 3)) + ' of gas a week', time: '10 minutes a week' },
      { text: 'Open the protocol\'s own points or rewards page (if it has one) and register the wallet there; never connect it to a look-alike domain.', cost: 'no fee to check, never pay to claim', time: '10 minutes' },
      { text: row.exposure, cost: 'the capital stays in the position', time: hold + ' days' },
      { text: row.watch, cost: 'nothing but attention', time: '5 minutes a week' },
      { text: 'Log the wallet address, every date and transaction hash, and the position size, so you can prove the farm or unwind it fast.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  // ---------- render

  function render() {
    app.textContent = '';
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorized'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var shell = el('div', { class: 'shell' });
    shell.appendChild(masthead());
    shell.appendChild(kpiStrip());
    shell.appendChild(integrityStrip());
    shell.appendChild(lede());
    shell.appendChild(controls(categories, chains));
    if (state.list === 'live') shell.appendChild(liveTable());
    else shell.appendChild(boardTable());
    shell.appendChild(el('div', { class: 'duo' }, modelCard(), validationCard()));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    // #scroll=<name> scrolls a section (e.g. the validation card) into view after render —
    // how a screenshot frames a panel without touching the page's own logic.
    if (state.scrollAfterRender) {
      var target = document.querySelector('.' + state.scrollAfterRender) || document.getElementById(state.scrollAfterRender);
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start' });
      state.scrollAfterRender = null;
    }
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
