/* Positions & Budget tab (R8) — position inventory, vacancy risk, HC budget vs
   filled, and the position register. Metrics and helpers: 02q-reg-positions.js
   (PosKit). Persona rules: every chart sits in Charts.card (class 'org'); the
   register lists incumbents only in its Filled / All views, through
   Access.maskTable (pseudonyms for 'masked', withheld for 'none'); per-asset
   cuts iterate Access.chartScopes(). */

TabRenderers.positions = (panel) => {
  const m = Compute.build(), ctx = Compute.ctxNow();
  const head = (h, sub) => `<div class="section-head"><h2>${esc(h)}</h2>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
  const tiles = (keys) => `<div class="tile-grid">${keys.map((k) => UI.tileHTML(k)).join('')}</div>`;
  const pct = (v) => fmtPct(v, 1);
  const vacTarget = Compute.metric('pb_vacancy_pct').target?.value ?? null;
  const focusTop = (items) => {   // the highest rate in a cut carries the emphasis
    const shown = items.filter((i) => i.value != null);
    if (shown.length > 1) shown.reduce((a, b) => (b.value > a.value ? b : a)).role = 'focus';
    return items;
  };

  /* ---------- vacancy rate by asset / function / level ---------- */

  function byAssetItems() {
    const scopes = Access.chartScopes();
    const locked = !!Access.lockedAsset();
    const items = CONFIG.assets.filter((a) => scopes.includes(a)).map((a) => {
      const t = PosKit.stats(m, { ...ctx, asset: a });
      return PosKit.cutItem(a, { active: t.active, vacant: t.Vacant, filled: t.Filled, rate: t.rate }, {
        role: a === ctx.asset ? 'focus' : undefined,
        setAsset: locked ? null : a
      });
    });
    if (scopes.includes('Group')) {
      const t = PosKit.stats(m, { ...ctx, asset: 'Group' });
      items.push(PosKit.cutItem(locked ? 'Group (benchmark)' : 'Group', { active: t.active, vacant: t.Vacant, filled: t.Filled, rate: t.rate }, {
        role: ctx.asset === 'Group' ? 'focus' : undefined, setAsset: locked ? null : 'Group'
      }));
    }
    for (const it of items) if (it.setAsset) it.tip += `\nClick to focus ${it.setAsset === 'Group' ? 'all assets' : it.setAsset}`;
    return items;
  }

  const vacancyCards = [
    Charts.card({
      title: 'Vacancy rate by asset', sub: 'vacancy % · (n) = vacant positions · click a bar to focus that asset', infoKey: 'pb_vacancy_pct',
      body: needData(['positions'], () => Charts.barH({ items: byAssetItems(), fmt: pct, target: vacTarget }))
    }),
    Charts.card({
      title: 'Vacancy rate by function', sub: 'vacancy % · (n) = vacant positions · highest rate in red', infoKey: 'pb_vacancy_pct',
      body: needData(['positions'], () => {
        const cuts = PosKit.vacancyBy(m, ctx, (r) => PosKit.fnOf(m, r));
        const items = focusTop(cuts.slice(0, 12).map((c) => PosKit.cutItem(c.key, c)));
        return items.length ? Charts.barH({ items, fmt: pct, target: vacTarget }) : '<div class="chart-empty">No filled or vacant positions in scope.</div>';
      })
    }),
    Charts.card({
      title: 'Vacancy rate by level', sub: 'vacancy % · (n) = vacant positions · grade ladder, senior → junior', infoKey: 'pb_vacancy_pct',
      body: needData(['positions'], () => {
        const items = focusTop(PosKit.vacancyBy(m, ctx, (r) => r.level, CONFIG.levels).map((c) => PosKit.cutItem(c.key, c)));
        return items.length ? Charts.barH({ items, fmt: pct, target: vacTarget }) : '<div class="chart-empty">No filled or vacant positions in scope.</div>';
      })
    })
  ].join('');

  /* ---------- vacancy ageing + requisition cover ---------- */

  const ageingCard = Charts.card({
    title: 'Vacancy ageing', sub: `days since Vacant Since · red = older than ${PosKit.AGED} days`, infoKey: 'pb_vacant_90d',
    body: needData(['positions'], () => {
      const { buckets, undated } = PosKit.ageing(m, ctx);
      const total = buckets.reduce((s, b) => s + b.n, 0) + undated;
      if (!total) return '<div class="chart-empty">No vacant positions in scope.</div>';
      const drillAged = Access.canDrill('pb_vacant_90d');
      const items = buckets.map((b) => {
        const aged = b.lo > PosKit.AGED;
        return {
          label: `${b.label} days`, value: b.n, sub: fmtPct(b.n / total * 100, 0), role: aged ? 'focus' : undefined,
          tip: `${b.label} days: ${fmtInt(b.n)} vacanc${b.n === 1 ? 'y' : 'ies'} (${fmtPct(b.n / total * 100, 1)})` +
            (m.has('requisitions') ? `\n${fmtInt(b.noReq)} without an open requisition` : '') +
            (aged && drillAged && b.n ? '\nClick for the aged list' : ''),
          drill: aged && drillAged && b.n ? 'pb_vacant_90d' : null
        };
      });
      if (undated) items.push({ label: 'No date', value: undated, sub: fmtPct(undated / total * 100, 0), tip: `${fmtInt(undated)} vacant positions without Vacant Since — not aged` });
      return Charts.barH({ items, fmt: (v) => fmtInt(v) });
    })
  });

  const coverCard = Charts.card({
    title: 'Vacancies by requisition cover', sub: 'red bars sum to “Vacant without open requisition”', infoKey: 'pb_vacant_no_req',
    body: needData(['positions', 'requisitions'], () => {
      const vac = PosKit.rows(m, ctx).filter(PosKit.isVacant);
      if (!vac.length) return '<div class="chart-empty">No vacant positions in scope.</div>';
      const cats = [
        ['Open requisition', (r, c, q) => c === 'open' && (!q.req_status || q.req_status === 'Open')],
        ['Offer released', (r, c, q) => c === 'open' && q.req_status === 'Offered'],
        ['Offer accepted (TBO)', (r, c, q) => c === 'open' && q.req_status === 'TBO'],
        ['Requisition on hold', (r, c, q) => c === 'open' && q.req_status === 'On Hold'],
        ['Requisition closed / dropped', (r, c) => c === 'closed', true],
        ['Req ID not found', (r, c) => c === 'unknown', true],
        ['No requisition', (r, c) => c === 'none', true]
      ];
      const counts = cats.map(() => 0);
      for (const r of vac) {
        const c = PosKit.cover(m, r);
        const q = r.requisition_id ? m.reqById.get(r.requisition_id) : null;
        const i = cats.findIndex(([, f]) => f(r, c, q || {}));
        if (i >= 0) counts[i]++;
      }
      const drillNoReq = Access.canDrill('pb_vacant_no_req');
      const items = cats.map(([label, , uncovered], i) => ({
        label, value: counts[i], sub: fmtPct(counts[i] / vac.length * 100, 0), role: uncovered ? 'focus' : 'ctx',
        tip: `${label}: ${fmtInt(counts[i])} of ${fmtInt(vac.length)} vacancies` + (uncovered && drillNoReq && counts[i] ? '\nClick for the uncovered list' : ''),
        drill: uncovered && drillNoReq && counts[i] ? 'pb_vacant_no_req' : null
      })).filter((it) => it.value > 0);
      return Charts.barH({ items, fmt: (v) => fmtInt(v) });
    })
  });

  /* ---------- HC budget vs filled positions ---------- */

  const budgetMonth = m.has('hc_budget') ? PosKit.budget(m, ctx).month : null;
  const budgetSub = budgetMonth == null ? 'latest budget month on or before as-of' : `budget month ${monthIdxToLabel(budgetMonth)} · filled = positions with status Filled`;
  const pairItem = (label, x, extra = {}) => {
    const gap = x.budget == null ? null : x.filled - x.budget;
    return {
      label, budget: x.budget, filled: x.filled,
      tip: `${label}\nHC budget ${x.budget == null ? '—' : fmtInt(x.budget)} · filled ${fmtInt(x.filled)}` +
        (x.budget ? ` (${fmtPct(x.filled / x.budget * 100, 1)})` : '') +
        (gap == null ? '' : `\n${gap > 0 ? fmtInt(gap) + ' over budget' : fmtInt(-gap) + ' below budget'}`) +
        (x.nonBudgeted ? `\n${fmtInt(x.nonBudgeted)} filled outside the budget` : ''),
      ...extra
    };
  };

  function groupNote() {
    if (!Access.chartScopes().includes('Group')) return '';
    const g = { ...ctx, asset: 'Group' };
    const b = PosKit.budget(m, g), f = PosKit.stats(m, g).Filled;
    return `Group${Access.lockedAsset() ? ' (benchmark)' : ''}: HC budget ${fmtInt(b.total)} · filled ${fmtInt(f)}` +
      (b.total ? ` (${fmtPct(f / b.total * 100, 1)})` : '');
  }

  const budgetCards = [
    Charts.card({
      title: 'HC budget vs filled positions by asset', sub: budgetSub, infoKey: 'pb_budget_fill_pct',
      body: needData(['positions', 'hc_budget'], () => {
        const locked = !!Access.lockedAsset();
        const items = PosKit.assetsFor({ ...ctx, asset: 'Group' }).map((a) => {
          const c = { ...ctx, asset: a };
          const x = { budget: PosKit.budget(m, c).total, filled: PosKit.stats(m, c).Filled,
            nonBudgeted: PosKit.rows(m, c).filter((r) => PosKit.isFilled(r) && r.budgeted_flag === false).length };
          return pairItem(a, x, { role: a === ctx.asset ? 'focus' : undefined, setAsset: locked ? null : a });
        });
        return PosKit.pairBars(items);
      }),
      note: m.has('positions') && m.has('hc_budget') ? groupNote() : ''
    }),
    Charts.card({
      title: 'HC budget vs filled positions by function', sub: 'largest budgets first · top 12', infoKey: 'pb_budget_fill_pct',
      body: needData(['positions', 'hc_budget'], () => {
        const list = PosKit.budgetBy(m, ctx, (r) => PosKit.fnOf(m, r), (b) => PosKit.fnOf(m, b))
          .sort((a, b) => (b.budget ?? -1) - (a.budget ?? -1) || b.filled - a.filled).slice(0, 12);
        return list.length ? PosKit.pairBars(list.map((x) => pairItem(x.key, x))) : '<div class="chart-empty">No budget or filled positions in scope.</div>';
      })
    })
  ].join('');

  /* ---------- position register ---------- */

  const VIEWS = [
    ['Vacant', 'Vacant', PosKit.isVacant],
    ['Held', 'On hold / frozen', PosKit.isHeld],
    ['Filled', 'Filled', PosKit.isFilled],
    ['All', 'All', () => true]
  ];
  const viewOf = (id) => VIEWS.find((v) => v[0] === id) || VIEWS[0];
  const TABLE_ROWS = 100;
  let lastTable = null;   // masked rows of the current view, for the CSV download

  function registerTable() {
    const [id, label, pred] = viewOf(PosKit.ui.view);
    const withInc = id === 'Filled' || id === 'All';
    const q = PosKit.ui.q.trim().toLowerCase();
    let list = PosKit.rows(m, ctx).filter(pred);
    // matches position attributes only — never the incumbent ID, so a masked
    // persona cannot probe whether a given employee holds a position
    if (q) list = list.filter((r) => [r.position_id, r.position_title, r.asset, r.function_plant, PosKit.fnOf(m, r), r.level]
      .some((v) => v != null && String(v).toLowerCase().includes(q)));
    const sorted = list.slice().sort(PosKit.urgency(ctx));
    const cols = withInc ? PosKit.COLS_INC : PosKit.COLS;
    const t = Access.maskTable(cols, sorted.map((r) => PosKit.rowOf(m, ctx, r, withInc)));
    if (!t) {
      lastTable = null;
      return `<div class="chart-empty chart-restricted">${Access.LOCK_SVG} Incumbent-level rows are withheld for ${esc(Access.label())}
        (identifiers: none). The Vacant and On hold / frozen views list positions only.</div>`;
    }
    lastTable = { title: `positions-${id.toLowerCase()}`, columns: t.columns, rows: t.rows };
    if (!t.rows.length) return `<div class="chart-empty">No ${esc(label.toLowerCase())} positions${q ? ' match “' + esc(PosKit.ui.q) + '”' : ''} in scope.</div>`;
    const masked = t.columns !== cols;
    return `<div class="chart-note pos-count">${fmtInt(Math.min(TABLE_ROWS, t.rows.length))} of ${fmtInt(t.rows.length)} ${esc(label.toLowerCase())} positions shown · most urgent first${masked ? ` · incumbent IDs pseudonymised for ${esc(Access.label())}` : ''}</div>` +
      UI.tableHTML(t.columns, t.rows.slice(0, TABLE_ROWS));
  }

  function registerBody() {
    if (!m.has('positions')) return needData(['positions'], () => '');
    if (Access.level('pb_positions_total') !== 'full') {
      return `<div class="chart-empty chart-restricted">${Access.LOCK_SVG} Aggregate-only access for ${esc(Access.label())} — the position register is row-level detail.</div>`;
    }
    const all = PosKit.rows(m, ctx);
    const btn = ([id, label, pred]) => `<button type="button" class="pos-view" data-pos-view="${id}" aria-pressed="${PosKit.ui.view === id}">${esc(label)}<span class="pos-n">${fmtInt(all.filter(pred).length)}</span></button>`;
    return `<div id="pos-register">
      <div class="pos-toolbar" role="group" aria-label="Position register view">
        ${VIEWS.map(btn).join('')}
        <input type="search" class="pos-q" id="pos-q" value="${esc(PosKit.ui.q)}" placeholder="Filter ID, title, plant, function, level" aria-label="Filter the position register">
        <button type="button" class="btn btn-outline pos-csv" data-pos-csv>Download rows → CSV</button>
      </div>
      <div class="pos-table" id="pos-table">${registerTable()}</div>
    </div>`;
  }

  /* ---------- page ---------- */

  panel.innerHTML = `
    <div class="empty-note pos-lead"><strong>Position master snapshot as of ${esc(CONFIG.asOf)}.</strong>
      Asset, business segment and function apply; the period and grade-band filters do not
      (positions carry Level). Vacancy rate = vacant ÷ (filled + vacant) — frozen and on-hold
      positions are reported separately.</div>
    ${head('Position inventory', 'all statuses · snapshot')}
    ${tiles(['pb_positions_total', 'pb_filled', 'pb_vacant', 'pb_frozen_hold', 'pb_vacancy_pct'])}
    <div class="card-grid pos-cards pos-grid">${vacancyCards}</div>
    ${head('Vacancy risk', `ageing from Vacant Since · > ${PosKit.AGED} days = aged · requisition cover from requisitions.csv`)}
    ${tiles(['pb_vacant_90d', 'pb_vacant_no_req', 'pb_cp_vacant'])}
    <div class="card-grid pos-cards pos-grid">${ageingCard}${coverCard}</div>
    ${head('Budget', 'HC budget from hc_budget.csv · latest month on or before as-of')}
    ${tiles(['pb_budgeted_unfilled', 'pb_budget_fill_pct'])}
    <div class="card-grid pos-cards pos-grid">${budgetCards}</div>
    ${head('Position register', 'row-level · incumbents masked by persona')}
    ${tiles(['pb_no_position_id'])}
    <div class="pos-cards">${Charts.card({
      title: 'Positions by status', sub: 'position · title · asset · function plant · level · status · vacant since · requisition',
      infoKey: 'pb_positions_total', body: registerBody()
    })}</div>`;

  /* ---------- register interactions (listeners live on elements rebuilt each render) ---------- */

  const reg = panel.querySelector('#pos-register');
  if (!reg) return;
  const table = reg.querySelector('#pos-table');
  const csvBtn = reg.querySelector('[data-pos-csv]');
  const refresh = () => {
    table.innerHTML = registerTable();
    csvBtn.disabled = !lastTable || !lastTable.rows.length;
  };
  csvBtn.disabled = !lastTable || !lastTable.rows.length;
  reg.addEventListener('click', (e) => {
    const v = e.target.closest('[data-pos-view]');
    if (v) {
      PosKit.ui.view = v.dataset.posView;
      reg.querySelectorAll('[data-pos-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === v)));
      refresh();
      return;
    }
    if (e.target.closest('[data-pos-csv]') && lastTable) Exports.drillCSV(lastTable);
  });
  reg.querySelector('#pos-q').addEventListener('input', debounce((e) => {
    PosKit.ui.q = e.target.value;
    refresh();
  }, 150));
};
