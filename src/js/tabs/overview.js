/* Overview tab — one page in six sections:
   Executive summary (rule-based band) · Headline KPIs · Employee demographics
   (R1: KPI strip A–D, 13-month trend, headcount by company / asset / segment /
   function / function plant / management band / level, superannuation, gender,
   R1a state-wise domicile, the permanent-roll distributions, employee details)
   · Budget vs actual (R1b expandable matrix) · Productivity, Cost & Safety ·
   Trends. Helpers, chart primitives and the tree/table widgets live in
   DemoKit (src/js/02j-reg-demographics.js). */

TabRenderers.overview = (panel) => {
  const entries = REGISTRY.filter((e) => e.tab === 'overview');
  const tiles = (g) => entries.filter((e) => e.group === g).map((e) => UI.tileHTML(e.key)).join('');
  const KNOWN = ['Workforce', 'Employee demographics', 'Budget vs actual', 'Productivity, Cost & Safety'];
  const extra = [...new Set(entries.map((e) => e.group))].filter((g) => !KNOWN.includes(g));
  const m = Compute.build(), ctx = Compute.ctxNow();
  const hasEmp = App.state.datasets.has('employee_master');
  const hasBudget = App.state.datasets.has('hc_budget');
  const bvaTree = hasEmp && hasBudget && Access.cardLevel('bva_variance') !== 'hidden' ? DemoKit.bvaTree(m, ctx) : null;

  const SECTIONS = [
    ['ovd-sec-head', 'Headline'], ['ovd-sec-demog', 'Employee demographics'], ['ovd-sec-bva', 'Budget vs actual'],
    ['ovd-sec-prod', 'Productivity, Cost & Safety'], ...extra.map((g, i) => ['ovd-sec-x' + i, g]), ['ovd-sec-trends', 'Trends']
  ];
  const head = (id, title, sub) => `<div class="section-head" id="${id}" tabindex="-1"><h2>${esc(title)}</h2>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;

  panel.innerHTML = `
    <div id="ovd-sec-exec">${ExecSummary.bandHTML()}</div>
    <nav class="ovd-nav" aria-label="Overview sections"><span class="ovd-nav-k">Jump to</span>${SECTIONS.map(([id, t]) =>
      `<button type="button" data-ovd-jump="${id}">${esc(t)}</button>`).join('')}</nav>
    ${head('ovd-sec-head', 'Headline', periodText(ctx) + ' · as of ' + CONFIG.asOf)}
    <div class="tile-grid">${tiles('Workforce')}</div>

    ${head('ovd-sec-demog', 'Employee demographics', `on-roll = permanent + trainee (GET) at ${fmtDMY(ctx.asOfDay)} · contract workforce on Contract & Compliance · hover for counts and shares`)}
    <div class="tile-grid ovd-kpis">${tiles('Employee demographics')}</div>
    <div class="ovd-grid" id="charts-overview-demog"></div>
    <div class="ovd-subhead">Distributions — permanent roll</div>
    <div class="card-grid" id="charts-overview-demo"></div>
    <div class="ovd-block" id="ovd-details"></div>

    ${head('ovd-sec-bva', 'Budget vs actual headcount', `permanent roll vs approved budget (hc_budget.csv)${bvaTree && bvaTree.month != null ? ' · budget month ' + monthIdxToLabel(bvaTree.month) : ''} · grade-band filter not applied`)}
    <div class="tile-grid">${tiles('Budget vs actual')}</div>
    <div class="ovd-block" id="ovd-bva"></div>

    ${head('ovd-sec-prod', 'Productivity, Cost & Safety', 'steel-specific block — see Methodology')}
    <div class="tile-grid">${tiles('Productivity, Cost & Safety')}</div>
    ${extra.map((g, i) => `${head('ovd-sec-x' + i, g, '')}<div class="tile-grid">${tiles(g)}</div>`).join('')}

    ${head('ovd-sec-trends', 'Trends', 'full history · selected asset in red, Group in black')}
    <div class="card-grid" id="charts-overview"></div>`;

  panel.querySelector('.ovd-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ovd-jump]');
    const el = b && document.getElementById(b.dataset.ovdJump);
    if (el) { el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); }
  });

  const need = (builder) => needData(['employee_master'], builder);
  const pop = hasEmp ? DemoKit.onRoll(m, ctx) : [];
  const total = pop.length;
  const perm = hasEmp ? Compute.actives(m, ctx, 'Permanent') : [];
  const bars = (items) => Charts.barH({ items, fmt: (v) => fmtInt(v) });

  /* ---- R1: trend, gender, headcount cuts, superannuation, R1a domicile ---- */
  const trendCard = () => {
    const months = [];
    for (let mi = ctx.endMonth - (DemoKit.TREND_MONTHS - 1); mi <= ctx.endMonth; mi++) months.push(mi);
    const values = months.map((mi) => DemoKit.onRollAt(m, ctx, DemoKit.dayAt(ctx, mi)).length);
    const marks = { 0: 'B', [months.length - 1]: 'A' };
    const ci = months.indexOf(fyStartMonthIdx(ctx.endMonth) - 1);
    if (ci >= 0) marks[ci] = marks[ci] ? marks[ci] + ' · C' : 'C';
    return DemoKit.trendLine({ months, values, marks, title: 'On-roll headcount, last 13 months' });
  };

  const genderCard = () => {
    const order = ['Female', 'Male', 'Other'];
    const counts = Compute.countBy(pop, (e) => e.gender, order);
    const shown = counts.filter((c) => !Access.suppressed(c.n));
    const hidden = counts.filter((c) => Access.suppressed(c.n));
    return Charts.donut({ items: shown.map((c) => ({ label: c.key, value: c.n })), centerLabel: `${fmtInt(total)} on roll`, shares: !hidden.length }) +
      (hidden.length ? `<div class="chart-note">${esc(hidden.map((c) => c.key).join(', '))}: &lt;${CONFIG.minCell} (small cell, not drawn) · shares withheld</div>` : '');
  };

  const assetCard = () => {
    const groupN = DemoKit.onRoll(m, ChartData.subCtx(ctx, 'Group')).length;
    const locked = !!Access.lockedAsset();
    return bars(Access.chartScopes().map((a) => {
      const n = DemoKit.onRoll(m, ChartData.subCtx(ctx, a)).length;
      return {
        label: a, value: n, role: a === ctx.asset ? 'focus' : undefined,
        sub: a === 'Group' ? '' : groupN ? fmtPct(n / groupN * 100, 1) + ' of Group' : '',
        tip: `${a}${a === 'Group' ? (locked ? ' (benchmark)' : ' (all assets)') : ''}: ${fmtInt(n)} on roll${a !== 'Group' && groupN ? ` (${fmtPct(n / groupN * 100, 1)} of Group)` : ''}${Access.canFocusAsset(a) && !locked ? '\nClick to focus ' + a : ''}`,
        setAsset: locked ? null : a
      };
    }));
  };

  const bandLabel = (k) => CONFIG.mgmtBandLabels[k] || k;
  const superCard = () => {
    const counts = new Map(CONFIG.superannBuckets.map(([l]) => [l, 0]));
    for (const e of pop) { const b = DemoKit.superBucket(e, ctx); if (b) counts.set(b, counts.get(b) + 1); }
    const due = [...counts.values()].reduce((s, n) => s + n, 0);
    return DemoKit.columns({
      items: [...counts.entries()].map(([label, n], i) => {
        const sup = Access.suppressed(n);
        return {
          label, value: sup ? null : n, role: i === 0 ? 'focus' : undefined,
          sub: sup ? `<${CONFIG.minCell}` : fmtPct(total ? n / total * 100 : 0, 1),
          tip: `${label} to superannuation: ${Access.cellText(n)}${sup ? '' : ` (${fmtPct(total ? n / total * 100 : 0, 1)} of on-roll)`}`
        };
      })
    }) + `<div class="chart-note">${Access.cellText(due)} due within 36 months · superannuation age ${CONFIG.retirementAge} · anyone past it counts in &lt;3M</div>`;
  };

  const domicileCard = () => {
    const homes = new Set(DemoKit.assetsInScope(ctx).map((a) => String(DemoKit.homeState(a) || '').toLowerCase()));
    const counts = Compute.countBy(pop, (e) => (DemoKit.hasDomicile(e) ? String(e.domicile_state).trim() : null));
    const items = DemoKit.dimItems(counts, total, { top: 12, otherLabel: 'Other states', suppress: true, focus: (k) => homes.has(String(k).toLowerCase()) });
    for (const it of items) if (it.role === 'focus' && it.value != null) { it.sub += ' · home'; it.tip += '\nHome state of an asset in scope'; }
    return bars(items);
  };

  const local = Compute.metric('demo_local_domicile_pct');
  document.getElementById('charts-overview-demog').innerHTML = [
    `<div class="ovd-span2">${Charts.card({
      title: 'Headcount trend — last 13 months', sub: 'on-roll at each month-end · A = as-of · B = same month last year · C = FY start',
      infoKey: 'demo_hc_asof', body: need(trendCard)
    })}</div>`,
    Charts.card({ title: 'Gender', sub: 'on-roll at as-of · count and share', infoKey: 'demo_women_pct', body: need(genderCard) }),
    Charts.card({
      title: 'Headcount by company', sub: 'legal entity · share of on-roll', infoKey: 'demo_hc_asof',
      body: need(() => bars(DemoKit.dimItems(Compute.countBy(pop, (e) => e.company), total)))
    }),
    Charts.card({ title: 'Headcount by asset', sub: 'on-roll · click a bar to focus that asset', infoKey: 'demo_hc_asof', body: need(assetCard) }),
    Charts.card({
      title: 'Headcount by business segment', sub: 'segment resolved via org_units.csv when the column is blank', infoKey: 'demo_hc_asof',
      body: need(() => bars(DemoKit.dimItems(Compute.countBy(pop, (e) => Compute.segOf(e), [...CONFIG.segments, 'Unassigned']), total,
        { focus: (k) => k === ctx.segment })))
    }),
    Charts.card({
      title: 'Headcount by function', sub: 'Function (Function 1) · share of on-roll', infoKey: 'demo_hc_asof',
      body: need(() => bars(DemoKit.dimItems(Compute.countBy(pop, (e) => e.function), total, { focus: (k) => k === ctx.fn })))
    }),
    Charts.card({
      title: 'Headcount by function plant', sub: 'top 12 units + the rest · hover for full names', infoKey: 'demo_hc_asof',
      body: need(() => bars(DemoKit.dimItems(Compute.countBy(pop, (e) => e.function_plant), total, { top: 12, otherLabel: 'Other units' })))
    }),
    Charts.card({
      title: 'Headcount by management band', sub: 'SM / MM / JM / Blue collar (distinct from grade band)', infoKey: 'demo_hc_asof',
      body: need(() => bars(DemoKit.dimItems(Compute.countBy(pop, (e) => e.mgmt_band, CONFIG.mgmtBands), total,
        { label: bandLabel, tipLabel: (k) => (CONFIG.mgmtBandLabels[k] ? `${k} — ${CONFIG.mgmtBandLabels[k]}` : k) })))
    }),
    Charts.card({
      title: 'Headcount by level', sub: 'grade ladder, senior → junior (GET = graduate engineer trainee)', infoKey: 'demo_hc_asof',
      body: need(() => bars(DemoKit.dimItems(Compute.countBy(pop, (e) => e.level, CONFIG.levels), total)))
    }),
    Charts.card({ title: 'Superannuation', sub: 'on-roll by months to superannuation · share of on-roll', infoKey: 'demo_superann_3y', body: need(superCard) }),
    Charts.card({
      title: 'State-wise domicile', infoKey: 'demo_local_domicile_pct',
      sub: `top 12 states · home state of an asset in red${local.value != null ? ' · local domicile ' + fmtPct(local.value, 1) : ''}`,
      body: need(domicileCard)
    })
  ].join('');

  /* ---- permanent-roll distributions (age / tenure / grade band) ---- */
  const AGE_BUCKETS = [['≤20', 0, 21], ['21–30', 21, 31], ['31–40', 31, 41], ['41–50', 41, 51], ['51–58', 51, 58.0001], ['>58', 58.0001, 200]];
  const TENURE_BUCKETS = [['<1 yr', 0, 1], ['1–6', 1, 6], ['6–11', 6, 11], ['11–16', 11, 16], ['16–21', 16, 21], ['21–26', 21, 26], ['26–31', 26, 31], ['>31', 31, 200]];
  document.getElementById('charts-overview-demo').innerHTML = [
    Charts.card({
      title: 'Age distribution', infoKey: 'avg_age',
      body: need(() => Charts.barH({
        items: DemoKit.bucketBarItems(perm.filter((e) => e.dob != null), AGE_BUCKETS, (e) => yearsBetween(e.dob, ctx.asOfDay), { suppress: true }),
        fmt: (v) => fmtInt(v)
      })),
      note: `superannuation age ${CONFIG.retirementAge} — the ≥51 bars feed the Outlook glidepath`
    }),
    Charts.card({
      title: 'Tenure distribution', infoKey: 'avg_tenure',
      body: need(() => Charts.barH({
        items: DemoKit.bucketBarItems(perm.filter((e) => e.doj != null), TENURE_BUCKETS, (e) => yearsBetween(e.doj, ctx.asOfDay)),
        fmt: (v) => fmtInt(v)
      }))
    }),
    Charts.card({
      title: 'Headcount by grade band', infoKey: 'headcount_close',
      body: need(() => Charts.barH({
        items: CONFIG.gradeBands.map((b) => {
          const n = perm.filter((e) => e.grade_band === b).length;
          return { label: CONFIG.bandLabels[b], value: n, tip: `${CONFIG.bandLabels[b]}: ${fmtInt(n)} (${fmtPct(n / (perm.length || 1) * 100, 1)})` };
        }),
        fmt: (v) => fmtInt(v)
      }))
    })
  ].join('');

  /* ---- employee details (row-level: full level + PII rule) ---- */
  let details = null;
  const detailsBody = () => {
    if (Access.level('demo_hc_asof') !== 'full') {
      return `<div class="chart-empty">Row-level detail withheld — ${esc(Access.label())} sees headcount as aggregates only.</div>`;
    }
    const raw = DemoKit.detailRows(m, ctx);
    details = Access.maskTable(DemoKit.DETAIL_COLS, raw, DemoKit.DETAIL_PII);
    if (!details) {
      return `<div class="chart-empty">Row-level detail withheld — the ${esc(Access.label())} persona sees no individual rows (identifiers: none). The counts above are the aggregate.</div>`;
    }
    return DemoKit.detailsHTML(details);
  };
  document.getElementById('ovd-details').innerHTML = Charts.card({
    title: 'Employee details', sub: `on-roll at ${fmtDMY(ctx.asOfDay)} · ${fmtInt(total)} rows · 50 per page · filter and export below`,
    infoKey: 'demo_hc_asof', body: need(detailsBody)
  });
  if (details) DemoKit.wireDetails(document.getElementById('ovd-details'), details);

  /* ---- R1b budget vs actual matrix ---- */
  document.getElementById('ovd-bva').innerHTML = Charts.card({
    title: 'Budget vs actual headcount — Asset → Function → Function Plant',
    sub: `${bvaTree && bvaTree.month != null ? 'budget ' + monthIdxToLabel(bvaTree.month) : 'budget month —'} · actual = permanent roll at ${fmtDMY(ctx.asOfDay)}${bvaTree && !bvaTree.hasPos ? ' · vacant positions need positions.csv' : ' · vacant = positions.csv status Vacant'}`,
    infoKey: 'bva_variance',
    body: needData(['hc_budget', 'employee_master'], () => (bvaTree ? DemoKit.bvaHTML(bvaTree) : '')),
    note: 'Variance = actual − budget. ▲ over budget: more people than approved positions · ▼ under budget: approved positions not yet filled. Expand a row (or press → / ←) to drill Asset → Function → Function Plant.'
  });
  if (bvaTree) DemoKit.wireBva(document.getElementById('ovd-bva'), bvaTree);

  /* ---- trends ---- */
  document.getElementById('charts-overview').innerHTML = [
    Charts.card({
      title: 'Permanent headcount by asset', sub: 'month-end actives · hover for values', infoKey: 'headcount_close',
      body: need(() => {
        const { months, series } = ChartData.assetLines(ctx, ChartData.headcountAt(m, ctx));
        return Charts.line({ months, series, yFmt: (v) => fmtInt(v) });
      })
    }),
    Charts.card({
      title: 'Annualised attrition by asset', sub: 'monthly, with target', infoKey: 'attr_annualised',
      body: needData(['exits', 'employee_master'], () => {
        const { months, series } = ChartData.assetLines(ctx, ChartData.attritionAt(m, ctx));
        return Charts.line({ months, series, yFmt: (v) => fmtPct(v, 0), target: Compute.metric('attr_annualised').target?.value ?? null });
      })
    }),
    Charts.card({
      title: 'Joins vs exits — monthly', sub: 'net workforce movement, selected scope', infoKey: 'headcount_close',
      body: needData(['employee_master', 'exits'], () => {
        const months = ChartData.monthsAxis(ctx);
        return Charts.line({
          months,
          series: [
            { label: 'Joins', role: 'group', values: months.map((mi) => Compute.joinsInMonth(m, ctx, mi, null)) },
            { label: 'Exits', role: 'focus', values: months.map((mi) => m.exits.filter((x) => x.exit_date != null && x.__emp && Compute.empMatch(x.__emp, ctx) && dayToMonthIdx(x.exit_date) === mi).length) }
          ],
          yFmt: (v) => fmtInt(v)
        });
      })
    }),
    Charts.card({
      title: 'Headcount vs 12 months ago', sub: 'permanent roll by asset · click a bar to focus', access: 'core',
      body: need(() => Charts.barH({
        items: Access.chartScopes().map((a) => {
          const sub = ChartData.subCtx(ctx, a);
          const now = Compute.activesAt(m, sub, 'Permanent', ctx.asOfDay).length;
          const then = Compute.activesAt(m, sub, 'Permanent', monthEndDay(ctx.endMonth - 12)).length;
          const d = now - then;
          return {
            label: a, value: now, role: a === ctx.asset ? 'focus' : undefined,
            sub: `${d >= 0 ? '+' : '−'}${fmtInt(Math.abs(d))} vs 12 m ago`,
            tip: `${a}: ${fmtInt(now)} now · ${fmtInt(then)} a year ago (${d >= 0 ? '+' : ''}${fmtInt(d)})`,
            setAsset: Access.lockedAsset() ? null : a
          };
        }),
        fmt: (v) => fmtInt(v)
      }))
    })
  ].join('');
};
