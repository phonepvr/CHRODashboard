/* Registry — Absenteeism (R9): on-roll employees, absence_monthly.csv joined to
   the employee master by Employee ID, so asset / grade band / segment / function
   scoping all apply. Access class 'attendance'.
   Privacy (health data): the file holds DAY COUNTS ONLY — no leave reasons, no
   medical or sick-note data — and nothing here ever shows a reason. The
   frequent-absence cohort is a COUNT ONLY, never a list of people. Drills show
   per-employee day counts to 'identified' personas only; 'masked' personas get
   asset × function aggregates (small bases suppressed); 'none' is withheld.
   AbsKit is the one namespace for this feature (also used by tabs/absence.js). */

const AbsKit = (() => {

  const TRAIL = 3;           // frequent-absence window: trailing months
  const FREQ_SPELLS = 3;     // spells in the window that put an employee in the cohort

  /* ---------- join + month index (once per model) ---------- */

  const cache = new WeakMap();   // model → {byMonth: Map(mi → [{r, e}]), months: [mi…], orphans, overBooked, spellBlank, total}
  function index(m) {
    let ix = cache.get(m);
    if (ix) return ix;
    const byMonth = new Map();
    let orphans = 0, overBooked = 0, spellBlank = 0, total = 0;
    for (const r of m.absence) {
      if (r.month == null) continue;
      const e = r.employee_id != null ? m.empById.get(r.employee_id) || null : null;
      if (!byMonth.has(r.month)) byMonth.set(r.month, []);
      byMonth.get(r.month).push({ r, e });
      total++;
      if (!e) orphans++;
      if (r.absence_spells == null) spellBlank++;
      if ((r.days_present || 0) + (r.planned_leave_days || 0) + (r.unplanned_days || 0) > (r.scheduled_days || 0) + 0.01) overBooked++;
    }
    ix = { byMonth, months: [...byMonth.keys()].sort((a, b) => a - b), orphans, overBooked, spellBlank, total };
    cache.set(m, ix);
    return ix;
  }

  // Rows with no employee-master match carry no attributes: they count only in
  // the unfiltered Group view (the platform convention for orphan rows).
  const inScope = (ctx, e) => (e ? Compute.empMatch(e, ctx) : Compute.isUnscoped(ctx));

  function rows(m, ctx, from = ctx.startMonth, to = ctx.endMonth) {
    const ix = index(m);
    const out = [];
    for (let mi = from; mi <= to; mi++) {
      for (const x of (ix.byMonth.get(mi) || [])) if (inScope(ctx, x.e)) out.push(x);
    }
    return out;
  }

  const blank = () => ({ sched: 0, present: 0, planned: 0, unplanned: 0, spells: 0, spellRows: 0, rows: 0, emps: new Set() });
  function add(t, r) {
    t.sched += r.scheduled_days || 0;
    t.present += r.days_present || 0;
    t.planned += r.planned_leave_days || 0;
    t.unplanned += r.unplanned_days || 0;
    if (r.absence_spells != null) { t.spells += r.absence_spells; t.spellRows++; }
    t.rows++;
    t.emps.add(r.employee_id);
    return t;
  }
  function tally(list) {
    const t = blank();
    for (const { r } of list) add(t, r);
    return t;
  }

  /* ---------- one-pass asset × month grid (trend, heat table, sparks) ----------
     Rows are matched on every filter EXCEPT the asset, then booked to their own
     asset and to 'Group' — so a whole chart costs one scan, not one per scope.
     Memoised per model (new data ⇒ new model) and per filter set. */
  const gridCache = new WeakMap();
  function grid(m, ctx, from, to) {
    let per = gridCache.get(m);
    if (!per) { per = new Map(); gridCache.set(m, per); }
    const key = [ctx.band, ctx.segment, ctx.fn, from, to].join('|');
    if (per.has(key)) return per.get(key);
    const g = { ...ctx, asset: 'Group' };
    const out = new Map();   // scope → Map(mi → tally)
    const cell = (scope, mi) => {
      if (!out.has(scope)) out.set(scope, new Map());
      const row = out.get(scope);
      if (!row.has(mi)) row.set(mi, blank());
      return row.get(mi);
    };
    const ix = index(m);
    for (let mi = from; mi <= to; mi++) {
      for (const { r, e } of (ix.byMonth.get(mi) || [])) {
        if (!inScope(g, e)) continue;
        add(cell('Group', mi), r);
        if (e && e.asset) add(cell(e.asset, mi), r);
      }
    }
    per.set(key, out);
    return out;
  }
  // tally for one scope (asset | 'Group') and month from the grid
  const gridCell = (gr, scope, mi) => gr.get(scope)?.get(mi) || blank();
  // several months of one scope merged into one tally
  function gridSum(gr, scope, months) {
    const t = blank();
    for (const mi of months) {
      const c = gr.get(scope)?.get(mi);
      if (!c) continue;
      for (const k of ['sched', 'present', 'planned', 'unplanned', 'spells', 'spellRows', 'rows']) t[k] += c[k];
      for (const id of c.emps) t.emps.add(id);
    }
    return t;
  }

  const pct = (a, b) => (b > 0 ? a / b * 100 : null);
  const absPct = (t) => pct(t.unplanned, t.sched);
  const attPct = (t) => pct(t.present, t.sched);
  const planPct = (t) => pct(t.planned, t.sched);
  // spells per employee-year: Σ spells ÷ employee-months × 12 (rows with spells only)
  const spellsPerEmp = (t) => (t.spellRows ? t.spells / t.spellRows * 12 : null);

  const period = (m, ctx) => tally(rows(m, ctx));
  const month = (m, ctx, mi) => tally(rows(m, ctx, mi, mi));

  // months that carry absence rows, trimmed to the history window — the trend axis
  function dataMonths(m, ctx, max = Infinity) {
    const ms = index(m).months.filter((mi) => mi >= ctx.histStart && mi <= ctx.endMonth);
    if (!ms.length) return [];
    const out = [];
    for (let mi = Math.max(ms[0], ctx.endMonth - max + 1); mi <= ctx.endMonth; mi++) out.push(mi);
    return out;
  }

  // tile spark: one value per data month (no empty lead-in from the 30-month window)
  const sparkOf = (m, ctx, fn) => {
    const ms = dataMonths(m, ctx);
    if (ms.length < 2) return null;
    const gr = grid(m, ctx, ms[0], ms[ms.length - 1]);
    return ms.map((mi) => fn(gridCell(gr, ctx.asset, mi)));
  };

  /* ---------- frequent-absence cohort (COUNT ONLY) ---------- */

  // spells per employee over the trailing TRAIL months ending at the as-of month,
  // booked per scope in one pass: Map(asset | 'Group' → Map(employee → spells)).
  // Internal to the counts below — never rendered as a list.
  function trailingByScope(m, ctx) {
    const out = new Map([['Group', new Map()]]);
    const g = { ...ctx, asset: 'Group' };
    const ix = index(m);
    for (let mi = ctx.endMonth - TRAIL + 1; mi <= ctx.endMonth; mi++) {
      for (const { r, e } of (ix.byMonth.get(mi) || [])) {
        if (r.absence_spells == null || r.employee_id == null || !inScope(g, e)) continue;
        const bump = (scope) => {
          if (!out.has(scope)) out.set(scope, new Map());
          const by = out.get(scope);
          by.set(r.employee_id, (by.get(r.employee_id) || 0) + r.absence_spells);
        };
        bump('Group');
        if (e && e.asset) bump(e.asset);
      }
    }
    return out;
  }
  const trailingSpells = (m, ctx) => trailingByScope(m, ctx).get(ctx.asset) || new Map();
  // {n: employees in the cohort, base: employees with spells on file in the window}
  function cohortOf(by) {
    let n = 0;
    for (const v of by.values()) if (v >= FREQ_SPELLS) n++;
    return { n, base: by.size };
  }
  function frequentCount(m, ctx) {
    const by = trailingSpells(m, ctx);
    return by.size ? cohortOf(by).n : null;
  }

  /* ---------- cuts ---------- */

  // absenteeism by an employee dimension over the period → [{key, t}] in `order`
  // (else by rate, highest first). Orphan rows carry no attributes and are left out.
  function byDim(m, ctx, keyFn, order, list = rows(m, ctx)) {
    const groups = new Map();
    for (const x of list) {
      if (!x.e) continue;
      const k = keyFn(x.e) ?? '(blank)';
      let t = groups.get(k);
      if (!t) { t = blank(); groups.set(k, t); }
      add(t, x.r);
    }
    const out = [...groups.entries()].map(([key, t]) => ({ key, t }));
    if (order) {
      const pos = new Map(order.map((k, i) => [k, i]));
      return out.sort((a, b) => (pos.has(a.key) ? pos.get(a.key) : 1e9) - (pos.has(b.key) ? pos.get(b.key) : 1e9));
    }
    return out.sort((a, b) => (absPct(b.t) ?? -1) - (absPct(a.t) ?? -1));
  }

  /* ---------- quality notes ---------- */

  function quality(m, ctx, kind) {
    const ix = index(m);
    if (!ix.total) return null;
    const notes = [];
    const share = (n) => n / ix.total * 100;
    if (share(ix.orphans) >= 1) notes.push(`${fmtPct(share(ix.orphans), 0)} of absence rows have an Employee ID not in the employee master — counted only in the unfiltered Group view`);
    if (share(ix.overBooked) >= 1) notes.push(`${fmtPct(share(ix.overBooked), 0)} of rows book more days than Scheduled Days`);
    if (kind === 'spells') {
      if (ix.spellBlank === ix.total) notes.push('Absence Spells column not supplied — spell metrics need it');
      else if (share(ix.spellBlank) >= 1) notes.push(`${fmtPct(share(ix.spellBlank), 0)} of rows have blank Absence Spells (left out of spell metrics)`);
    }
    return notes.length ? notes.join(' · ') : null;
  }

  /* ---------- drill (persona-aware; health data) ---------- */

  // No Spells column per employee: spell counts per person over a 3-month period
  // would BE the frequent-absence cohort list, which is never shown to anyone.
  const PERSON_COLS = ['Employee', 'Asset', 'Function', 'Band', 'Months', 'Scheduled days', 'Present', 'Planned leave', 'Unplanned absence'];
  const SORTS = {
    unplanned: (a, b) => b.t.unplanned - a.t.unplanned,
    planned: (a, b) => b.t.planned - a.t.planned,
    present: (a, b) => (attPct(a.t) ?? 101) - (attPct(b.t) ?? 101)
  };
  const LIMIT = 200;

  // 'identified' → one row per employee, day COUNTS only (no reasons, no dates,
  //                no spells) — except the spell metric, which drills to aggregates;
  // 'masked'     → asset × function aggregates, bases < CONFIG.minCell suppressed;
  // 'none'       → the person-level shape with no rows, which Access.maskDrill withholds.
  function drill(m, ctx, sort = 'unplanned') {
    const pii = Access.pii();
    const list = rows(m, ctx);
    const scope = `${monthIdxToLabel(ctx.startMonth)} – ${monthIdxToLabel(ctx.endMonth)}`;
    if (pii === 'identified' && SORTS[sort]) {
      const byEmp = new Map();
      for (const x of list) {
        if (!x.e) continue;
        if (!byEmp.has(x.e.employee_id)) byEmp.set(x.e.employee_id, { e: x.e, list: [] });
        byEmp.get(x.e.employee_id).list.push(x);
      }
      const recs = [...byEmp.values()].map((o) => ({ e: o.e, t: tally(o.list) })).sort(SORTS[sort]);
      const top = recs.slice(0, LIMIT);
      return {
        title: `Absence day counts by employee, ${scope} (${recs.length > LIMIT ? `top ${LIMIT} of ` : ''}${fmtInt(recs.length)}) — counts only, no reasons`,
        columns: PERSON_COLS,
        rows: top.map(({ e, t }) => [e.employee_id, e.asset || '', e.function || '', e.mgmt_band || '', fmtInt(t.rows),
          fmtNum(t.sched, 0), fmtNum(t.present, 0), fmtNum(t.planned, 0), fmtNum(t.unplanned, 0)])
      };
    }
    if (pii === 'identified' || pii === 'masked') {
      const groups = new Map();
      for (const x of list) {
        if (!x.e) continue;
        const k = (x.e.asset || '(blank)') + '\u0000' + (x.e.function || '(blank)');
        if (!groups.has(k)) groups.set(k, { asset: x.e.asset || '(blank)', fn: x.e.function || '(blank)', list: [] });
        groups.get(k).list.push(x);
      }
      const recs = [...groups.values()].map((g) => ({ ...g, t: tally(g.list) }))
        .sort((a, b) => CONFIG.assets.indexOf(a.asset) - CONFIG.assets.indexOf(b.asset) || (absPct(b.t) ?? -1) - (absPct(a.t) ?? -1));
      return {
        title: `Absence by asset and function, ${scope} — aggregates only (${pii === 'masked'
          ? `individual records withheld for ${Access.label()}` : 'spell counts are never shown per employee'})`,
        columns: ['Asset', 'Function', 'Employees', 'Scheduled days', 'Unplanned absence days', 'Absenteeism %', 'Planned leave %', 'Spells / employee-year'],
        rows: recs.map(({ asset, fn, t }) => {
          const n = t.emps.size;
          if (Access.suppressed(n)) return [asset, fn, Access.cellText(n), '—', '—', '—', '—', '—'];
          return [asset, fn, fmtInt(n), fmtNum(t.sched, 0), fmtNum(t.unplanned, 0), fmtPct(absPct(t), 1), fmtPct(planPct(t), 1),
            spellsPerEmp(t) == null ? '—' : fmtNum(spellsPerEmp(t), 1)];
        })
      };
    }
    return { title: 'Absence day counts by employee', columns: PERSON_COLS, rows: [] };
  }

  // registry inputs: the absence columns a metric reads + the master columns its scoping joins on
  const inputs = (cols) => [
    { dataset: 'absence_monthly', columns: ['Employee ID', 'Month', ...cols] },
    { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band', 'Function', 'Business Segment'] }
  ];

  return {
    TRAIL, FREQ_SPELLS, inputs,
    index, rows, tally, period, month, dataMonths, grid, gridCell, gridSum, sparkOf,
    trailingByScope, trailingSpells, cohortOf, frequentCount, byDim, quality, drill,
    pct, absPct, attPct, planPct, spellsPerEmp
  };
})();

/* =================== Absence rates =================== */

defineMetric({
  key: 'absenteeism_pct', label: 'Absenteeism rate', tab: 'absence',
  group: 'Absence rates', access: 'attendance', unit: '%', decimals: 1, direction: 'lower', scorecard: 'HR Operations',
  formulaText: 'Σ Unplanned Absence Days ÷ Σ Scheduled Days × 100\n(on-roll employees, months in the selected period)',
  inputs: AbsKit.inputs(['Scheduled Days', 'Unplanned Absence Days']),
  caveat: 'Unplanned = unplanned / unauthorised absence (e.g. LWP, unapproved). Pre-approved leave is excluded — see Planned leave share. Day counts only: no leave reasons or medical data are loaded or shown.',
  compute: (m, ctx) => AbsKit.absPct(AbsKit.period(m, ctx)),
  spark: (m, ctx) => AbsKit.sparkOf(m, ctx, AbsKit.absPct),
  quality: (m, ctx) => AbsKit.quality(m, ctx),
  drill: (m, ctx) => AbsKit.drill(m, ctx, 'unplanned')
});

defineMetric({
  key: 'abs_attendance_pct', label: 'Attendance rate', tab: 'absence',
  group: 'Absence rates', access: 'attendance', unit: '%', decimals: 1, direction: 'higher',
  formulaText: 'Σ Days Present ÷ Σ Scheduled Days × 100\n(on-roll employees, months in the selected period)',
  inputs: AbsKit.inputs(['Scheduled Days', 'Days Present']),
  caveat: 'Planned leave counts as not present, so attendance + planned leave share + absenteeism ≈ 100% when the day counts reconcile. The contract workforce has its own attendance rate on Contract & Compliance.',
  compute: (m, ctx) => AbsKit.attPct(AbsKit.period(m, ctx)),
  spark: (m, ctx) => AbsKit.sparkOf(m, ctx, AbsKit.attPct),
  quality: (m, ctx) => AbsKit.quality(m, ctx),
  drill: (m, ctx) => AbsKit.drill(m, ctx, 'present')
});

defineMetric({
  key: 'abs_planned_leave_pct', label: 'Planned leave share', tab: 'absence',
  group: 'Absence rates', access: 'attendance', unit: '%', decimals: 1, direction: null,
  formulaText: 'Σ Planned Leave Days ÷ Σ Scheduled Days × 100\n(blank Planned Leave Days count as 0)',
  inputs: AbsKit.inputs(['Scheduled Days', 'Planned Leave Days']),
  caveat: 'Pre-approved leave is an entitlement, not a problem signal — shown for context (seasonality, leave build-up), with no direction or target.',
  compute: (m, ctx) => AbsKit.planPct(AbsKit.period(m, ctx)),
  spark: (m, ctx) => AbsKit.sparkOf(m, ctx, AbsKit.planPct),
  quality: (m, ctx) => AbsKit.quality(m, ctx),
  drill: (m, ctx) => AbsKit.drill(m, ctx, 'planned')
});

/* =================== Absence frequency =================== */

defineMetric({
  key: 'abs_spells_per_emp', label: 'Absence spells per employee (annualised)', tab: 'absence',
  group: 'Absence frequency', access: 'attendance', unit: '', decimals: 1, direction: 'lower',
  formulaText: 'Σ Absence Spells ÷ employee-months on file × 12\n(= spells per employee-year; a spell is one separate unplanned-absence occurrence)',
  inputs: AbsKit.inputs(['Absence Spells']),
  caveat: 'Frequency complements the rate: many short spells disrupt rosters more than one long absence of the same length. Rows with blank Absence Spells are left out. The drill-down is aggregated (asset × function) for every persona — spell counts per person would amount to the frequent-absence list.',
  compute: (m, ctx) => AbsKit.spellsPerEmp(AbsKit.period(m, ctx)),
  spark: (m, ctx) => AbsKit.sparkOf(m, ctx, AbsKit.spellsPerEmp),
  quality: (m, ctx) => AbsKit.quality(m, ctx, 'spells'),
  drill: (m, ctx) => AbsKit.drill(m, ctx, 'spells')
});

defineMetric({
  key: 'abs_frequent_count', label: 'Frequent-absence cohort', tab: 'absence',
  group: 'Absence frequency', access: 'attendance', unit: '', decimals: 0, direction: 'lower', suppress: true,
  formulaText: `Employees with ≥${AbsKit.FREQ_SPELLS} Absence Spells summed over the trailing ${AbsKit.TRAIL} months\n(to the as-of month) — reported as a COUNT ONLY`,
  inputs: AbsKit.inputs(['Absence Spells']),
  caveat: 'Count only — never a named list. The dashboard does not show who is in this cohort, to anyone: absence patterns can reveal health information. Follow-up belongs to the HRBP / line-manager process on the attendance system of record. Counts below the small-cell threshold are suppressed for restricted personas.',
  compute: (m, ctx) => AbsKit.frequentCount(m, ctx),
  quality: (m, ctx) => AbsKit.quality(m, ctx, 'spells')
});

defineMetric({
  key: 'abs_days_lost', label: 'Absence days lost', tab: 'absence',
  group: 'Absence frequency', access: 'attendance', unit: 'd', decimals: 0, direction: 'lower',
  formulaText: 'Σ Unplanned Absence Days in the selected period\n(on-roll employees; planned leave is not counted as lost)',
  inputs: AbsKit.inputs(['Unplanned Absence Days']),
  caveat: 'A volume figure: it scales with headcount, so compare assets and units on the absenteeism rate, not on days lost.',
  compute: (m, ctx) => { const t = AbsKit.period(m, ctx); return t.rows ? t.unplanned : null; },
  spark: (m, ctx) => AbsKit.sparkOf(m, ctx, (t) => (t.rows ? t.unplanned : null)),
  quality: (m, ctx) => AbsKit.quality(m, ctx),
  drill: (m, ctx) => AbsKit.drill(m, ctx, 'unplanned')
});
