/* Registry — Contract & Compliance additions (Phase 8 · SSC incorporation, D10).
   - Statutory register (statutory_compliance.csv): asset-level remittances,
     returns and licence renewals. DUE-DATE BASIS — an item belongs to the period
     its Due Date falls in (period start → as-of); an item not yet due is never
     a miss; "pending past due" is a STOCK at the as-of date (any month), not a
     period flow. Status is trusted; dates that disagree with it are flagged.
   - Manning mix: contract headcount [SCRUM] ÷ permanent on-roll [HRMS], both
     sides at the same asset and business segment (grade band not applied).
   - Contract-labour cost per man-day present [SCRUM] (access class 'cost').
   Statutory items are not people, so their counts carry no small-cell rule; the
   on-roll headcounts behind the ratio are people and use Access.cellText.
   ONE shared global scope: every helper lives in CompKit. */

const CompKit = (() => {

  const SRC_STAT = SCHEMAS.statutory_compliance.source;   // Aparajita
  const SRC_CL = SCHEMAS.contract_attendance.source;      // SCRUM
  const src = (id) => '[' + SCHEMAS[id].source + ']';

  /* ---------- statutory register ---------- */

  const periodFrom = (ctx) => monthEndDay(ctx.startMonth - 1) + 1;
  const scoped = (m, ctx) => m.statutory.filter((r) => Compute.panelMatch(ctx, r));
  const applicable = (r) => r.status != null && r.status !== 'Not applicable' && r.due_date != null;
  // open past due at `day`: Status Pending (or completed only after `day`) and due before it
  const openAt = (r, day) => applicable(r) && r.due_date < day &&
    (r.status === 'Pending' || (r.completed_date != null && r.completed_date > day));
  // counts towards on-time %: completed (on time / late) or already past due
  const counted = (r, day) => applicable(r) && (r.status === 'On time' || r.status === 'Late' || openAt(r, day));

  // items falling due in [from, to] (default: the period window) that count
  function dueRows(m, ctx, from = periodFrom(ctx), to = ctx.asOfDay) {
    return scoped(m, ctx).filter((r) => r.due_date >= from && r.due_date <= to && counted(r, ctx.asOfDay));
  }

  function tally(rows, day) {
    const t = { n: 0, onTime: 0, late: 0, open: 0 };
    for (const r of rows) {
      t.n++;
      if (r.status === 'On time') t.onTime++;
      else if (r.status === 'Late') t.late++;
      else if (openAt(r, day)) t.open++;
    }
    t.pct = t.n ? t.onTime / t.n * 100 : null;
    return t;
  }

  const has = (m) => m.has('statutory_compliance');
  const onTimePct = (m, ctx) => (has(m) ? tally(dueRows(m, ctx), ctx.asOfDay).pct : null);
  const lateRows = (m, ctx) => dueRows(m, ctx).filter((r) => r.status === 'Late');
  const overdueRows = (m, ctx) => scoped(m, ctx).filter((r) => openAt(r, ctx.asOfDay))
    .sort((a, b) => a.due_date - b.due_date);
  const daysPastDue = (r, ctx) => ctx.asOfDay - r.due_date;

  // due months (month index) that carry register rows in scope, clipped to the history window
  function dueMonths(m, ctx) {
    let lo = Infinity;
    for (const r of scoped(m, ctx)) if (applicable(r)) lo = Math.min(lo, dayToMonthIdx(r.due_date));
    const out = [];
    for (let mi = Math.max(lo, ctx.histStart); mi <= ctx.endMonth; mi++) out.push(mi);
    return out;
  }
  function monthTally(m, ctx, mi) {
    const from = monthEndDay(mi - 1) + 1, to = Math.min(monthEndDay(mi), ctx.asOfDay);
    return tally(dueRows(m, ctx, from, to), ctx.asOfDay);
  }

  const itemOf = (r) => r.compliance_item || '(blank)';
  // items in register order: most rows first (monthly before periodic), then by name
  function itemOrder(rows) {
    return Compute.countBy(rows, itemOf)
      .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((x) => x.key);
  }

  // Status vs dates — flagged, never silently re-classified
  function statusQuality(m, ctx) {
    let bad = 0;
    for (const r of scoped(m, ctx)) {
      const c = r.completed_date, d = r.due_date;
      if (d == null) continue;
      if ((r.status === 'On time' && c != null && c > d) || (r.status === 'Late' && c != null && c <= d) ||
          (r.status === 'Pending' && c != null)) bad++;
    }
    return bad ? `${fmtInt(bad)} statutory ${bad === 1 ? 'row carries' : 'rows carry'} a Status that disagrees with their Due / Completed dates — Status is used as given` : null;
  }

  /* ---------- manning mix ---------- */

  const allBands = (ctx) => (ctx.band === 'All' ? ctx : { ...ctx, band: 'All' });

  function contractHcIn(m, ctx, mi) {
    let n = 0, rows = 0;
    for (const r of m.cAtt) if (r.month === mi && Compute.panelMatch(ctx, r)) { n += r.contract_headcount || 0; rows++; }
    return rows ? n : null;
  }

  // {month, contract, onroll, ratio} at the latest contract month in scope
  function mix(m, ctx) {
    if (!m.has('contract_attendance') || !m.has('employee_master')) return null;
    const month = Compute.latestPanelMonth(m.cAtt, ctx);
    if (month == null) return null;
    const contract = contractHcIn(m, ctx, month);
    const day = Math.min(ctx.asOfDay, monthEndDay(month));
    const onroll = Compute.activesAt(m, allBands(ctx), 'Permanent', day).length;
    return { month, contract, onroll, ratio: onroll && contract != null ? contract / onroll : null };
  }

  function ratioAt(m, ctx, mi) {
    const contract = contractHcIn(m, ctx, mi);
    if (contract == null) return null;
    const onroll = Compute.activesAt(m, allBands(ctx), 'Permanent', Math.min(ctx.asOfDay, monthEndDay(mi))).length;
    return onroll ? contract / onroll : null;
  }

  /* ---------- contract-labour cost ---------- */

  const costRows = (rows) => rows.filter((r) => r.contract_cost != null && r.mandays_present > 0);
  function perManday(rows) {
    const r = costRows(rows);
    const md = r.reduce((s, x) => s + x.mandays_present, 0);
    return md ? r.reduce((s, x) => s + x.contract_cost, 0) / md : null;
  }
  const costPerManday = (m, ctx) => perManday(Compute.panelRowsInPeriod(m.cAtt, ctx));
  function costTotal(m, ctx) {
    const r = Compute.panelRowsInPeriod(m.cAtt, ctx).filter((x) => x.contract_cost != null);
    return r.length ? r.reduce((s, x) => s + x.contract_cost, 0) : null;
  }
  const costAt = (m, ctx, mi) => perManday(m.cAtt.filter((r) => r.month === mi && Compute.panelMatch(ctx, r)));
  // contractor × asset over the period, highest cost per manday first
  function byContractor(m, ctx) {
    const g = new Map();
    for (const r of costRows(Compute.panelRowsInPeriod(m.cAtt, ctx))) {
      const k = r.contractor + '|' + r.asset;
      if (!g.has(k)) g.set(k, { contractor: r.contractor, asset: r.asset, seg: Compute.segOf(r), md: 0, cost: 0 });
      const x = g.get(k);
      x.md += r.mandays_present; x.cost += r.contract_cost;
    }
    return [...g.values()].map((x) => ({ ...x, cpm: x.cost / x.md })).sort((a, b) => b.cpm - a.cpm);
  }
  function blankCostNote(m, ctx) {
    const rows = Compute.panelRowsInPeriod(m.cAtt, ctx);
    if (!rows.length) return null;
    const blank = rows.filter((r) => r.contract_cost == null).length;
    return blank ? `${fmtPct(blank / rows.length * 100, 0)} of contractor-months in the period have no Contract Labour Cost — excluded from cost and man-days alike` : null;
  }

  /* ---------- per-scope chart helpers (persona scopes only) ---------- */

  const assetScopes = () => Access.chartScopes().filter((s) => s !== 'Group');

  function scopeLines(ctx, months, valueAt /* (scope, mi) */) {
    const scopes = Access.chartScopes();
    let t = 0;
    const series = assetScopes().map((a) => ({
      label: a, role: a === ctx.asset ? 'focus' : (t++ % 2 === 0 ? 'ctx1' : 'ctx2'),
      values: months.map((mi) => valueAt(a, mi))
    }));
    if (scopes.includes('Group')) {
      series.push({ label: 'Group', role: ctx.asset === 'Group' ? 'focus' : 'group', values: months.map((mi) => valueAt('Group', mi)) });
    }
    return series;
  }

  function scopeBars(ctx, valueOf /* scope -> {value, sub, tip} */) {
    const locked = !!Access.lockedAsset();
    return Access.chartScopes().map((s) => {
      const v = valueOf(s);
      return {
        label: s, value: v.value, sub: v.sub, role: s === ctx.asset ? 'focus' : undefined,
        tip: v.tip + (locked ? (s === 'Group' ? '\nGroup (benchmark)' : '') : s === 'Group' ? '\nClick to reset focus' : '\nClick to focus ' + s),
        setAsset: locked ? null : s
      };
    });
  }

  return {
    SRC_STAT, SRC_CL, src,
    periodFrom, scoped, applicable, openAt, counted, dueRows, tally, onTimePct, lateRows, overdueRows,
    daysPastDue, dueMonths, monthTally, itemOf, itemOrder, statusQuality,
    allBands, contractHcIn, mix, ratioAt,
    perManday, costPerManday, costTotal, costAt, byContractor, blankCostNote,
    assetScopes, scopeLines, scopeBars
  };
})();

