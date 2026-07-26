/* Registry — metrics that exist primarily for the CHRO Scorecard
   (Talent Acquisition timing + Performance & Rewards promotion discipline). */

defineMetric({
  key: 'time_to_fill_median', label: 'Median time to fill', tab: 'talent',
  group: 'Hiring', unit: 'd', decimals: 0, direction: 'lower', scorecard: 'Talent Acquisition',
  formulaText: 'Median of (Closed Date − Open Date) across requisitions closed in period',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Open Date', 'Closed Date'] }],
  compute: (m, ctx) => {
    const closed = Compute.reqsClosedInPeriod(m, ctx, false).filter((r) => r.open_date != null);
    if (!closed.length) return null;
    return median(closed.map((r) => r.closed_date - r.open_date));
  }
});

defineMetric({
  key: 'promo_coverage_2y', label: 'Promoted in last 2 yrs (AM+ bands)', tab: 'talent',
  group: 'Hiring', unit: '%', direction: 'higher', scorecard: 'Performance & Rewards',
  formulaText: 'Active AM–GM and VP+ employees with a Last Promotion Date within 2 years\n÷ those with tenure ≥2 years × 100',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Grade Band', 'Last Promotion Date', 'Date of Joining'] }],
  caveat: 'Below-AM promotions are usually grade-progressions handled separately; excluded here.',
  compute: (m, ctx) => {
    const pop = Compute.actives(m, ctx, 'Permanent').filter((e) =>
      e.grade_band !== 'Below AM' && e.doj != null && yearsBetween(e.doj, ctx.asOfDay) >= 2);
    if (!pop.length) return null;
    return pop.filter((e) => e.last_promotion != null && yearsBetween(e.last_promotion, ctx.asOfDay) <= 2).length / pop.length * 100;
  }
});

defineMetric({
  key: 'promo_recency_median', label: 'Median years since promotion (AM+)', tab: 'talent',
  group: 'Hiring', unit: '', decimals: 1, direction: 'lower', scorecard: 'Performance & Rewards',
  formulaText: 'Median of (as-of − Last Promotion Date) in years, for AM–GM and VP+\nemployees who have ever been promoted',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Grade Band', 'Last Promotion Date'] }],
  compute: (m, ctx) => {
    const pop = Compute.actives(m, ctx, 'Permanent')
      .filter((e) => e.grade_band !== 'Below AM' && e.last_promotion != null);
    if (!pop.length) return null;
    return median(pop.map((e) => yearsBetween(e.last_promotion, ctx.asOfDay)));
  }
});
