/* Overview tab — executive summary band (deterministic, rule-based) +
   headline KPI grid + the steel-specific Productivity, Cost & Safety block +
   workforce demographics (age / tenure / band distributions) + trend charts. */

function bucketBarItems(pop, buckets, valueOf) {
  // buckets: [label, min, max] with max exclusive; counts + share in the tip
  const total = pop.length || 1;
  return buckets.map(([label, min, max]) => {
    const n = pop.filter((e) => {
      const v = valueOf(e);
      return v != null && v >= min && v < max;
    }).length;
    return { label, value: n, tip: `${label}: ${fmtInt(n)} (${fmtPct(n / total * 100, 1)})` };
  });
}

TabRenderers.overview = (panel) => {
  const entries = REGISTRY.filter((e) => e.tab === 'overview');
  const groups = [...new Set(entries.map((e) => e.group))];
  panel.innerHTML = `
    ${ExecSummary.bandHTML()}
    ${groups.map((g) => `
      <div class="section-head"><h2>${esc(g)}</h2>
        <span class="sub">${g === 'Productivity, Cost & Safety'
          ? 'steel-specific block — see Methodology'
          : esc(CONFIG.periodLabel) + ' · as of ' + esc(CONFIG.asOf)}</span></div>
      <div class="tile-grid">
        ${entries.filter((e) => e.group === g).map((e) => UI.tileHTML(e.key)).join('')}
      </div>`).join('')}
    <div class="section-head"><h2>Workforce demographics</h2>
      <span class="sub">permanent roll at as-of · hover for counts and shares</span></div>
    <div class="card-grid" id="charts-overview-demo"></div>
    <div class="section-head"><h2>Trends</h2><span class="sub">full history · selected asset in red, Group in black</span></div>
    <div class="card-grid" id="charts-overview"></div>`;

  const m = Compute.build(), ctx = Compute.ctxNow();
  const perm = App.state.datasets.has('employee_master') ? Compute.actives(m, ctx, 'Permanent') : [];

  /* ---- demographics: the three distributions from the executive-dashboard form ---- */
  const AGE_BUCKETS = [['≤20', 0, 21], ['21–30', 21, 31], ['31–40', 31, 41], ['41–50', 41, 51], ['51–58', 51, 58.0001], ['>58', 58.0001, 200]];
  const TENURE_BUCKETS = [['<1 yr', 0, 1], ['1–6', 1, 6], ['6–11', 6, 11], ['11–16', 11, 16], ['16–21', 16, 21], ['21–26', 21, 26], ['26–31', 26, 31], ['>31', 31, 200]];
  document.getElementById('charts-overview-demo').innerHTML = [
    Charts.card({
      title: 'Age distribution', infoKey: 'avg_age',
      body: needData(['employee_master'], () => Charts.barH({
        items: bucketBarItems(perm.filter((e) => e.dob != null), AGE_BUCKETS, (e) => yearsBetween(e.dob, ctx.asOfDay)),
        fmt: (v) => fmtInt(v)
      })),
      note: `superannuation age ${CONFIG.retirementAge} — the ≥51 bars feed the Outlook glidepath`
    }),
    Charts.card({
      title: 'Tenure distribution', infoKey: 'avg_tenure',
      body: needData(['employee_master'], () => Charts.barH({
        items: bucketBarItems(perm.filter((e) => e.doj != null), TENURE_BUCKETS, (e) => yearsBetween(e.doj, ctx.asOfDay)),
        fmt: (v) => fmtInt(v)
      }))
    }),
    Charts.card({
      title: 'Headcount by grade band', infoKey: 'headcount_close',
      body: needData(['employee_master'], () => Charts.barH({
        items: CONFIG.gradeBands.map((b) => {
          const n = perm.filter((e) => e.grade_band === b).length;
          return { label: CONFIG.bandLabels[b], value: n, tip: `${CONFIG.bandLabels[b]}: ${fmtInt(n)} (${fmtPct(n / (perm.length || 1) * 100, 1)})` };
        }),
        fmt: (v) => fmtInt(v)
      }))
    })
  ].join('');

  /* ---- trends ---- */
  document.getElementById('charts-overview').innerHTML = [
    Charts.card({
      title: 'Permanent headcount by asset', sub: 'month-end actives · hover for values', infoKey: 'headcount_close',
      body: needData(['employee_master'], () => {
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
      title: 'Headcount vs 12 months ago', sub: 'permanent roll by asset · click a bar to focus',
      body: needData(['employee_master'], () => Charts.barH({
        items: [...CONFIG.assets, 'Group'].map((a) => {
          const sub = ChartData.subCtx(ctx, a);
          const now = Compute.activesAt(m, sub, 'Permanent', ctx.asOfDay).length;
          const then = Compute.activesAt(m, sub, 'Permanent', monthEndDay(ctx.endMonth - 12)).length;
          const d = now - then;
          return {
            label: a, value: now, role: a === ctx.asset ? 'focus' : undefined,
            sub: `${d >= 0 ? '+' : '−'}${fmtInt(Math.abs(d))} vs 12 m ago`,
            tip: `${a}: ${fmtInt(now)} now · ${fmtInt(then)} a year ago (${d >= 0 ? '+' : ''}${fmtInt(d)})`,
            setAsset: a
          };
        }),
        fmt: (v) => fmtInt(v)
      }))
    })
  ].join('');
};