/* =================== Deployment — manning mix [SCRUM ÷ HRMS] =================== */

defineMetric({
  key: 'contract_onroll_ratio', label: 'Contract-to-on-roll ratio', tab: 'contract', access: 'ops',
  group: 'Deployment', unit: '', decimals: 2, direction: null, source: CompKit.SRC_CL,
  formulaText: 'Σ Contract Headcount across contractors (latest month in scope)\n÷ active permanent employees at that month end\n(both sides at the same asset and business segment; the grade-band filter does not apply)',
  inputs: [{ dataset: 'contract_attendance', columns: ['Contractor', 'Asset', 'Month', 'Contract Headcount'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Employee Class', 'Date of Joining'] }],
  caveat: 'Manning mix, not a target: a high ratio means more of the work is done by contract labour. Numerator from contract_attendance.csv [SCRUM], denominator from employee_master.csv [HRMS]; trainees are not in either side.',
  compute: (m, ctx) => CompKit.mix(m, ctx)?.ratio ?? null,
  spark: (m, ctx) => {
    const months = ChartData.monthsAxis(ctx);
    return months.map((mi) => CompKit.ratioAt(m, ctx, mi));
  },
  drill: (m, ctx) => {
    const rows = [];
    const scopes = Access.chartScopes().filter((s) => s !== 'Group' && Compute.inAsset(ctx, s));
    const segs = [...CONFIG.segments, 'Unassigned'];
    const line = (asset, seg, c) => {
      const x = CompKit.mix(m, c);
      if (!x || (!x.contract && !x.onroll)) return;
      rows.push([asset, seg, monthIdxToLabel(x.month), fmtInt(x.contract), Access.cellText(x.onroll),
        Access.suppressed(x.onroll) ? '—' : x.ratio == null ? '—' : fmtNum(x.ratio, 2)]);
    };
    for (const a of scopes) {
      if (!Compute.inSeg(ctx, null)) { line(a, ctx.segment, { ...ctx, asset: a }); continue; }
      line(a, 'All', { ...ctx, asset: a });
      for (const s of segs) line(a, s, { ...ctx, asset: a, segment: s });
    }
    return {
      title: 'Contract-to-on-roll ratio by asset and business segment',
      columns: ['Asset', 'Business segment', 'Contract month', 'Contract HC', 'On-roll HC', 'Ratio'],
      rows
    };
  }
});

/* =================== Contract labour cost [SCRUM] =================== */

defineMetric({
  key: 'contract_cost_per_manday', label: 'Contract labour cost per manday (₹)', tab: 'contract', access: 'cost',
  group: 'Contract labour cost', unit: '', decimals: 0, direction: 'lower', source: CompKit.SRC_CL,
  formulaText: 'Σ Contract Labour Cost ÷ Σ Man-days Present over the period\n(contractor-months that report a cost and man-days present > 0)',
  inputs: [{ dataset: 'contract_attendance', columns: ['Contractor', 'Asset', 'Month', 'Man-days Present', 'Contract Labour Cost'] }],
  caveat: 'Lower is cheaper, not automatically better — rates must stay at or above the statutory minimum wage; read it beside wage-payment timeliness. Invoiced cost as recorded; GST treatment follows the source.',
  compute: (m, ctx) => CompKit.costPerManday(m, ctx),
  spark: (m, ctx) => ChartData.monthsAxis(ctx).map((mi) => CompKit.costAt(m, ctx, mi)),
  quality: (m, ctx) => CompKit.blankCostNote(m, ctx),
  drill: (m, ctx) => {
    const rows = CompKit.byContractor(m, ctx);
    return {
      title: `Contract labour cost per manday by contractor — ${monthIdxToLabel(ctx.startMonth)} to ${monthIdxToLabel(ctx.endMonth)}`,
      columns: ['Contractor', 'Asset', 'Business segment', 'Man-days present', 'Contract labour cost', 'Cost per manday (₹)'],
      rows: rows.map((x) => [x.contractor, x.asset, x.seg, fmtInt(x.md), fmtINR(x.cost), fmtInt(x.cpm)])
    };
  }
});

defineMetric({
  key: 'contract_cost_total', label: 'Contract labour cost (period)', tab: 'contract', access: 'cost',
  group: 'Contract labour cost', unit: '₹', decimals: 0, direction: null, source: CompKit.SRC_CL,
  formulaText: 'Σ Contract Labour Cost across contractor-months in the period',
  inputs: [{ dataset: 'contract_attendance', columns: ['Contractor', 'Asset', 'Month', 'Contract Labour Cost'] }],
  caveat: 'Invoiced contract-labour cost only — not the permanent employee cost on the Overview.',
  compute: (m, ctx) => CompKit.costTotal(m, ctx),
  quality: (m, ctx) => CompKit.blankCostNote(m, ctx),
  drill: (m, ctx) => {
    const rows = [];
    for (const a of Access.chartScopes().filter((s) => s !== 'Group' && Compute.inAsset(ctx, s))) {
      const c = { ...ctx, asset: a };
      const t = CompKit.costTotal(m, c);
      if (t == null) continue;
      const md = Compute.panelRowsInPeriod(m.cAtt, c).filter((r) => r.contract_cost != null).reduce((s, r) => s + (r.mandays_present || 0), 0);
      rows.push([a, fmtINR(t), fmtInt(md), CompKit.costPerManday(m, c) == null ? '—' : fmtInt(CompKit.costPerManday(m, c))]);
    }
    return { title: 'Contract labour cost by asset — period', columns: ['Asset', 'Contract labour cost', 'Man-days present', 'Cost per manday (₹)'], rows };
  }
});

/* =================== Statutory register [Aparajita] =================== */

defineMetric({
  key: 'stat_ontime_pct', label: 'Statutory items on time', tab: 'contract', access: 'ops',
  group: 'Statutory register', unit: '%', decimals: 1, direction: 'higher', scorecard: 'HR Operations', source: CompKit.SRC_STAT,
  formulaText: 'Items with Status = On time ÷ applicable items falling due in the period × 100\napplicable = Status ≠ Not applicable, Due Date from period start to the as-of date,\nand completed (On time / Late) or still pending past its due date\n(items pending but not yet due are excluded — they cannot be late yet)',
  inputs: [{ dataset: 'statutory_compliance', columns: ['Asset', 'Month', 'Compliance Item', 'Due Date', 'Completed Date', 'Status'] }],
  caveat: 'Due-date basis: an item belongs to the period its due date falls in, whatever its compliance month. Every item counts once — a PF remittance and a factory-licence renewal weigh the same.',
  compute: (m, ctx) => CompKit.onTimePct(m, ctx),
  quality: (m, ctx) => CompKit.statusQuality(m, ctx),
  spark: (m, ctx) => CompKit.dueMonths(m, ctx).map((mi) => CompKit.monthTally(m, ctx, mi).pct),
  drill: (m, ctx) => {
    const rows = CompKit.dueRows(m, ctx);
    return {
      title: `Statutory items by compliance item — due ${fmtDMY(CompKit.periodFrom(ctx))} to ${fmtDMY(ctx.asOfDay)}`,
      columns: ['Compliance item', 'Applicable', 'On time', 'Late', 'Pending past due', 'On-time %'],
      rows: CompKit.itemOrder(rows).map((item) => {
        const t = CompKit.tally(rows.filter((r) => CompKit.itemOf(r) === item), ctx.asOfDay);
        return [item, fmtInt(t.n), fmtInt(t.onTime), fmtInt(t.late), fmtInt(t.open), fmtPct(t.pct, 1)];
      })
    };
  }
});

defineMetric({
  key: 'stat_late_items', label: 'Statutory items completed late', tab: 'contract', access: 'ops',
  group: 'Statutory register', unit: '', decimals: 0, direction: 'lower', source: CompKit.SRC_STAT,
  formulaText: 'Count of items with Status = Late whose Due Date falls in the period (period start → as-of)',
  inputs: [{ dataset: 'statutory_compliance', columns: ['Asset', 'Compliance Item', 'Due Date', 'Completed Date', 'Status'] }],
  caveat: 'Completed, but after the statutory due date — interest, penalty or prosecution exposure depends on the item.',
  compute: (m, ctx) => (m.has('statutory_compliance') ? CompKit.lateRows(m, ctx).length : null),
  spark: (m, ctx) => CompKit.dueMonths(m, ctx).map((mi) => CompKit.monthTally(m, ctx, mi).late),
  drill: (m, ctx) => {
    const rows = CompKit.lateRows(m, ctx).sort((a, b) => a.due_date - b.due_date);
    return {
      title: `Statutory items completed late — due in period (${rows.length})`,
      columns: ['Asset', 'Business segment', 'Compliance item', 'Month', 'Due date', 'Completed', 'Days late'],
      rows: rows.map((r) => [r.asset, Compute.segOf(r), r.compliance_item, r.month == null ? '—' : monthIdxToLabel(r.month),
        fmtDMY(r.due_date), fmtDMY(r.completed_date), r.completed_date == null ? '—' : fmtInt(r.completed_date - r.due_date)])
    };
  }
});

defineMetric({
  key: 'stat_pending_overdue', label: 'Pending items past due', tab: 'contract', access: 'ops',
  group: 'Statutory register', unit: '', decimals: 0, direction: 'lower', source: CompKit.SRC_STAT,
  formulaText: 'Count of applicable items with Status = Pending and Due Date before the as-of date\n(a stock at the as-of date — any compliance month, not only the period)',
  inputs: [{ dataset: 'statutory_compliance', columns: ['Asset', 'Month', 'Compliance Item', 'Due Date', 'Status'] }],
  caveat: 'The open worklist. Trend = the same count at each month end, rebuilt from due and completion dates.',
  compute: (m, ctx) => (m.has('statutory_compliance') ? CompKit.overdueRows(m, ctx).length : null),
  spark: (m, ctx) => CompKit.dueMonths(m, ctx).map((mi) => {
    const day = Math.min(ctx.asOfDay, monthEndDay(mi));
    return CompKit.scoped(m, ctx).filter((r) => CompKit.openAt(r, day)).length;
  }),
  drill: (m, ctx) => {
    const rows = CompKit.overdueRows(m, ctx);
    return {
      title: `Pending statutory items past due at ${fmtDMY(ctx.asOfDay)} (${rows.length})`,
      columns: ['Asset', 'Business segment', 'Compliance item', 'Month', 'Due date', 'Days past due'],
      rows: rows.map((r) => [r.asset, Compute.segOf(r), r.compliance_item, r.month == null ? '—' : monthIdxToLabel(r.month),
        fmtDMY(r.due_date), fmtInt(CompKit.daysPastDue(r, ctx))])
    };
  }
});

defineMetric({
  key: 'stat_overdue_age_avg', label: 'Average days past due (open items)', tab: 'contract', access: 'ops',
  group: 'Statutory register', unit: 'd', decimals: 0, direction: 'lower', source: CompKit.SRC_STAT,
  formulaText: 'Mean of (as-of date − Due Date) in days over the pending items past due',
  inputs: [{ dataset: 'statutory_compliance', columns: ['Asset', 'Compliance Item', 'Due Date', 'Status'] }],
  caveat: 'Blank when nothing is past due. The ageing chart shows the spread; one very old item moves the mean.',
  compute: (m, ctx) => {
    if (!m.has('statutory_compliance')) return null;
    const rows = CompKit.overdueRows(m, ctx);
    return rows.length ? mean(rows.map((r) => CompKit.daysPastDue(r, ctx))) : null;
  },
  drill: (m, ctx) => {
    const rows = CompKit.overdueRows(m, ctx);
    return {
      title: `Pending items past due by age — at ${fmtDMY(ctx.asOfDay)}`,
      columns: ['Days past due', 'Items', 'Oldest item'],
      rows: CONFIG.taAgeingBuckets.map(([label, lo, hi]) => {
        const b = rows.filter((r) => { const d = CompKit.daysPastDue(r, ctx); return d >= lo && d < hi; });
        return [label, fmtInt(b.length), b.length ? `${b[0].compliance_item} · ${b[0].asset}` : '—'];
      })
    };
  }
});
