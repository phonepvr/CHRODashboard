/* Registry — New Joining tab (R2, docs/PHASE8_PLAN.md; reference image 2 structure).
   A HIRE is an employee-master row whose Date of Joining falls in the window:
   fiscal YTD = [first day of the fiscal year (CONFIG.fyStartMonth), as-of date].
   Every Employee Class counts (GET trainees included) and so do joiners who have
   since exited — this is a hiring count, not a headcount. Filters (asset, grade
   band, business segment, persona function) apply through Compute.empMatch.
   Every helper lives in the JoinKit namespace (one shared global script scope). */

const JoinKit = (() => {

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FY_MONTH = MONTHS[CONFIG.fyStartMonth - 1] || 'Jan';
  const EMP = 'employee_master';
  // canonical employee_master columns every hire metric reads (filters included)
  const BASE_COLS = ['Employee ID', 'Date of Joining', 'Employee Class', 'Asset', 'Grade Band', 'Business Segment', 'Function'];
  const DETAIL_COLS = ['Employee ID', 'Name', 'Date of Joining', 'Hire type', 'Gender', 'Level', 'Band', 'Company',
    'Asset', 'Function', 'Function Plant', 'MC member', 'Status'];

  /* ---------- windows & populations ---------- */

  const ytdFrom = (ctx) => Compute.fyStartDay(ctx);
  const t12From = (ctx) => monthEndDay(ctx.endMonth - 12) + 1;

  function hiresBetween(m, ctx, from, to) {
    const out = [];
    for (const e of m.emps) {
      if (e.doj == null || e.doj < from || e.doj > to) continue;
      if (Compute.empMatch(e, ctx)) out.push(e);
    }
    return out;
  }
  const ytd = (m, ctx) => hiresBetween(m, ctx, ytdFrom(ctx), ctx.asOfDay);
  const trailing12 = (m, ctx) => hiresBetween(m, ctx, t12From(ctx), ctx.asOfDay);

  // "FY 2025–26" (or the calendar year when the fiscal year starts in January)
  function fyLabel(ctx) {
    const s = fyStartMonthIdx(ctx.endMonth), y = Math.floor(s / 12);
    return CONFIG.fyStartMonth === 1 ? String(y) : `FY ${y}–${String((y + 1) % 100).padStart(2, '0')}`;
  }
  const ytdRange = (ctx) => `${monthIdxToLabel(fyStartMonthIdx(ctx.endMonth))} – ${monthIdxToLabel(ctx.endMonth)}`;

  /* ---------- hire attributes (resolved) ---------- */

  const hasCol = (m, key) => m.emps.some((e) => e[key] != null);
  const mcOf = (m, e) => Compute.orgOf(m, e.function_plant)?.mc_member || null;
  // employee column first, else the unit's legal entity from org_units
  const companyOf = (m, e) => e.company || Compute.orgOf(m, e.function_plant)?.company || null;
  const statusOf = (e, ctx) => (e.__exitDay <= ctx.asOfDay ? 'Exited ' + fmtDMY(e.__exitDay) : 'Active');

  // count of YTD hires of one Hire Type; not computable when the column is absent
  function byType(m, ctx, type) {
    if (!hasCol(m, 'hire_type')) return null;
    return ytd(m, ctx).filter((e) => e.hire_type === type).length;
  }

  function hireTypeNote(m, ctx) {
    if (!hasCol(m, 'hire_type')) return 'Hire Type not in employee_master.csv — map the column to split hires by channel';
    const pop = ytd(m, ctx);
    if (!pop.length) return null;
    const blank = pop.filter((e) => e.hire_type == null).length;
    return blank ? `${fmtPct(blank / pop.length * 100, 0)} of YTD hires have blank Hire Type` : null;
  }

  /* ---------- row-level view (drills + the hiring details table) ---------- */

  // Raw rows with identifiers — callers route them through Access.maskDrill /
  // Access.maskTable, never straight to the page.
  function drill(m, ctx, pred, what) {
    const rows = ytd(m, ctx).filter((e) => !pred || pred(e))
      .sort((a, b) => b.doj - a.doj || String(a.employee_id).localeCompare(String(b.employee_id)));
    return {
      title: `${what} — ${fyLabel(ctx)} YTD (${fmtInt(rows.length)})`,
      columns: DETAIL_COLS,
      rows: rows.map((e) => [
        e.employee_id, e.name || '', fmtDMY(e.doj), e.hire_type || '(blank)', e.gender || '(blank)',
        e.level || '(blank)', e.mgmt_band || '(blank)', companyOf(m, e) || '(blank)', e.asset || '',
        e.function || '(blank)', e.function_plant || '(blank)', mcOf(m, e) || '(unmapped)', statusOf(e, ctx)
      ])
    };
  }

  return { FY_MONTH, EMP, BASE_COLS, ytdFrom, t12From, hiresBetween, ytd, trailing12, fyLabel, ytdRange,
    hasCol, mcOf, companyOf, statusOf, byType, hireTypeNote, drill };
})();

/* =================== New joiners (tab: joining) =================== */

