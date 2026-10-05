/* ==========================================================
   CoinPulse - frontend logic
   Talks only to our own Node server (/api/...), which in turn
   talks to CoinGecko with the secret API key.
   ========================================================== */
(() => {
  'use strict';

  const REFRESH_SECONDS = 60;
  const STABLES = new Set(['usdt', 'usdc', 'dai', 'usde', 'fdusd', 'tusd', 'usds', 'pyusd', 'usdd', 'usd1', 'busd', 'susds', 'bsc-usd', 'usdtb', 'usdy', 'usdf', 'gusd', 'usdg', 'rlusd']);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const safeJSON = (raw, fallback) => { try { return JSON.parse(raw) ?? fallback; } catch { return fallback; } };
  const store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  const state = {
    vs: store.get('cp.vs', 'usd'),
    coins: [],
    global: null,
    trending: [],
    fng: null,
    sort: { key: 'rank', dir: 'asc' },
    tab: 'all',
    q: '',
    page: 1,
    perPage: 20,
    favs: new Set(safeJSON(store.get('cp.favs', '[]'), [])),
    countdown: REFRESH_SECONDS,
    loading: false,
    modalCoin: null,
    range: 7,
    chart: null,
    chartToken: 0,
  };

  /* ---------------- formatting ---------------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtPrice(n, cur = state.vs) {
    if (n == null || isNaN(n)) return '-';
    const a = Math.abs(n);
    const max = a >= 1 ? 2 : a >= 0.01 ? 4 : a >= 0.0001 ? 6 : 8;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: max }).format(n);
  }
  function fmtCompact(n, cur = state.vs) {
    if (n == null || isNaN(n)) return '-';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), notation: 'compact', maximumFractionDigits: 2 }).format(n);
  }
  const fmtNum = (n) => (n == null ? '-' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n));
  const fmtPct = (n) => (n == null || isNaN(n) ? '-' : `${Math.abs(n).toFixed(2)}%`);
  const dir = (n) => (n == null || isNaN(n) || Math.abs(n) < 0.005 ? '' : n > 0 ? 'up' : 'down');
  const pill = (n) => `<span class="pill ${dir(n)}">${fmtPct(n)}</span>`;

  function setPill(el, n) {
    el.className = `pill ${dir(n)}`;
    el.textContent = n == null ? '-' : `${fmtPct(n)}`;
  }

  /* ---------------- API ---------------- */
  async function api(url) {
    const res = await fetch(url);
    if (!res.ok) {
      let msg = 'Could not load data';
      try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }

  /* ---------------- field helpers ---------------- */
  const ch1 = (c) => c.price_change_percentage_1h_in_currency;
  const ch24 = (c) => c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h;
  const ch7 = (c) => c.price_change_percentage_7d_in_currency;

  const SORTERS = {
    rank: (c) => c.market_cap_rank ?? 1e9,
    name: (c) => c.name.toLowerCase(),
    price: (c) => c.current_price ?? -1,
    h1: (c) => ch1(c) ?? -1e9,
    h24: (c) => ch24(c) ?? -1e9,
    d7: (c) => ch7(c) ?? -1e9,
    volume: (c) => c.total_volume ?? -1,
    mcap: (c) => c.market_cap ?? -1,
  };

  /* ---------------- sparkline ---------------- */
  function sparkline(prices, up, w = 110, h = 34) {
    if (!prices || prices.length < 2) return '';
    const step = Math.max(1, Math.floor(prices.length / 40));
    const pts = prices.filter((_, i) => i % step === 0);
    const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * w).toFixed(1)} ${(h - 3 - ((p - min) / span) * (h - 6)).toFixed(1)}`).join('');
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${up ? 'var(--up)' : 'var(--down)'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  /* ---------------- render: header stats ---------------- */
  function renderStats() {
    const g = state.global?.data;
    if (!g) return;
    const cur = g.total_market_cap?.[state.vs] != null ? state.vs : 'usd';
    const cap = g.total_market_cap[cur];
    const chg = g.market_cap_change_percentage_24h_usd;

    $('#heroCap').textContent = fmtCompact(cap, cur);
    setPill($('#heroChg'), chg);
    $('#statCap').textContent = fmtCompact(cap, cur);
    const sub = $('#statCapChg');
    sub.className = `stat-sub ${dir(chg) === 'up' ? 'txt-up' : dir(chg) === 'down' ? 'txt-down' : 'text-muted'}`;
    sub.textContent = chg == null ? '-' : `${chg >= 0 ? '+' : '-'}${fmtPct(chg)} in 24h`;
    $('#statVol').textContent = fmtCompact(g.total_volume?.[cur], cur);
    $('#statCoins').textContent = (g.active_cryptocurrencies ?? 0).toLocaleString('en-US');

    const btc = g.market_cap_percentage?.btc ?? 0;
    const eth = g.market_cap_percentage?.eth ?? 0;
    $('#statBtc').textContent = `${btc.toFixed(1)}%`;
    $('#domBtc').style.width = `${btc}%`;
    $('#domEth').style.width = `${eth}%`;
    $('#domOther').style.width = `${Math.max(0, 100 - btc - eth)}%`;
  }

  function renderFng() {
    const d = state.fng?.data?.[0];
    if (!d) return;
    const v = Number(d.value);
    $('#fngValue').textContent = v;
    $('#fngLabel').textContent = d.value_classification;
    $('#fngMark').style.left = `${Math.min(100, Math.max(0, v))}%`;
  }

  /* ---------------- render: ticker ---------------- */
  function renderTicker() {
    if (!state.coins.length) return;
    const items = state.coins.slice(0, 16).map((c) => {
      const v = ch24(c);
      return `<span class="tick"><b>${esc(c.symbol.toUpperCase())}</b><span class="tabular">${fmtPrice(c.current_price)}</span><span class="tabular ${dir(v) === 'up' ? 'txt-up' : dir(v) === 'down' ? 'txt-down' : 'muted'}">${v == null ? '' : (v >= 0 ? '+' : '-') + fmtPct(v)}</span></span>`;
    }).join('');
    $('#tickerTrack').innerHTML = items + items; // duplicated for a seamless loop
  }

  /* ---------------- render: heatmap (squarified treemap) ---------------- */
  function squarify(items, x, y, w, h) {
    const total = items.reduce((s, i) => s + i.v, 0);
    const scale = (w * h) / total;
    const nodes = items.map((i) => ({ ...i, a: i.v * scale }));
    const out = [];
    let rect = { x, y, w, h };
    let row = [];

    const worst = (r, side) => {
      const s = r.reduce((a, n) => a + n.a, 0);
      const mx = Math.max(...r.map((n) => n.a));
      const mn = Math.min(...r.map((n) => n.a));
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    const place = (r) => {
      const s = r.reduce((a, n) => a + n.a, 0);
      if (rect.w >= rect.h) {
        const rw = s / rect.h; let cy = rect.y;
        r.forEach((n) => { const nh = n.a / rw; out.push({ ...n, x: rect.x, y: cy, w: rw, h: nh }); cy += nh; });
        rect = { x: rect.x + rw, y: rect.y, w: rect.w - rw, h: rect.h };
      } else {
        const rh = s / rect.w; let cx = rect.x;
        r.forEach((n) => { const nw = n.a / rh; out.push({ ...n, x: cx, y: rect.y, w: nw, h: rh }); cx += nw; });
        rect = { x: rect.x, y: rect.y + rh, w: rect.w, h: rect.h - rh };
      }
    };

    nodes.forEach((n) => {
      const side = Math.min(rect.w, rect.h);
      if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
      else { place(row); row = [n]; }
    });
    if (row.length) place(row);
    return out;
  }

  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  function tileColor(change) {
    const neutral = [74, 86, 111], good = [11, 154, 104], bad = [214, 47, 69];
    const t = Math.min(Math.abs(change ?? 0) / 6, 1);
    const [r, g, b] = mix(neutral, (change ?? 0) >= 0 ? good : bad, t);
    return `rgb(${r},${g},${b})`;
  }

  function renderHeatmap() {
    const box = $('#heatmap-box');
    const coins = state.coins.filter((c) => !STABLES.has(c.symbol.toLowerCase()) && c.market_cap > 0).slice(0, 30);
    if (!coins.length) { box.innerHTML = '<div class="skel" style="position:absolute;inset:0;border-radius:0"></div>'; return; }

    const W = box.clientWidth, H = box.clientHeight;
    const tiles = squarify(coins.map((c) => ({ c, v: c.market_cap })), 0, 0, W, H);
    box.innerHTML = tiles.map(({ c, x, y, w, h }) => {
      const change = ch24(c);
      const m = Math.min(w, h);
      const fs = Math.max(10, Math.min(28, Math.sqrt(w * h) / 6));
      const showChg = m > 38 && w > 52;
      const showPrice = m > 82 && w > 96;
      return `<button class="tile" data-id="${esc(c.id)}" style="left:${(x / W) * 100}%;top:${(y / H) * 100}%;width:${(w / W) * 100}%;height:${(h / H) * 100}%;background:${tileColor(change)}" aria-label="${esc(c.name)}, ${fmtPct(change)} in 24 hours">
        <span class="t-sym" style="font-size:${fs}px">${esc(c.symbol.toUpperCase())}</span>
        ${showChg ? `<span class="t-chg" style="font-size:${Math.max(10, fs * 0.55)}px">${change == null ? '' : (change >= 0 ? '+' : '-') + fmtPct(change)}</span>` : ''}
        ${showPrice ? `<span class="t-price" style="font-size:${Math.max(10, fs * 0.5)}px">${fmtPrice(c.current_price)}</span>` : ''}
      </button>`;
    }).join('');
  }

  /* ---------------- render: movers ---------------- */
  function moverRow(c, right) {
    return `<li><button class="mover" data-id="${esc(c.id)}">
      <img class="coin-img" src="${esc(c.image)}" alt="" loading="lazy" width="28" height="28" />
      <div class="min-w-0"><div class="m-name">${esc(c.name)}</div><div class="m-sub">${esc(c.symbol.toUpperCase())}</div></div>
      <div class="m-right">${right}</div>
    </button></li>`;
  }

  function renderMovers() {
    if (!state.coins.length) return;
    const ranked = state.coins.filter((c) => ch24(c) != null && !STABLES.has(c.symbol.toLowerCase()));
    const gainers = [...ranked].sort((a, b) => ch24(b) - ch24(a)).slice(0, 5);
    const losers = [...ranked].sort((a, b) => ch24(a) - ch24(b)).slice(0, 5);
    const right = (c) => `<div class="tabular text-sm font-semibold">${fmtPrice(c.current_price)}</div>${pill(ch24(c))}`;
    $('#listGainers').innerHTML = gainers.map((c) => moverRow(c, right(c))).join('');
    $('#listLosers').innerHTML = losers.map((c) => moverRow(c, right(c))).join('');

    const t = state.trending.slice(0, 5).map(({ item }) => {
      const known = state.coins.find((c) => c.id === item.id);
      const pct = item.data?.price_change_percentage_24h?.usd ?? (known ? ch24(known) : null);
      const rank = item.market_cap_rank ? `Rank ${item.market_cap_rank}` : 'Unranked';
      const body = `<img class="coin-img" src="${esc(item.small || item.thumb)}" alt="" loading="lazy" width="28" height="28" />
        <div class="min-w-0"><div class="m-name">${esc(item.name)}</div><div class="m-sub">${esc(item.symbol)} &middot; ${rank}</div></div>
        <div class="m-right">${pill(pct)}</div>`;
      return known
        ? `<li><button class="mover" data-id="${esc(item.id)}">${body}</button></li>`
        : `<li><div class="mover" style="cursor:default">${body}</div></li>`;
    }).join('');
    $('#listTrending').innerHTML = t || '<li class="empty">Trending list is not available right now.</li>';
  }

  /* ---------------- render: table ---------------- */
  function visibleCoins() {
    let list = state.coins.slice();
    if (state.q) {
      const q = state.q.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
    }
    if (state.tab === 'gainers') list = list.filter((c) => (ch24(c) ?? 0) > 0);
    if (state.tab === 'losers') list = list.filter((c) => (ch24(c) ?? 0) < 0);
    if (state.tab === 'watch') list = list.filter((c) => state.favs.has(c.id));

    let { key, dir: d } = state.sort;
    // Gainers / losers tabs default to sorting by the 24h move
    if (state.tab === 'gainers' && key === 'rank') { key = 'h24'; d = 'desc'; }
    if (state.tab === 'losers' && key === 'rank') { key = 'h24'; d = 'asc'; }

    const fn = SORTERS[key];
    list.sort((a, b) => {
      const va = fn(a), vb = fn(b);
      const r = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return d === 'asc' ? r : -r;
    });
    return list;
  }

  function starSvg() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';
  }

  function renderTable() {
    const body = $('#marketBody');
    if (!state.coins.length) {
      body.innerHTML = Array.from({ length: 10 }, () => `<tr><td colspan="10"><div class="skel" style="height:28px"></div></td></tr>`).join('');
      return;
    }

    const list = visibleCoins();
    const pages = Math.max(1, Math.ceil(list.length / state.perPage));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.perPage;
    const rows = list.slice(start, start + state.perPage);

    if (!rows.length) {
      const msg = state.tab === 'watch'
        ? ['Your watchlist is empty', 'Tap the star next to a coin to follow it here.']
        : ['No coins match', 'Try a different name or clear the search.'];
      body.innerHTML = `<tr><td colspan="10"><div class="empty"><strong>${msg[0]}</strong>${msg[1]}</div></td></tr>`;
    } else {
      body.innerHTML = rows.map((c) => {
        const fav = state.favs.has(c.id);
        const up7 = (ch7(c) ?? 0) >= 0;
        return `<tr data-id="${esc(c.id)}" tabindex="0">
          <td><button class="star ${fav ? 'on' : ''}" data-star="${esc(c.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove' : 'Add'} ${esc(c.name)} ${fav ? 'from' : 'to'} watchlist">${starSvg()}</button></td>
          <td class="tabular text-muted">${c.market_cap_rank ?? '-'}</td>
          <td><div class="coin-cell"><img class="coin-img" src="${esc(c.image)}" alt="" loading="lazy" width="28" height="28" /><div><div class="coin-name">${esc(c.name)}</div><div class="coin-sym">${esc(c.symbol.toUpperCase())}</div></div></div></td>
          <td class="text-right tabular font-semibold">${fmtPrice(c.current_price)}</td>
          <td class="text-right hidden sm:table-cell">${pill(ch1(c))}</td>
          <td class="text-right">${pill(ch24(c))}</td>
          <td class="text-right hidden md:table-cell">${pill(ch7(c))}</td>
          <td class="text-right tabular hidden lg:table-cell">${fmtCompact(c.total_volume)}</td>
          <td class="text-right tabular hidden md:table-cell">${fmtCompact(c.market_cap)}</td>
          <td class="hidden lg:table-cell pr-5">${sparkline(c.sparkline_in_7d?.price, up7)}</td>
        </tr>`;
      }).join('');
    }

    const from = list.length ? start + 1 : 0;
    $('#rangeText').textContent = `${from}-${Math.min(start + state.perPage, list.length)} of ${list.length} coins`;
    $('#pageText').textContent = `${state.page} / ${pages}`;
    $('#prevPage').disabled = state.page <= 1;
    $('#nextPage').disabled = state.page >= pages;
    $('#watchCount').textContent = state.favs.size;

    $$('#marketTable th.sortable').forEach((th) => {
      if (th.dataset.sort === state.sort.key) th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
  }

  function renderAll() {
    renderStats();
    renderFng();
    renderTicker();
    renderHeatmap();
    renderMovers();
    renderTable();
    const btc = state.coins.find((c) => c.id === 'bitcoin');
    document.title = btc ? `BTC ${fmtPrice(btc.current_price)} - CoinPulse` : 'CoinPulse - Live crypto market tracker';
  }

  /* ---------------- data loading ---------------- */
  function setStatus(kind, text) {
    const dot = $('#liveDot');
    dot.className = `live-dot ${kind}`;
    $('#liveText').textContent = text;
  }
  function showError(msg) {
    $('#errorText').textContent = msg;
    $('#errorBanner').classList.remove('hidden');
  }

  async function loadAll() {
    if (state.loading) return;
    state.loading = true;
    $('#refreshBtn').classList.add('spinning');

    const [markets, global, trending, fng] = await Promise.allSettled([
      api(`/api/markets?vs=${state.vs}`),
      api('/api/global'),
      api('/api/trending'),
      api('/api/fng'),
    ]);

    if (markets.status === 'fulfilled') {
      state.coins = markets.value;
      $('#errorBanner').classList.add('hidden');
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setStatus('on', `Live - updated ${t}`);
    } else {
      setStatus('err', state.coins.length ? 'Showing last known data' : 'Offline');
      showError(markets.reason?.message || 'Could not load market data.');
    }
    if (global.status === 'fulfilled') state.global = global.value;
    if (trending.status === 'fulfilled') state.trending = trending.value.coins || [];
    if (fng.status === 'fulfilled') state.fng = fng.value;

    renderAll();
    if (state.modalCoin) refreshModalHeader();

    state.loading = false;
    state.countdown = REFRESH_SECONDS;
    $('#refreshBtn').classList.remove('spinning');
  }

  /* ---------------- coin modal ---------------- */
  const modal = $('#coinModal');

  function openCoin(id) {
    const c = state.coins.find((x) => x.id === id);
    if (!c) return;
    state.modalCoin = c;
    state.range = 7;
    $$('.range-tabs button').forEach((b) => b.classList.toggle('is-active', b.dataset.range === '7'));
    $('#mImg').src = c.image;
    $('#mName').textContent = c.name;
    $('#mSymbol').textContent = c.symbol.toUpperCase();
    $('#mRank').textContent = c.market_cap_rank ?? '-';
    refreshModalHeader();
    if (!modal.open) modal.showModal();
    loadChart();
  }

  function refreshModalHeader() {
    const c = state.coins.find((x) => x.id === state.modalCoin?.id) || state.modalCoin;
    state.modalCoin = c;
    $('#mPrice').textContent = fmtPrice(c.current_price);
    setPill($('#mChg'), ch24(c));
    syncModalStar();

    const stats = [
      ['Market cap', fmtCompact(c.market_cap)],
      ['24h volume', fmtCompact(c.total_volume)],
      ['Circulating supply', `${fmtNum(c.circulating_supply)} ${c.symbol.toUpperCase()}`],
      ['24h high', fmtPrice(c.high_24h)],
      ['24h low', fmtPrice(c.low_24h)],
      ['7d change', fmtPct(ch7(c)) === '-' ? '-' : `${ch7(c) >= 0 ? '+' : '-'}${fmtPct(ch7(c))}`],
      ['All-time high', fmtPrice(c.ath)],
      ['From all-time high', c.ath_change_percentage == null ? '-' : `${c.ath_change_percentage.toFixed(1)}%`],
      ['Max supply', c.max_supply ? fmtNum(c.max_supply) : 'No limit'],
    ];
    $('#mStats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  }

  function syncModalStar() {
    const on = state.favs.has(state.modalCoin?.id);
    const b = $('#mStar');
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', on ? 'Remove from watchlist' : 'Add to watchlist');
    b.title = on ? 'Remove from watchlist' : 'Add to watchlist';
  }

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  async function loadChart() {
    const c = state.modalCoin;
    const token = ++state.chartToken;
    const stateEl = $('#chartState');
    stateEl.textContent = 'Loading chart...';
    stateEl.classList.remove('hidden');

    try {
      const data = await api(`/api/coin/${encodeURIComponent(c.id)}/chart?vs=${state.vs}&days=${state.range}`);
      if (token !== state.chartToken) return; // a newer request replaced this one
      drawChart(data.prices || []);
      stateEl.classList.add('hidden');
    } catch (err) {
      if (token !== state.chartToken) return;
      stateEl.textContent = err.message || 'Chart is not available right now.';
    }
  }

  function drawChart(points) {
    if (!points.length || typeof Chart === 'undefined') return;
    const labels = points.map((p) => p[0]);
    const values = points.map((p) => p[1]);
    const up = values[values.length - 1] >= values[0];
    const color = css(up ? '--up' : '--down');
    const muted = css('--muted');
    const line = css('--line');

    const canvas = $('#coinChart');
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 280);
    grad.addColorStop(0, up ? 'rgba(25,201,138,.28)' : 'rgba(240,71,90,.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    const tick = (ms) => {
      const d = new Date(ms);
      if (state.range <= 1) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (state.range <= 90) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
    };

    if (state.chart) state.chart.destroy();
    state.chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ data: values, borderColor: color, backgroundColor: grad, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.25 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 450 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => new Date(+items[0].label).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
              label: (item) => fmtPrice(item.parsed.y),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 6, maxRotation: 0, callback(v) { return tick(+this.getLabelForValue(v)); } } },
          y: { position: 'right', grid: { color: line }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 5, callback: (v) => fmtPrice(v) } },
        },
      },
    });
  }

  /* ---------------- watchlist ---------------- */
  function toggleFav(id) {
    state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
    store.set('cp.favs', JSON.stringify([...state.favs]));
    renderTable();
    if (state.modalCoin) syncModalStar();
  }

  /* ---------------- events ---------------- */
  function bind() {
    // table: open coin / toggle star
    $('#marketBody').addEventListener('click', (e) => {
      const star = e.target.closest('[data-star]');
      if (star) { e.stopPropagation(); toggleFav(star.dataset.star); return; }
      const row = e.target.closest('tr[data-id]');
      if (row) openCoin(row.dataset.id);
    });
    $('#marketBody').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('tr[data-id]')) openCoin(e.target.dataset.id);
    });

    // heatmap + movers
    $('#heatmap-box').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) openCoin(t.dataset.id); });
    ['#listGainers', '#listLosers', '#listTrending'].forEach((s) =>
      $(s).addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) openCoin(b.dataset.id); }));

    // sorting
    $('#marketTable thead').addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable');
      if (!th) return;
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else state.sort = { key, dir: key === 'name' || key === 'rank' ? 'asc' : 'desc' };
      state.page = 1;
      renderTable();
    });

    // tabs
    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      state.tab = t.dataset.tab;
      state.page = 1;
      $$('.tab').forEach((x) => { const on = x === t; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', on); });
      renderTable();
    }));

    // search (desktop + mobile inputs stay in sync)
    const onSearch = (e) => {
      state.q = e.target.value.trim();
      state.page = 1;
      $('#searchInput').value = $('#searchInputMobile').value = e.target.value;
      renderTable();
    };
    $('#searchInput').addEventListener('input', onSearch);
    $('#searchInputMobile').addEventListener('input', onSearch);
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        e.preventDefault();
        (window.innerWidth >= 640 ? $('#searchInput') : $('#searchInputMobile')).focus();
      }
    });

    // pagination
    $('#prevPage').addEventListener('click', () => { state.page--; renderTable(); $('#markets').scrollIntoView({ behavior: 'smooth' }); });
    $('#nextPage').addEventListener('click', () => { state.page++; renderTable(); $('#markets').scrollIntoView({ behavior: 'smooth' }); });

    // currency
    const sel = $('#currencySelect');
    sel.value = state.vs;
    sel.addEventListener('change', () => {
      state.vs = sel.value;
      store.set('cp.vs', state.vs);
      state.coins = [];
      renderTable();
      loadAll().then(() => { if (state.modalCoin && modal.open) loadChart(); });
    });

    // theme
    $('#themeToggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      store.set('cp.theme', next);
      if (modal.open) loadChart();
    });

    // refresh + retry
    $('#refreshBtn').addEventListener('click', loadAll);
    $('#retryBtn').addEventListener('click', loadAll);

    // modal
    $('#mClose').addEventListener('click', () => modal.close());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
    modal.addEventListener('close', () => { state.modalCoin = null; state.chartToken++; if (state.chart) { state.chart.destroy(); state.chart = null; } });
    $('#mStar').addEventListener('click', () => state.modalCoin && toggleFav(state.modalCoin.id));
    $$('.range-tabs button').forEach((b) => b.addEventListener('click', () => {
      state.range = Number(b.dataset.range);
      $$('.range-tabs button').forEach((x) => x.classList.toggle('is-active', x === b));
      loadChart();
    }));

    // keep the treemap crisp when the window changes size
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderHeatmap, 150); });

    // refresh when the tab becomes visible again after a long pause
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.countdown <= 5) loadAll(); });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    bind();
    setStatus('', 'Connecting...');
    renderTable(); // skeleton rows
    renderHeatmap();
    loadAll();

    setInterval(() => {
      if (document.hidden) return;
      state.countdown = Math.max(0, state.countdown - 1);
      $('#refreshIn').textContent = state.countdown;
      if (state.countdown === 0) loadAll();
    }, 1000);
  }

  boot();
})();
