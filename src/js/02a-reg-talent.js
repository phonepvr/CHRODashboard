/* Registry — Talent Management */

defineMetric({
  key: 'tt_stagnation', label: 'TT stagnation (same role ≥3 yrs)', tab: 'talent',
  group: 'Top Talent', unit: '%', direction: 'lower', scorecard: 'Talent Management',
  formulaText: 'TTs in the same role for ≥3 years ÷ total TTs × 100\n(role tenure from Current Role Start Date)',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'TT Flag', 'Current Role Start Date'] }],
  caveat: 'Rows with a blank Current Role Start Date are excluded from the numerator.',
  compute: (m, ctx) => {
    const tts = Compute.actives(m, ctx, 'Permanent').filter((e) => e.tt_flag);
    if (!tts.length) return null;
    const stag = tts.filter((e) => e.role_start != null && yearsBetween(e.role_start, ctx.asOfDay) >= 3);
    return stag.length / tts.length * 100;
  },
  quality: (m, ctx) => Compute.blankShareNote(m, ctx, 'employee_master', 'role_start', 'Current Role Start Date'),
  drill: (m, ctx) => {
    const tts = Compute.actives(m, ctx, 'Permanent')
      .filter((e) => e.tt_flag && e.role_start != null && yearsBetween(e.role_start, ctx.asOfDay) >= 3);
    return {
      title: `TTs in the same role ≥3 years (${tts.length})`,
      columns: ['Employee', 'Asset', 'Band', 'In role since', 'Last promotion'],
      rows: tts.map((e) => [e.employee_id, e.asset, CONFIG.bandLabels[e.grade_band], fmtDMY(e.role_start), e.last_promotion ? fmtDMY(e.last_promotion) : 'never'])
    };
  }
});

defineMetric({
  key: 'tt_stag_promoted', label: 'Stagnating TTs promoted in last 2 yrs', tab: 'talent',
  group: 'Top Talent', unit: '', decimals: 0, direction: null,
  formulaText: 'TTs in same role ≥3 yrs AND promoted within the last 2 years (count)\n— promoted but not moved: a role-rotation gap, not a promotion gap',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'TT Flag', 'Current Role Start Date', 'Last Promotion Date'] }],
  compute: (m, ctx) => Compute.actives(m, ctx, 'Permanent').filter((e) =>
    e.tt_flag && e.role_start != null && yearsBetween(e.role_start, ctx.asOfDay) >= 3 &&
    e.last_promotion != null && yearsBetween(e.last_promotion, ctx.asOfDay) <= 2).length
});

defineMetric({
  key: 'tt_stag_notpromoted', label: 'Stagnating TTs not promoted in last 2 yrs', tab: 'talent',
  group: 'Top Talent', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'TTs in same role ≥3 yrs AND with no promotion in the last 2 years (count)',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'TT Flag', 'Current Role Start Date', 'Last Promotion Date'] }],
  compute: (m, ctx) => Compute.actives(m, ctx, 'Permanent').filter((e) =>
    e.tt_flag && e.role_start != null && yearsBetween(e.role_start, ctx.asOfDay) >= 3 &&
    (e.last_promotion == null || yearsBetween(e.last_promotion, ctx.asOfDay) > 2)).length
});

defineMetric({
  key: 'tt_3yr_nopromo', label: 'TTs ≥3 yrs without promotion', tab: 'talent',
  group: 'Top Talent', unit: '', decimals: 0, direction: 'lower', scorecard: 'Performance & Rewards',
  formulaText: 'TTs whose Last Promotion Date is >3 years ago (or blank with tenure >3 yrs) — count',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'TT Flag', 'Last Promotion Date', 'Date of Joining'] }],
  caveat: 'Proxy for “flagged TT 3 consecutive years without promotion” — the input schema does not carry year-of-identification history.',
  compute: (m, ctx) => Compute.actives(m, ctx, 'Permanent').filter((e) => e.tt_flag &&
    (e.last_promotion != null ? yearsBetween(e.last_promotion, ctx.asOfDay) > 3
      : (e.doj != null && yearsBetween(e.doj, ctx.asOfDay) > 3))).length
});

defineMetric({
  key: 'succession_coverage', label: 'Succession coverage (GM + CP)', tab: 'talent',
  group: 'Succession', unit: '%', direction: 'higher', scorecard: 'Talent Management',
  formulaText: 'GM-level + Critical Positions with ≥1 identified successor ÷ all GM + CP positions × 100',
  inputs: [{ dataset: 'succession', columns: ['Position ID', 'Position Level', 'Successor Employee ID'] }],
  compute: (m, ctx) => {
    const pos = Compute.positions(m, ctx);
    if (!pos.length) return null;
    return pos.filter((p) => p.successors.length > 0).length / pos.length * 100;
  },
  drill: (m, ctx) => {
    const pos = Compute.positions(m, ctx);
    return {
      title: `GM + CP positions (${pos.length})`,
      columns: ['Position', 'Level', 'Incumbent', 'Successors', 'Ready now'],
      rows: pos.map((p) => [p.id, p.level, p.incumbent || '(vacant)', String(p.successors.length),
        String(p.successors.filter((s) => s.readiness === 'Ready Now').length)])
    };
  }
});

