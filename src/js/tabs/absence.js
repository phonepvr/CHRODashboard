/* Absenteeism tab (R9) — on-roll employees from absence_monthly.csv, joined to
   the employee master (asset / grade band / segment / function all apply).
   Day counts only: no leave reasons or medical data exist in the template and
   none is shown. The frequent-absence cohort is a COUNT ONLY — no chart, table
   or drill on this tab lists its members. Data helpers live in AbsKit
   (02r-reg-absence.js); shared tab helpers in tiles-tabs.js. */

TabRenderers.absence = (panel) => {
  const NEED = ['absence_monthly', 'employee_master'];
  const m = Compute.build(), ctx = Compute.ctxNow();
  const range = `${monthIdxToLabel(ctx.startMonth)} – ${monthIdxToLabel(ctx.endMonth)}`;
  const minCell = CONFIG.minCell;
  const target = Compute.metric('absenteeism_pct').target?.value ?? null;
  const pct1 = (v) => fmtPct(v, 1);

  renderTilesByGroup(panel, 'absence', {
    leadHTML: `<div class="empty-note abs-lead"><strong>On-roll employees · day counts only.</strong>
      absence_monthly.csv carries scheduled, present, planned-leave and unplanned-absence days per
      employee per month — no leave reasons, medical or sick-note data, and none is ever shown.
      The frequent-absence cohort is reported as a <strong>count only</strong>; this dashboard never
      lists its members. Drill-downs show per-employee day counts to identified personas and
      asset × function aggregates to masked personas.</div>`,
    groupSubs: {
      'Absence rates': `${range} · share of scheduled days · selected scope`,
      'Absence frequency': `spell = one separate unplanned-absence occurrence · cohort = ≥${AbsKit.FREQ_SPELLS} spells in the trailing ${AbsKit.TRAIL} months`
    },
    tailHTML: `
      <div class="section-head"><h2>Absenteeism by dimension</h2>
        <span class="sub">${esc(range)} · unplanned ÷ scheduled days · highest in red${Access.suppressionOn() ? ` · bases under ${minCell} employees suppressed` : ''}</span></div>
      <div class="card-grid abs-dims" id="abs-dims"></div>
      <div class="section-head"><h2>Days lost — asset × month</h2>
        <span class="sub">trailing 12 months · click an asset to focus it</span></div>
      <div class="card-grid abs-heat-grid" id="abs-heat"></div>`
  });

  const hasData = NEED.every((id) => App.state.datasets.has(id));
  const small = (n) => Access.suppressed(n);
  // one scan each, shared by every card below
  const periodRows = hasData ? AbsKit.rows(m, ctx) : [];
  const trailing = hasData ? AbsKit.trailingByScope(m, ctx) : new Map();

  /* ---------- Absence rates ---------- */

  function trendBody() {
    const months = AbsKit.dataMonths(m, ctx);
    if (months.length < 2) return '<div class="chart-empty">Series too short to draw — need at least two months of absence data.</div>';
    const gr = AbsKit.grid(m, ctx, months[0], months[months.length - 1]);
    const { series } = ChartData.assetLines({ ...ctx, histStart: months[0] }, (asset, mi) =>
      AbsKit.absPct(AbsKit.gridCell(gr, asset, mi)));
    return Charts.line({ months, series, yFmt: (v) => fmtPct(v, 1), target });
  }

  function compositionBody() {
    const t = AbsKit.tally(periodRows);
    if (!t.sched) return '<div class="chart-empty">No scheduled days in the period for this scope.</div>';
    const other = t.sched - t.present - t.planned - t.unplanned;
    const items = [
      { label: 'Unplanned absence', value: Math.round(t.unplanned) },
      { label: 'Planned leave', value: Math.round(t.planned) },
      { label: 'Present', value: Math.round(t.present) }
    ];
    if (Math.abs(other) / t.sched >= 0.005) items.push({ label: other > 0 ? 'Not reconciled' : 'Over-booked', value: Math.round(Math.abs(other)) });
    return Charts.donut({ items, centerLabel: 'scheduled days' });
  }

  fillSlot('absence', 'Absence rates', [
    Charts.card({
      title: 'Monthly absenteeism by asset', sub: 'unplanned ÷ scheduled days · selected asset in red, Group in black', infoKey: 'absenteeism_pct',
      body: needData(NEED, trendBody),
      note: target == null ? 'No absenteeism target loaded (targets.csv) — none is drawn.' : ''
    }),
    Charts.card({
      title: 'Where scheduled days went', sub: `${range} · selected scope · hover for days`, infoKey: 'abs_attendance_pct',
      body: needData(NEED, compositionBody)
    })
  ].join(''));

  /* ---------- Absence frequency (counts only) ---------- */

  const SPELL_BUCKETS = [['0 spells', 0, 1], ['1', 1, 2], ['2', 2, 3], ['3–4', 3, 5], ['5+', 5, Infinity]];

  function spellsBody() {
    const by = trailing.get(ctx.asset) || new Map();
    if (!by.size) return '<div class="chart-empty">No Absence Spells in the trailing window for this scope.</div>';
    const vals = [...by.values()];
    return Charts.barH({
      items: SPELL_BUCKETS.map(([label, lo, hi]) => {
        const n = vals.filter((v) => v >= lo && v < hi).length;
        const share = n / vals.length * 100;
        const cohort = lo >= AbsKit.FREQ_SPELLS;
        return {
          label, value: small(n) ? null : n, role: cohort ? 'focus' : undefined,
          sub: small(n) ? `<${minCell} — small cell` : pct1(share),
          tip: small(n) ? `${label}: fewer than ${minCell} employees (suppressed)`
            : `${label}: ${fmtInt(n)} employees (${pct1(share)})${cohort ? '\nIn the frequent-absence cohort' : ''}`
        };
      }),
      fmt: (v) => fmtInt(v)
    });
  }

  function cohortBody() {
    const locked = !!Access.lockedAsset();
    return Charts.barH({
      items: Access.chartScopes().map((a) => {
        // same rule as the abs_frequent_count tile, one pass for every scope
        const by = trailing.get(a);
        const { n, base } = by ? AbsKit.cohortOf(by) : { n: null, base: 0 };
        const hide = small(n);
        const v = hide ? null : n;
        return {
          label: a, value: v, role: a === ctx.asset ? 'focus' : undefined,
          sub: hide ? `<${minCell} — small cell` : v != null && base ? pct1(v / base * 100) : '',
          tip: hide ? `${a}: fewer than ${minCell} (suppressed)`
            : `${a}: ${v == null ? 'no data' : fmtInt(v) + ' employees'}${v != null && base ? ` — ${pct1(v / base * 100)} of ${fmtInt(base)} on file` : ''}${!locked && a !== 'Group' ? '\nClick to focus ' + a : ''}`,
          setAsset: locked ? null : a
        };
      }),
      fmt: (v) => fmtInt(v)
    });
  }

  fillSlot('absence', 'Absence frequency', [
    Charts.card({
      title: `Employees by absence spells — trailing ${AbsKit.TRAIL} months`, sub: `selected scope · red = frequent-absence cohort (≥${AbsKit.FREQ_SPELLS} spells)`, infoKey: 'abs_frequent_count',
      body: needData(NEED, spellsBody),
      note: 'Distribution of counts only — no individual appears on this tab.'
    }),
    Charts.card({
      title: 'Frequent-absence cohort by asset', sub: 'count · share of employees on file in the window · hover for the base', infoKey: 'abs_frequent_count',
      body: needData(NEED, cohortBody),
      note: 'Never a named list: who is in the cohort is not shown to any persona.'
    })
  ].join(''));

  /* ---------- by dimension ---------- */

  function dimBody(keyFn, order, labelOf) {
    const cuts = AbsKit.byDim(m, ctx, keyFn, order, periodRows).filter((c) => c.t.sched > 0);
    if (!cuts.length) return '<div class="chart-empty">No absence rows for this scope.</div>';
    const shown = cuts.filter((c) => !small(c.t.emps.size)).map((c) => AbsKit.absPct(c.t));
    const top = shown.length > 1 ? Math.max(...shown) : null;
    return Charts.barH({
      items: cuts.map((c) => {
        const n = c.t.emps.size, v = AbsKit.absPct(c.t), hide = small(n);
        const name = labelOf ? labelOf(c.key) : c.key;
        return {
          label: c.key, value: hide ? null : v, role: !hide && top != null && v === top ? 'focus' : undefined,
          sub: hide ? `<${minCell} emp. — suppressed` : '',
          tip: hide ? `${name}: fewer than ${minCell} employees (suppressed)`
            : `${name}: ${pct1(v)} absenteeism\n${fmtInt(c.t.unplanned)} unplanned of ${fmtInt(c.t.sched)} scheduled days · ${fmtInt(n)} employees`
        };
      }),
      fmt: pct1,
      target
    });
  }

  const avg = hasData ? AbsKit.absPct(AbsKit.tally(periodRows)) : null;
  const avgSub = avg == null ? 'hover a bar for its employee base' : `scope average ${pct1(avg)} · hover a bar for its employee base`;
  // long cuts pair up (function · level), short ones pair up (band · segment), so rows align
  panel.querySelector('#abs-dims').innerHTML = [
    Charts.card({ title: 'Absenteeism by function', sub: avgSub, infoKey: 'absenteeism_pct', body: needData(NEED, () => dimBody((e) => e.function)) }),
    Charts.card({ title: 'Absenteeism by level', sub: 'senior → junior · ' + avgSub, infoKey: 'absenteeism_pct', body: needData(NEED, () => dimBody((e) => e.level, CONFIG.levels)) }),
    Charts.card({
      title: 'Absenteeism by management band', sub: avgSub, infoKey: 'absenteeism_pct',
      body: needData(NEED, () => dimBody((e) => e.mgmt_band, CONFIG.mgmtBands, (k) => CONFIG.mgmtBandLabels[k] || k))
    }),
    Charts.card({
      title: 'Absenteeism by business segment', sub: avgSub, infoKey: 'absenteeism_pct',
      body: needData(NEED, () => dimBody((e) => Compute.segOf(e), [...CONFIG.segments, 'Unassigned']))
    })
  ].join('');

  /* ---------- heat table: days lost, asset × month ---------- */

  function heatBody() {
    const months = AbsKit.dataMonths(m, ctx, 12);
    if (!months.length) return '<div class="chart-empty">No absence months in the history window.</div>';
    const locked = !!Access.lockedAsset();
    const gr = AbsKit.grid(m, ctx, months[0], months[months.length - 1]);
    const grid = Access.chartScopes().map((a) => {
      const cells = months.map((mi) => {
        const t = AbsKit.gridCell(gr, a, mi);
        return { mi, t, n: t.emps.size, rate: AbsKit.absPct(t), hide: small(t.emps.size) };
      });
      return { a, cells, total: AbsKit.gridSum(gr, a, months) };
    });
    // shade = absenteeism %, 5 equal steps over the asset cells (Group excluded so it never sets the scale)
    const rates = grid.filter((g) => g.a !== 'Group' || grid.length === 1)
      .flatMap((g) => g.cells.filter((c) => !c.hide && c.rate != null).map((c) => c.rate));
    if (!rates.length) return '<div class="chart-empty">No scheduled days in the window for this scope.</div>';
    const lo = Math.min(...rates), hi = Math.max(...rates), STEPS = 5;
    const step = (hi - lo) / STEPS || 1;
    const bin = (r) => Math.min(STEPS - 1, Math.max(0, Math.floor((r - lo) / step)));
    const head = `<tr><th scope="col">Asset</th>${months.map((mi) => `<th scope="col" class="num">${esc(monthIdxToLabel(mi))}</th>`).join('')}
      <th scope="col" class="num abs-total">12-m days</th><th scope="col" class="num abs-total">Rate</th></tr>`;
    const body = grid.map((g) => {
      const focus = g.a === ctx.asset;
      const rowHead = locked
        ? `<th scope="row">${esc(g.a)}</th>`
        : `<th scope="row"><button type="button" class="abs-asset" data-setasset="${esc(g.a)}" data-tip="${esc(g.a === 'Group' ? 'Group (all assets)\nClick to reset focus' : 'Click to focus ' + g.a)}" aria-label="${esc(g.a === 'Group' ? 'Group — reset the asset focus' : 'Focus ' + g.a)}">${esc(g.a)}</button></th>`;
      const tds = g.cells.map((c) => {
        const where = `${g.a} · ${monthIdxToLabel(c.mi)}`;
        if (!c.t.rows) return `<td class="num abs-h-na" data-tip="${esc(where + '\nNo absence rows')}">—</td>`;
        if (c.hide) return `<td class="num abs-h-na" data-tip="${esc(`${where}\nFewer than ${minCell} employees — suppressed`)}">&lt;${minCell}</td>`;
        const cls = c.rate == null ? 'abs-h-na' : 'abs-h' + bin(c.rate);
        return `<td class="num ${cls}" data-tip="${esc(`${where}\n${fmtInt(c.t.unplanned)} days lost · ${pct1(c.rate)} absenteeism\n${fmtInt(c.n)} employees · ${fmtInt(c.t.sched)} scheduled days`)}">${fmtInt(c.t.unplanned)}</td>`;
      }).join('');
      const tHide = small(g.total.emps.size);
      return `<tr class="${focus ? 'abs-focus' : ''}${g.a === 'Group' ? ' abs-group' : ''}">${rowHead}${tds}
        <td class="num abs-total">${tHide ? `&lt;${minCell}` : fmtInt(g.total.unplanned)}</td>
        <td class="num abs-total">${tHide || AbsKit.absPct(g.total) == null ? '—' : pct1(AbsKit.absPct(g.total))}</td></tr>`;
    }).join('');
    const legend = Array.from({ length: STEPS }, (_, i) =>
      `<span class="abs-key"><span class="abs-sw abs-h${i}"></span>${esc(fmtNum(lo + i * step, 1))}–${esc(fmtPct(lo + (i + 1) * step, 1))}</span>`).join('');
    return `<div class="table-scroll"><table class="data-table abs-heat">
        <thead>${head}</thead><tbody>${body}</tbody></table></div>
      <div class="abs-legend" aria-label="Shade scale: absenteeism %"><span class="abs-legend-k">Shade = absenteeism %</span>${legend}</div>`;
  }

  panel.querySelector('#abs-heat').innerHTML = Charts.card({
    title: 'Days lost by asset and month',
    sub: 'cell = unplanned absence days · shade = absenteeism % (days lost ÷ scheduled days) · hover for detail',
    infoKey: 'abs_days_lost',
    body: needData(NEED, heatBody),
    note: 'Days scale with headcount — compare assets on the shade (rate), not the raw number.'
  });
};
