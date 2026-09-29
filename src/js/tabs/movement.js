/* Movement tab (R3) — promotions, transfers, re-designations and segment
   changes: period tiles, a monthly trend by type, asset→asset and level→level
   flow heat-tables, promotions by band / level, an Employee History lookup and
   a movement details table. Metrics + compute helpers: 02l-reg-movement.js.

   Persona rules on this tab:
   - tiles / charts go through UI.tileHTML and Charts.card (class per metric);
   - per-asset cuts use Access.chartScopes(): an asset-locked persona sees its
     own asset plus an 'Other assets' bucket, never a peer's name;
   - heat-table cells and band / level bars below CONFIG.minCell read "<5" for
     every non-default persona (Access.cellText / Access.suppressed);
   - row-level views (history lookup, details table) need the 'org' class at
     'full': PII 'identified' types or picks an Employee ID; 'masked' picks from
     a pseudonymised list (raw IDs never reach the DOM); 'none' is disabled. */

TabRenderers.movement = (() => {

  const K = MoveKit;
  // lookup selection survives re-renders, but never across personas or data loads
  const sel = { id: null, token: null, version: null };
  let pickList = [];                 // masked persona: index → raw ID (kept out of the DOM)

  const DATA = ['employee_movements', 'employee_master'];
  const SERIES_STYLE = {
    [K.T.promo]: { role: 'focus' }, [K.T.loc]: { role: 'group' }, [K.T.fn]: { role: 'ctx1' },
    [K.T.co]: { role: 'ctx1', dashed: true }, [K.T.redesig]: { role: 'ctx2' }, [K.T.seg]: { role: 'ctx2', dashed: true }
  };

  const rowLevel = () => {
    if (Access.levelForClass(Access.persona(), 'org') !== 'full') return 'agg';
    return Access.pii();             // 'identified' | 'masked' | 'none'
  };

  /* ---------- charts ---------- */

  function trendCard(m, ctx) {
    return Charts.card({
      title: 'Movements by type — monthly', sub: 'count of movement rows per month, selected scope · Promotion in red, direct-labelled',
      infoKey: 'mv_total',
      body: needData(DATA, () => {
        const months = ChartData.monthsAxis(ctx);
        const by = K.monthlyByType(m, ctx);
        const series = K.TYPE_ORDER.map((t) => ({ label: K.SHORT[t], ...SERIES_STYLE[t], values: by.get(t) }));
        return Charts.line({ months, series, yFmt: (v) => fmtInt(v) });
      })
    });
  }

  // intensity step 0–5 of n against the table maximum
  const step = (n, max) => (!n || !max ? 0 : Math.max(1, Math.ceil(n / max * 5)));

  function heatTable(f, { id, what, cornerLabel }) {
    if (!f.n) return `<div class="chart-empty">No ${esc(what)} in the trailing ${f.months} months for this scope.</div>`;
    const ax = f.axis;
    const outOf = (a) => ax.reduce((s, b) => s + f.get(a, b), 0);
    const inTo = (b) => ax.reduce((s, a) => s + f.get(a, b), 0);
    const max = Math.max(...[...f.cells.values()]);
    const cell = (a, b) => {
      if (a === b) return '<td class="mv-diag" aria-label="same">·</td>';
      const n = f.get(a, b);
      const supp = Access.suppressed(n);
      const txt = n ? Access.cellText(n) : '';
      const tip = `${a} → ${b}: ${supp ? `fewer than ${CONFIG.minCell} (suppressed for this persona)` : fmtInt(n)} · trailing ${f.months} months`;
      return `<td class="mv-h${supp ? ' is-supp' : step(n, max)}" data-tip="${esc(tip)}">${esc(txt)}</td>`;
    };
    const tot = (n, label) => `<td class="mv-tot" data-tip="${esc(label + ': ' + (Access.suppressed(n) ? 'fewer than ' + CONFIG.minCell : fmtInt(n)))}">${esc(Access.cellText(n))}</td>`;
    return `<div class="table-scroll"><table class="mv-heat" id="${esc(id)}">
      <thead><tr><th class="mv-corner" scope="col">${esc(cornerLabel)}</th>${ax.map((b) => `<th scope="col">${esc(b)}</th>`).join('')}<th class="mv-tot" scope="col">Out</th></tr></thead>
      <tbody>${ax.map((a) => `<tr><th scope="row">${esc(a)}</th>${ax.map((b) => cell(a, b)).join('')}${tot(outOf(a), 'Out of ' + a)}</tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row">In</th>${ax.map((b) => tot(inTo(b), 'Into ' + b)).join('')}${tot(f.n, 'All')}</tr></tfoot>
    </table></div>`;
  }

  function assetFlowCard(m, ctx) {
    const scopes = Access.chartScopes().filter((a) => a !== 'Group');
    const locked = !!Access.lockedAsset();
    const bucket = locked ? (a) => (scopes.includes(a) ? a : 'Other assets') : null;
    return Charts.card({
      title: 'Asset-to-asset transfer flow', sub: `rows = From asset, columns = To asset · any movement that changes the asset · trailing 12 months${locked ? ' · peers pooled as “Other assets”' : ''}`,
      infoKey: 'mv_transfer_location',
      body: needData(DATA, () => heatTable(K.flow(m, ctx, {
        fromKey: (x) => x.r.from_asset, toKey: (x) => x.r.to_asset, months: 12,
        order: [...CONFIG.assets.filter((a) => scopes.includes(a)), 'Other assets'], bucket
      }), { id: 'mv-flow-asset', what: 'inter-asset movements', cornerLabel: 'From ↓ · To →' })),
      note: `Darker = more movements. Cells below ${CONFIG.minCell} read “<${CONFIG.minCell}” on persona-restricted views.`
    });
  }

  function levelFlowCard(m, ctx) {
    return Charts.card({
      title: 'Level flow — from → to', sub: 'rows = From Level, columns = To Level (senior → junior) · any movement that changes the level · trailing 12 months',
      infoKey: 'mv_promotions',
      body: needData(DATA, () => heatTable(K.flow(m, ctx, {
        fromKey: (x) => x.r.from_level, toKey: (x) => x.r.to_level, months: 12, order: CONFIG.levels
      }), { id: 'mv-flow-level', what: 'level changes', cornerLabel: 'From ↓ · To →' })),
      note: 'Cells left of the diagonal step up the ladder (promotions); right of it would be demotions; two or more columns left of it are skip-level moves.'
    });
  }

  // count bars (org class); the annualised rate rides along as the bar's
  // sub-label only when the persona may see the promotion rate (perf class)
  function promoBars(m, ctx, dim, showRate) {
    const rows = K.promotionsBy(m, ctx, dim);
    if (!rows.length) return '<div class="chart-empty">No promotions in the selected period for this scope.</div>';
    return Charts.barH({
      fmt: (v) => fmtInt(v),
      items: rows.map((r) => {
        const supp = Access.suppressed(r.n);
        const rate = showRate && !supp && r.rate != null ? `${fmtPct(r.rate, 1)} p.a.` : '';
        return {
          label: r.label, value: supp ? null : r.n,
          sub: supp ? `<${CONFIG.minCell}` : rate,
          tip: `${r.label}: ${supp ? `fewer than ${CONFIG.minCell}` : fmtInt(r.n)} promotions${rate ? `\nRate ${rate} (permanent ${fmtInt(r.permN)} ÷ average headcount ${fmtInt(r.avgHc)})` : ''}`
        };
      })
    });
  }

  function promoByCard(m, ctx) {
    const showRate = Access.canSee('mv_promotion_rate');
    return Charts.card({
      title: 'Promotions by management band and level',
      sub: `period count by the band / level promoted into${showRate ? ' · label = annualised rate vs that group’s average permanent headcount' : ''}`,
      infoKey: 'mv_promotions',
      body: needData(DATA, () => `<div class="mv-subhead">By management band</div>${promoBars(m, ctx, 'band', showRate)}
        <div class="mv-subhead">By level (senior → junior)</div>${promoBars(m, ctx, 'level', showRate)}`),
      note: `Bars below ${CONFIG.minCell} read “<${CONFIG.minCell}” on persona-restricted views.`
    });
  }

  /* ---------- employee history ---------- */

  const dateOf = (day) => fmtDMY(day);
  // distance before the as-of date in the unit a reader expects
  function ago(day) {
    const d = AS_OF_DAY - day;
    if (d < 0) return 'after as-of';
    if (d < 62) return `${fmtInt(d)} day${d === 1 ? '' : 's'} before as-of`;
    if (d < 730) return `${fmtInt(Math.round(d / 30.44))} months before as-of`;
    return `${fmtNum(d / 365.25, 1)} yrs before as-of`;
  }

  function stateLine(s) {
    return [s.asset, s.function, s.level, s.company, s.segment].filter(Boolean).map(esc).join(' · ') || '—';
  }

  function timelineHTML(h, mode) {
    const shownId = mode === 'masked' ? Access.pseudonym(h.id) : h.id;
    const name = mode === 'identified' && h.e.name ? ` · ${esc(h.e.name)}` : '';
    const tenureEnd = h.active ? AS_OF_DAY : h.exit.exit_date;
    const tenure = h.e.doj != null ? yearsBetween(h.e.doj, tenureEnd) : null;
    const lastPromo = h.lastPromoDay != null
      ? `Last promotion ${dateOf(h.lastPromoDay)} (${ago(h.lastPromoDay)})`
      : h.masterPromoDay != null ? `Last Promotion Date in employee master ${dateOf(h.masterPromoDay)} — no Promotion row in employee_movements`
      : 'No promotion on record';
    const items = h.events.map((ev) => {
      if (ev.kind === 'join') {
        return `<li class="mv-ev mv-ev-join"><span class="mv-date">${dateOf(ev.day)}</span><span class="mv-kind">Joined${h.e.hire_type ? ` <span class="mv-sub">${esc(h.e.hire_type)} hire</span>` : ''}</span><span class="mv-detail">${stateLine(ev.state)}</span></li>`;
      }
      if (ev.kind === 'exit') {
        return `<li class="mv-ev mv-ev-exit"><span class="mv-date">${dateOf(ev.day)}</span><span class="mv-kind">Exited${ev.type ? ` <span class="mv-sub">${esc(ev.type)}</span>` : ''}</span><span class="mv-detail">Last role: ${stateLine(h.current)}</span></li>`;
      }
      const isPromo = ev.type === K.T.promo;
      const isLast = isPromo && ev.day === h.lastPromoDay;
      const detail = ev.changes.length
        ? ev.changes.map((c) => `<span class="mv-chg"><span class="mv-chg-k">${esc(c.label)}</span> ${esc(c.from)} <span class="mv-arrow" aria-hidden="true">→</span><span class="mv-sr"> to </span> <strong>${esc(c.to)}</strong></span>`).join('')
        : esc(ev.text);
      return `<li class="mv-ev ${isPromo ? 'mv-ev-promo' : 'mv-ev-move'}${isLast ? ' is-last-promo' : ''}" data-type="${esc(ev.type)}"><span class="mv-date">${dateOf(ev.day)}${ev.day > AS_OF_DAY ? ' <span class="mv-sub">future-dated</span>' : ''}</span><span class="mv-kind">${esc(ev.type)}${isLast ? ' <span class="mv-badge">Last promotion</span>' : ''}</span><span class="mv-detail">${detail}</span></li>`;
    });
    if (h.active) {
      items.push(`<li class="mv-ev mv-ev-now"><span class="mv-date">${dateOf(AS_OF_DAY)}</span><span class="mv-kind">Current role <span class="mv-sub">as-of · active</span></span><span class="mv-detail">${stateLine(h.current)}${h.band ? ' · ' + esc(CONFIG.mgmtBandLabels[h.band] || h.band) : ''}</span></li>`);
    }
    return `<div class="mv-tl-head">
        <span class="mv-tl-id" data-mv-id>${esc(shownId)}</span>${name}
        <span class="mv-tl-status ${h.active ? '' : 'is-exited'}">${h.active ? 'Active' : 'Exited'}</span>
      </div>
      <div class="mv-tl-facts">
        <span>${tenure == null ? '—' : fmtNum(tenure, 1) + ' yrs tenure'}</span>
        <span>${fmtInt(h.moves)} movement${h.moves === 1 ? '' : 's'} on record</span>
        <span>${esc(lastPromo)}</span>
      </div>
      <ol class="mv-tl" aria-label="Employee history, oldest first">${items.join('')}</ol>
      ${mode === 'masked' ? `<p class="chart-note">Identifier pseudonymised for ${esc(Access.label())} — stable within this browser session only; names are never shown.</p>` : ''}`;
  }

  function historyControls(m, ctx, mode) {
    if (mode === 'identified') {
      const list = K.recentMovers(m, ctx, 400);
      return `<form class="mv-lookup" id="mv-lookup-form" autocomplete="off">
          <label class="ctl mv-ctl">Employee ID
            <input id="mv-emp-input" type="text" list="mv-emp-list" spellcheck="false" placeholder="Type or pick an Employee ID" value="${esc(sel.id || '')}" aria-describedby="mv-lookup-hint">
          </label>
          <datalist id="mv-emp-list">${list.map((r) => `<option value="${esc(r.id)}">${esc([r.e.name, r.e.asset, K.SHORT[r.last.type]].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
          <button class="btn btn-solid" type="submit" id="mv-emp-go">Show history</button>
          <span class="mv-hint" id="mv-lookup-hint">Suggestions list the ${fmtInt(list.length)} most recent movers in scope; any in-scope Employee ID resolves.</span>
        </form>`;
    }
    if (mode === 'masked') {
      const list = K.recentMovers(m, ctx, 80);
      pickList = list.map((r) => r.id);
      const cur = sel.id ? pickList.indexOf(sel.id) : -1;
      return `<div class="mv-lookup">
          <label class="ctl mv-ctl">Employee (pseudonymised)
            <select id="mv-emp-select" aria-describedby="mv-lookup-hint">
              <option value="">Choose from the ${fmtInt(list.length)} most recent movers…</option>
              ${list.map((r, i) => `<option value="${i}"${i === cur ? ' selected' : ''}>${esc(Access.pseudonym(r.id))} · ${esc(K.SHORT[r.last.type])} · ${esc(fmtDMY(r.last.day))}</option>`).join('')}
            </select>
          </label>
          <span class="mv-hint" id="mv-lookup-hint">Typing an Employee ID is disabled for ${esc(Access.label())}: identifiers are masked, so the lookup offers pseudonyms only.</span>
        </div>`;
    }
    const why = mode === 'none'
      ? `Employee history is row-level detail. ${Access.label()} sees aggregates only (identifiers: none), so the lookup is disabled — the tiles and charts on this tab are the aggregate view.`
      : `Movement data is aggregate-only for ${Access.label()}, so the row-level lookup is disabled.`;
    return `<div class="mv-lookup is-disabled">
        <label class="ctl mv-ctl">Employee ID
          <input id="mv-emp-input" type="text" disabled placeholder="Not available for this persona">
        </label>
        <button class="btn btn-solid" type="button" id="mv-emp-go" disabled>Show history</button>
      </div>
      <div class="chart-empty chart-restricted mv-withheld" id="mv-history-withheld">${Access.LOCK_SVG} ${esc(why)}</div>`;
  }

  function historyCard(m, ctx, mode) {
    const body = needData(DATA, () => {
      if (mode !== 'identified' && mode !== 'masked') return historyControls(m, ctx, mode);
      return historyControls(m, ctx, mode) + '<div class="mv-timeline" id="mv-timeline" aria-live="polite"></div>';
    });
    return Charts.card({
      title: 'Lookup and timeline', sub: 'joining → each movement (from → to) → last promotion → exit or current role · resolves employees whose current employee-master record is in scope',
      infoKey: 'mv_total', body
    });
  }

  function showTimeline(panel, m, ctx, mode, id) {
    const out = panel.querySelector('#mv-timeline');
    if (!out) return;
    if (!id) { out.innerHTML = '<div class="chart-empty">Pick an employee to see their movement history.</div>'; return; }
    const h = K.history(m, ctx, id);
    if (!h) {
      out.innerHTML = `<div class="chart-empty" data-mv-notfound>No employee with that ID in your current scope.</div>`;
      return;
    }
    sel.id = h.id;
    out.innerHTML = timelineHTML(h, mode);
  }

  // opening example: the recent mover with the richest history (most movements)
  function defaultPick(m, ctx, recent) {
    let best = null, bestN = -1;
    for (const r of recent) {
      const n = (K.idx(m).byEmp.get(r.id) || []).length;
      if (n > bestN) { best = r.id; bestN = n; }
    }
    return best;
  }

  function wireHistory(panel, m, ctx, mode) {
    if (mode === 'identified') {
      const form = panel.querySelector('#mv-lookup-form');
      if (!form) return;
      const input = form.querySelector('#mv-emp-input');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        showTimeline(panel, m, ctx, mode, input.value);
      });
      // picking a datalist suggestion fires 'input' with the full value
      input.addEventListener('change', () => { if (input.value.trim()) showTimeline(panel, m, ctx, mode, input.value); });
      const first = sel.id && K.history(m, ctx, sel.id) ? sel.id : defaultPick(m, ctx, K.recentMovers(m, ctx, 60));
      if (first) input.value = first;
      showTimeline(panel, m, ctx, mode, first || null);
    } else if (mode === 'masked') {
      const s = panel.querySelector('#mv-emp-select');
      if (!s) return;
      s.addEventListener('change', () => showTimeline(panel, m, ctx, mode, s.value === '' ? null : pickList[+s.value]));
      if (s.value === '' && pickList.length) s.value = String(Math.max(0, pickList.indexOf(defaultPick(m, ctx, pickList.slice(0, 60).map((id) => ({ id }))))));
      showTimeline(panel, m, ctx, mode, s.value === '' ? null : pickList[+s.value]);
    }
  }

  /* ---------- details table ---------- */

  function detailsCard(m, ctx, mode) {
    const body = needData(DATA, () => {
      if (mode === 'agg') return `<div class="chart-empty chart-restricted" id="mv-details-withheld">${Access.LOCK_SVG} Row-level detail withheld — movement data is aggregate-only for ${esc(Access.label())}.</div>`;
      const d = K.detailRows(m, ctx);
      if (!d.total) return '<div class="chart-empty">No movements in the selected period for this scope.</div>';
      const t = Access.maskTable(d.columns, d.rows);
      if (!t) return `<div class="chart-empty chart-restricted" id="mv-details-withheld">${Access.LOCK_SVG} This table lists individual people. ${esc(Access.label())} sees aggregates only (identifiers: none), so the rows are not shown.</div>`;
      return `<div class="mv-details" id="mv-details">${UI.tableHTML(t.columns, t.rows)}</div>
        <div class="chart-note">Latest ${fmtInt(d.rows.length)} of ${fmtInt(d.total)} movements in the period${t.columns !== d.columns ? ' · identifiers pseudonymised, names removed' : ''}. Click a volume tile for the full list and CSV.</div>`;
    });
    return Charts.card({ title: 'Movements in the period', sub: 'latest first · “Change” lists every attribute that changed · Asset / Function / Level = state after the move', infoKey: 'mv_total', body });
  }

  /* ---------- render ---------- */

  return function render(panel) {
    const m = Compute.build(), ctx = Compute.ctxNow();
    const tok = Access.token();
    if (sel.token !== tok || sel.version !== App.state.dataVersion) { sel.id = null; sel.token = tok; sel.version = App.state.dataVersion; }
    const mode = rowLevel();
    const months = ctx.periodMonths;
    renderTilesByGroup(panel, 'movement', {
      groupSubs: {
        'Movement volume': `period · last ${months} month${months === 1 ? '' : 's'} to as-of · a move counts for the From and the To scope`,
        'Movement rates': 'annualised · permanent roll'
      },
      tailHTML: `
        <div class="section-head"><h2>Employee history</h2><span class="sub">${esc(Access.PII_LABEL[Access.pii()] || '')} for ${esc(Access.label())}</span></div>
        <div class="card-grid mv-grid-1" id="mv-history">${historyCard(m, ctx, mode)}</div>
        <div class="section-head"><h2>Movement details</h2><span class="sub">row-level · follows the persona’s identifier rule</span></div>
        <div class="card-grid mv-grid-1">${detailsCard(m, ctx, mode)}</div>`
    });
    fillSlot('movement', 'Movement volume', trendCard(m, ctx) + assetFlowCard(m, ctx));
    fillSlot('movement', 'Movement rates', promoByCard(m, ctx) + levelFlowCard(m, ctx));
    wireHistory(panel, m, ctx, mode);
  };
})();
