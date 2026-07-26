/* Outlook tab — projections, never mixed into actuals.
   Every panel states METHOD, ASSUMPTIONS, HORIZON and uncertainty; every
   projected figure carries a "Projected" marker and draws dashed. Risk
   cohorts are reported as COUNTS ONLY — no individual scores, by design. */

const Outlook = (() => {

  function panel({ title, method, assumptions, horizon, body, note = '' }) {
    return `<div class="card ol-panel">
      <div class="card-title">${esc(title)} <span class="proj-chip">Projected</span></div>
      <div class="card-sub">${esc(horizon)}</div>
      ${body}
      <div class="ol-method"><span class="po-k">Method</span>${esc(method)}
        <span class="po-k" style="margin-top:4px">Assumptions</span>${esc(assumptions)}</div>
      ${note ? `<div class="chart-note">${esc(note)}</div>` : ''}
    </div>`;
  }

  /* 1 — year-end attrition, run-rate + variance band */
  function attritionPanel(m, ctx) {
    const months = ChartData.monthsAxis(ctx);
    const actual = months.map((mi) => Compute.monthAttritionRate(m, ctx, mi));
    const valid = actual.filter((v) => v != null && isFinite(v));
    if (valid.length < 6) {
      return panel({
        title: 'Year-end attrition', horizon: 'to fiscal year end',
        method: 'Run-rate annualisation of fiscal-YTD exits.',
        assumptions: 'Not drawn: fewer than six months of usable history — the series is too short for a defensible band.',
        body: '<div class="chart-empty">Series too short or noisy to project — more monthly history needed.</div>'
      });
    }
    const ytd = Compute.ytdAttrition(m, ctx);
    const sd = stdev(valid.slice(-24)) ?? 0;
    const horizonM = 4; // months of dashed projection drawn past as-of
    const projMonths = [...months];
    const projected = actual.map(() => null);
    for (let i = 1; i <= horizonM; i++) projMonths.push(ctx.endMonth + i);
    const lastActual = actual[actual.length - 1];
    const padded = [...actual, ...Array(horizonM).fill(null)];
    for (let i = 0; i <= horizonM; i++) projected[months.length - 1 + i] = ytd;
    projected[months.length - 1] = lastActual; // join the lines
    const bandArr = projMonths.map((_, i) => i >= months.length - 1 ? ytd : null);
    const chart = Charts.line({
      months: projMonths,
      series: [
        { label: 'Actual', role: 'group', values: padded },
        { label: 'Projected', role: 'projected', dashed: true, values: projected }
      ],
      band: {
        upper: bandArr.map((v) => v == null ? null : v + sd),
        lower: bandArr.map((v) => v == null ? null : Math.max(0, v - sd))
      },
      yFmt: (v) => fmtPct(v, 0)
    });
    return panel({
      title: 'Year-end attrition', horizon: 'projected to fiscal year end',
      method: `Run-rate annualisation of fiscal-YTD exits: projected FY rate = YTD exits ÷ YTD average headcount × (12 ÷ elapsed months). Currently ${fmtPct(ytd, 1)}.`,
      assumptions: `Exit behaviour continues at the YTD pace. Band = ±1 standard deviation (${fmtPct(sd, 1)}) of the trailing 24 monthly annualised rates.`,
      body: chart
    });
  }

  /* 2 — superannuation glidepath (deterministic) */
  function glidepathPanel(m, ctx) {
    const horizonM = 36;
    const months = [];
    const counts = [];
    let cum = 0;
    const cumSeries = [];
    const actives = Compute.actives(m, ctx, 'Permanent').filter((e) => e.dob != null);
    for (let i = 1; i <= horizonM; i++) {
      const mi = ctx.endMonth + i;
      months.push(mi);
      const n = actives.filter((e) => {
        const retireDay = e.dob + Math.round(CONFIG.retirementAge * 365.25);
        return dayToMonthIdx(retireDay) === mi;
      }).length;
      cum += n;
      counts.push(n);
      cumSeries.push(cum);
    }
    const chart = Charts.line({
      months,
      series: [{ label: 'Cumulative retirements', role: 'focus', dashed: true, values: cumSeries }],
      yFmt: (v) => fmtInt(v)
    });
    return panel({
      title: 'Superannuation glidepath', horizon: 'next 36 months',
      method: `Deterministic: each permanent employee retires in the month they turn ${CONFIG.retirementAge} (configurable). Monthly counts summed cumulatively.`,
      assumptions: 'None — this panel carries no forecasting assumption; it is arithmetic on dates of birth. Early exits before superannuation would only reduce it.',
      body: chart,
      note: `${fmtInt(cum)} retirements fall due in the window (${fmtPct(actives.length ? cum / actives.length * 100 : 0, 1)} of the current roll).`
    });
  }

  /* 3 — headcount roll-forward */
  function rollForwardPanel(m, ctx) {
    const horizonM = 12;
    const actives = Compute.actives(m, ctx, 'Permanent');
    const start = actives.length;
    const ytd = Compute.ytdAttrition(m, ctx) ?? 0;
    const monthlyExitRate = ytd / 100 / 12;
    const openReqs = m.reqs.filter((r) => r.closed_date == null && Compute.inAsset(ctx, r.asset));
    const closed = m.reqs.filter((r) => r.closed_date != null && r.open_date != null && Compute.inAsset(ctx, r.asset));
    const medTTF = median(closed.map((r) => r.closed_date - r.open_date)) ?? 90;
    const fillPerMonth = medTTF > 0 ? Math.min(openReqs.length, openReqs.length / (medTTF / 30)) : 0;
    const months = [];
    let hc = start, remainingReqs = openReqs.length;
    const vals = [];
    const retire = (mi) => Compute.actives(m, ctx, 'Permanent').filter((e) => e.dob != null &&
      dayToMonthIdx(e.dob + Math.round(CONFIG.retirementAge * 365.25)) === mi).length;
    for (let i = 1; i <= horizonM; i++) {
      const mi = ctx.endMonth + i;
      months.push(mi);
      const joins = Math.min(remainingReqs, fillPerMonth);
      remainingReqs -= joins;
      hc = hc + joins - hc * monthlyExitRate - retire(mi);
      vals.push(Math.round(hc));
    }
    const chart = Charts.line({
      months,
      series: [{ label: 'Projected roll', role: 'projected', dashed: true, values: vals }],
      yFmt: (v) => fmtInt(v)
    });
    return panel({
      title: 'Headcount roll-forward', horizon: 'next 12 months, selected scope',
      method: 'Month by month: current roll + pipeline joins (open requisitions filled at the median time-to-fill pace) − run-rate exits − superannuation retirements.',
      assumptions: `Attrition holds at the YTD run-rate (${fmtPct(ytd, 1)} annualised); ${fmtInt(openReqs.length)} open requisitions fill at the median ${fmtInt(medTTF)}-day pace; no new requisitions are raised.`,
      body: m.has('requisitions') ? chart : '<div class="chart-empty">Needs requisitions.csv for the joins pipeline.</div>'
    });
  }

  /* 4 — vacancy burn-down */
  function burndownPanel(m, ctx) {
    if (!m.has('requisitions')) {
      return panel({
        title: 'Vacancy burn-down', horizon: 'until the current openings clear',
        method: 'Open requisitions reduced at the historical closure pace (median time-to-fill).',
        assumptions: 'Not computed — requisitions.csv not loaded.',
        body: '<div class="chart-empty">No data loaded for this panel — needs requisitions.csv.</div>'
      });
    }
    const open = m.reqs.filter((r) => r.closed_date == null && Compute.inAsset(ctx, r.asset));
    const closed = m.reqs.filter((r) => r.closed_date != null && r.open_date != null && Compute.inAsset(ctx, r.asset));
    const medTTF = median(closed.map((r) => r.closed_date - r.open_date)) ?? 90;
    const perMonth = Math.max(1, Math.round(open.length / Math.max(1, medTTF / 30)));
    const months = [], vals = [];
    let rem = open.length;
    for (let i = 1; i <= 12 && rem > 0; i++) {
      months.push(ctx.endMonth + i);
      rem = Math.max(0, rem - perMonth);
      vals.push(rem);
    }
    const body = months.length >= 2
      ? Charts.line({ months, series: [{ label: 'Open requisitions', role: 'projected', dashed: true, values: vals }], yFmt: (v) => fmtInt(v) })
      : `<div class="chart-empty">${fmtInt(open.length)} open requisition${open.length === 1 ? '' : 's'} — clears within a month at the current pace.</div>`;
    return panel({
      title: 'Vacancy burn-down', horizon: 'until current openings clear (max 12 months)',
      method: `Open requisitions (${fmtInt(open.length)}) reduced by the historical closure pace: median time-to-fill ${fmtInt(medTTF)} days → ~${fmtInt(perMonth)} closures/month.`,
      assumptions: 'Closure pace holds; no new requisitions are raised (so this is a lower bound on future open positions).',
      body
    });
  }

  /* 5 — manpower cost outlook with live increment slider */
  function costPanel(m, ctx) {
    if (!m.has('production_safety')) {
      return panel({
        title: 'Manpower cost outlook', horizon: 'next 12 months',
        method: 'Run-rate employee cost with a compensation-increment slider.',
        assumptions: 'Not computed — production_safety.csv not loaded.',
        body: '<div class="chart-empty">No data loaded for this panel — needs production_safety.csv.</div>'
      });
    }
    const cost = Compute.prodSum(m, ctx, 'employee_cost');
    const annualRunRate = cost != null ? cost * (12 / ctx.periodMonths) : null;
    return panel({
      title: 'Manpower cost outlook', horizon: 'next 12 months',
      method: 'Employee-cost run-rate from the selected period, annualised, with the increment percentage applied from the next cycle. Projected cost = run-rate × (1 + increment%).',
      assumptions: 'Headcount mix stays flat (see the roll-forward panel for the volume view); increment applies to the full base.',
      body: `
        <div class="ol-cost">
          <div><span class="po-k">Current annual run-rate</span>
            <span class="ol-big">${annualRunRate == null ? '—' : fmtINR(annualRunRate)}</span></div>
          <label class="ol-slider">Increment assumption
            <input type="range" id="ol-incr" min="0" max="15" step="0.5" value="8"
              aria-label="Increment percentage assumption">
            <span id="ol-incr-val" class="ol-slider-val">8.0%</span>
          </label>
          <div><span class="po-k">Projected cost (next 12 m) <span class="proj-chip">Projected</span></span>
            <span class="ol-big" id="ol-cost-out" data-base="${annualRunRate ?? ''}">${annualRunRate == null ? '—' : fmtINR(annualRunRate * 1.08)}</span></div>
        </div>`
    });
  }

  /* 6 — attrition-risk cohorts: rule-based, COUNTS ONLY */
  function riskPanel(m, ctx) {
    const actives = Compute.actives(m, ctx, 'Permanent');
    const groupAttr = Compute.metric('attr_annualised', { asset: 'Group' }).value ?? 0;
    const hotAssets = new Set(CONFIG.assets.filter((a) =>
      (Compute.metric('attr_annualised', { asset: a }).value ?? 0) > groupAttr + 1.5));
    const c1 = actives.filter((e) => e.doj != null && yearsBetween(e.doj, ctx.asOfDay) <= 2 && hotAssets.has(e.asset)).length;
    const c2 = actives.filter((e) => e.tt_flag &&
      (e.last_promotion == null || yearsBetween(e.last_promotion, ctx.asOfDay) > 3)).length;
    const c3 = actives.filter((e) => e.dob != null &&
      yearsBetween(e.dob, ctx.asOfDay) >= CONFIG.retirementAge - 2).length;
    const rows = [
      ['Early-tenure at high-attrition assets', 'Tenure ≤2 yrs at an asset running >1.5pp above Group attrition', c1],
      ['Unpromoted Top Talent', 'TT with no promotion in >3 years (or never)', c2],
      ['Superannuation-adjacent', `Within 2 years of retirement age ${CONFIG.retirementAge}`, c3]
    ];
    return panel({
      title: 'Attrition-risk cohorts', horizon: 'current roll, rule-based bands',
      method: 'Deterministic rules over the loaded data — each cohort is a transparent filter, listed beside its count.',
      assumptions: 'Reported as COHORT COUNTS ONLY — this dashboard computes no individual risk scores, by design.',
      body: UI.tableHTML(['Cohort', 'Rule', 'Count'], rows.map((r) => [r[0], r[1], fmtInt(r[2])]))
    });
  }

  function render(panelEl) {
    const m = Compute.build(), ctx = Compute.ctxNow();
    if (!m.has('employee_master')) {
      panelEl.innerHTML = '<div class="empty-note">Outlook needs at least employee_master.csv (plus exits.csv for attrition projections).</div>';
      return;
    }
    panelEl.innerHTML = `
      <div class="empty-note" style="margin-bottom:10px"><strong>Projections, kept apart from actuals.</strong>
        Every figure on this tab is a projection — marked, drawn dashed, and documented with its
        method and assumptions. Nothing here feeds the actuals tabs or the scorecard.</div>
      <div class="card-grid">
        ${m.has('exits') ? attritionPanel(m, ctx) : panel({ title: 'Year-end attrition', horizon: '—', method: 'Run-rate annualisation.', assumptions: 'Not computed — exits.csv not loaded.', body: '<div class="chart-empty">Needs exits.csv.</div>' })}
        ${glidepathPanel(m, ctx)}
        ${rollForwardPanel(m, ctx)}
        ${burndownPanel(m, ctx)}
        ${costPanel(m, ctx)}
        ${riskPanel(m, ctx)}
      </div>`;
    const slider = panelEl.querySelector('#ol-incr');
    if (slider) {
      slider.addEventListener('input', () => {
        const out = panelEl.querySelector('#ol-cost-out');
        const val = panelEl.querySelector('#ol-incr-val');
        val.textContent = fmtNum(+slider.value, 1) + '%';
        const base = Number(out.dataset.base);
        out.textContent = isFinite(base) && base > 0 ? fmtINR(base * (1 + slider.value / 100)) : '—';
      });
    }
  }

  return { render };
})();

TabRenderers.outlook = (panel) => Outlook.render(panel);
