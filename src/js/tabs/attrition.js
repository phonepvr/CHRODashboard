/* Attrition tab — R5 layout (reference page 3 structure):
   page-level exit-type toggle → fiscal-YTD KPI strip → headline trends →
   attrition by type → rate cuts by dimension (toggle-scoped) → the existing
   cohort / early-turnover / exit-quality sections → employee-wise details
   (toggle-scoped, persona-masked). Page fragments live in AttrKit
   (02n-reg-attrition2.js); the shared helpers fillSlot / needData in tiles-tabs.js. */

TabRenderers.attrition = (panel) => {
  const K = AttrKit;
  const m = Compute.build(), ctx = Compute.ctxNow();
  const STRIP = ['attr_sep_ytd', 'attr_ytd', 'attr_hc_fystart', 'attr_hc_asof', 'attr_abs_ytd', 'attr_retire_ytd'];
  const TYPE_KEYS = ['attr_voluntary', 'attr_involuntary'];
  const placed = new Set([...STRIP, 'attr_annualised', ...TYPE_KEYS, ...K.DIMS.map((d) => d.key), 'attr_reason_top']);
  // every other attrition metric keeps its registry group section (and chart slot id)
  const rest = REGISTRY.filter((e) => e.tab === 'attrition' && !placed.has(e.key));
  const groups = [...new Set(rest.map((e) => e.group))];
  const slotId = (g) => `charts-attrition-${g.replace(/\W+/g, '-').toLowerCase()}`;
  const tiles = (keys) => `<div class="tile-grid">${keys.map((k) => UI.tileHTML(k)).join('')}</div>`;
  const head = (title, sub) => `<div class="section-head"><h2>${esc(title)}</h2>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
  const ytd = K.ytdCtx(ctx);

  panel.innerHTML = `
    ${K.toolbarHTML()}
    ${head('Year to date', `fiscal year ${fmtDMY(Compute.fyStartDay(ctx))} – ${fmtDMY(ctx.asOfDay)} (${ytd.periodMonths} mo) · permanent roll · retirements counted separately, never in attrition`)}
    <div class="attr-strip">${tiles(STRIP)}</div>
    ${head('Headline', 'annualised; superannuation excluded')}
    ${tiles(['attr_annualised'])}
    <div class="chart-slot card-grid" id="charts-attrition-headline" style="margin-top:10px"></div>
    ${head('Attrition by type', 'voluntary + involuntary = total · the selected period, annualised')}
    ${tiles(TYPE_KEYS)}
    <div class="chart-slot card-grid" id="charts-attrition-type" style="margin-top:10px"></div>
    <div id="attr-cuts" class="attr-scoped"></div>
    ${groups.map((g) => `${head(g)}
      <div class="tile-grid">${rest.filter((e) => e.group === g).map((e) => UI.tileHTML(e.key)).join('')}</div>
      <div class="chart-slot card-grid" id="${slotId(g)}" style="margin-top:10px"></div>`).join('')}
    <div id="attr-details" class="attr-scoped"></div>`;

  /* ---- existing charts (unchanged) ---- */
  fillSlot('attrition', 'headline', [
    Charts.card({
      title: 'Monthly attrition by asset (annualised)', sub: 'selected asset in red · Group in black · direct-labelled', infoKey: 'attr_annualised',
      body: needData(['exits', 'employee_master'], () => {
        const { months, series } = ChartData.assetLines(ctx, ChartData.attritionAt(m, ctx));
        return Charts.line({ months, series, yFmt: (v) => fmtPct(v, 0), target: Compute.metric('attr_annualised').target?.value ?? null });
      })
    }),
    Charts.card({
      title: 'Total vs voluntary attrition', sub: 'monthly annualised — the gap is involuntary/managed exits', infoKey: 'attr_voluntary',
      body: needData(['exits', 'employee_master'], () => {
        const months = ChartData.monthsAxis(ctx);
        return Charts.line({
          months,
          series: [
            { label: 'Total', role: 'group', values: months.map((mi) => Compute.monthAttritionRate(m, ctx, mi)) },
            { label: 'Voluntary', role: 'focus', values: months.map((mi) => Compute.monthAttritionRateWhere(m, ctx, mi, (x) => x.exit_type === 'Voluntary')) }
          ],
          yFmt: (v) => fmtPct(v, 0)
        });
      })
    })
  ].join(''));
  fillSlot('attrition', 'Exit quality', Charts.card({
    title: 'Exits by stated reason', sub: 'period; blank reasons surfaced, not hidden', infoKey: 'attr_regretted',
    body: needData(['exits', 'employee_master'], () => {
      const counts = new Map();
      for (const x of Compute.exitsInPeriod(m, ctx, null)) {
        const k = x.exit_reason || '(blank)';
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9)
        .map(([label, value]) => ({ label, value, role: label === '(blank)' ? 'focus' : undefined, tip: `${label}: ${fmtInt(value)} exits` }));
      return items.length ? Charts.barH({ items, fmt: (v) => fmtInt(v) }) : '<div class="chart-empty">No exits in the selected period.</div>';
    })
  }));
  fillSlot('attrition', 'Early turnover', Charts.card({
    title: 'Early turnover (≤1 yr) by asset', sub: 'click a bar to focus that asset', infoKey: 'attr_early_1y',
    body: needData(['exits', 'employee_master'], () => Charts.barH({
      items: ChartData.assetBars('attr_early_1y', (v) => fmtPct(v, 1)), fmt: (v) => fmtPct(v, 0),
      target: Compute.metric('attr_early_1y').target?.value ?? null
    }))
  }));

  /* ---- R5 additions ---- */
  fillSlot('attrition', 'type', K.typeChartHTML(m, ctx));

  // toggle-scoped fragments re-render in place; the radio keeps focus
  const renderScoped = () => {
    const mm = Compute.build(), cc = Compute.ctxNow();
    panel.querySelector('#attr-cuts').innerHTML = K.cutsHTML(mm, cc, K.state.type);
    panel.querySelector('#attr-details').innerHTML = K.detailsHTML(mm, cc, K.state.type);
    const csv = panel.querySelector('[data-attr-csv]');
    if (csv) {
      csv.addEventListener('click', () => {
        const t = K.detailsTable(Compute.build(), Compute.ctxNow(), K.state.type);
        if (t) Exports.drillCSV(t);
      });
    }
  };
  renderScoped();
  for (const r of panel.querySelectorAll('input[name="attr-type"]')) {
    r.addEventListener('change', () => {
      if (!r.checked || !K.TYPES.includes(r.value)) return;
      K.state.type = r.value;
      renderScoped();
    });
  }
};
