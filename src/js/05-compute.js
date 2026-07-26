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
    const empById = new Map();
    for (const e of emps) {
      e.__exit = exitByEmp.get(e.employee_id) || null;
      if (!empById.has(e.employee_id)) empById.set(e.employee_id, e); // first wins; dupes flagged in DQ
    }
    for (const x of exits) x.__emp = empById.get(x.employee_id) || null;

    const targets = new Map();
    for (const t of (ds('targets') || [])) {
      if (t.metric_key) targets.set(t.metric_key, { value: t.target_value, direction: t.direction });
    }

    model = {
      emps, exits, empById, exitByEmp,
      reqs: ds('requisitions') || [],
      apps: ds('internal_applications') || [],
      learning: ds('learning_events') || [],
      idp: ds('idp_status') || [],
      lms: ds('lms_usage') || [],
      succ: ds('succession') || [],
      prod: ds('production_safety') || [],
      cAtt: ds('contract_attendance') || [],
      cComp: ds('contract_compliance') || [],
      targets,
      has
    };
    modelVersion = App.state.dataVersion;
    return model;
  }

  /* ---------- context ---------- */

  function ctxNow() {
    const months = App.state.filters.periodMonths;
    return {
      asset: App.state.filters.asset,        // 'Group' | asset name
      band: App.state.filters.band,          // 'All' | grade band
      periodMonths: months,
      asOfDay: AS_OF_DAY,
      endMonth: AS_OF_MONTH,
      startMonth: AS_OF_MONTH - months + 1,
      histStart: AS_OF_MONTH - CONFIG.historyMonths + 1
    };
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

  // exits (perm+trainee) inside [startMonth, endMonth]
  function exitsInPeriod(m, ctx, klass) {
    return m.exits.filter((x) => {
      if (x.exit_date == null || !x.__emp) return false;
      const mi = dayToMonthIdx(x.exit_date);
      if (mi < ctx.startMonth || mi > ctx.endMonth) return false;
      if (klass != null && x.__emp.employee_class !== klass) return false;
      return empMatch(x.__emp, ctx);
    });
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

  function contractHeadcount(m, ctx) {
    if (!m.has('contract_attendance')) return null;
    let latest = null;
    for (const r of m.cAtt) if (r.month != null && inAsset(ctx, r.asset)) latest = Math.max(latest ?? 0, r.month);
    if (latest == null) return null;
    return m.cAtt.filter((r) => r.month === latest && inAsset(ctx, r.asset))
      .reduce((s, r) => s + (r.contract_headcount || 0), 0);
  }

  function cpPositions(m, ctx) {
    if (m.has('succession')) {
      // asset inferred from position id prefix is not schema-safe; use incumbent's asset when known
      return m.succ.filter((s) => s.position_level === 'CP' && succMatch(m, ctx, s)).length;
    }
    if (m.has('employee_master')) {
      return actives(build(), ctx, 'Permanent').filter((e) => e.cp_flag).length || null;
    }
    return null;
  }

  function succMatch(m, ctx, s) {
    if (ctx.asset === 'Group') return true;
    const inc = s.incumbent_id ? m.empById.get(s.incumbent_id) : null;
    if (inc) return inc.asset === ctx.asset;
    const suc = s.successor_id ? m.empById.get(s.successor_id) : null;
    if (suc) return suc.asset === ctx.asset;
    return false; // unattributable rows only count at Group level
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

  function blankExitReasonNote(m) {
    const d = App.state.datasets.get('exits');
    if (!d || !d.rows.length) return null;
    const blank = d.rows.filter((r) => !r.exit_reason).length;
    if (!blank) return null;
    return `${fmtPct(blank / d.rows.length * 100, 0)} of exits have no recorded reason`;
  }

  /* ---------- metric evaluation ---------- */

  function metricAvailable(entry) {
    return entry.inputs.every((i) => has(i.dataset));
  }

  function metric(key) {
    const entry = REG_BY_KEY.get(key);
    if (!entry) return { entry: null, value: null, available: false };
    const ctx = ctxNow();
    const mk = key + '|' + ctx.asset + '|' + ctx.band + '|' + ctx.periodMonths + '|' + App.state.dataVersion;
    if (memo.has(mk)) return memo.get(mk);
    const m = build();
    const available = metricAvailable(entry);
    let value = null, quality = null, spark = null;
    if (available) {
      try { value = entry.compute(m, ctx); } catch (e) { value = null; quality = 'Computation failed: ' + e.message; }
      if (entry.quality && quality == null) { try { quality = entry.quality(m, ctx); } catch { /* noop */ } }
      if (entry.spark) { try { spark = entry.spark(m, ctx); } catch { spark = null; } }
    }
    const target = m.targets.get(key) || null;
    const res = { entry, value, available, quality, spark, target, ctx };
    memo.set(mk, res);
    return res;
  }

  /* ---------- drill helpers ---------- */

  function drillHeadcount(m, ctx) {
    const rows = [];
    for (const asset of CONFIG.assets) {
      if (ctx.asset !== 'Group' && asset !== ctx.asset) continue;
      for (const band of CONFIG.gradeBands) {
        const c = { asset: asset, band: band };
        const sub = { ...ctx, asset, band };
        rows.push([asset, CONFIG.bandLabels[band],
          fmtInt(activesAt(m, sub, 'Permanent', ctx.asOfDay).length),
          fmtInt(activesAt(m, sub, 'Trainee', ctx.asOfDay).length)]);
      }
    }
    return { title: 'Headcount by asset and grade band', columns: ['Asset', 'Grade band', 'Permanent', 'Trainees'], rows };
  }

  return {
    build, ctxNow, metric, metricAvailable,
    actives, activesAt, exitsInPeriod, monthlySeries, avgHeadcount,
    annualisedAttrition, monthAttritionRate, contractHeadcount, cpPositions,
    blankShareNote, blankExitReasonNote, drillHeadcount,
    empMatch, inAsset, inBand, succMatch,
    invalidate() { memo.clear(); }
  };
})();
