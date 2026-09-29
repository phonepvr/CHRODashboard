/* Registry — Positions & Budget tab (R8, docs/PHASE8_PLAN.md). Access class 'org'.
   Sources: positions.csv (snapshot as of CONFIG.asOf — the period filter does not
   apply), hc_budget.csv (latest budget month on or before the as-of month),
   requisitions.csv (vacancy cover) and employee_master.csv (position-ID
   completeness). Scope = asset + business segment + function (Compute.orgMatch;
   a blank Function resolves through org_units.csv by Function Plant). Positions
   carry Level, not Grade Band, so the grade-band filter does not apply.
   Vacancy rate = Vacant ÷ (Filled + Vacant): Frozen / On Hold are counted
   separately. Row-level lists that name incumbents go through Access masking;
   position-only lists (vacancies) name no one.
   Shared script scope: every helper lives in PosKit. */

const PosKit = (() => {

  const AGED = 90;            // "vacant > 90 days" — same threshold as the TA worklist (D3)
  const CAP = 500;            // rows per drill-down (the CSV carries the same rows)
  const STATUS_RANK = { Vacant: 0, 'On Hold': 1, Frozen: 2, Filled: 3 };

  /* ---------- scope ---------- */

  // Function of a position / budget row; a blank one resolves via org_units by Function Plant
  const fnOf = (m, r) => r.function ?? Compute.orgOf(m, r.function_plant)?.function ?? null;
  const match = (m, ctx, r) =>
    Compute.orgMatch(ctx, r.function != null ? r : { asset: r.asset, __seg: r.__seg, function: fnOf(m, r) });

  // positions in scope — cached per model (a new model object on every data change)
  const cache = new WeakMap();
  function rows(m, ctx) {
    let byCtx = cache.get(m);
    if (!byCtx) { byCtx = new Map(); cache.set(m, byCtx); }
    const k = [ctx.asset, ctx.segment, ctx.fn].join('|');
    if (!byCtx.has(k)) byCtx.set(k, m.positionRows.filter((r) => match(m, ctx, r)));
    return byCtx.get(k);   // shared — never mutate; slice() before sorting
  }

  const isFilled = (r) => r.position_status === 'Filled';
  const isVacant = (r) => r.position_status === 'Vacant';
  const isHeld = (r) => r.position_status === 'Frozen' || r.position_status === 'On Hold';
  const isActive = (r) => isFilled(r) || isVacant(r);
  const ageOf = (r, ctx) => (r.vacant_since == null ? null : Math.max(0, ctx.asOfDay - r.vacant_since));
  const isAged = (r, ctx) => isVacant(r) && (ageOf(r, ctx) ?? -1) > AGED;

  function tally(list) {
    const t = { total: list.length, Filled: 0, Vacant: 0, 'On Hold': 0, Frozen: 0 };
    for (const r of list) if (r.position_status in STATUS_RANK) t[r.position_status]++;
    t.active = t.Filled + t.Vacant;
    t.rate = t.active ? t.Vacant / t.active * 100 : null;
    return t;
  }
  const stats = (m, ctx) => tally(rows(m, ctx));

  /* ---------- requisition cover ---------- */

  // 'open' | 'closed' (linked requisition closed or dropped) | 'unknown' (ID not in requisitions.csv) | 'none'
  function cover(m, r) {
    if (!r.requisition_id) return 'none';
    const q = m.reqById.get(r.requisition_id);
    if (!q) return 'unknown';
    return Compute.reqOpen(q) ? 'open' : 'closed';
  }
  const noOpenReq = (m, r) => isVacant(r) && cover(m, r) !== 'open';

  function reqText(m, r) {
    if (!r.requisition_id) return isFilled(r) ? '' : '(none)';
    const q = m.reqById.get(r.requisition_id);
    if (!q) return `${r.requisition_id} · not in requisitions.csv`;
    const st = Compute.reqOpen(q) ? (q.req_status || 'Open') : (q.req_status === 'Dropped' ? 'Dropped' : 'Closed');
    return `${r.requisition_id} · ${st}`;
  }

  /* ---------- budget ---------- */

  // hc_budget rows in scope for the latest Month on or before the as-of month
  function budget(m, ctx) {
    const inScope = m.hcBudget.filter((b) => b.month != null && b.month <= ctx.endMonth && match(m, ctx, b));
    let month = null;
    for (const b of inScope) if (month == null || b.month > month) month = b.month;
    const list = inScope.filter((b) => b.month === month);
    return { month, rows: list, total: list.reduce((s, b) => s + (b.budget_hc || 0), 0) };
  }

  // filled vs budget per key: [{key, budget, filled, nonBudgeted}] (budget null when no budget row)
  function budgetBy(m, ctx, keyPos, keyBud) {
    const acc = new Map();
    const at = (k) => { if (!acc.has(k)) acc.set(k, { key: k, budget: null, filled: 0, nonBudgeted: 0 }); return acc.get(k); };
    for (const b of budget(m, ctx).rows) { const a = at(keyBud(b) ?? '(blank)'); a.budget = (a.budget || 0) + (b.budget_hc || 0); }
    for (const r of rows(m, ctx)) {
      if (!isFilled(r)) continue;
      const a = at(keyPos(r) ?? '(blank)');
      a.filled++;
      if (r.budgeted_flag === false) a.nonBudgeted++;
    }
    return [...acc.values()];
  }

  /* ---------- cuts ---------- */

  // vacancy rate by a dimension (Compute.countBy): [{key, active, vacant, filled, rate}];
  // ordered by `order` when given, else by rate descending
  function vacancyBy(m, ctx, keyFn, order) {
    const act = rows(m, ctx).filter(isActive);
    const vac = new Map(Compute.countBy(act.filter(isVacant), keyFn).map((x) => [x.key, x.n]));
    const out = Compute.countBy(act, keyFn, order).map(({ key, n }) => {
      const v = vac.get(key) || 0;
      return { key, active: n, vacant: v, filled: n - v, rate: n ? v / n * 100 : null };
    });
    if (!order) out.sort((a, b) => b.rate - a.rate || b.active - a.active);
    return out;
  }

  // one barH item for a vacancy cut; a persona-restricted small base is withheld
  function cutItem(label, c, extra = {}) {
    if (Access.suppressed(c.active)) {
      return { label, value: null, sub: `${Access.cellText(c.active)} positions`, tip: `${label}: fewer than ${CONFIG.minCell} positions — withheld (small cell)`, ...extra };
    }
    return {
      label, value: c.rate, sub: `(${fmtInt(c.vacant)})`,
      tip: `${label}: ${fmtPct(c.rate, 1)} vacancy\n${fmtInt(c.vacant)} vacant · ${fmtInt(c.filled)} filled`, ...extra
    };
  }

  // vacancy ageing in the TA ageing buckets (D3), with the no-open-requisition share
  function ageing(m, ctx) {
    const out = CONFIG.taAgeingBuckets.map(([label, lo]) => ({ label, lo, n: 0, noReq: 0 }));
    const idx = new Map(out.map((b, i) => [b.label, i]));
    let undated = 0;
    for (const r of rows(m, ctx)) {
      if (!isVacant(r)) continue;
      const a = ageOf(r, ctx);
      if (a == null) { undated++; continue; }
      const b = out[idx.get(bucketOf(a, CONFIG.taAgeingBuckets))];
      if (!b) continue;
      b.n++;
      if (m.has('requisitions') && cover(m, r) !== 'open') b.noReq++;
    }
    return { buckets: out, undated };
  }

  /* ---------- row-level lists ---------- */

  const COLS = ['Position', 'Title', 'Asset', 'Function Plant', 'Level', 'Status', 'Budgeted', 'Critical', 'Vacant since', 'Days vacant', 'Requisition'];
  const COLS_INC = [...COLS, 'Incumbent'];
  const yn = (b) => (b == null ? '' : b ? 'Y' : 'N');
  // the Critical flag is talent-pool data (ACCESS_CLASSES.talent: CP): no column
  // for a persona that cannot see that class
  const showCP = () => Access.levelForClass(Access.persona(), 'talent') !== 'hidden';
  const colsFor = (withInc) => (withInc ? COLS_INC : COLS).filter((c) => c !== 'Critical' || showCP());

  function rowOf(m, ctx, r, withInc) {
    const age = isFilled(r) ? null : ageOf(r, ctx);
    const cells = [
      r.position_id ?? '(blank)', r.position_title || '', r.asset || '', r.function_plant || '', r.level || '',
      r.position_status || '(blank)', yn(r.budgeted_flag), ...(showCP() ? [yn(r.cp_flag)] : []),
      r.vacant_since == null || isFilled(r) ? '' : fmtDMY(r.vacant_since),
      age == null ? '' : { html: `<span class="pos-num${isVacant(r) && age > AGED ? ' pos-aged' : ''}">${fmtInt(age)}</span>` },
      reqText(m, r)
    ];
    // '' for non-filled rows and '(blank)' for a filled row without an ID are never pseudonymised
    if (withInc) cells.push(isFilled(r) ? (r.incumbent_id || '(blank)') : '');
    return cells;
  }

  // most urgent first: Vacant → On Hold → Frozen → Filled, then oldest vacancy, then ID
  const urgency = (ctx) => (a, b) =>
    (STATUS_RANK[a.position_status] ?? 9) - (STATUS_RANK[b.position_status] ?? 9) ||
    (ageOf(b, ctx) ?? -1) - (ageOf(a, ctx) ?? -1) ||
    String(a.position_id).localeCompare(String(b.position_id));

  // a position list for a drill-down; `withInc` adds the Incumbent column (masked /
  // withheld by Access.maskDrill for personas below 'identified')
  function listDrill(m, ctx, title, list, withInc) {
    const sorted = list.slice().sort(urgency(ctx));
    const more = sorted.length > CAP ? ` — first ${fmtInt(CAP)} shown` : '';
    return {
      title: `${title} (${fmtInt(list.length)})${more}`,
      columns: colsFor(withInc),
      rows: sorted.slice(0, CAP).map((r) => rowOf(m, ctx, r, withInc))
    };
  }

  // assets a table or chart may show for this persona and context
  const assetsFor = (ctx) => Access.chartScopes().filter((a) => a !== 'Group' && Compute.inAsset(ctx, a));
  const pctCell = (v, n) => (Access.suppressed(n) ? `<${CONFIG.minCell}` : v == null ? '—' : fmtPct(v, 1));

  function drillByAssetStatus(m, ctx) {
    const line = (label, t) => [label, fmtInt(t.Filled), fmtInt(t.Vacant), fmtInt(t['On Hold']), fmtInt(t.Frozen), fmtInt(t.total), pctCell(t.rate, t.active)];
    const out = assetsFor(ctx).map((a) => line(a, stats(m, { ...ctx, asset: a })));
    out.push(line('Total (scope)', stats(m, ctx)));
    return { title: 'Positions by asset and status', columns: ['Asset', 'Filled', 'Vacant', 'On Hold', 'Frozen', 'Total', 'Vacancy %'], rows: out };
  }

  function drillByAssetFunction(m, ctx) {
    const out = [];
    for (const a of assetsFor(ctx)) {
      for (const c of vacancyBy(m, { ...ctx, asset: a }, (r) => fnOf(m, r))) {
        out.push([a, c.key, Access.cellText(c.filled), Access.cellText(c.vacant), pctCell(c.rate, c.active)]);
      }
    }
    return { title: 'Vacancy rate by asset and function', columns: ['Asset', 'Function', 'Filled', 'Vacant', 'Vacancy %'], rows: out };
  }

  function drillBudget(m, ctx) {
    const b = budget(m, ctx);
    const key = (asset, fn, plant) => [asset, fn ?? '(blank)', plant ?? '(blank)'].join('\u0001');
    const list = budgetBy(m, ctx, (r) => key(r.asset, fnOf(m, r), r.function_plant), (x) => key(x.asset, fnOf(m, x), x.function_plant));
    const rank = new Map(CONFIG.assets.map((a, i) => [a, i]));
    const parts = (k) => k.split('\u0001');
    list.sort((x, y) => {
      const [a1, f1, p1] = parts(x.key), [a2, f2, p2] = parts(y.key);
      return (rank.get(a1) ?? 9) - (rank.get(a2) ?? 9) || f1.localeCompare(f2) || p1.localeCompare(p2);
    });
    const rowsOut = list.slice(0, CAP).map((x) => {
      const [a, f, p] = parts(x.key);
      const gap = x.budget == null ? null : x.filled - x.budget;
      return [a, f, p, x.budget == null ? '(no budget row)' : fmtInt(x.budget), Access.cellText(x.filled),
        gap == null ? '—' : (gap > 0 ? '+' : '') + fmtInt(gap), x.budget ? pctCell(x.filled / x.budget * 100, x.filled) : '—'];
    });
    return {
      title: `Filled positions vs HC budget by unit — budget month ${b.month == null ? '—' : monthIdxToLabel(b.month)}${list.length > CAP ? ` — first ${fmtInt(CAP)} of ${fmtInt(list.length)} shown` : ''}`,
      columns: ['Asset', 'Function', 'Function Plant', 'Budget', 'Filled', 'Filled − budget', 'Filled % of budget'],
      rows: rowsOut
    };
  }

  /* ---------- position-ID completeness (employee master) ---------- */

  const idCache = new WeakMap();
  function positionIds(m) {
    if (!idCache.has(m)) idCache.set(m, new Set(m.positionRows.map((r) => r.position_id).filter((v) => v != null)));
    return idCache.get(m);
  }
  // active permanent employees not tied to any position. The grade-band filter is
  // not applied: the tab is position-keyed and the band selector is disabled on it.
  function unpositioned(m, ctx) {
    const ids = positionIds(m);
    return Compute.actives(m, { ...ctx, band: 'All' }, 'Permanent').filter((e) => !e.position_id || !ids.has(e.position_id));
  }

  /* ---------- paired bars: HC budget vs filled positions (one axis, direct-labelled) ---------- */

  function pairBars(items) {
    const w = 640, rowH = 34, padT = 20, padL = 120, padR = 160;
    const vals = items.flatMap((i) => [i.budget, i.filled]).filter((v) => v != null && isFinite(v));
    if (!vals.length) return '<div class="chart-empty">No data for this chart.</div>';
    const height = padT + items.length * rowH + 4;
    const max = Math.max(...vals, 1);
    const iw = w - padL - padR;
    const X = (v) => Math.max(0, (v || 0) / max * iw);
    const legend = `<g class="pos-legend" aria-hidden="true">
        <rect x="${padL}" y="4" width="10" height="8" fill="var(--ink-20)"/><text x="${padL + 14}" y="11.5" class="ax">HC budget</text>
        <rect x="${padL + 80}" y="3" width="10" height="10" fill="var(--ink-80)"/><text x="${padL + 94}" y="11.5" class="ax">Filled positions</text>
      </g>`;
    const bars = items.map((it, r) => {
      const y = padT + r * rowH;
      const bw = X(it.budget), fw = X(it.filled);
      const fill = it.role === 'focus' ? 'var(--red)' : 'var(--ink-80)';
      const pct = it.budget ? ` · ${fmtPct(it.filled / it.budget * 100, 1)}` : '';
      const attrs = [
        it.tip ? `data-tip="${esc(it.tip)}"` : '',
        it.setAsset ? `data-setasset="${esc(it.setAsset)}" style="cursor:pointer"` : ''
      ].join(' ');
      return `<g ${attrs}>
        <rect x="0" y="${y}" width="${w}" height="${rowH}" fill="transparent"/>
        <text x="${padL - 8}" y="${y + rowH / 2 + 3.5}" text-anchor="end" class="bar-label">${esc(it.label)}</text>
        <rect x="${padL}" y="${y + 5}" width="${bw.toFixed(1)}" height="9" fill="var(--ink-20)"/>
        <text x="${(padL + bw + 6).toFixed(1)}" y="${y + 13}" class="ax">${it.budget == null ? 'no budget row' : esc(fmtInt(it.budget)) + ' budget'}</text>
        <rect x="${padL}" y="${y + 17}" width="${fw.toFixed(1)}" height="12" fill="${fill}"/>
        <text x="${(padL + fw + 6).toFixed(1)}" y="${y + 27.5}" class="bar-value">${esc(fmtInt(it.filled))} filled<tspan class="ax">${esc(pct)}</tspan></text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${height}" role="img" preserveAspectRatio="xMidYMid meet"><title>HC budget vs filled positions</title>${legend}${bars}</svg>`;
  }

  // table view state for the position register (memory only, this session)
  const ui = { view: 'Vacant', q: '' };

  // registry input for positions.csv (canonical SCHEMAS column names)
  const input = (...cols) => ({ dataset: 'positions', columns: ['Position ID', 'Asset', 'Position Status', ...cols] });

  return {
    AGED, CAP, COLS, COLS_INC, colsFor, ui, input,
    fnOf, match, rows, stats, tally, isFilled, isVacant, isHeld, isActive, isAged, ageOf,
    cover, noOpenReq, reqText, budget, budgetBy, vacancyBy, cutItem, ageing,
    rowOf, urgency, listDrill, assetsFor, drillByAssetStatus, drillByAssetFunction, drillBudget,
    positionIds, unpositioned, pairBars
  };
})();

/* =================== Position inventory =================== */

defineMetric({
  key: 'pb_positions_total', label: 'Total positions', tab: 'positions', access: 'org',
  group: 'Position inventory', unit: '', decimals: 0, direction: null,
  formulaText: 'Rows in positions.csv in scope — every status (Filled, Vacant, On Hold, Frozen)\nSnapshot as of the as-of date: the period filter does not apply',
  inputs: [PosKit.input('Business Segment', 'Function', 'Function Plant')],
  caveat: 'Scope = asset, business segment and function; a blank Function resolves through org_units.csv by Function Plant. The drill-down is an aggregate (asset × status) — it names no one.',
  compute: (m, ctx) => PosKit.rows(m, ctx).length,
  quality: (m, ctx) => {
    const seen = new Set();
    let dup = 0;
    for (const r of PosKit.rows(m, ctx)) { if (seen.has(r.position_id)) dup++; else seen.add(r.position_id); }
    return dup ? `${fmtInt(dup)} duplicate Position ID row${dup === 1 ? '' : 's'} — each row is counted` : null;
  },
  drill: (m, ctx) => PosKit.drillByAssetStatus(m, ctx)
});

defineMetric({
  key: 'pb_filled', label: 'Filled positions', tab: 'positions', access: 'org',
  group: 'Position inventory', unit: '', decimals: 0, direction: null,
  formulaText: 'Positions with Position Status = Filled (count)',
  inputs: [PosKit.input('Incumbent Employee ID')],
  caveat: 'The drill-down lists incumbents: identifiers are pseudonymised for masked personas and withheld where the persona sees no row-level detail.',
  compute: (m, ctx) => PosKit.stats(m, ctx).Filled,
  quality: (m, ctx) => {
    const filled = PosKit.rows(m, ctx).filter(PosKit.isFilled);
    const noId = filled.filter((r) => !r.incumbent_id).length;
    const notes = [];
    if (noId) notes.push(`${fmtInt(noId)} filled position${noId === 1 ? ' has' : 's have'} no Incumbent Employee ID`);
    if (m.has('employee_master')) {
      const gone = filled.filter((r) => { if (!r.incumbent_id) return false; const e = m.empById.get(r.incumbent_id); return !e || e.__exitDay <= ctx.asOfDay; }).length;
      if (gone) notes.push(`${fmtInt(gone)} name an incumbent who is not active in employee_master.csv`);
    }
    return notes.length ? notes.join(' · ') : null;
  },
  drill: (m, ctx) => PosKit.listDrill(m, ctx, 'Filled positions', PosKit.rows(m, ctx).filter(PosKit.isFilled), true)
});

defineMetric({
  key: 'pb_vacant', label: 'Vacant positions', tab: 'positions', access: 'org',
  group: 'Position inventory', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Positions with Position Status = Vacant (count)',
  inputs: [PosKit.input('Vacant Since', 'Requisition ID')],
  compute: (m, ctx) => PosKit.stats(m, ctx).Vacant,
  drill: (m, ctx) => PosKit.listDrill(m, ctx, 'Vacant positions', PosKit.rows(m, ctx).filter(PosKit.isVacant), false)
});

defineMetric({
  key: 'pb_frozen_hold', label: 'Frozen / on hold', tab: 'positions', access: 'org',
  group: 'Position inventory', unit: '', decimals: 0, direction: null,
  formulaText: 'Positions with Position Status = Frozen or On Hold (count)\nReported apart from vacancies — neither is being filled',
  inputs: [PosKit.input()],
  caveat: 'On Hold = hiring paused on an approved position; Frozen = withdrawn from the fillable budget.',
  compute: (m, ctx) => { const t = PosKit.stats(m, ctx); return t.Frozen + t['On Hold']; },
  drill: (m, ctx) => PosKit.listDrill(m, ctx, 'Frozen and on-hold positions', PosKit.rows(m, ctx).filter(PosKit.isHeld), false)
});

defineMetric({
  key: 'pb_vacancy_pct', label: 'Vacancy rate', tab: 'positions', access: 'org',
  group: 'Position inventory', unit: '%', decimals: 1, direction: 'lower',
  formulaText: 'Vacant positions ÷ (Filled + Vacant positions) × 100\nFrozen and On Hold positions are left out of both terms',
  inputs: [PosKit.input('Function', 'Level')],
  caveat: 'A position-master rate: it can differ from “open requisitions ÷ headcount” when vacancies have no requisition (see Vacancy risk).',
  compute: (m, ctx) => PosKit.stats(m, ctx).rate,
  drill: (m, ctx) => PosKit.drillByAssetFunction(m, ctx)
});

/* =================== Vacancy risk =================== */

defineMetric({
  key: 'pb_vacant_90d', label: 'Vacant > 90 days', tab: 'positions', access: 'org',
  group: 'Vacancy risk', unit: '', decimals: 0, direction: 'lower',
  formulaText: `Vacant positions with (as-of date − Vacant Since) > ${PosKit.AGED} days (count)\nVacant rows without a Vacant Since date are left out and flagged`,
  inputs: [PosKit.input('Vacant Since')],
  caveat: 'Same >90-day threshold as the TA requisition worklist; ageing buckets follow the TA buckets (0–30 … 365+ days).',
  compute: (m, ctx) => PosKit.rows(m, ctx).filter((r) => PosKit.isAged(r, ctx)).length,
  quality: (m, ctx) => {
    const n = PosKit.rows(m, ctx).filter((r) => PosKit.isVacant(r) && r.vacant_since == null).length;
    return n ? `${fmtInt(n)} vacant position${n === 1 ? ' has' : 's have'} no Vacant Since date — not aged` : null;
  },
  drill: (m, ctx) => PosKit.listDrill(m, ctx, `Positions vacant > ${PosKit.AGED} days`, PosKit.rows(m, ctx).filter((r) => PosKit.isAged(r, ctx)), false)
});

defineMetric({
  key: 'pb_vacant_no_req', label: 'Vacant without open requisition', tab: 'positions', access: 'org',
  group: 'Vacancy risk', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Vacant positions with no open requisition (count)\n= Requisition ID blank, not found in requisitions.csv, or linked to a requisition\n  that has a Closed Date or Req Status Dropped / Closed',
  inputs: [PosKit.input('Requisition ID'),
           { dataset: 'requisitions', columns: ['Requisition ID', 'Closed Date', 'Req Status'] }],
  caveat: 'Vacancies nobody is recruiting for — either raise a requisition or review whether the position is still needed.',
  compute: (m, ctx) => PosKit.rows(m, ctx).filter((r) => PosKit.noOpenReq(m, r)).length,
  quality: (m, ctx) => {
    const vac = PosKit.rows(m, ctx).filter(PosKit.isVacant);
    const unknown = vac.filter((r) => PosKit.cover(m, r) === 'unknown').length;
    const closed = vac.filter((r) => PosKit.cover(m, r) === 'closed').length;
    const notes = [];
    if (unknown) notes.push(`${fmtInt(unknown)} vacanc${unknown === 1 ? 'y references' : 'ies reference'} a Requisition ID not in requisitions.csv`);
    if (closed) notes.push(`${fmtInt(closed)} point${closed === 1 ? 's' : ''} to a closed or dropped requisition`);
    return notes.length ? notes.join(' · ') : null;
  },
  drill: (m, ctx) => PosKit.listDrill(m, ctx, 'Vacant positions without an open requisition', PosKit.rows(m, ctx).filter((r) => PosKit.noOpenReq(m, r)), false)
});

defineMetric({
  key: 'pb_cp_vacant', label: 'Critical positions vacant', tab: 'positions', access: 'talent',
  group: 'Vacancy risk', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Positions with Critical Position Flag = Y and Position Status = Vacant (count)',
  inputs: [PosKit.input('Critical Position Flag', 'Vacant Since')],
  caveat: 'From the position master’s own flag — independent of succession.csv (the Talent tab’s critical-position metrics). Critical positions are talent-pool data: personas without that class see neither this count nor the register’s Critical column.',
  compute: (m, ctx) => PosKit.rows(m, ctx).filter((r) => r.cp_flag && PosKit.isVacant(r)).length,
  drill: (m, ctx) => {
    const cp = PosKit.rows(m, ctx).filter((r) => r.cp_flag);
    return PosKit.listDrill(m, ctx, `Critical positions vacant — of ${fmtInt(cp.length)} critical positions`, cp.filter(PosKit.isVacant), false);
  }
});

/* =================== Budget =================== */

defineMetric({
  key: 'pb_budgeted_unfilled', label: 'Budgeted but unfilled', tab: 'positions', access: 'org',
  group: 'Budget', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Positions with Budgeted Flag = Y and Position Status = Vacant or On Hold (count)\nFrozen positions are left out — a freeze takes the position out of the fillable budget',
  inputs: [PosKit.input('Budgeted Flag')],
  caveat: 'Approved headroom not yet converted into hires: the position-level view of the HC budget gap.',
  compute: (m, ctx) => PosKit.rows(m, ctx).filter((r) => r.budgeted_flag && (PosKit.isVacant(r) || r.position_status === 'On Hold')).length,
  drill: (m, ctx) => PosKit.listDrill(m, ctx, 'Budgeted positions not filled',
    PosKit.rows(m, ctx).filter((r) => r.budgeted_flag && (PosKit.isVacant(r) || r.position_status === 'On Hold')), false)
});

defineMetric({
  key: 'pb_budget_fill_pct', label: 'Filled vs HC budget', tab: 'positions', access: 'org',
  group: 'Budget', unit: '%', decimals: 1, direction: null,
  formulaText: 'Filled positions ÷ Σ Budget Headcount × 100\nBudget = hc_budget.csv rows in scope for the latest Month on or before the as-of month',
  inputs: [PosKit.input(),
           { dataset: 'hc_budget', columns: ['Month', 'Asset', 'Function', 'Function Plant', 'Budget Headcount'] }],
  caveat: 'Above 100% = more positions filled than budgeted (filled positions outside the budget are counted). Level-split budget rows are summed as loaded — load either a split or a whole-unit file, not both.',
  compute: (m, ctx) => {
    const b = PosKit.budget(m, ctx);
    return b.total ? PosKit.stats(m, ctx).Filled / b.total * 100 : null;
  },
  quality: (m, ctx) => {
    const b = PosKit.budget(m, ctx);
    if (b.month == null) return 'No hc_budget.csv rows in scope on or before the as-of month';
    return b.month < ctx.endMonth ? `Latest budget month in scope is ${monthIdxToLabel(b.month)} — before the as-of month` : null;
  },
  drill: (m, ctx) => PosKit.drillBudget(m, ctx)
});

/* =================== Position register (data quality) =================== */

defineMetric({
  key: 'pb_no_position_id', label: 'Incumbents without position ID', tab: 'positions', access: 'org',
  group: 'Position register', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Active permanent employees whose Position ID is blank\nor not found in positions.csv (count)\nGrade-band filter not applied — this tab is position-keyed',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Position ID', 'Employee Class', 'Date of Joining'] },
           { dataset: 'positions', columns: ['Position ID'] }],
  caveat: 'A data-quality count: these people cannot be tied to a budgeted position, so position-based vacancy and budget figures miss them. The drill-down lists the employees to fix in the HRMS.',
  compute: (m, ctx) => PosKit.unpositioned(m, ctx).length,
  drill: (m, ctx) => {
    const ids = PosKit.positionIds(m);
    const list = PosKit.unpositioned(m, ctx).slice().sort((a, b) => String(a.employee_id).localeCompare(String(b.employee_id)));
    return {
      title: `Active employees without a valid position ID (${fmtInt(list.length)})${list.length > PosKit.CAP ? ` — first ${fmtInt(PosKit.CAP)} shown` : ''}`,
      columns: ['Employee', 'Name', 'Asset', 'Function', 'Function Plant', 'Level', 'Position ID in master'],
      rows: list.slice(0, PosKit.CAP).map((e) => [e.employee_id, e.name || '', e.asset, e.function || '', e.function_plant || '', e.level || '',
        !e.position_id ? '(blank)' : ids.has(e.position_id) ? e.position_id : `${e.position_id} (not in positions.csv)`])
    };
  }
});
