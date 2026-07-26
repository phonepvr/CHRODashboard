/* Compute layer — joins the parsed datasets into one model, applies the
   asset/grade-band/period context, evaluates registry metrics with memoisation.
   Pure in-memory; rebuilt whenever data or filters change. */

const Compute = (() => {

  let model = null;
  let modelVersion = -1;
  const memo = new Map();

  function ds(id) {
    const d = App.state.datasets.get(id);
    return d ? d.rows : null;
  }
  function has(id) { return App.state.datasets.has(id); }

  /* ---------- model build (joins) ---------- */

  const SENIOR_GRADES = new Set(['AGM', 'DGM', 'GM', 'VP', 'SVP', 'ED']);

  function build() {
    if (model && modelVersion === App.state.dataVersion) return model;
    memo.clear();
    const emps = ds('employee_master') || [];
    const exits = ds('exits') || [];
    const exitByEmp = new Map();
    for (const x of exits) if (x.employee_id != null && x.exit_date != null) {
      const prev = exitByEmp.get(x.employee_id);
      if (!prev || x.exit_date > prev.exit_date) exitByEmp.set(x.employee_id, x);
    }
    // Dedupe by Employee ID (first wins) for BOTH joins and headcount maths, so
    // duplicate rows never double-count in a denominator. The raw dataset still
    // carries the duplicates, which the Data Quality tab reports separately.
    const empById = new Map();
    const uniqueEmps = [];
    for (const e of emps) {
      e.__exit = exitByEmp.get(e.employee_id) || null;
      if (e.employee_id != null && empById.has(e.employee_id)) continue;
      if (e.employee_id != null) empById.set(e.employee_id, e);
      uniqueEmps.push(e);
    }
    for (const x of exits) x.__emp = empById.get(x.employee_id) || null;

    const targets = new Map();
    for (const t of (ds('targets') || [])) {
      if (t.metric_key) targets.set(t.metric_key, { value: t.target_value, direction: t.direction });
    }

    const learning = ds('learning_events') || [];
    const learningByEmp = new Map();
    for (const l of learning) {
      if (!l.employee_id) continue;
      if (!learningByEmp.has(l.employee_id)) learningByEmp.set(l.employee_id, []);
      learningByEmp.get(l.employee_id).push(l);
    }

    const succ = ds('succession') || [];
    const successorIds = new Set(succ.map((s) => s.successor_id).filter(Boolean));

    const reqs = ds('requisitions') || [];
    const reqById = new Map(reqs.map((r) => [r.requisition_id, r]));

    model = {
      emps: uniqueEmps, rawEmps: emps, exits, empById, exitByEmp,
      reqs, reqById,
      apps: ds('internal_applications') || [],
      learning, learningByEmp,
      idp: ds('idp_status') || [],
      lms: ds('lms_usage') || [],
      succ, successorIds,
      prod: ds('production_safety') || [],
      cAtt: ds('contract_attendance') || [],
      cComp: ds('contract_compliance') || [],
      targets,
      has, SENIOR_GRADES
    };
    modelVersion = App.state.dataVersion;
    return model;
  }

  /* ---------- context ---------- */

  function ctxNow(overrides) {
    const months = App.state.filters.periodMonths;
    const base = {
      asset: App.state.filters.asset,        // 'Group' | asset name
      band: App.state.filters.band,          // 'All' | grade band
      periodMonths: months,
      asOfDay: AS_OF_DAY,
      endMonth: AS_OF_MONTH,
      startMonth: AS_OF_MONTH - months + 1,
      histStart: AS_OF_MONTH - CONFIG.historyMonths + 1
    };
    if (!overrides) return base;
    const c = { ...base, ...overrides };
    if (overrides.endMonth != null || overrides.periodMonths != null) {
      c.startMonth = c.endMonth - c.periodMonths + 1;
      c.asOfDay = Math.min(AS_OF_DAY, monthEndDay(c.endMonth));
    }
    return c;
  }

  const inAsset = (ctx, asset) => ctx.asset === 'Group' || asset === ctx.asset;
  const inBand = (ctx, band) => ctx.band === 'All' || band === ctx.band;

  function empMatch(e, ctx) {
    return inAsset(ctx, e.asset) && inBand(ctx, e.grade_band);
  }

  function activesAt(m, ctx, klass, day) {
    return m.emps.filter((e) =>
      (klass == null || e.employee_class === klass) &&
      empMatch(e, ctx) &&
      e.doj != null && e.doj <= day &&
      (!e.__exit || e.__exit.exit_date > day));
  }
  const actives = (m, ctx, klass) => activesAt(m, ctx, klass, ctx.asOfDay);

  // exits inside [startMonth, endMonth] (klass filter optional)
  function exitsInPeriod(m, ctx, klass) {
    return m.exits.filter((x) => {
      if (x.exit_date == null || !x.__emp) return false;
      const mi = dayToMonthIdx(x.exit_date);
      if (mi < ctx.startMonth || mi > ctx.endMonth) return false;
      if (klass != null && x.__emp.employee_class !== klass) return false;
      return empMatch(x.__emp, ctx);
    });
  }

  function joinsInWindow(m, ctx, months, klass) {
    const from = monthEndDay(ctx.endMonth - months) + 1;
    return m.emps.filter((e) =>
      (klass == null || e.employee_class === klass) &&
      empMatch(e, ctx) && e.doj != null && e.doj >= from && e.doj <= ctx.asOfDay);
  }

  /* ---------- shared computations ---------- */

  function monthlySeries(m, ctx, fn) {
    const out = [];
    for (let mi = ctx.histStart; mi <= ctx.endMonth; mi++) out.push(fn(mi, monthEndDay(mi)));
    return out;
  }

  function avgHeadcount(m, ctx, klass) {
    const vals = [];
    for (let mi = ctx.startMonth; mi <= ctx.endMonth; mi++) {
      vals.push(activesAt(m, ctx, klass, monthEndDay(mi)).length);
    }
    return mean(vals);
  }

  function annualisedAttrition(m, ctx) {
    const avg = avgHeadcount(m, ctx, 'Permanent');
    if (!avg) return null;
    const n = exitsInPeriod(m, ctx, 'Permanent').length;
    return n / avg * (12 / ctx.periodMonths) * 100;
  }

  function monthAttritionRate(m, ctx, mi) {
    const hc = activesAt(m, ctx, 'Permanent', monthEndDay(mi)).length;
    if (!hc) return null;
    const n = m.exits.filter((x) => x.exit_date != null && x.__emp &&
      x.__emp.employee_class === 'Permanent' && empMatch(x.__emp, ctx) &&
      dayToMonthIdx(x.exit_date) === mi).length;
    return n / hc * 12 * 100;
  }

  // fiscal YTD (Apr–as-of) annualised
  function ytdAttrition(m, ctx) {
    const y = Math.floor(ctx.endMonth / 12), m0 = ctx.endMonth % 12;
    const fyStart = (m0 >= 3) ? y * 12 + 3 : (y - 1) * 12 + 3; // April
    const months = ctx.endMonth - fyStart + 1;
    const c = { ...ctx, startMonth: fyStart, periodMonths: months };
    return annualisedAttrition(m, c);
  }

  /* ---------- cohorts ---------- */

  function cohortFilter(m, ctx, cohort) {
    const a = actives(m, ctx, null).filter((e) => e.employee_class === 'Permanent' || e.employee_class === 'Trainee');
    switch (cohort) {
      case 'All': return a;
      case 'TT': return a.filter((e) => e.tt_flag);
      case 'Trainees': return a.filter((e) => e.employee_class === 'Trainee');
      case 'VP+': return a.filter((e) => e.grade_band === 'VP & above');
      case 'AM-GM': return a.filter((e) => e.grade_band === 'AM-GM');
      default: return a;
    }
  }

  function learningCoverage(m, ctx, cohort) {
    const pop = cohortFilter(m, ctx, cohort);
    if (!pop.length) return null;
    const from = monthEndDay(ctx.endMonth - 12) + 1; // trailing 12 months window
    const covered = pop.filter((e) => (m.learningByEmp.get(e.employee_id) || [])
      .some((l) => l.start_date != null && l.start_date >= from && l.start_date <= ctx.asOfDay));
    return covered.length / pop.length * 100;
  }

  function learningDaysPerEmp(m, ctx, cohort) {
    const pop = cohortFilter(m, ctx, cohort);
    if (!pop.length) return null;
    const from = monthEndDay(ctx.endMonth - 12) + 1;
    let days = 0;
    for (const e of pop) {
      for (const l of (m.learningByEmp.get(e.employee_id) || [])) {
        if (l.start_date != null && l.start_date >= from && l.start_date <= ctx.asOfDay) days += (l.person_days || 0);
      }
    }
    return days / pop.length;
  }

  /* ---------- succession / positions ---------- */

  function succMatch(m, ctx, s) {
    if (ctx.asset === 'Group') return true;
    const inc = s.incumbent_id ? m.empById.get(s.incumbent_id) : null;
    if (inc) return inc.asset === ctx.asset;
    const suc = s.successor_id ? m.empById.get(s.successor_id) : null;
    if (suc) return suc.asset === ctx.asset;
    return false; // unattributable rows only count at Group level
  }

  // one row per position (a position can have several successor rows)
  function positions(m, ctx) {
    const byPos = new Map();
    for (const s of m.succ) {
      if (!s.position_id || !succMatch(m, ctx, s)) continue;
      if (!byPos.has(s.position_id)) {
        byPos.set(s.position_id, { id: s.position_id, level: s.position_level, incumbent: s.incumbent_id, successors: [] });
      }
      const p = byPos.get(s.position_id);
      if (s.successor_id) p.successors.push({ id: s.successor_id, readiness: s.readiness, idp: s.succ_idp_flag });
      if (s.incumbent_id) p.incumbent = s.incumbent_id;
    }
    return [...byPos.values()];
  }

  function cpPositions(m, ctx) {
    if (m.has('succession')) return positions(m, ctx).filter((p) => p.level === 'CP').length;
    // employee_master fallback: a genuine zero (e.g. band filter with no CPs) is a
    // real count, not "not computable" — return 0, not null.
    if (m.has('employee_master')) return actives(m, ctx, 'Permanent').filter((e) => e.cp_flag).length;
    return null;
  }

  const seniorReq = (m, r) => r.grade && m.SENIOR_GRADES.has(String(r.grade).toUpperCase());

  function reqsClosedInPeriod(m, ctx, seniorOnly) {
    return m.reqs.filter((r) => {
      if (r.closed_date == null) return false;
      const mi = dayToMonthIdx(r.closed_date);
      return mi >= ctx.startMonth && mi <= ctx.endMonth && inAsset(ctx, r.asset) &&
        (!seniorOnly || seniorReq(m, r));
    });
  }

  /* ---------- contract ---------- */

  function latestPanelMonth(rows, ctx) {
    let latest = null;
    for (const r of rows) if (r.month != null && inAsset(ctx, r.asset)) latest = Math.max(latest ?? -Infinity, r.month);
    return latest;
  }

  function contractHeadcount(m, ctx) {
    if (!m.has('contract_attendance')) return null;
    const latest = latestPanelMonth(m.cAtt, ctx);
    if (latest == null) return null;
    return m.cAtt.filter((r) => r.month === latest && inAsset(ctx, r.asset))
      .reduce((s, r) => s + (r.contract_headcount || 0), 0);
  }

  // Average total contract headcount over the period: mean across the months that
  // actually report, so a ragged panel (one asset short a month) doesn't zero an
  // asset out — matches the "average total workforce" the productivity tiles state.
  function contractAvgHeadcount(m, ctx) {
    if (!m.has('contract_attendance')) return null;
    const byMonth = new Map();
    for (const r of m.cAtt) {
      if (r.month == null || r.month < ctx.startMonth || r.month > ctx.endMonth || !inAsset(ctx, r.asset)) continue;
      byMonth.set(r.month, (byMonth.get(r.month) || 0) + (r.contract_headcount || 0));
    }
    return byMonth.size ? mean([...byMonth.values()]) : null;
  }

  function panelRowsInPeriod(rows, ctx) {
    return rows.filter((r) => r.month != null && r.month >= ctx.startMonth && r.month <= ctx.endMonth && inAsset(ctx, r.asset));
  }

  function contractAttendancePct(m, ctx) {
    const rows = panelRowsInPeriod(m.cAtt, ctx);
    const dep = rows.reduce((s, r) => s + (r.mandays_deployed || 0), 0);
    if (!dep) return null;
    return rows.reduce((s, r) => s + (r.mandays_present || 0), 0) / dep * 100;
  }

  function complianceShare(m, ctx, key) {
    const rows = panelRowsInPeriod(m.cComp, ctx).filter((r) => r[key] != null);
    if (!rows.length) return null;
    return rows.filter((r) => r[key]).length / rows.length * 100;
  }

  function inductionAvg(m, ctx) {
    const rows = panelRowsInPeriod(m.cComp, ctx).filter((r) => r.induction_pct != null);
    return rows.length ? mean(rows.map((r) => r.induction_pct)) : null;
  }

  function contractCompositeIdx(m, ctx) {
    const parts = [complianceShare(m, ctx, 'pf_esi_flag'), complianceShare(m, ctx, 'wage_flag'),
                   complianceShare(m, ctx, 'licence_flag'), inductionAvg(m, ctx)];
    if (parts.some((p) => p == null)) return null;
    return mean(parts);
  }

  /* ---------- production ---------- */

  function prodSum(m, ctx, key) {
    const rows = panelRowsInPeriod(m.prod, ctx).filter((r) => r[key] != null);
    if (!rows.length) return null;
    return rows.reduce((s, r) => s + r[key], 0);
  }

  /* ---------- data-quality note helpers (tile-level) ---------- */

  function blankShareNote(m, ctx, dsId, key, label) {
    const d = App.state.datasets.get(dsId);
    if (!d || !d.rows.length) return null;
    const blank = d.rows.filter((r) => r[key] == null).length;
    if (!blank) return null;
    const pct = blank / d.rows.length * 100;
    return pct >= 1 ? `${fmtPct(pct, 0)} of rows have blank ${label}` : null;
  }

  function blankExitReasonNote() {
    const d = App.state.datasets.get('exits');
    if (!d || !d.rows.length) return null;
    const blank = d.rows.filter((r) => !r.exit_reason).length;
    if (!blank) return null;
    return `${fmtPct(blank / d.rows.length * 100, 0)} of exits have no recorded reason`;
  }

  function staleIdpNote(m, ctx) {
    const rows = m.idp.filter((r) => r.idp_flag && r.last_updated != null);
    if (!rows.length) return null;
    const stale = rows.filter((r) => ctx.asOfDay - r.last_updated > 270).length;
    if (!stale) return null;
    return `${fmtPct(stale / rows.length * 100, 0)} of IDPs not updated in 9+ months`;
  }

  /* ---------- metric evaluation ---------- */

  function metricAvailable(entry) {
    return entry.inputs.every((i) => has(i.dataset));
  }

  function metric(key, overrides) {
    const entry = REG_BY_KEY.get(key);
    if (!entry) return { entry: null, value: null, available: false };
    const ctx = ctxNow(overrides);
    // The sparkline is computed only for base-context calls (no overrides). The
    // memo key must therefore distinguish the two, or an override call whose ctx
    // equals the base ctx (e.g. the exec summary at the current asset) would cache
    // a spark-less entry that the tile then reads — dropping the trend line.
    const mk = key + '|' + ctx.asset + '|' + ctx.band + '|' + ctx.startMonth + '-' + ctx.endMonth + '|' + App.state.dataVersion + (overrides ? '|ov' : '|base');
    if (memo.has(mk)) return memo.get(mk);
    const m = build();
    const available = metricAvailable(entry);
    let value = null, quality = null, spark = null;
    if (available) {
      try { value = entry.compute(m, ctx); } catch (e) { value = null; quality = 'Computation failed: ' + e.message; }
      if (entry.quality && quality == null) { try { quality = entry.quality(m, ctx); } catch { /* noop */ } }
      if (entry.spark && !overrides) { try { spark = entry.spark(m, ctx); } catch { spark = null; } }
    }
    const target = m.targets.get(key) || null;
    const res = { entry, value, available, quality, spark, target, ctx };
    memo.set(mk, res);
    return res;
  }

  // value for the immediately-prior period of the same length
  function priorValue(key) {
    const c = ctxNow();
    return metric(key, { endMonth: c.endMonth - c.periodMonths, periodMonths: c.periodMonths }).value;
  }

  // value at Group scope, current period
  function groupValue(key) {
    const res = metric(key, { asset: 'Group' });
    return res.value;
  }

  /* ---------- drill helpers ---------- */

  function drillHeadcount(m, ctx) {
    const rows = [];
    for (const asset of CONFIG.assets) {
      if (ctx.asset !== 'Group' && asset !== ctx.asset) continue;
      for (const band of CONFIG.gradeBands) {
        const sub = { ...ctx, asset, band };
        rows.push([asset, CONFIG.bandLabels[band],
          fmtInt(activesAt(m, sub, 'Permanent', ctx.asOfDay).length),
          fmtInt(activesAt(m, sub, 'Trainee', ctx.asOfDay).length)]);
      }
    }
    return { title: 'Headcount by asset and grade band', columns: ['Asset', 'Grade band', 'Permanent', 'Trainees'], rows };
  }

  function drillExits(m, ctx) {
    const xs = exitsInPeriod(m, ctx, null).sort((a, b) => b.exit_date - a.exit_date).slice(0, 200);
    return {
      title: `Exits in period (${xs.length})`,
      columns: ['Employee', 'Asset', 'Band', 'Exit date', 'Type', 'Regretted', 'Reason'],
      rows: xs.map((x) => [x.employee_id, x.__emp.asset, CONFIG.bandLabels[x.__emp.grade_band] || '', fmtDMY(x.exit_date), x.exit_type, x.regretted_flag ? 'Y' : 'N', x.exit_reason || '(blank)'])
    };
  }

  return {
    build, ctxNow, metric, metricAvailable, priorValue, groupValue,
    actives, activesAt, exitsInPeriod, joinsInWindow, monthlySeries, avgHeadcount,
    annualisedAttrition, monthAttritionRate, ytdAttrition,
    cohortFilter, learningCoverage, learningDaysPerEmp,
    positions, cpPositions, succMatch, seniorReq, reqsClosedInPeriod,
    contractHeadcount, contractAvgHeadcount, contractAttendancePct, complianceShare, inductionAvg, contractCompositeIdx,
    panelRowsInPeriod, latestPanelMonth, prodSum,
    blankShareNote, blankExitReasonNote, staleIdpNote,
    drillHeadcount, drillExits,
    empMatch, inAsset, inBand,
    invalidate() { memo.clear(); }
  };
})();