defineMetric({
  key: 'join_hires_ytd', label: 'Total hires YTD', tab: 'joining', access: 'hiring',
  group: 'New joiners', unit: '', decimals: 0, direction: null,
  formulaText: `Employees with Date of Joining from the fiscal-year start to the as-of date — count\n(fiscal year starts in ${JoinKit.FY_MONTH}, CONFIG.fyStartMonth = ${CONFIG.fyStartMonth}; every Employee Class;\n joiners who have since exited are included)`,
  inputs: [{ dataset: 'employee_master', columns: JoinKit.BASE_COLS }],
  caveat: 'A hiring count, not a headcount: a joiner who left again inside the year still counts. GET trainees are included. A rehire counts once, on the Date of Joining held in the master. The period selector does not apply — the window is always fiscal YTD.',
  compute: (m, ctx) => JoinKit.ytd(m, ctx).length,
  spark: (m, ctx) => Compute.monthlySeries(m, ctx, (mi) => Compute.joinsInMonth(m, ctx, mi, null)),
  drill: (m, ctx) => JoinKit.drill(m, ctx, null, 'Hires')
});

defineMetric({
  key: 'join_women_ytd', label: 'Women hires YTD', tab: 'joining', access: 'hiring',
  group: 'New joiners', unit: '', decimals: 0, direction: null,
  formulaText: 'Hires YTD (fiscal-year start → as-of) with Gender = Female — count',
  inputs: [{ dataset: 'employee_master', columns: [...JoinKit.BASE_COLS, 'Gender'] }],
  caveat: 'Read with the women share of hires — the count alone moves with hiring volume.',
  compute: (m, ctx) => JoinKit.ytd(m, ctx).filter((e) => e.gender === 'Female').length,
  quality: (m, ctx) => Compute.blankShareNote(m, ctx, 'employee_master', 'gender', 'Gender'),
  drill: (m, ctx) => JoinKit.drill(m, ctx, (e) => e.gender === 'Female', 'Women hires')
});

defineMetric({
  key: 'join_women_pct', label: 'Women share of hires YTD', tab: 'joining', access: 'hiring',
  group: 'New joiners', unit: '%', decimals: 1, direction: 'higher',
  formulaText: 'Women hires YTD ÷ total hires YTD × 100',
  inputs: [{ dataset: 'employee_master', columns: [...JoinKit.BASE_COLS, 'Gender'] }],
  caveat: 'Intake diversity: above the workforce female share, hiring is lifting representation; below it, hiring is diluting it.',
  compute: (m, ctx) => {
    const pop = JoinKit.ytd(m, ctx);
    return pop.length ? pop.filter((e) => e.gender === 'Female').length / pop.length * 100 : null;
  }
});

defineMetric({
  key: 'join_lateral_ytd', label: 'Lateral hires YTD', tab: 'joining', access: 'hiring',
  group: 'New joiners', unit: '', decimals: 0, direction: null,
  formulaText: 'Hires YTD (fiscal-year start → as-of) with Hire Type = Lateral — count',
  inputs: [{ dataset: 'employee_master', columns: [...JoinKit.BASE_COLS, 'Hire Type'] }],
  caveat: 'Experienced hires from the market. Hire Type is the channel recorded on the employee master.',
  compute: (m, ctx) => JoinKit.byType(m, ctx, 'Lateral'),
  quality: (m, ctx) => JoinKit.hireTypeNote(m, ctx),
  drill: (m, ctx) => JoinKit.drill(m, ctx, (e) => e.hire_type === 'Lateral', 'Lateral hires')
});

defineMetric({
  key: 'join_campus_ytd', label: 'Campus hires YTD', tab: 'joining', access: 'hiring',
  group: 'New joiners', unit: '', decimals: 0, direction: null,
  formulaText: 'Hires YTD (fiscal-year start → as-of) with Hire Type = Campus — count',
  inputs: [{ dataset: 'employee_master', columns: [...JoinKit.BASE_COLS, 'Hire Type'] }],
  caveat: 'Campus intake is seasonal — most joins land in a few months of the year; read with the monthly trend.',
  compute: (m, ctx) => JoinKit.byType(m, ctx, 'Campus'),
  quality: (m, ctx) => JoinKit.hireTypeNote(m, ctx),
  drill: (m, ctx) => JoinKit.drill(m, ctx, (e) => e.hire_type === 'Campus', 'Campus hires')
});

defineMetric({
  key: 'join_get_ytd', label: 'GET hires YTD', tab: 'joining', access: 'hiring',
  group: 'New joiners', unit: '', decimals: 0, direction: null,
  formulaText: 'Hires YTD (fiscal-year start → as-of) with Hire Type = GET — count\n(GET = graduate engineer trainee)',
  inputs: [{ dataset: 'employee_master', columns: [...JoinKit.BASE_COLS, 'Hire Type'] }],
  caveat: 'Counted by Hire Type, not by Employee Class: a GET confirmed onto the permanent roll still counts as a GET hire.',
  compute: (m, ctx) => JoinKit.byType(m, ctx, 'GET'),
  quality: (m, ctx) => JoinKit.hireTypeNote(m, ctx),
  drill: (m, ctx) => JoinKit.drill(m, ctx, (e) => e.hire_type === 'GET', 'GET hires')
});

defineMetric({
  key: 'join_hires_12m', label: 'Hires — trailing 12 months', tab: 'joining', access: 'hiring',
  group: 'New joiners', unit: '', decimals: 0, direction: null,
  formulaText: 'Employees with Date of Joining in the 12 months ending at the as-of date — count\n(every Employee Class; joiners who have since exited are included)',
  inputs: [{ dataset: 'employee_master', columns: JoinKit.BASE_COLS }],
  caveat: 'A full-year view that does not reset at the fiscal-year start — the sum of the last 12 points of the hiring trend.',
  compute: (m, ctx) => JoinKit.trailing12(m, ctx).length
});
