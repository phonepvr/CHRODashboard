/* Registry — Managers tab (R7: Manager Demographics / Scope of Manager).
   Line manager = an active on-roll employee (Permanent or Trainee) referenced
   as Manager ID by ≥1 other active employee at the as-of date. Every cut keys
   on the MANAGER's own record (asset, grade band, segment, function, level,
   band, function plant): the filters select managers, and their direct reports
   are counted wherever those reports sit. Manager ID is a snapshot of the
   current reporting line, so the tab is as-of only (no history, no spark).
   MgrKit is the one namespace this feature adds; tabs/managers.js renders
   with it. Access class 'org' on every entry. */

const MgrKit = (() => {

  // unfiltered context: the direct-report index spans the whole roll
  const ALL = { asset: 'Group', band: 'All', segment: 'All', fn: 'All' };
  const idxCache = new WeakMap();   // model → Map(day → {byMgr, active})
  const setCache = new WeakMap();   // model → Map(ctx key → managers[])
  const lvl = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim().toUpperCase());

  // does the loaded employee master carry a reporting line at all?
  const hasLines = (m) => m.emps.some((e) => e.manager_id);

  function cacheFor(store, m) {
    let c = store.get(m);
    if (!c) { c = new Map(); store.set(m, c); }
    return c;
  }

  // direct-report index at a day: Manager ID → [active reports]; self-references ignored
  function reportsAt(m, day) {
    const c = cacheFor(idxCache, m);
    if (c.has(day)) return c.get(day);
    const byMgr = new Map(), active = new Set();
    for (const e of Compute.activesAt(m, ALL, null, day)) {
      active.add(e.employee_id);
      const mid = e.manager_id;
      if (!mid || mid === e.employee_id) continue;
      if (!byMgr.has(mid)) byMgr.set(mid, []);
      byMgr.get(mid).push(e);
    }
    const idx = { byMgr, active };
    c.set(day, idx);
    return idx;
  }

  // line managers in scope → [{e, n, same, bucket}] (n = direct reports,
  // same = direct reports at the manager's own Level, bucket = CONFIG.scopeBuckets)
  function managers(m, ctx) {
    const key = [ctx.asset, ctx.band, ctx.segment, ctx.fn, ctx.asOfDay].join('|');
    const c = cacheFor(setCache, m);
    if (c.has(key)) return c.get(key);
    const { byMgr } = reportsAt(m, ctx.asOfDay);
    const out = [];
    for (const e of Compute.activesAt(m, ctx, null, ctx.asOfDay)) {
      const reports = byMgr.get(e.employee_id);
      if (!reports || !reports.length) continue;
      const own = lvl(e.level);
      const same = own ? reports.filter((r) => lvl(r.level) === own).length : 0;
      out.push({ e, n: reports.length, same, bucket: bucketOf(reports.length, CONFIG.scopeBuckets) });
    }
    c.set(key, out);
    return out;
  }

  function summary(list) {
    let reports = 0, same = 0, women = 0;
    for (const x of list) {
      reports += x.n;
      if (x.same) same++;
      if (x.e.gender === 'Female') women++;
    }
    const mgrs = list.length;
    return { mgrs, reports, ratio: mgrs ? reports / mgrs : null, same, women, womenPct: mgrs ? women / mgrs * 100 : null };
  }

  // dimensions on the manager's own record; order = CONFIG ladder where one exists
  const DIMS = {
    asset: { label: 'Asset', of: (e) => e.asset, order: () => CONFIG.assets, name: (k) => k },
    band: { label: 'Band', of: (e) => e.mgmt_band || null, order: () => CONFIG.mgmtBands, name: (k) => CONFIG.mgmtBandLabels[k] || k },
    level: { label: 'Level', of: (e) => e.level || null, order: () => CONFIG.levels, name: (k) => k },
    plant: { label: 'Function Plant', of: (e) => e.function_plant || null, order: () => null, name: (k) => k },
    gender: { label: 'Gender', of: (e) => e.gender || null, order: () => ENUMS.gender, name: (k) => k }
  };

  // managers by a dimension → [{key, label, mgrs, reports, ratio, same}]
  function cut(list, dimId) {
    const d = DIMS[dimId];
    const agg = new Map();
    for (const x of list) {
      const k = d.of(x.e) ?? '(blank)';
      const a = agg.get(k) || { reports: 0, same: 0 };
      a.reports += x.n;
      if (x.same) a.same++;
      agg.set(k, a);
    }
    return Compute.countBy(list, (x) => d.of(x.e), d.order()).map(({ key, n }) => {
      const a = agg.get(key);
      return { key, label: d.name(key), mgrs: n, reports: a.reports, ratio: n ? a.reports / n : null, same: a.same };
    });
  }

  /* ---------- row-level detail (Access.maskTable / maskDrill downstream) ---------- */

  const COLS = ['Manager ID', 'Manager Name', 'Level', 'Band', 'Asset', 'Function Plant', 'Direct reports', 'Scope bucket'];
  const byReports = (a, b) => b.n - a.n || (a.e.employee_id < b.e.employee_id ? -1 : 1);
  const rowOf = (x) => [x.e.employee_id, x.e.name || '', x.e.level || '', x.e.mgmt_band || '', x.e.asset || '',
    x.e.function_plant || '', fmtInt(x.n), x.bucket || ''];
  const rows = (list) => list.slice().sort(byReports).map(rowOf);

  function detail(list, title) {
    return { title: `${title} (${fmtInt(list.length)})`, columns: COLS, rows: rows(list) };
  }

  function sameLevelDetail(list) {
    const sel = list.filter((x) => x.same).sort((a, b) => b.same - a.same || byReports(a, b));
    return {
      title: `Line managers with a same-level direct report (${fmtInt(sel.length)})`,
      columns: [...COLS, 'Same-level reports'],
      rows: sel.map((x) => [...rowOf(x), fmtInt(x.same)])
    };
  }

  /* ---------- data-quality notes ---------- */

  function lineQuality(m, ctx) {
    if (!hasLines(m)) return 'Manager ID is blank on every employee row — line managers cannot be derived';
    const { active } = reportsAt(m, ctx.asOfDay);
    const pop = Compute.activesAt(m, ctx, null, ctx.asOfDay);
    const withMgr = pop.filter((e) => e.manager_id && e.manager_id !== e.employee_id);
    if (!withMgr.length) return null;
    const dangling = withMgr.filter((e) => !active.has(e.manager_id)).length;
    const pct = dangling / withMgr.length * 100;
    return pct >= 1 ? `${fmtPct(pct, 0)} of employees in scope report to a Manager ID that is not an active employee` : null;
  }

  function levelQuality(m, ctx) {
    const list = managers(m, ctx);
    if (!list.length) return null;
    const blank = list.filter((x) => !lvl(x.e.level)).length;
    return blank ? `${fmtPct(blank / list.length * 100, 0)} of line managers have a blank Level — not compared` : null;
  }

  // compute guard: no reporting line at all → not computable (null), never a false 0
  const when = (m, f) => (hasLines(m) ? f() : null);

  return { hasLines, reportsAt, managers, summary, cut, DIMS, COLS, rows, detail, sameLevelDetail, lineQuality, levelQuality, when };
})();