defineMetric({
  key: 'succ_ready_now', label: 'Ready-now index', tab: 'talent',
  group: 'Succession', unit: '%', direction: 'higher', scorecard: 'Talent Management',
  formulaText: 'Positions with a Ready Now successor ÷ all GM + CP positions × 100',
  inputs: [{ dataset: 'succession', columns: ['Position ID', 'Position Level', 'Successor Employee ID', 'Readiness'] }],
  compute: (m, ctx) => {
    const pos = Compute.positions(m, ctx);
    if (!pos.length) return null;
    return pos.filter((p) => p.successors.some((s) => s.readiness === 'Ready Now')).length / pos.length * 100;
  }
});

defineMetric({
  key: 'succ_1_2yr', label: '1–2 year index', tab: 'talent',
  group: 'Succession', unit: '%', direction: 'higher',
  formulaText: 'Positions with a 1-2 Years successor ÷ all GM + CP positions × 100',
  inputs: [{ dataset: 'succession', columns: ['Position ID', 'Position Level', 'Successor Employee ID', 'Readiness'] }],
  compute: (m, ctx) => {
    const pos = Compute.positions(m, ctx);
    if (!pos.length) return null;
    return pos.filter((p) => p.successors.some((s) => s.readiness === '1-2 Years')).length / pos.length * 100;
  }
});

defineMetric({
  key: 'internal_fill_rate', label: 'Internal fill rate (senior roles)', tab: 'talent',
  group: 'Succession', unit: '%', direction: 'higher', scorecard: 'Talent Acquisition',
  formulaText: 'Senior requisitions (AGM+) closed with Closure Mode = Internal\n÷ senior requisitions closed in period × 100',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Grade', 'Closed Date', 'Closure Mode'] }],
  caveat: 'Senior = grade AGM, DGM, GM, VP, SVP, ED. Campus closures excluded from the base.',
  compute: (m, ctx) => {
    const closed = Compute.reqsClosedInPeriod(m, ctx, true).filter((r) => r.closure_mode && r.closure_mode !== 'Campus');
    if (!closed.length) return null;
    return closed.filter((r) => r.closure_mode === 'Internal').length / closed.length * 100;
  }
});

defineMetric({
  key: 'cp_occupancy', label: 'CP occupancy by TT/CT', tab: 'talent',
  group: 'Critical Positions', unit: '%', direction: 'higher', scorecard: 'Talent Management',
  formulaText: 'Critical Positions whose incumbent is flagged TT or CT ÷ occupied CPs × 100',
  inputs: [{ dataset: 'succession', columns: ['Position ID', 'Position Level', 'Incumbent Employee ID'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'TT Flag', 'CT Flag'] }],
  compute: (m, ctx) => {
    const cps = Compute.positions(m, ctx).filter((p) => p.level === 'CP' && p.incumbent);
    if (!cps.length) return null;
    const held = cps.filter((p) => {
      const e = m.empById.get(p.incumbent);
      return e && (e.tt_flag || e.ct_flag);
    });
    return held.length / cps.length * 100;
  }
});

defineMetric({
  key: 'cp_vacancy', label: 'CP/GM vacancies', tab: 'talent',
  group: 'Critical Positions', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'GM + CP positions with no incumbent (count)',
  inputs: [{ dataset: 'succession', columns: ['Position ID', 'Incumbent Employee ID'] }],
  compute: (m, ctx) => Compute.positions(m, ctx).filter((p) => !p.incumbent).length,
  drill: (m, ctx) => {
    const v = Compute.positions(m, ctx).filter((p) => !p.incumbent);
    return {
      title: `Vacant GM + CP positions (${v.length})`,
      columns: ['Position', 'Level', 'Successors identified'],
      rows: v.map((p) => [p.id, p.level, String(p.successors.length)])
    };
  }
});

defineMetric({
  key: 'req_open_90d', label: 'Senior requisitions open >90 days', tab: 'talent',
  group: 'Critical Positions', unit: '', decimals: 0, direction: 'lower', scorecard: 'Talent Acquisition',
  formulaText: 'Open senior requisitions (AGM+) with Open Date >90 days before as-of (count)',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Grade', 'Open Date', 'Closed Date'] }],
  caveat: 'Proxy for positions vacant ≥3 months — the schema links vacancies to requisitions, not position IDs.',
  compute: (m, ctx) => m.reqs.filter((r) => r.closed_date == null && r.open_date != null &&
    Compute.inAsset(ctx, r.asset) && Compute.seniorReq(m, r) && (ctx.asOfDay - r.open_date) > 90).length
});

defineMetric({
  key: 'tt_not_successors', label: 'TTs not identified as successors', tab: 'talent',
  group: 'Top Talent', unit: '%', direction: 'lower',
  formulaText: 'TTs not appearing as a successor for any GM/CP position ÷ total TTs × 100',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'TT Flag'] },
           { dataset: 'succession', columns: ['Successor Employee ID'] }],
  compute: (m, ctx) => {
    const tts = Compute.actives(m, ctx, 'Permanent').filter((e) => e.tt_flag);
    if (!tts.length) return null;
    return tts.filter((e) => !m.successorIds.has(e.employee_id)).length / tts.length * 100;
  }
});
