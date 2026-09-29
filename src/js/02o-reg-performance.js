/* Registry — Performance tab (R6): the goal-setting → mid-year → annual review
   cycle. Flags and statuses only, never ratings. Every metric here is access
   class 'perf'; goal_setting_pct and midyear_review_pct live in
   02i-reg-additions.js (tab 'performance') and use the same definitions.

   PerfKit is this feature's one namespace: the phase model and the cuts shared
   by these metrics and tabs/performance.js. Denominators match
   Compute.pmsCompletion — pms_status rows whose employee matches the context
   (asset, grade band, business segment, function); rows whose Employee ID is
   not in the master count only when no filter narrows the scope. */

const PerfKit = (() => {

  // cycle order; each phase's statuses run Not started → … → final (ENUMS)
  const PHASES = [
    {
      id: 'goal', label: 'Goal setting', key: 'goal_setting_pct', base: 'In cycle',
      flag: 'goal_flag', status: 'goal_status', enumId: 'goalStatus',
      flagCol: 'Goal Setting Complete Flag', statusCol: 'Goal Setting Status',
      waiting: 'Submitted', waitLabel: 'Goal approval'
    },
    {
      id: 'midyear', label: 'Mid-year review', key: 'midyear_review_pct', base: 'In cycle',
      flag: 'midyear_flag', status: 'midyear_status', enumId: 'midYearStatus',
      flagCol: 'Mid-Year Review Complete Flag', statusCol: 'Mid-Year Status',
      waiting: 'Self-review done', waitLabel: 'Mid-year review'
    },
    {
      // blank flag = not in scope for the annual cycle (e.g. joined after its cut-off)
      id: 'annual', label: 'Annual review', key: 'annual_review_pct', base: 'In scope', scoped: true,
      flag: 'annual_flag', status: 'annual_status', enumId: 'annualStatus',
      flagCol: 'Annual Review Complete Flag', statusCol: 'Annual Review Status',
      waiting: 'Self-appraisal done', waitLabel: 'Annual review'
    }
  ];
  const BY_ID = new Map(PHASES.map((p) => [p.id, p]));
  const phase = (id) => BY_ID.get(id) || PHASES[0];

  const NO_MGR = '(no manager on record)';
  const NO_EMP = '(not in employee master)';
  const BLANK = '(blank)';

  /* ---------- population ---------- */

  // memo per model + context: the tab asks for many cuts of the same rows
  let memoM = null;
  const memo = new Map();
  function rows(m, ctx) {
    if (memoM !== m) { memoM = m; memo.clear(); }
    const k = [ctx.asset, ctx.band, ctx.segment, ctx.fn].join('|');
    if (memo.has(k)) return memo.get(k);
    const unscoped = Compute.isUnscoped(ctx);
    const out = [];
    for (const r of m.pms) {
      const e = m.empById.get(r.employee_id) || null;
      if (e ? Compute.empMatch(e, ctx) : unscoped) out.push({ r, e });
    }
    memo.set(k, out);
    return out;
  }

  const inPhase = (r, p) => !p.scoped || r[p.flag] != null;
  const isDone = (r, p) => r[p.flag] === true;
  const waitingOn = (r, p) => inPhase(r, p) && r[p.status] === p.waiting;

  // status position in the phase ladder; a blank / unreadable status is placed
  // by its flag (Y → final, otherwise Not started) and reported as such
  function stageOf(r, p) {
    const list = ENUMS[p.enumId];
    const i = r[p.status] != null ? list.indexOf(r[p.status]) : -1;
    if (i >= 0) return { i, placed: false };
    return { i: isDone(r, p) ? list.length - 1 : 0, placed: true };
  }

  /* ---------- completion ---------- */

  function completion(m, ctx, id) {
    const p = phase(id);
    let n = 0, done = 0;
    for (const { r } of rows(m, ctx)) {
      if (!inPhase(r, p)) continue;
      n++;
      if (isDone(r, p)) done++;
    }
    return { n, done, pct: n ? done / n * 100 : null };
  }

  // completion by any dimension → [{key, n, done, pct}], ordered by `order`
  // (unlisted keys after, by size) or by size when no order is given
  function completionBy(m, ctx, id, keyFn, order) {
    const p = phase(id);
    const g = new Map();
    for (const x of rows(m, ctx)) {
      if (!inPhase(x.r, p)) continue;
      const k = keyFn(x) ?? BLANK;
      let c = g.get(k);
      if (!c) g.set(k, (c = { key: k, n: 0, done: 0 }));
      c.n++;
      if (isDone(x.r, p)) c.done++;
    }
    const pos = new Map((order || []).map((k, i) => [k, i]));
    return [...g.values()]
      .map((c) => ({ ...c, pct: c.n ? c.done / c.n * 100 : null }))
      .sort((a, b) => (pos.has(a.key) ? pos.get(a.key) : 1e9) - (pos.has(b.key) ? pos.get(b.key) : 1e9) ||
        (a.key === BLANK) - (b.key === BLANK) || b.n - a.n || (a.key < b.key ? -1 : 1));
  }

  // functions with the lowest completion; eligibility needs n ≥ CONFIG.minCell
  function laggards(m, ctx, id, limit = 5) {
    return completionBy(m, ctx, id, ({ e }) => e?.function ?? null)
      .filter((c) => c.key !== BLANK && c.n >= CONFIG.minCell)
      .sort((a, b) => a.pct - b.pct || b.n - a.n || (a.key < b.key ? -1 : 1))
      .slice(0, limit);
  }

  /* ---------- status funnel ---------- */

  // reach[k] = employees at or beyond status k; at[k] = employees exactly at k
  function funnel(m, ctx, id) {
    const p = phase(id), list = ENUMS[p.enumId];
    const reach = list.map(() => 0), at = list.map(() => 0);
    let n = 0, placed = 0, mismatch = 0;
    for (const { r } of rows(m, ctx)) {
      if (!inPhase(r, p)) continue;
      n++;
      const s = stageOf(r, p);
      if (s.placed) placed++;
      else if ((s.i === list.length - 1) !== isDone(r, p)) mismatch++;
      at[s.i]++;
      for (let k = 0; k <= s.i; k++) reach[k]++;
    }
    const stages = [{ label: p.base, value: n }].concat(list.slice(1).map((s, k) => ({
      label: k === list.length - 2 ? s : s + ' or beyond', value: reach[k + 1]
    })));
    return { phase: p, statuses: list, n, at, reach, stages, placed, mismatch };
  }

  /* ---------- items awaiting the line manager ---------- */

  function awaitingCount(m, ctx, id) {
    const ps = id ? [phase(id)] : PHASES;
    return rows(m, ctx).filter(({ r }) => ps.some((p) => waitingOn(r, p))).length;
  }

  const modeOf = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] || '';

  // one row per line manager with ≥1 report awaiting their action; team, asset
  // and function come from the in-scope reports only (never the manager's own row)
  function byManager(m, ctx) {
    const g = new Map();
    for (const { r, e } of rows(m, ctx)) {
      const id = e ? (e.manager_id || NO_MGR) : NO_EMP;
      let c = g.get(id);
      if (!c) g.set(id, (c = { id, team: 0, goal: 0, midyear: 0, annual: 0, employees: 0, assets: new Map(), fns: new Map() }));
      c.team++;
      if (e?.asset) c.assets.set(e.asset, (c.assets.get(e.asset) || 0) + 1);
      if (e?.function) c.fns.set(e.function, (c.fns.get(e.function) || 0) + 1);
      let any = false;
      for (const p of PHASES) if (waitingOn(r, p)) { c[p.id]++; any = true; }
      if (any) c.employees++;
    }
    // the unattributable buckets (no manager / not in master) always sort last
    return [...g.values()].filter((c) => c.employees > 0)
      .map((c) => ({ ...c, named: c.id !== NO_MGR && c.id !== NO_EMP, asset: modeOf(c.assets), fn: modeOf(c.fns) }))
      .sort((a, b) => b.named - a.named || b.employees - a.employees || b.team - a.team || (a.id < b.id ? -1 : 1));
  }

  const MANAGER_COLUMNS = ['Manager', 'Asset', 'Function', 'Team in cycle',
    ...PHASES.map((p) => p.waitLabel), 'Employees awaiting'];
  const managerRow = (c) => [c.id, c.asset || '—', c.fn || '—', fmtInt(c.team),
    ...PHASES.map((p) => fmtInt(c[p.id])), fmtInt(c.employees)];

  /* ---------- drills (row-level; openDrill masks them per persona) ---------- */

  function pendingDrill(m, ctx, id, cap = 200) {
    const p = phase(id), list = ENUMS[p.enumId];
    const pend = rows(m, ctx).filter(({ r }) => inPhase(r, p) && !isDone(r, p))
      .map((x) => ({ ...x, s: stageOf(x.r, p).i }))
      .sort((a, b) => a.s - b.s || String(a.e?.asset).localeCompare(String(b.e?.asset)) ||
        String(a.r.employee_id).localeCompare(String(b.r.employee_id)));
    const shown = pend.slice(0, cap);
    return {
      title: `${p.label} not complete (${fmtInt(pend.length)}${pend.length > cap ? ', first ' + cap + ' shown' : ''})`,
      columns: ['Employee', 'Asset', 'Function', 'Level', p.statusCol, 'Manager'],
      rows: shown.map(({ r, e }) => [r.employee_id, e?.asset || NO_EMP, e?.function || '—', e?.level || '—',
        r[p.status] || `${BLANK} → ${list[stageOf(r, p).i]}`, e ? (e.manager_id || NO_MGR) : NO_EMP])
    };
  }

  function managerDrill(m, ctx, cap = 200) {
    const all = byManager(m, ctx);
    return {
      title: `Line managers with reports awaiting their action (${fmtInt(all.length)}${all.length > cap ? ', first ' + cap + ' shown' : ''})`,
      columns: MANAGER_COLUMNS,
      rows: all.slice(0, cap).map(managerRow)
    };
  }

  // phase completion per asset in scope — aggregate, no identifiers
  function assetDrill(m, ctx) {
    const scopes = CONFIG.assets.filter((a) => Compute.inAsset(ctx, a));
    const line = (label, c) => {
      const byPh = PHASES.map((p) => completion(m, c, p.id));
      return [label, fmtInt(byPh[0].n), ...byPh.map((x) => (x.pct == null ? '—' : fmtPct(x.pct, 1))), fmtInt(byPh[2].n)];
    };
    const rowsOut = scopes.map((a) => line(a, { ...ctx, asset: a }));
    if (scopes.length > 1) rowsOut.push(line('Group', ctx));
    return {
      title: 'Cycle completion by asset',
      columns: ['Asset', 'In cycle', ...PHASES.map((p) => p.label), 'In annual scope'],
      rows: rowsOut
    };
  }

  // tab-local view state (memory only): the phase the "Completion by" cuts show
  const state = { phase: 'midyear' };

  return {
    state, PHASES, phase, rows, inPhase, isDone, waitingOn, stageOf,
    completion, completionBy, laggards, funnel, awaitingCount, byManager,
    MANAGER_COLUMNS, managerRow, pendingDrill, managerDrill, assetDrill,
    NO_MGR, NO_EMP, BLANK
  };
})();

