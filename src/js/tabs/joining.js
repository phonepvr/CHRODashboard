/* New Joining tab (R2, reference image 2 structure): fiscal-YTD hire tiles,
   13-month hiring trend with point labels, YTD hires by gender / hire type /
   company / asset / function plant / MC member / level / management band /
   generation, and the employee-wise hiring details table (persona-masked).
   Population and definitions: JoinKit + the join_* metrics in 02k-reg-joining.js.
   Persona rules: every card declares its access class via infoKey; per-asset
   cuts iterate Access.chartScopes(); small cuts (< CONFIG.minCell) are
   suppressed for non-default personas; row-level detail goes through
   Access.maskTable and is shown only at 'full' level. */

TabRenderers.joining = (() => {

  const TILE_KEYS = ['join_hires_ytd', 'join_women_ytd', 'join_women_pct', 'join_lateral_ytd',
    'join_campus_ytd', 'join_get_ytd', 'join_hires_12m'];
  const TABLE_ROWS = 100;          // rows drawn on the tab; the drill holds (and exports) them all
  const LABEL_MAX = 19;            // barH reserves ~120 px for category labels

  const clip = (s) => (String(s).length > LABEL_MAX ? String(s).slice(0, LABEL_MAX - 1) + '…' : String(s));
  const isPseudoKey = (k) => /^\(.*\)$/.test(String(k));   // '(blank)', '(unmapped)'
  const need = (ids, builder) => needData(ids, builder);

  /* ---------- bar items for a cut of the YTD hires ---------- */

  function cutItems(pop, keyFn, { order, labelOf, tipOf } = {}) {
    const total = pop.length;
    return Compute.countBy(pop, keyFn, order).map(({ key, n }) => {
      const full = labelOf && !isPseudoKey(key) ? labelOf(key) : String(key);
      const hide = Access.suppressed(n);
      const share = total ? fmtPct(n / total * 100, 1) : '—';
      return {
        label: clip(full), value: hide ? null : n,
        sub: hide ? `<${CONFIG.minCell} · suppressed` : share,
        role: isPseudoKey(key) ? 'ctx' : undefined,
        tip: hide ? `${full}: fewer than ${CONFIG.minCell} hires — suppressed for this persona`
          : `${full}${tipOf ? ' · ' + tipOf(key) : ''}: ${fmtInt(n)} hires (${share} of ${fmtInt(total)})`
      };
    });
  }

  function barsOrEmpty(items, emptyText) {
    return items.length ? Charts.barH({ items, fmt: (v) => fmtInt(v) }) : `<div class="chart-empty">${esc(emptyText)}</div>`;
  }

  // one card per dimension: absent column → an explicit "not in source" state
  function dimCard(m, pop, { title, sub, col, colName, keyFn, order, labelOf, tipOf, note, scroll, datasets }) {
    const body = need(datasets || [JoinKit.EMP], () => {
      if (col && !JoinKit.hasCol(m, col)) {
        return `<div class="chart-empty">${esc(colName)} not in employee_master.csv — map the column on the Field Mapping step to draw this cut.</div>`;
      }
      const svg = barsOrEmpty(cutItems(pop, keyFn, { order, labelOf, tipOf }), 'No hires in the fiscal year to date for this scope.');
      return scroll ? `<div class="jn-scroll">${svg}</div>` : svg;
    });
    return Charts.card({ title, sub, infoKey: 'join_hires_ytd', body, note });
  }

  /* ---------- hiring trend: 13 months, point labels, current FY in red ---------- */

  function monthly(m, ctx, months) {
    const idx = new Map(months.map((mi, i) => [mi, i]));
    const rows = months.map(() => ({ n: 0, women: 0, types: new Map() }));
    const from = monthEndDay(months[0] - 1) + 1;
    for (const e of m.emps) {
      if (e.doj == null || e.doj < from || e.doj > ctx.asOfDay || !idx.has(e.__dojMi) || !Compute.empMatch(e, ctx)) continue;
      const r = rows[idx.get(e.__dojMi)];
      r.n++;
      if (e.gender === 'Female') r.women++;
      if (e.hire_type) r.types.set(e.hire_type, (r.types.get(e.hire_type) || 0) + 1);
    }
    return rows;
  }

  function trendSVG(months, rows, fyIdx) {
    const w = 640, h = 214, padL = 36, padR = 18, padT = 22, padB = 26;
    const iw = w - padL - padR, ih = h - padT - padB;
    const inset = 16;               // keeps the end point labels clear of the y-axis
    const vals = rows.map((r) => r.n);
    const ticks = Charts.niceTicks(0, Math.max(...vals, 1), 4);
    const yMax = ticks[ticks.length - 1] || 1;
    const X = (i) => padL + inset + i / (months.length - 1) * (iw - 2 * inset);
    const Y = (v) => padT + (1 - v / yMax) * ih;
    const inFy = (i) => fyIdx != null && i >= fyIdx;
    const grid = ticks.map((t) => `<line x1="${padL}" y1="${Y(t).toFixed(1)}" x2="${padL + iw}" y2="${Y(t).toFixed(1)}" stroke="var(--ink-10)"/>
      <text x="${padL - 6}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end" class="ax">${fmtInt(t)}</text>`).join('');
    const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
    const context = `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--ink-55)" stroke-width="1.8" stroke-linejoin="round"/>`;
    const focus = fyIdx != null && fyIdx < months.length - 1
      ? `<polyline points="${pts.slice(fyIdx).join(' ')}" fill="none" stroke="var(--red)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`
      : '';
    const fyMark = fyIdx != null && fyIdx > 0 ? (() => {
      const x = ((X(fyIdx - 1) + X(fyIdx)) / 2).toFixed(1);
      return `<line x1="${x}" y1="${padT - 4}" x2="${x}" y2="${padT + ih}" stroke="var(--ink-40)" stroke-dasharray="2 3"/>
        <text x="${(+x + 4).toFixed(1)}" y="${(padT + ih - 5).toFixed(1)}" class="ax">FY start</text>`;
    })() : '';
    const marks = vals.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.2" fill="${inFy(i) ? 'var(--red)' : 'var(--ink-70)'}" stroke="var(--white)" stroke-width="1.2"/>
      <text x="${X(i).toFixed(1)}" y="${(Y(v) - 8).toFixed(1)}" text-anchor="middle" class="jn-pt">${fmtInt(v)}</text>`).join('');
    const xl = months.map((mi, i) => `<text x="${X(i).toFixed(1)}" y="${h - 8}" text-anchor="middle" class="ax">${esc(monthIdxToLabel(mi))}</text>`).join('');
    const strips = months.map((mi, i) => {
      const r = rows[i];
      const types = ENUMS.hireType.filter((t) => r.types.has(t)).map((t) => `${t} ${fmtInt(r.types.get(t))}`).join(' · ');
      const tip = [monthIdxToLabel(mi) + (inFy(i) ? ' (current FY)' : ''), `Hires: ${fmtInt(r.n)}`, `Women: ${fmtInt(r.women)}`, types].filter(Boolean).join('\n');
      const x0 = i === 0 ? padL : (X(i - 1) + X(i)) / 2;
      const x1 = i === months.length - 1 ? padL + iw : (X(i) + X(i + 1)) / 2;
      return `<rect x="${x0.toFixed(1)}" y="${padT}" width="${Math.max(0, x1 - x0).toFixed(1)}" height="${ih}" fill="transparent" data-tip="${esc(tip)}"/>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" preserveAspectRatio="xMidYMid meet" class="jn-trend">
      <title>Hires per month, ${esc(monthIdxToLabel(months[0]))} to ${esc(monthIdxToLabel(months[months.length - 1]))}</title>
      ${grid}${fyMark}${context}${focus}${marks}${xl}${strips}</svg>`;
  }

  function trendCard(m, ctx) {
    const months = [];
    for (let mi = ctx.endMonth - 12; mi <= ctx.endMonth; mi++) months.push(mi);
    const fyStart = fyStartMonthIdx(ctx.endMonth);
    const fyIdx = months.indexOf(fyStart);
    return Charts.card({
      title: 'Hiring trend — month on month', infoKey: 'join_hires_12m',
      sub: `${monthIdxToLabel(months[0])} – ${monthIdxToLabel(ctx.endMonth)} · current fiscal year in red · labels = hires in the month`,
      body: need([JoinKit.EMP], () => trendSVG(months, monthly(m, ctx, months), fyIdx < 0 ? null : fyIdx)),
      note: 'Hover a month for the women and hire-type split. Joiners who have since exited are included.'
    });
  }

  /* ---------- gender donut ---------- */

  function genderCard(pop) {
    let dropped = false;
    const items = Compute.countBy(pop, (e) => e.gender, ENUMS.gender).filter(({ n }) => {
      if (Access.suppressed(n)) { dropped = true; return false; }
      return n > 0;
    }).map(({ key, n }) => ({ label: key, value: n }));
    const total = items.reduce((s, i) => s + i.value, 0);
    return Charts.card({
      title: 'Hires by gender', sub: 'YTD · count (share of hires)', infoKey: 'join_women_pct',
      body: need([JoinKit.EMP], () => (items.length
        ? Charts.donut({ items, centerLabel: `${fmtInt(total)} hires` })
        : '<div class="chart-empty">No hires in the fiscal year to date for this scope.</div>')),
      note: dropped ? `Segments with fewer than ${CONFIG.minCell} hires are not drawn for this persona; shares are of the drawn total.` : ''
    });
  }

  /* ---------- asset cut (persona chart scopes, click to focus) ---------- */

  function assetCard(m, ctx) {
    const assets = Access.chartScopes().filter((a) => a !== 'Group');
    const counts = assets.map((a) => [a, JoinKit.ytd(m, { ...ctx, asset: a }).length]);
    const total = counts.reduce((s, [, n]) => s + n, 0);
    const locked = !!Access.lockedAsset();
    const items = counts.map(([a, n]) => {
      const hide = Access.suppressed(n);
      const share = total ? fmtPct(n / total * 100, 1) : '—';
      return {
        label: a, value: hide ? null : n, role: a === ctx.asset ? 'focus' : undefined,
        sub: hide ? `<${CONFIG.minCell} · suppressed` : share,
        tip: hide ? `${a}: fewer than ${CONFIG.minCell} hires — suppressed` : `${a}: ${fmtInt(n)} hires (${share})${locked ? '' : '\nClick to focus ' + a}`,
        setAsset: locked ? null : a
      };
    });
    return Charts.card({
      title: 'Hires by asset', infoKey: 'join_hires_ytd',
      sub: locked ? 'YTD · own asset only' : 'YTD · click a bar to focus that asset',
      body: need([JoinKit.EMP], () => barsOrEmpty(items, 'No assets in this persona’s scope.'))
    });
  }

  /* ---------- hiring details table ---------- */

  function detailsCard(m, ctx) {
    let body, sub = 'fiscal YTD joiners, newest first';
    if (!App.state.datasets.has(JoinKit.EMP)) {
      body = need([JoinKit.EMP], () => '');
    } else if (Access.level('join_hires_ytd') !== 'full') {
      body = `<div class="chart-empty jn-withheld">${Access.LOCK_SVG} Row-level detail withheld for ${esc(Access.label())} — hiring is aggregate-only in this profile. The tiles above are the aggregate.</div>`;
    } else {
      const raw = JoinKit.drill(m, ctx, null, 'Hires');
      const t = Access.maskTable(raw.columns, raw.rows);
      if (!t) {
        body = `<div class="chart-empty jn-withheld">${Access.LOCK_SVG} Row-level detail withheld for ${esc(Access.label())} — identifiers: none. The tiles above are the aggregate.</div>`;
      } else {
        const masked = t.columns !== raw.columns;
        const shown = t.rows.slice(0, TABLE_ROWS);
        sub = `fiscal YTD joiners, newest first · ${fmtInt(raw.rows.length)} rows${masked ? ' · identifiers masked' : ''}`;
        body = (masked ? `<div class="chart-note jn-masknote">Identifiers are pseudonymised for ${esc(Access.label())} — stable within this browser session only; names are not shown.</div>` : '') +
          (raw.rows.length ? `<div class="jn-table">${UI.tableHTML(t.columns, shown)}</div>
            <div class="jn-table-foot"><span>${shown.length < raw.rows.length ? `Showing the latest ${fmtInt(shown.length)} of ${fmtInt(raw.rows.length)} joiners.` : `All ${fmtInt(raw.rows.length)} joiners shown.`}</span>
              <button class="btn btn-outline" data-drill="join_hires_ytd">All ${fmtInt(raw.rows.length)} rows → view / CSV</button></div>`
            : '<div class="chart-empty">No hires in the fiscal year to date for this scope.</div>');
      }
    }
    return Charts.card({ title: 'Hiring details — employee-wise', sub, infoKey: 'join_hires_ytd', body });
  }

  /* ---------- page ---------- */

  function generationNote() {
    return 'Birth-year cohorts: ' + CONFIG.generations.map(([g, lo, hi]) =>
      `${g} ${lo === -Infinity ? '≤' + (hi - 1) : hi === Infinity ? lo + '+' : lo + '–' + String(hi - 1).slice(2)}`).join(' · ');
  }

  return (panel) => {
    const m = Compute.build(), ctx = Compute.ctxNow();
    const has = App.state.datasets.has(JoinKit.EMP);
    const pop = has ? JoinKit.ytd(m, ctx) : [];
    const fy = JoinKit.fyLabel(ctx);
    const small = Access.suppressionOn() ? ` · cuts below ${CONFIG.minCell} hires suppressed for this persona` : '';
    const mcOrder = [...new Set(pop.map((e) => JoinKit.mcOf(m, e)).filter(Boolean))].sort();

    panel.innerHTML = `
      <div class="section-head"><h2>New joiners — ${esc(fy)} YTD</h2>
        <span class="sub">${esc(JoinKit.ytdRange(ctx))} · Date of Joining ${esc(fmtDMY(JoinKit.ytdFrom(ctx)))} → ${esc(fmtDMY(ctx.asOfDay))} · joiners who have since exited included · the period selector does not apply</span></div>
      <div class="tile-grid jn-tiles">${TILE_KEYS.map((k) => UI.tileHTML(k)).join('')}</div>

      <div class="section-head"><h2>Hiring trend &amp; mix</h2>
        <span class="sub">monthly hires, and the YTD split by gender${esc(small)}</span></div>
      <div class="card-grid jn-lead">${trendCard(m, ctx)}${genderCard(pop)}</div>

      <div class="section-head"><h2>Where hires landed</h2>
        <span class="sub">YTD hires by legal entity, asset, plant / department unit and management-committee owner</span></div>
      <div class="card-grid jn-grid">
        ${dimCard(m, pop, { title: 'Hires by company', sub: 'YTD · legal entity (employee column, else org_units)', keyFn: (e) => JoinKit.companyOf(m, e) })}
        ${assetCard(m, ctx)}
        ${dimCard(m, pop, { title: 'Hires by function plant', sub: 'YTD · largest first · scroll for every unit', col: 'function_plant', colName: 'Function Plant', keyFn: (e) => e.function_plant, scroll: true })}
        ${dimCard(m, pop, { title: 'Hires by MC member', sub: 'YTD · MC owner of the joiner’s function plant', keyFn: (e) => JoinKit.mcOf(m, e) || '(unmapped)', order: mcOrder, datasets: [JoinKit.EMP, 'org_units'], note: 'Resolved from org_units.csv by Function Plant — role codes only, never names. Units missing from org_units show as (unmapped).' })}
      </div>

      <div class="section-head"><h2>Who was hired</h2>
        <span class="sub">YTD hires by channel, grade-ladder level (senior → junior), management band and generation</span></div>
      <div class="card-grid jn-grid">
        ${dimCard(m, pop, { title: 'Hires by type of hire', sub: 'YTD · channel on the employee master', col: 'hire_type', colName: 'Hire Type', keyFn: (e) => e.hire_type, order: ENUMS.hireType })}
        ${dimCard(m, pop, { title: 'Hires by generation', sub: 'YTD · birth-year cohort from DOB', col: 'dob', colName: 'DOB', keyFn: (e) => generationOf(e.dob), order: CONFIG.generations.map((g) => g[0]), note: generationNote() })}
        ${dimCard(m, pop, { title: 'Hires by level', sub: 'YTD · ladder order (CONFIG.levels)', col: 'level', colName: 'Level', keyFn: (e) => e.level, order: CONFIG.levels })}
        ${dimCard(m, pop, { title: 'Hires by management band', sub: 'YTD · SM / MM / JM / Blue collar', col: 'mgmt_band', colName: 'Management Band', keyFn: (e) => e.mgmt_band, order: CONFIG.mgmtBands, labelOf: (k) => CONFIG.mgmtBandLabels[k] || k, tipOf: (k) => k })}
      </div>

      <div class="section-head"><h2>Row-level detail</h2>
        <span class="sub">${esc(Access.PII_LABEL[Access.pii()] || '')} for ${esc(Access.label())}</span></div>
      <div class="jn-details">${detailsCard(m, ctx)}</div>`;
  };
})();