/* =================== Managers (Scope of manager) =================== */

defineMetric({
  key: 'line_managers', label: 'Total line managers', tab: 'managers', access: 'org',
  group: 'Scope of manager', unit: '', decimals: 0, direction: null,
  formulaText: 'Active on-roll employees (Permanent + Trainee) referenced as Manager ID\nby ≥1 other active employee at the as-of date — count\n(asset, grade band, segment and function filters select on the manager’s own record)',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Manager ID', 'Asset', 'Grade Band', 'Function', 'Business Segment', 'Date of Joining', 'Employee Class'] }],
  caveat: 'Manager ID is a snapshot of the current reporting line, so this is an as-of count with no history. Direct reports are counted wherever they sit; dotted-line teams are not visible.',
  compute: (m, ctx) => MgrKit.when(m, () => MgrKit.managers(m, ctx).length),
  quality: (m, ctx) => MgrKit.lineQuality(m, ctx),
  drill: (m, ctx) => MgrKit.detail(MgrKit.managers(m, ctx), 'Line managers — manager details')
});

defineMetric({
  key: 'mgr_emp_ratio', label: 'Manager-to-employee ratio (1 : n)', tab: 'managers', access: 'org',
  group: 'Scope of manager', unit: '', decimals: 1, direction: null,
  formulaText: 'Σ active direct reports of the line managers in scope ÷ line managers in scope\n(n = average direct reports per line manager; read as 1 manager : n employees)',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Manager ID', 'Asset', 'Grade Band', 'Date of Joining', 'Employee Class'] }],
  caveat: 'Direct reports only (one level down) — not total scope through the reporting tree. Differs from Overview “Span of control” (individual contributors ÷ managers, permanent roll).',
  compute: (m, ctx) => MgrKit.when(m, () => MgrKit.summary(MgrKit.managers(m, ctx)).ratio),
  drill: (m, ctx) => MgrKit.detail(MgrKit.managers(m, ctx), 'Line managers by direct reports')
});

defineMetric({
  key: 'mgr_same_level', label: 'Managers at same level as a report', tab: 'managers', access: 'org',
  group: 'Scope of manager', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Line managers with ≥1 active direct report whose Level equals the manager’s own Level — count\n(a blank Level on either side is not compared)',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Manager ID', 'Level', 'Date of Joining', 'Employee Class'] }],
  caveat: 'A structural flag — same-level reporting usually signals a missing layer or a title-only grade. Needs the optional Level column.',
  compute: (m, ctx) => MgrKit.when(m, () => MgrKit.summary(MgrKit.managers(m, ctx)).same),
  quality: (m, ctx) => MgrKit.levelQuality(m, ctx),
  drill: (m, ctx) => MgrKit.sameLevelDetail(MgrKit.managers(m, ctx))
});

defineMetric({
  key: 'mgr_women', label: 'Women line managers', tab: 'managers', access: 'org',
  group: 'Scope of manager', unit: '', decimals: 0, direction: null,
  formulaText: 'Line managers with Gender = Female — count',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Manager ID', 'Gender', 'Date of Joining', 'Employee Class'] }],
  compute: (m, ctx) => MgrKit.when(m, () => MgrKit.summary(MgrKit.managers(m, ctx)).women),
  drill: (m, ctx) => MgrKit.detail(MgrKit.managers(m, ctx).filter((x) => x.e.gender === 'Female'), 'Women line managers')
});

defineMetric({
  key: 'mgr_women_pct', label: 'Women share of line managers', tab: 'managers', access: 'org',
  group: 'Scope of manager', unit: '%', decimals: 1, direction: 'higher',
  formulaText: 'Line managers with Gender = Female ÷ line managers × 100',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Manager ID', 'Gender', 'Date of Joining', 'Employee Class'] }],
  caveat: 'Compare with the female share of the workforce (Overview) — the gap is the managerial pipeline.',
  compute: (m, ctx) => MgrKit.when(m, () => MgrKit.summary(MgrKit.managers(m, ctx)).womenPct)
});
