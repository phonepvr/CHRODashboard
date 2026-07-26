/* Registry — Internal Mobility (internal job portal) */

function mobReqsInPeriod(m, ctx) {
  return m.reqs.filter((r) => r.open_date != null && Compute.inAsset(ctx, r.asset) &&
    dayToMonthIdx(r.open_date) >= ctx.startMonth && dayToMonthIdx(r.open_date) <= ctx.endMonth);
}
function mobAppsInPeriod(m, ctx) {
  return m.apps.filter((a) => {
    if (a.application_date == null) return false;
    const mi = dayToMonthIdx(a.application_date);
    if (mi < ctx.startMonth || mi > ctx.endMonth) return false;
    const r = m.reqById.get(a.requisition_id);
    return !r || Compute.inAsset(ctx, r.asset);
  });
}

const MOB_FUNNEL = [
  ['mob_openings', 'New openings', 'Requisitions with Open Date in the period',
    (m, ctx) => mobReqsInPeriod(m, ctx).length, [{ dataset: 'requisitions', columns: ['Requisition ID', 'Open Date', 'Asset'] }]],
  ['mob_postings', 'Postings on internal portal', 'Requisitions opened in period with Posted Internally Flag = Y',
    (m, ctx) => mobReqsInPeriod(m, ctx).filter((r) => r.posted_flag).length,
    [{ dataset: 'requisitions', columns: ['Requisition ID', 'Open Date', 'Posted Internally Flag'] }]],
  ['mob_postings_with_apps', 'Postings receiving internal applications', 'Posted requisitions with ≥1 internal application',
    (m, ctx) => {
      const withApps = new Set(m.apps.map((a) => a.requisition_id));
      return mobReqsInPeriod(m, ctx).filter((r) => r.posted_flag && withApps.has(r.requisition_id)).length;
    },
    [{ dataset: 'requisitions', columns: ['Requisition ID', 'Posted Internally Flag'] },
     { dataset: 'internal_applications', columns: ['Requisition ID'] }]],
  ['mob_apps', 'Internal applications', 'Applications with Application Date in the period',
    (m, ctx) => mobAppsInPeriod(m, ctx).length,
    [{ dataset: 'internal_applications', columns: ['Application ID', 'Application Date'] }]],
  ['mob_interviewed', 'Interviewed', 'Applications in period with Status = Interviewed or beyond',
    (m, ctx) => mobAppsInPeriod(m, ctx).filter((a) => ['Interviewed', 'Offered'].includes(a.status)).length,
    [{ dataset: 'internal_applications', columns: ['Application ID', 'Status'] }]],
  ['mob_offers', 'Offers to internal candidates', 'Applications in period with Status = Offered',
    (m, ctx) => mobAppsInPeriod(m, ctx).filter((a) => a.status === 'Offered').length,
    [{ dataset: 'internal_applications', columns: ['Application ID', 'Status'] }]],
  ['mob_rejected', 'Rejected', 'Applications in period with Status = Rejected',
    (m, ctx) => mobAppsInPeriod(m, ctx).filter((a) => a.status === 'Rejected').length,
    [{ dataset: 'internal_applications', columns: ['Application ID', 'Status'] }]]
];

for (const [key, label, formula, compute, inputs] of MOB_FUNNEL) {
  defineMetric({
    key, label, tab: 'mobility', group: 'Portal funnel', unit: '', decimals: 0,
    direction: null, formulaText: formula + ' (count)', inputs, compute
  });
}

defineMetric({
  key: 'posting_compliance', label: 'Internal posting compliance', tab: 'mobility',
  group: 'Process discipline', unit: '%', direction: 'higher', scorecard: 'Talent Acquisition',
  formulaText: 'Externally-filled positions (excl. Campus) that were posted internally\n÷ externally-filled positions (excl. Campus) × 100\nAim: 100% of non-confidential positions',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Closed Date', 'Closure Mode', 'Posted Internally Flag', 'Confidential Flag'] }],
  caveat: 'Confidential requisitions are excluded — they are exempt from internal posting.',
  compute: (m, ctx) => {
    const ext = Compute.reqsClosedInPeriod(m, ctx, false)
      .filter((r) => (r.closure_mode === 'External' || r.closure_mode === 'Boomerang') && !r.confidential_flag);
    if (!ext.length) return null;
    return ext.filter((r) => r.posted_flag).length / ext.length * 100;
  },
  drill: (m, ctx) => {
    const miss = Compute.reqsClosedInPeriod(m, ctx, false)
      .filter((r) => (r.closure_mode === 'External' || r.closure_mode === 'Boomerang') && !r.confidential_flag && !r.posted_flag);
    return {
      title: `Externally filled without internal posting (${miss.length})`,
      columns: ['Requisition', 'Asset', 'Grade', 'Function', 'Closed'],
      rows: miss.map((r) => [r.requisition_id, r.asset, r.grade || '', r.function || '', fmtDMY(r.closed_date)])
    };
  }
});