/* =================== Performance management (tab 'performance') =================== */

defineMetric({
  key: 'annual_review_pct', label: 'Annual review completion', tab: 'performance', access: 'perf',
  group: 'Performance management', unit: '%', direction: 'higher', snapshot: true, scorecard: 'Performance & Rewards',
  formulaText: 'Employees with Annual Review Complete Flag = Y\n÷ employees with the flag filled (in scope for the annual cycle) × 100',
  inputs: [{ dataset: 'pms_status', columns: ['Employee ID', 'Annual Review Complete Flag', 'Annual Review Status'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band', 'Function', 'Business Segment', 'Level', 'Manager ID'] }],
  caveat: 'A blank flag means not in scope for the annual cycle (e.g. joined after its cut-off) — left out of the denominator, not counted as pending. The drill-down lists who is still open, least progressed first.',
  compute: (m, ctx) => (m.has('pms_status') ? PerfKit.completion(m, ctx, 'annual').pct : null),
  quality: (m, ctx) => {
    const f = PerfKit.funnel(m, ctx, 'annual');
    return f.mismatch ? `${fmtInt(f.mismatch)} rows where Annual Review Status and the complete flag disagree — the tile follows the flag` : null;
  },
  drill: (m, ctx) => PerfKit.pendingDrill(m, ctx, 'annual')
});

defineMetric({
  key: 'perf_cycle_headcount', label: 'Employees in the cycle', tab: 'performance', access: 'perf',
  group: 'Performance management', unit: '', decimals: 0, direction: null,
  formulaText: 'pms_status rows whose Employee ID matches the filters (asset, grade band,\nbusiness segment, function) — count\n(rows not in the employee master count only when no filter is applied)',
  inputs: [{ dataset: 'pms_status', columns: ['Employee ID'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band', 'Function', 'Business Segment'] }],
  caveat: 'The denominator of goal-setting and mid-year completion. A current-cycle snapshot — the period selector does not apply. The drill-down is the phase-by-asset completion table.',
  compute: (m, ctx) => (m.has('pms_status') ? PerfKit.rows(m, ctx).length : null),
  drill: (m, ctx) => PerfKit.assetDrill(m, ctx)
});

defineMetric({
  key: 'perf_awaiting_manager', label: 'Awaiting line-manager action', tab: 'performance', access: 'perf',
  group: 'Performance management', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Employees in the cycle whose own step is done and the manager’s is next —\nGoal Setting Status = Submitted, or Mid-Year Status = Self-review done,\nor Annual Review Status = Self-appraisal done (annual scope only) — count, each employee once',
  inputs: [{ dataset: 'pms_status', columns: ['Employee ID', 'Goal Setting Status', 'Mid-Year Status', 'Annual Review Status', 'Annual Review Complete Flag'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band', 'Function', 'Business Segment', 'Manager ID'] }],
  caveat: 'A status snapshot, not ageing — the template carries no step dates, so this cannot say how long an item has waited. The drill-down lists the line managers holding them (identifiers follow the persona’s PII level).',
  compute: (m, ctx) => (m.has('pms_status') ? PerfKit.awaitingCount(m, ctx) : null),
  quality: (m, ctx) => {
    const blank = PerfKit.rows(m, ctx).filter(({ r }) => r.goal_status == null && r.midyear_status == null && r.annual_status == null).length;
    const n = PerfKit.rows(m, ctx).length;
    return n && blank / n >= 0.5 ? `${fmtPct(blank / n * 100, 0)} of cycle rows carry no phase status — the count needs the status columns` : null;
  },
  drill: (m, ctx) => PerfKit.managerDrill(m, ctx)
});
