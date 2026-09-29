/* Managers tab (R7) — Manager Demographics / Scope of Manager.
   Tiles are registry-driven (02p-reg-managers.js) and always cover the full
   filtered scope. The Scope Bucket filter (CONFIG.scopeBuckets on direct-report
   counts) is local to this tab and re-scopes only its charts and the manager
   details table. Every cut keys on the manager's own record; each dimension is
   drawn as an aligned pair — line managers (left) and manager-to-employee ratio
   (right, same rows). Per-asset cuts iterate Access.chartScopes(); persona-
   restricted small cells read "<5"; the details table needs the 'full' level
   and goes through Access.maskTable. */

TabRenderers.managers = (() => {

  let bucket = 'All';                 // tab-local Scope Bucket filter
  const SUPP = -1;                    // bar value withheld under the small-cell rule
  const PLANT_TOP = 12;
  const TABLE_MAX = 500;
  const LABEL_MAX = 19;               // barH label gutter; the full name stays in the tooltip

  const cnt = (n) => (Access.suppressed(n) ? SUPP : n);
  const fmtCnt = (v) => (v === SUPP ? `<${CONFIG.minCell}` : fmtInt(v));
  const share = (n, of) => (of && !Access.suppressed(n) ? ` (${fmtPct(n / of * 100, 1)})` : '');
  // a report total next to a withheld manager count would give the count away
  const reportsNote = (mgrs, reports) => (Access.suppressed(mgrs) ? '' : ` · ${fmtInt(reports)} direct reports`);
  const short = (s) => (s.length > LABEL_MAX ? s.slice(0, LABEL_MAX - 1) + '…' : s);
  const inBucket = (list) => (bucket === 'All' ? list : list.filter((x) => x.bucket === bucket));
  const bucketText = () => (bucket === 'All' ? 'all scope buckets' : `${bucket} direct reports`);
  const empty = () => `<div class="chart-empty">No line managers with ${esc(bucketText())} in this scope.</div>`;
  const bar = (items, fmt, target = null) => Charts.barH({ items, fmt, target });
  const ratioFmt = (v) => fmtNum(v, 1);

  /* ---------- rows → bar items (count and ratio share the same rows) ---------- */

  // one row per chart scope (assets the persona may see, then Group)
  function assetRows(m, ctx) {
    return Access.chartScopes().map((a) => {
      const s = MgrKit.summary(inBucket(MgrKit.managers(m, { ...ctx, asset: a })));
      return { key: a, label: a, mgrs: s.mgrs, reports: s.reports, ratio: s.ratio, focus: a === ctx.asset, setAsset: Access.lockedAsset() ? null : a };
    });
  }

  function countItems(rows, total) {
    return rows.map((r) => ({
      label: short(r.label), value: cnt(r.mgrs), role: r.focus ? 'focus' : undefined, setAsset: r.setAsset || null,
      tip: `${r.label}: ${fmtCnt(cnt(r.mgrs))} line managers${r.key === 'Group' ? '' : share(r.mgrs, total)}${reportsNote(r.mgrs, r.reports)}${!r.setAsset ? '' : r.key === 'Group' ? '\nClick to reset focus' : '\nClick to focus ' + r.label}`
    }));
  }

  function ratioItems(rows) {
    return rows.map((r) => {
      const small = Access.suppressed(r.mgrs);
      return {
        label: short(r.label), value: small ? null : r.ratio, role: r.focus ? 'focus' : undefined, setAsset: r.setAsset || null,
        sub: small ? `n<${CONFIG.minCell}` : '',        // reports ÷ managers sit in the tooltip
        tip: small ? `${r.label}: fewer than ${CONFIG.minCell} line managers — ratio withheld`
          : `${r.label}: 1 : ${fmtNum(r.ratio, 1)}\n${fmtInt(r.reports)} direct reports ÷ ${fmtInt(r.mgrs)} line managers`
      };
    });
  }

  /* ---------- sections ---------- */

  function scopeBar(all) {
    const counts = new Map(CONFIG.scopeBuckets.map(([label]) => [label, 0]));
    for (const x of all) if (x.bucket) counts.set(x.bucket, counts.get(x.bucket) + 1);
    const btn = (id, n) => `<button type="button" class="mg-scope-btn" data-mg-scope="${esc(id)}"
      aria-pressed="${bucket === id}">${esc(id)}<span class="mg-n">${esc(Access.cellText(n))}</span></button>`;
    const shown = inBucket(all).length;
    return `<div class="mg-toolbar">
      <div class="mg-scope" role="group" aria-label="Scope bucket — direct reports per line manager">
        <span class="mg-scope-label" aria-hidden="true">Scope bucket</span>
        ${btn('All', all.length)}${CONFIG.scopeBuckets.map(([label]) => btn(label, counts.get(label))).join('')}
      </div>
      <div class="mg-scope-note" id="mg-scope-note">${bucket === 'All'
        ? `Charts and table cover all ${esc(Access.cellText(all.length))} line managers.`
        : `Charts and table: <strong>${esc(Access.cellText(shown))}</strong> of ${esc(Access.cellText(all.length))} line managers with ${esc(bucket)} direct reports.`}
        Tiles stay on the full scope.</div>
    </div>`;
  }

  // share base for the asset rows: the Group row when drawn, else the drawn assets
  const totalOf = (rows) => rows.find((r) => r.key === 'Group')?.mgrs ?? rows.reduce((t, r) => t + r.mgrs, 0);

  // one aligned pair per dimension: line managers | manager-to-employee ratio
  function pairCards(m, ctx, list) {
    const target = Compute.metric('mgr_emp_ratio').target?.value ?? null;
    const plantsAll = MgrKit.cut(list, 'plant');
    const dims = [
      { id: 'asset', rows: assetRows(m, ctx), subL: 'manager’s own asset · click a bar to focus', always: true },
      { id: 'band', rows: MgrKit.cut(list, 'band'), subL: 'management band (SM / MM / JM / Blue Collar)' },
      { id: 'level', rows: MgrKit.cut(list, 'level'), subL: 'grade ladder, senior → junior' },
      { id: 'plant', rows: plantsAll.slice(0, PLANT_TOP), subL: `largest ${Math.min(PLANT_TOP, plantsAll.length)} of ${plantsAll.length} plants by line managers`,
        note: plantsAll.length > PLANT_TOP ? 'Every plant appears in the manager details table below.' : '' }
    ];
    return dims.map((d) => {
      const name = MgrKit.DIMS[d.id].label.toLowerCase();
      const has = d.always || list.length;
      return Charts.card({
        title: `Line managers by ${name}`, sub: d.subL, infoKey: 'line_managers',
        body: has ? bar(countItems(d.rows, d.id === 'asset' ? totalOf(d.rows) : list.length), fmtCnt) : empty(), note: d.note || ''
      }) + Charts.card({
        title: `Manager-to-employee ratio by ${name}`, sub: '1 : n — direct reports ÷ line managers, same rows · counts on hover', infoKey: 'mgr_emp_ratio',
        body: has ? bar(ratioItems(d.rows), ratioFmt, target) : empty()
      });
    }).join('');
  }

  function structureCards(all, list) {
    const dist = CONFIG.scopeBuckets.map(([label]) => {
      const rows = all.filter((x) => x.bucket === label);
      const n = rows.length;
      return {
        label, value: cnt(n), role: label === bucket ? 'focus' : undefined,
        tip: `${label} direct reports: ${fmtCnt(cnt(n))} line managers${share(n, all.length)}${reportsNote(n, rows.reduce((t, x) => t + x.n, 0))}`
      };
    });
    const levels = MgrKit.cut(list, 'level').filter((r) => r.key !== '(blank)');
    const sameItems = levels.map((r) => ({
      label: r.label, value: cnt(r.same), sub: `of ${fmtCnt(cnt(r.mgrs))}`,
      tip: `${r.label}: ${fmtCnt(cnt(r.same))} of ${fmtCnt(cnt(r.mgrs))} line managers have ≥1 direct report at ${r.label}${share(r.same, r.mgrs)}`
    }));
    // donut only when every category can be shown: a withheld category would
    // inflate the others' shares, and a single 100% segment has no arc to draw
    const genders = MgrKit.cut(list, 'gender');
    const withheld = genders.filter((g) => Access.suppressed(g.mgrs)).length;
    const asBars = withheld > 0 || genders.length < 2;
    return [
      Charts.card({
        title: 'Line managers by scope bucket', sub: 'direct reports per manager · selected bucket in red', infoKey: 'line_managers',
        body: all.length ? bar(dist, fmtCnt) : empty()
      }),
      Charts.card({
        title: 'Manager level = employee level', sub: 'managers with ≥1 direct report at their own level · of all at that level', infoKey: 'mgr_same_level',
        body: levels.length ? bar(sameItems, fmtCnt) : empty()
      }),
      Charts.card({
        title: 'Line managers by gender', sub: 'share of line managers in the selection', infoKey: 'mgr_women_pct',
        body: !list.length ? empty() : asBars ? bar(countItems(genders, list.length), fmtCnt)
          : Charts.donut({ items: genders.map((g) => ({ label: g.label, value: g.mgrs })), centerLabel: 'line managers' }),
        note: withheld ? `Shown as bars — ${withheld === 1 ? 'a category' : withheld + ' categories'} under ${CONFIG.minCell} withheld (small-cell rule).` : ''
      })
    ].join('');
  }

  function tableHTML(cols, rows) {
    const num = (c) => c === 'Direct reports';
    return `<div class="table-scroll mg-table-wrap" tabindex="0" role="region" aria-label="Manager details">
      <table class="data-table mg-table">
        <thead><tr>${cols.map((c) => `<th scope="col"${num(c) ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td${num(cols[i]) ? ' class="num"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
  }

  // → {html, table}: table = the (masked) rows behind the CSV button, or null when withheld
  function detailsBlock(list) {
    const who = esc(Access.label());
    if (Access.level('line_managers') !== 'full') {
      return { table: null, html: `<div class="empty-note mg-withheld">${Access.LOCK_SVG} Manager details withheld — ${who} sees
        organisation data as aggregates only. The tiles and charts above carry the counts.</div>` };
    }
    const all = MgrKit.rows(list);
    const shown = all.slice(0, TABLE_MAX);
    const t = Access.maskTable(MgrKit.COLS, shown);
    if (!t) {
      return { table: null, html: `<div class="empty-note mg-withheld">${Access.LOCK_SVG} Manager details withheld — the ${who}
        persona sees no row-level detail (identifiers: none). The tiles and charts above carry the counts.</div>` };
    }
    const masked = t.columns !== MgrKit.COLS;
    const title = `Manager details — ${bucketText()}${masked ? ' — identifiers masked' : ''}`;
    return {
      table: { title, columns: t.columns, rows: t.rows },
      html: `<div class="mg-table-head">
          <span class="mg-table-count">${fmtInt(shown.length)}${all.length > shown.length ? ` of ${fmtInt(all.length)}` : ''} line managers · most direct reports first</span>
          <button type="button" class="btn btn-outline" data-mg-csv>Download table → CSV</button>
        </div>
        ${masked ? `<p class="chart-note">Identifiers are pseudonymised for ${who} — stable within this browser session only; names dropped.</p>` : ''}
        ${all.length > shown.length ? `<p class="chart-note">Showing the first ${fmtInt(TABLE_MAX)} — the full list is on the “Total line managers” tile drill-down.</p>` : ''}
        ${shown.length ? tableHTML(t.columns, t.rows) : empty()}`
    };
  }

  /* ---------- render ---------- */

  function render(panel) {
    const tiles = REGISTRY.filter((e) => e.tab === 'managers').map((e) => UI.tileHTML(e.key)).join('');
    const head = `<div class="section-head"><h2>Scope of manager</h2>
        <span class="sub">as of ${esc(CONFIG.asOf)} · cuts use the manager’s own record</span></div>
      <div class="tile-grid">${tiles}</div>`;
    if (!App.state.datasets.has('employee_master')) {
      panel.innerHTML = head + '<div class="chart-empty mg-gap">No data loaded for this tab — needs employee_master.csv (with Manager ID).</div>';
      return;
    }
    const m = Compute.build(), ctx = Compute.ctxNow();
    if (!MgrKit.hasLines(m)) {
      panel.innerHTML = head + '<div class="empty-note mg-gap">Manager ID is blank on every row of employee_master.csv — map the reporting-manager column on the Field Mapping step to build this tab.</div>';
      return;
    }
    const all = MgrKit.managers(m, ctx);
    const list = inBucket(all);
    const details = detailsBlock(list);
    panel.innerHTML = `${head}
      ${scopeBar(all)}
      <div class="section-head"><h2>Line managers &amp; manager-to-employee ratio</h2>
        <span class="sub">${esc(bucketText())} · left: count · right: 1 : n · hover for shares</span></div>
      <div class="card-grid mg-pairs">${pairCards(m, ctx, list)}</div>
      <div class="section-head"><h2>Structure &amp; gender</h2><span class="sub">${esc(bucketText())}</span></div>
      <div class="card-grid">${structureCards(all, list)}</div>
      <div class="section-head"><h2>Manager details</h2><span class="sub">${esc(bucketText())} · identifiers per persona</span></div>
      <div class="mg-details">${details.html}</div>`;

    for (const b of panel.querySelectorAll('[data-mg-scope]')) {
      b.addEventListener('click', () => {
        bucket = b.dataset.mgScope;
        render(panel);
        panel.querySelector(`[data-mg-scope="${CSS.escape(bucket)}"]`)?.focus();
      });
    }
    const csv = panel.querySelector('[data-mg-csv]');
    if (csv && details.table) csv.addEventListener('click', () => Exports.drillCSV(details.table));
  }

  return render;
})();
