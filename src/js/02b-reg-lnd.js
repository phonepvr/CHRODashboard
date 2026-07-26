/* Registry — Learning & Development */

const LND_COHORTS = [
  ['all', 'All', 'All permanent + trainee employees'],
  ['tt', 'TT', 'Top Talent'],
  ['trainees', 'Trainees', 'Trainees'],
  ['vp', 'VP+', 'VP & above'],
  ['amgm', 'AM-GM', 'AM–GM band']
];
const LND_COHORT_ARG = { all: 'All', tt: 'TT', trainees: 'Trainees', vp: 'VP+', amgm: 'AM-GM' };

for (const [ck, cLabel, cDesc] of LND_COHORTS) {
  defineMetric({
    key: 'learning_coverage_' + ck,
    label: `Learning coverage — ${cLabel === 'AM-GM' ? 'AM–GM' : cLabel}`, tab: 'lnd',
    group: 'Learning coverage', unit: '%', direction: 'higher',
    scorecard: ck === 'all' ? 'L&D' : null, cohort: cLabel,
    formulaText: `${cDesc} with ≥1 learning intervention in the trailing 12 months\n÷ cohort headcount × 100`,
    inputs: [{ dataset: 'learning_events', columns: ['Employee ID', 'Start Date'] },
             { dataset: 'employee_master', columns: ['Employee ID', 'Grade Band', 'Employee Class', 'TT Flag'] }],
    compute: (m, ctx) => Compute.learningCoverage(m, ctx, LND_COHORT_ARG[ck])
  });
}

for (const [ck, cLabel, cDesc] of LND_COHORTS) {
  defineMetric({
    key: 'learning_days_' + ck,
    label: `Person-days per employee — ${cLabel === 'AM-GM' ? 'AM–GM' : cLabel}`, tab: 'lnd',
    group: 'Learning intensity', unit: '', decimals: 2, direction: 'higher',
    scorecard: ck === 'all' ? 'L&D' : null, cohort: cLabel,
    formulaText: `Σ Person-Days for ${cDesc} in the trailing 12 months ÷ cohort headcount`,
    inputs: [{ dataset: 'learning_events', columns: ['Employee ID', 'Start Date', 'Person-Days'] },
             { dataset: 'employee_master', columns: ['Employee ID', 'Grade Band', 'Employee Class', 'TT Flag'] }],
    compute: (m, ctx) => Compute.learningDaysPerEmp(m, ctx, LND_COHORT_ARG[ck])
  });
}

defineMetric({
  key: 'idp_coverage', label: 'IDP coverage (TT + VP+)', tab: 'lnd',
  group: 'Development plans', unit: '%', direction: 'higher', scorecard: 'L&D',
  formulaText: 'Eligible employees (TT + VP & above) with IDP on System Flag = Y\n÷ eligible employees × 100',
  inputs: [{ dataset: 'idp_status', columns: ['Employee ID', 'IDP on System Flag'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'TT Flag', 'Grade Band'] }],
  compute: (m, ctx) => {
    const eligible = Compute.actives(m, ctx, null).filter((e) => e.tt_flag || e.grade_band === 'VP & above');
    if (!eligible.length) return null;
    const idpByEmp = new Map(m.idp.map((r) => [r.employee_id, r]));
    return eligible.filter((e) => idpByEmp.get(e.employee_id)?.idp_flag).length / eligible.length * 100;
  },
  quality: (m, ctx) => Compute.staleIdpNote(m, ctx)
});

defineMetric({
  key: 'idp_impl_avg', label: 'Average IDP implementation', tab: 'lnd',
  group: 'Development plans', unit: '%', direction: 'higher',
  formulaText: 'Mean of IDP Implementation % across IDPs on system',
  inputs: [{ dataset: 'idp_status', columns: ['Employee ID', 'IDP on System Flag', 'IDP Implementation %'] }],
  compute: (m, ctx) => {
    const rows = m.idp.filter((r) => {
      const e = m.empById.get(r.employee_id);
      return r.idp_flag && r.idp_pct != null && (!e || Compute.empMatch(e, ctx));
    });
    return rows.length ? mean(rows.map((r) => r.idp_pct)) : null;
  },
  quality: (m, ctx) => Compute.staleIdpNote(m, ctx)
});

const IDP_BANDS = [
  ['idp_band_low', '≤25% implementation', (p) => p <= 25],
  ['idp_band_mid', '26–50% implementation', (p) => p > 25 && p <= 50],
  ['idp_band_high', '>50% implementation', (p) => p > 50]
];
for (const [key, label, pred] of IDP_BANDS) {
  defineMetric({
    key, label: `TT development plans at ${label}`, tab: 'lnd',
    group: 'Development plans', unit: '%', direction: key === 'idp_band_high' ? 'higher' : (key === 'idp_band_low' ? 'lower' : null),
    formulaText: `TTs whose IDP Implementation % is ${label.replace(' implementation', '')}\n÷ TTs with an IDP on system × 100`,
    inputs: [{ dataset: 'idp_status', columns: ['Employee ID', 'IDP on System Flag', 'IDP Implementation %'] },
             { dataset: 'employee_master', columns: ['Employee ID', 'TT Flag'] }],
    compute: (m, ctx) => {
      const idpByEmp = new Map(m.idp.map((r) => [r.employee_id, r]));
      const tts = Compute.actives(m, ctx, 'Permanent').filter((e) => e.tt_flag)
        .map((e) => idpByEmp.get(e.employee_id))
        .filter((r) => r && r.idp_flag && r.idp_pct != null);
      if (!tts.length) return null;
      return tts.filter((r) => pred(r.idp_pct)).length / tts.length * 100;
    }
  });
}

defineMetric({
  key: 'lms_adoption', label: 'LMS adoption (ever logged in)', tab: 'lnd',
  group: 'Learning platform', unit: '%', direction: 'higher', scorecard: 'L&D',
  formulaText: 'Licensed users with ≥1 login ÷ licensed users × 100',
  inputs: [{ dataset: 'lms_usage', columns: ['Employee ID', 'Licensed Flag', 'Last Login Date'] }],
  compute: (m, ctx) => {
    const rows = m.lms.filter((r) => {
      if (!r.licensed_flag) return false;
      const e = m.empById.get(r.employee_id);
      return !e || Compute.empMatch(e, ctx);
    });
    if (!rows.length) return null;
    return rows.filter((r) => r.last_login != null).length / rows.length * 100;
  }
});

defineMetric({
  key: 'lms_active_6m', label: 'LMS active in last 6 months', tab: 'lnd',
  group: 'Learning platform', unit: '%', direction: 'higher', scorecard: 'L&D',
  formulaText: 'Licensed users with a login in the last 6 months ÷ licensed users × 100',
  inputs: [{ dataset: 'lms_usage', columns: ['Employee ID', 'Licensed Flag', 'Last Login Date'] }],
  compute: (m, ctx) => {
    const rows = m.lms.filter((r) => {
      if (!r.licensed_flag) return false;
      const e = m.empById.get(r.employee_id);
      return !e || Compute.empMatch(e, ctx);
    });
    if (!rows.length) return null;
    return rows.filter((r) => r.last_login != null && (ctx.asOfDay - r.last_login) <= 182).length / rows.length * 100;
  }
});
