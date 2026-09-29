/* Registry — Employee Movement / History (R3, tab 'movement').
   Source: employee_movements.csv (one row per event; "To" = state after it),
   joined to employee_master by Employee ID.

   Scope rule: a movement is in scope when the employee's Grade Band matches and
   EITHER its From side OR its To side (Asset, Business Segment, Function) falls
   inside the selected filters — so a transfer out of an asset or segment counts
   for it as much as a transfer in. Blank From/To values fall back to the other
   side, then to the employee master. Rows whose Employee ID is not in the master
   count only when no filter narrows the scope (the orphan rule).

   Access classes (documented choice): movement COUNTS and the internal movement
   rate are 'org' (ACCESS_CLASSES.org names employee movements); the PROMOTION
   RATE is 'perf', the class of every other promotion metric (promo_coverage_2y,
   promo_recency_median). Row-level views (drills, the employee history lookup,
   the details table) additionally follow the persona's PII level.

   Every helper lives in the one namespace below; it touches Compute / Access
   only inside functions, because those modules load after this file. */

const MoveKit = (() => {

  const T = {
    promo: 'Promotion', loc: 'Transfer – Location', fn: 'Transfer – Function',
    co: 'Transfer – Company', redesig: 'Re-designation', seg: 'Segment Change'
  };
  const TYPE_ORDER = [T.promo, T.loc, T.fn, T.co, T.redesig, T.seg];
  const SHORT = { [T.promo]: 'Promotion', [T.loc]: 'Location', [T.fn]: 'Function', [T.co]: 'Company', [T.redesig]: 'Re-designation', [T.seg]: 'Segment' };
  const ONLY = Object.fromEntries(TYPE_ORDER.map((t) => [t, new Set([t])]));
  // internal moves = everything except a re-designation (a title change, not a move)
  const INTERNAL = new Set([T.promo, T.loc, T.fn, T.co, T.seg]);
  const ATTRS = [['asset', 'Asset'], ['function', 'Function'], ['level', 'Level'], ['company', 'Company'], ['segment', 'Segment']];
  const DRILL_CAP = 500;

  /* ---------- per-model index (rebuilt with the model) ---------- */

  const cache = new WeakMap();
  function idx(m) {
    let c = cache.get(m);
    if (c) return c;
    const recs = [];
    const byEmp = new Map();
    let orphans = 0;
    for (const r of m.movements) {
      if (r.effective_date == null || !r.movement_type) continue;
      const e = r.employee_id != null ? m.empById.get(r.employee_id) || null : null;
      if (!e) orphans++;
      const toA = r.to_asset ?? r.from_asset ?? e?.asset ?? null;
      const toS = r.to_segment ?? r.from_segment ?? e?.__seg ?? null;
      const toF = r.to_function ?? r.from_function ?? e?.function ?? null;
      const x = {
        r, e, day: r.effective_date, mi: dayToMonthIdx(r.effective_date), type: r.movement_type,
        toA, toS, toF, frA: r.from_asset ?? toA, frS: r.from_segment ?? toS, frF: r.from_function ?? toF,
        perm: !!e && e.employee_class === 'Permanent'
      };
      recs.push(x);
      if (r.employee_id != null) {
        if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
        byEmp.get(r.employee_id).push(x);
      }
    }
    for (const list of byEmp.values()) list.sort((a, b) => a.day - b.day || a.r.__row - b.r.__row);
    // Level → Management Band: the modal band of each level in the employee master
    const tally = new Map();
    for (const e of m.emps) {
      if (!e.level || !e.mgmt_band) continue;
      if (!tally.has(e.level)) tally.set(e.level, new Map());
      const t = tally.get(e.level);
      t.set(e.mgmt_band, (t.get(e.mgmt_band) || 0) + 1);
    }
    const levelBand = new Map([...tally].map(([lv, t]) => [lv, [...t].sort((a, b) => b[1] - a[1])[0][0]]));
    c = { recs, byEmp, levelBand, orphans, total: m.movements.length };
    cache.set(m, c);
    return c;
  }

  /* ---------- scope ---------- */

  const side = (ctx, a, s, f) => Compute.inAsset(ctx, a) && Compute.inSeg(ctx, s) && Compute.inFn(ctx, f);
  function match(ctx, x) {
    if (!x.e) return Compute.isUnscoped(ctx);
    if (!Compute.inBand(ctx, x.e.grade_band)) return false;
    return side(ctx, x.toA, x.toS, x.toF) || side(ctx, x.frA, x.frS, x.frF);
  }

  // movements in scope with Effective Date in [from, to] (month indices), never after as-of
  function inScope(m, ctx, { from = ctx.startMonth, to = ctx.endMonth, types = null } = {}) {
    return idx(m).recs.filter((x) => x.mi >= from && x.mi <= to && x.day <= ctx.asOfDay &&
      (!types || types.has(x.type)) && match(ctx, x));
  }
  const count = (m, ctx, type) => inScope(m, ctx, { types: type ? ONLY[type] : null }).length;

  // monthly counts over the history window (histStart … endMonth), one pass
  function monthlyByType(m, ctx, { permOnly = false } = {}) {
    const n = ctx.endMonth - ctx.histStart + 1;
    const out = new Map(TYPE_ORDER.map((t) => [t, new Array(n).fill(0)]));
    for (const x of idx(m).recs) {
      if (x.mi < ctx.histStart || x.mi > ctx.endMonth || x.day > ctx.asOfDay) continue;
      if (permOnly && !x.perm) continue;
      if (!out.has(x.type) || !match(ctx, x)) continue;
      out.get(x.type)[x.mi - ctx.histStart]++;
    }
    return out;
  }
  function monthlyCount(m, ctx, types) {
    const by = monthlyByType(m, ctx);
    const n = ctx.endMonth - ctx.histStart + 1;
    const out = new Array(n).fill(0);
    for (const [t, arr] of by) if (!types || types.has(t)) arr.forEach((v, i) => { out[i] += v; });
    return out;
  }

  /* ---------- rates (annualised, permanent roll) ---------- */

  function annualised(m, ctx, n) {
    const avg = Compute.avgHeadcount(m, ctx, 'Permanent');
    return avg ? n / avg * (12 / ctx.periodMonths) * 100 : null;
  }
  const promotionRate = (m, ctx) => annualised(m, ctx, inScope(m, ctx, { types: ONLY[T.promo] }).filter((x) => x.perm).length);
  const movers = (m, ctx) => new Set(inScope(m, ctx, { types: INTERNAL }).filter((x) => x.perm).map((x) => x.r.employee_id));
  const internalRate = (m, ctx) => annualised(m, ctx, movers(m, ctx).size);

  // monthly annualised rate: this month's events ÷ month-end permanent HC × 12 × 100
  function monthlyRate(m, ctx, types, unique) {
    const out = [];
    for (let mi = ctx.histStart; mi <= ctx.endMonth; mi++) {
      const hc = Compute.activesAt(m, ctx, 'Permanent', monthEndDay(mi)).length;
      if (!hc) { out.push(null); continue; }
      const rows = inScope(m, ctx, { from: mi, to: mi, types }).filter((x) => x.perm);
      const n = unique ? new Set(rows.map((x) => x.r.employee_id)).size : rows.length;
      out.push(n / hc * 12 * 100);
    }
    return out;
  }

  /* ---------- promotions by band / level ---------- */

  const bandOfLevel = (m, lv) => (lv ? idx(m).levelBand.get(lv) : null) || null;
  const DIMS = {
    band: {
      order: () => CONFIG.mgmtBands,
      label: (k) => CONFIG.mgmtBandLabels[k] || k,
      ofRec: (m, x) => bandOfLevel(m, x.r.to_level) || x.e?.mgmt_band || null,
      ofEmp: (e) => e.mgmt_band || null
    },
    level: {
      order: () => CONFIG.levels,
      label: (k) => k,
      ofRec: (m, x) => x.r.to_level || x.e?.level || null,
      ofEmp: (e) => e.level || null
    }
  };
  // [{key, label, n, permN, avgHc, rate}] in ladder order; rate = annualised, permanent roll
  function promotionsBy(m, ctx, dim) {
    const d = DIMS[dim];
    const recs = inScope(m, ctx, { types: ONLY[T.promo] });
    const perm = new Map();
    for (const x of recs) if (x.perm) { const k = d.ofRec(m, x) ?? '(blank)'; perm.set(k, (perm.get(k) || 0) + 1); }
    const hc = new Map();
    for (let mi = ctx.startMonth; mi <= ctx.endMonth; mi++) {
      for (const e of Compute.activesAt(m, ctx, 'Permanent', monthEndDay(mi))) {
        const k = d.ofEmp(e) ?? '(blank)';
        hc.set(k, (hc.get(k) || 0) + 1);
      }
    }
    return Compute.countBy(recs, (x) => d.ofRec(m, x), d.order()).map(({ key, n }) => {
      const avgHc = (hc.get(key) || 0) / ctx.periodMonths;
      const pn = perm.get(key) || 0;
      return { key, label: d.label(key), n, permN: pn, avgHc, rate: avgHc ? pn / avgHc * (12 / ctx.periodMonths) * 100 : null };
    });
  }

  /* ---------- from → to flows (heat tables) ---------- */

  // {axis, cells: Map('a\u0001b' → n), n, months} — trailing `months` to as-of;
  // only rows where both sides are present and differ. `bucket` maps a value
  // onto the axis (e.g. peers → 'Other assets' for an asset-locked persona).
  function flow(m, ctx, { fromKey, toKey, types = null, months = 12, order = [], bucket = null }) {
    const cells = new Map();
    const seen = new Set();
    let n = 0;
    for (const x of inScope(m, ctx, { from: ctx.endMonth - months + 1, to: ctx.endMonth, types })) {
      let a = fromKey(x), b = toKey(x);
      if (a == null || b == null || a === b) continue;
      if (bucket) { a = bucket(a); b = bucket(b); }
      const k = a + '\u0001' + b;
      cells.set(k, (cells.get(k) || 0) + 1);
      seen.add(a); seen.add(b);
      n++;
    }
    const axis = order.filter((v) => seen.has(v)).concat([...seen].filter((v) => !order.includes(v)).sort());
    return { axis, cells, n, months, get: (a, b) => cells.get(a + '\u0001' + b) || 0 };
  }

  /* ---------- row-level: change text, drills, history ----------
     Counts keep the From/To rule, but identified rows must not undo the
     'Other assets' pooling: for an asset-locked persona a peer asset's name
     reads 'Other assets', and a scope-locked persona is listed only people
     whose current master record is in scope (the history lookup's rule). */

  const pool = (a) => (a == null || !Access.lockedAsset() || Access.chartScopes().includes(a) ? a : 'Other assets');
  const rowScoped = (ctx, x) => Access.persona().scope === 'all' || (!!x.e && Compute.empMatch(x.e, ctx));
  const stateTo = (x) => ({ asset: pool(x.r.to_asset ?? x.r.from_asset), function: x.r.to_function ?? x.r.from_function, level: x.r.to_level ?? x.r.from_level, company: x.r.to_company ?? x.r.from_company, segment: x.r.to_segment ?? x.r.from_segment });
  const stateFrom = (x) => ({ asset: pool(x.r.from_asset ?? x.r.to_asset), function: x.r.from_function ?? x.r.to_function, level: x.r.from_level ?? x.r.to_level, company: x.r.from_company ?? x.r.to_company, segment: x.r.from_segment ?? x.r.to_segment });
  const stateOf = (e) => (e ? { asset: e.asset, function: e.function, level: e.level, company: e.company, segment: e.__seg !== 'Unassigned' ? e.__seg : null } : {});

  // [{label, from, to}] for each attribute that changed
  function changes(x) {
    const out = [];
    for (const [k, label] of ATTRS) {
      const f = x.r['from_' + k], t = x.r['to_' + k];
      if ((f != null || t != null) && f !== t) out.push({ label, from: (k === 'asset' ? pool(f) : f) ?? '—', to: (k === 'asset' ? pool(t) : t) ?? '—' });
    }
    return out;
  }
  function changeText(x) {
    const ch = changes(x);
    if (ch.length) return ch.map((c) => `${c.label} ${c.from} → ${c.to}`).join('; ');
    const lv = x.r.to_level ?? x.r.from_level;
    return lv ? `No org change · level ${lv} unchanged` : 'No org change recorded';
  }

  const DRILL_COLS = ['Employee', 'Name', 'Effective date', 'Movement type', 'Change', 'Asset', 'Function', 'Level'];
  function listRows(recs) {
    return recs.map((x) => {
      const s = stateTo(x);
      return [x.r.employee_id, x.e?.name || '', fmtDMY(x.day), x.type, changeText(x), s.asset || pool(x.e?.asset) || '', s.function || x.e?.function || '', s.level || x.e?.level || ''];
    });
  }
  const latestFirst = (a, b) => b.day - a.day || b.r.__row - a.r.__row;
  // title suffix when people now outside the persona's scope are counted but not listed
  const unlisted = (n, listed) => (n > listed ? ` — ${fmtInt(listed)} listed; people now outside this persona’s scope are counted, not listed` : '');
  function drillList(m, ctx, types, what) {
    const all = inScope(m, ctx, { types });
    const recs = all.filter((x) => rowScoped(ctx, x)).sort(latestFirst);
    const shown = recs.slice(0, DRILL_CAP);
    return {
      title: `${what} in period (${fmtInt(all.length)})${unlisted(all.length, recs.length)}${recs.length > shown.length ? ` — latest ${fmtInt(shown.length)}` : ''}`,
      columns: DRILL_COLS,
      rows: listRows(shown)
    };
  }
  function drillMovers(m, ctx) {
    const by = new Map();
    let counted = 0;
    for (const x of inScope(m, ctx, { types: INTERNAL })) {
      if (!x.perm) continue;
      if (!by.has(x.r.employee_id)) { by.set(x.r.employee_id, []); counted++; }
      by.get(x.r.employee_id).push(x);
    }
    const list = [...by.values()].filter((xs) => rowScoped(ctx, xs[0])).map((xs) => xs.sort(latestFirst)).sort((a, b) => latestFirst(a[0], b[0]));
    const shown = list.slice(0, DRILL_CAP);
    return {
      title: `Permanent employees with an internal move in period (${fmtInt(counted)})${unlisted(counted, list.length)}${list.length > shown.length ? ` — latest ${fmtInt(shown.length)}` : ''}`,
      columns: ['Employee', 'Name', 'Moves in period', 'Types', 'Latest move'],
      rows: shown.map((xs) => [xs[0].r.employee_id, xs[0].e?.name || '', fmtInt(xs.length),
        [...new Set(xs.map((x) => SHORT[x.type] || x.type))].join(', '), fmtDMY(xs[0].day)])
    };
  }
  function drillRateByBand(m, ctx) {
    const rows = promotionsBy(m, ctx, 'band');
    return {
      title: 'Promotion rate by management band (period, annualised)',
      columns: ['Management band', 'Promotions (permanent)', 'Average headcount', 'Promotion rate'],
      rows: rows.map((r) => [r.label, Access.cellText(r.permN), fmtInt(r.avgHc),
        Access.suppressed(r.permN) ? '—' : r.rate == null ? '—' : fmtPct(r.rate, 1)])
    };
  }

  // Details table rows for the tab: latest `cap` movements in the period
  function detailRows(m, ctx, cap = 100) {
    const all = inScope(m, ctx);
    const recs = all.filter((x) => rowScoped(ctx, x)).sort(latestFirst);
    return { total: recs.length, unlisted: all.length - recs.length, columns: ['Employee ID', 'Name', 'Effective date', 'Movement type', 'Change', 'Asset', 'Function', 'Level'], rows: listRows(recs.slice(0, cap)) };
  }

  // employees the lookup may resolve: in the persona's current scope (employee
  // master attributes, all filters), most recent mover first
  function recentMovers(m, ctx, limit = 80) {
    const out = [];
    for (const [id, list] of idx(m).byEmp) {
      const e = m.empById.get(id);
      if (!e || !Compute.empMatch(e, ctx)) continue;
      out.push({ id, e, last: list[list.length - 1] });
    }
    return out.sort((a, b) => latestFirst(a.last, b.last)).slice(0, limit);
  }

  // Full timeline for one employee, or null when the ID is unknown or outside
  // the scope (the two cases are indistinguishable on purpose).
  function history(m, ctx, rawId) {
    const q = String(rawId ?? '').trim();
    if (!q) return null;
    let e = m.empById.get(q) || m.empById.get(q.toUpperCase()) || null;
    if (!e) {
      const lq = q.toLowerCase();
      for (const [k, v] of m.empById) if (String(k).toLowerCase() === lq) { e = v; break; }
    }
    if (!e || !Compute.empMatch(e, ctx)) return null;
    const list = idx(m).byEmp.get(e.employee_id) || [];
    const events = [];
    if (e.doj != null) events.push({ kind: 'join', day: e.doj, state: list.length ? stateFrom(list[0]) : stateOf(e) });
    let lastPromo = null;
    for (const x of list) {
      events.push({ kind: 'move', day: x.day, type: x.type, changes: changes(x), text: changeText(x), state: stateTo(x), x });
      if (x.type === T.promo) lastPromo = x;
    }
    const exit = e.__exit && e.__exit.exit_date != null ? e.__exit : null;
    if (exit) events.push({ kind: 'exit', day: exit.exit_date, type: exit.exit_type });
    events.sort((a, b) => a.day - b.day || (a.kind === 'join' ? -1 : b.kind === 'join' ? 1 : a.kind === 'exit' ? 1 : b.kind === 'exit' ? -1 : 0));
    const active = !exit || exit.exit_date > ctx.asOfDay;
    return {
      id: e.employee_id, e, events, moves: list.length, active, exit,
      lastPromoDay: lastPromo ? lastPromo.day : null,
      masterPromoDay: e.last_promotion ?? null,
      current: stateOf(e),
      band: e.mgmt_band || null
    };
  }

  function orphanNote(m) {
    const c = idx(m);
    if (!c.total || !c.orphans) return null;
    const pct = c.orphans / c.total * 100;
    return pct >= 0.5 ? `${fmtPct(pct, 1)} of movement rows have an Employee ID not in the employee master — counted only when no filter narrows the scope` : null;
  }

  return {
    T, TYPE_ORDER, SHORT, ONLY, INTERNAL,
    idx, match, inScope, count, monthlyByType, monthlyCount,
    promotionRate, internalRate, movers, monthlyRate, promotionsBy, bandOfLevel,
    flow, changes, changeText, stateTo, stateFrom, drillList, drillMovers, drillRateByBand,
    detailRows, recentMovers, history, orphanNote
  };
})();