defineMetric({
  key: 'mobility_ageing', label: 'Applications with no action >15 days', tab: 'mobility',
  group: 'Process discipline', unit: '', decimals: 0, direction: 'lower', scorecard: 'HR Operations',
  formulaText: 'Open internal applications (Applied/Shortlisted) whose Last Action Date\nis >15 days before as-of (count)',
  inputs: [{ dataset: 'internal_applications', columns: ['Application ID', 'Status', 'Last Action Date'] }],
  compute: (m, ctx) => m.apps.filter((a) => {
    if (!['Applied', 'Shortlisted'].includes(a.status)) return false;
    const r = m.reqById.get(a.requisition_id);
    if (r && !Compute.inAsset(ctx, r.asset)) return false;
    const last = a.last_action_date ?? a.application_date;
    return last != null && (ctx.asOfDay - last) > 15;
  }).length,
  drill: (m, ctx) => {
    const rows = m.apps.filter((a) => {
      if (!['Applied', 'Shortlisted'].includes(a.status)) return false;
      const r = m.reqById.get(a.requisition_id);
      if (r && !Compute.inAsset(ctx, r.asset)) return false;
      const last = a.last_action_date ?? a.application_date;
      return last != null && (ctx.asOfDay - last) > 15;
    });
    return {
      title: `Stalled internal applications (${rows.length})`,
      columns: ['Application', 'Requisition', 'Applicant', 'Status', 'Last action', 'Days stalled'],
      rows: rows.map((a) => {
        const last = a.last_action_date ?? a.application_date;
        return [a.application_id, a.requisition_id, a.employee_id, a.status, fmtDMY(last), fmtInt(ctx.asOfDay - last)];
      })
    };
  }
});

defineMetric({
  key: 'ext_closed_ready_now', label: 'External hires despite ready-now bench', tab: 'mobility',
  group: 'Process discipline', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Senior requisitions closed externally in the period at assets where ≥1\nReady Now successor existed (count) — surfaced as process failures',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Grade', 'Closed Date', 'Closure Mode', 'Asset'] },
           { dataset: 'succession', columns: ['Successor Employee ID', 'Readiness'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset'] }],
  caveat: 'The schema links requisitions to assets, not position IDs, so this matches at asset level: an external senior hire while the same asset had an unplaced Ready Now successor.',
  compute: (m, ctx) => {
    const readyByAsset = new Set();
    for (const s of m.succ) {
      if (s.readiness !== 'Ready Now' || !s.successor_id) continue;
      const e = m.empById.get(s.successor_id);
      if (e) readyByAsset.add(e.asset);
    }
    return Compute.reqsClosedInPeriod(m, ctx, true)
      .filter((r) => r.closure_mode === 'External' && readyByAsset.has(r.asset)).length;
  }
});

defineMetric({
  key: 'ext_closed_12yr', label: 'External hires despite 1–2 yr bench', tab: 'mobility',
  group: 'Process discipline', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Senior requisitions closed externally in the period at assets where ≥1\n1-2 Years successor existed (count)',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Grade', 'Closed Date', 'Closure Mode', 'Asset'] },
           { dataset: 'succession', columns: ['Successor Employee ID', 'Readiness'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset'] }],
  caveat: 'Asset-level match — see the ready-now tile for the definition.',
  compute: (m, ctx) => {
    const benchByAsset = new Set();
    for (const s of m.succ) {
      if (s.readiness !== '1-2 Years' || !s.successor_id) continue;
      const e = m.empById.get(s.successor_id);
      if (e) benchByAsset.add(e.asset);
    }
    return Compute.reqsClosedInPeriod(m, ctx, true)
      .filter((r) => r.closure_mode === 'External' && benchByAsset.has(r.asset)).length;
  }
});
