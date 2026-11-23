// YieldRadar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable and sortable table, the model's fit report, and a per-protocol
// detail dialog with the implied-value arithmetic, launch signals and the farm plan. No network:
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
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
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
  function impliedFromParts(tvlUsd, multiple, trendMult, patienceMult) {
    return Math.max(1, Math.round(tvlUsd * multiple * trendMult * patienceMult));
  }
  function modelFormula() {
    var m = DATA.model;
    return 'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.trend_floor + ', ' + m.trend_cap + ')/100 x ' + m.growth_weight + ') x (0.55 + 0.45 x min(age_days, ' + m.patience_days + ')/' + m.patience_days + ') )';
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
        el('span', { text: DATA.model_version + ' model, fitted on the snapshot\'s own comparables' })
      )
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
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { class: 'accent', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Found early, below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Blended market multiple' }), el('b', { text: fmtMult(DATA.fit.blended) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top of the board' }), el('b', { class: 'accent', text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }))
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
          el('caption', { class: 'sub', style: 'text-align:left;padding:12px 16px 0;', text: 'Ranked by implied launch value — the model\'s own claim, fitted from the snapshot\'s comparables. Select a row for its math, signals and farm plan.' }),
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

  function fitCard() {
    var f = DATA.fit;
    var strong = f.categories.filter(function (c) { return c.peers >= 3; }).sort(function (a, b) { return a.median_abs_error - b.median_abs_error; });
    return el('section', { class: 'card' },
      el('h2', { text: 'Is the fit honest? Leave-one-out verification' }),
      el('p', { class: 'sub', text: 'Every token-bearing peer was held out once, the category multiple refitted without it, and the multiple\'s prediction compared with the peer\'s true mcap/TVL. This is the model checking itself on the snapshot\'s own figures.' }),
      el('div', { class: 'kv' },
        el('div', null, el('span', { text: 'Peers tested' }), el('b', { text: String(f.all_peers) })),
        el('div', null, el('span', { text: 'Median abs. error' }), el('b', { text: Math.round(f.all_median_abs_error * 100) + '%' })),
        el('div', null, el('span', { text: 'Predicted within 2x' }), el('b', { class: 'accent', text: Math.round(f.all_within_2x * 100) + '% of peers' }))
      ),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'fit' },
          el('thead', null, el('tr', null, el('th', { text: 'Category (3+ peers)' }), el('th', { text: 'Mult.' }), el('th', { text: 'MAE' }), el('th', { text: '≤2x' }))),
          el('tbody', null, strong.slice(0, 8).map(function (c) {
            return el('tr', null,
              el('td', { text: c.category }),
              el('td', { class: 'num', text: fmtMult(c.multiple) }),
              el('td', { class: 'num', text: Math.round(c.median_abs_error * 100) + '%' }),
              el('td', { class: 'num', text: Math.round(c.within_2x * 100) + '%' })
            );
          }))
        )
      ),
      el('p', { class: 'footnote', text: 'A comp-table estimate cannot predict a market cap exactly; within 2x is what it can honestly promise. Thin categories lean on the blended multiple and are labelled as such.' })
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

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'What a token launch would be worth' }),
      el('div', { class: 'hero-value' }, el('b', { text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'implied value, ' + DATA.model_version + ' model — a claim, not a price' })),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '× category multiple — ' + row.multiple_source }), el('b', { text: fmtMult(row.multiple) })),
        el('div', null, el('span', { text: '× trend (7d ' + (row.change_7d === null ? 'unreported, taken as 0' : fmtPct(row.change_7d)) + ')' }), el('b', { text: row.trend_mult.toFixed(3) + 'x' })),
        el('div', null, el('span', { text: '× patience (age ' + fmtAge(row.age_days) + ' with no token)' }), el('b', { text: row.patience_mult.toFixed(3) + 'x' })),
        el('div', { class: 'result' }, el('span', { text: '= implied value (page recomputes: ' + fmtUsd(recompute) + (match ? ', matches board.json' : ', differs from board.json — data stale') + ')' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      )
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Launch signs to watch' }),
      el('div', { class: 'signals' },
        el('ul', null, DATA.rows.length ? signalsOf(row).map(function (s) { return el('li', { text: s }); }) : [])
      )
    ));

    var steps = planOf(row);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How to farm it — ' + costTierLabel(row.cost_tier) + ', hold ' + row.hold_days + ' days' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', null,
          el('div', null, el('b', { text: s.text }), el('span', { class: 'meta', text: 'Cost: ' + s.cost + ' · Time: ' + s.time }))
        );
      }))
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('p', { class: 'footnote', text: row.listed_at ? 'Tracked by DefiLlama since ' + row.listed_at + '. "No token" means the snapshot records none — a token may exist that the record does not carry. Nothing here is financial advice.' : 'DefiLlama reports no listing date for ' + row.name + '. "No token" means the snapshot records none — a token may exist that the record does not carry. Nothing here is financial advice.' })
    ));

    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
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
      { text: action, cost: '$' + capital + ' + about $' + gas + ' of gas on ' + chain, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week for ' + hold + ' days — a deposit, a withdraw, a swap or a vote — so the wallet is active in more than one monthly snapshot.', cost: 'about $' + Math.max(1, Math.round(gas / 3)) + ' of gas a week', time: '10 minutes a week' },
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
    shell.appendChild(lede());
    shell.appendChild(controls(categories, chains));
    if (state.list === 'live') shell.appendChild(liveTable());
    else shell.appendChild(boardTable());
    shell.appendChild(el('div', { class: 'duo' }, modelCard(), fitCard()));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