/* ---------------- tiles: movement volume (period counts) ---------------- */

{
  // (block scope: these names never reach the shared global scope)
  const MV_IN = [
    { dataset: 'employee_movements', columns: ['Employee ID', 'Effective Date', 'Movement Type', 'From Asset', 'To Asset', 'From Function', 'To Function', 'From Segment', 'To Segment'] },
    { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band', 'Function', 'Business Segment'] }
  ];
  const SCOPE_CAVEAT = 'Scope follows the movement: a move out of the selected asset, segment or function counts for it (From side) as much as a move in (To side). Blank From/To values fall back to the other side, then to the employee master; the grade band is the employee’s current one.';
  const withCols = (extra) => [{ ...MV_IN[0], columns: [...MV_IN[0].columns, ...extra] }, MV_IN[1]];

  defineMetric({
    key: 'mv_total', label: 'Movements (all types)', tab: 'movement', access: 'org',
    group: 'Movement volume', unit: '', decimals: 0, direction: null,
    formulaText: 'Movement rows with Effective Date in the period (all six Movement Types)\nIn scope when the employee’s Grade Band matches and the From or the To side\n(Asset, Business Segment, Function) falls inside the selected filters',
    inputs: MV_IN, caveat: SCOPE_CAVEAT,
    compute: (m, ctx) => MoveKit.count(m, ctx, null),
    spark: (m, ctx) => MoveKit.monthlyCount(m, ctx, null),
    quality: (m) => MoveKit.orphanNote(m),
    drill: (m, ctx) => MoveKit.drillList(m, ctx, null, 'Movements')
  });

  const COUNT_TILES = [
    ['mv_promotions', 'Promotions', MoveKit.T.promo, ['From Level', 'To Level'],
      'Title and level step up the ladder. Promotions of every class are counted here; the promotion rate uses the permanent roll only.'],
    ['mv_transfer_location', 'Location transfers', MoveKit.T.loc, [],
      'A change of asset / site within the same legal entity. The asset-to-asset flow matrix below also includes company transfers that change the asset.'],
    ['mv_transfer_function', 'Function transfers', MoveKit.T.fn, [],
      'A change of Function (Function 1); the segment may change with it.'],
    ['mv_transfer_company', 'Company transfers', MoveKit.T.co, ['From Company', 'To Company'],
      'A change of legal entity (inter-company transfer). It may also change the asset.'],
    ['mv_redesignation', 'Re-designations', MoveKit.T.redesig, ['From Level', 'To Level'],
      'A title / grade change without a level change — not an internal move. In-level grade steps at the entry rung of the ladder are recorded here, never as promotions.'],
    ['mv_segment_change', 'Segment changes', MoveKit.T.seg, [],
      'A move between Operations and Projects without a change of function.']
  ];
  for (const [key, label, type, extra, note] of COUNT_TILES) {
    defineMetric({
      key, label, tab: 'movement', access: 'org',
      group: 'Movement volume', unit: '', decimals: 0, direction: null,
      formulaText: `Movement rows with Movement Type = ${type}\nand Effective Date in the period (count, scope as for all movements)`,
      inputs: withCols(extra), caveat: note + ' ' + SCOPE_CAVEAT,
      compute: (m, ctx) => MoveKit.count(m, ctx, type),
      spark: (m, ctx) => MoveKit.monthlyCount(m, ctx, MoveKit.ONLY[type]),
      drill: (m, ctx) => MoveKit.drillList(m, ctx, MoveKit.ONLY[type], label)
    });
  }

  /* ---------------- tiles: movement rates (annualised) ---------------- */

  const RATE_IN = (extra) => [
    { dataset: 'employee_movements', columns: ['Employee ID', 'Effective Date', 'Movement Type', ...extra] },
    { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band', 'Function', 'Business Segment', 'Employee Class', 'Date of Joining'] }
  ];

  defineMetric({
    key: 'mv_promotion_rate', label: 'Promotion rate (annualised)', tab: 'movement', access: 'perf',
    group: 'Movement rates', unit: '%', decimals: 1, direction: null,
    formulaText: 'Promotions of permanent employees with Effective Date in the period\n÷ average permanent headcount over the period (month-end mean)\n× (12 ÷ months in period) × 100',
    inputs: RATE_IN(['From Level', 'To Level']),
    caveat: 'Access class: Performance & recognition — the class of every other promotion metric; movement counts use Organisation, positions & movement. The headcount denominator uses current employee-master attributes (no point-in-time attribution). No benchmark is implied: a target applies only when targets.csv sets one.',
    compute: (m, ctx) => MoveKit.promotionRate(m, ctx),
    spark: (m, ctx) => MoveKit.monthlyRate(m, ctx, MoveKit.ONLY[MoveKit.T.promo], false),
    drill: (m, ctx) => MoveKit.drillRateByBand(m, ctx)
  });

  defineMetric({
    key: 'mv_internal_rate', label: 'Internal movement rate (annualised)', tab: 'movement', access: 'org',
    group: 'Movement rates', unit: '%', decimals: 1, direction: null,
    formulaText: 'Permanent employees with ≥1 internal move in the period\n(Promotion, any Transfer, Segment Change — Re-designations excluded)\n÷ average permanent headcount × (12 ÷ months in period) × 100',
    inputs: RATE_IN(['From Asset', 'To Asset', 'From Function', 'To Function', 'From Segment', 'To Segment']),
    caveat: 'Unique movers per period: an employee who moves twice in the period counts once, so over a 12-month period this is the share of the average roll that moved. The headcount denominator uses current employee-master attributes.',
    compute: (m, ctx) => MoveKit.internalRate(m, ctx),
    spark: (m, ctx) => MoveKit.monthlyRate(m, ctx, MoveKit.INTERNAL, true),
    drill: (m, ctx) => MoveKit.drillMovers(m, ctx)
  });
}
