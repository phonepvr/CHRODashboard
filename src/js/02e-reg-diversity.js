/* Registry — Diversity */

function femaleShare(pop) {
  if (!pop.length) return null;
  return pop.filter((e) => e.gender === 'Female').length / pop.length * 100;
}
function femaleCounts(pop) {
  const f = pop.filter((e) => e.gender === 'Female').length;
  return `${fmtInt(f)} of ${fmtInt(pop.length)}`;
}

const DIV_BANDS = [
  ['female_below_am', 'Below AM', (e) => e.grade_band === 'Below AM'],
  ['female_am_gm', 'AM–GM', (e) => e.grade_band === 'AM-GM'],
  ['female_vp', 'VP & above', (e) => e.grade_band === 'VP & above']
];
for (const [key, label, pred] of DIV_BANDS) {
  defineMetric({
    key, label: `Female share — ${label}`, tab: 'diversity',
    group: 'Gender by grade band', unit: '%', direction: 'higher',
    formulaText: `Active permanent female employees in ${label}\n÷ active permanent employees in ${label} × 100`,
    inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Gender', 'Grade Band'] }],
    compute: (m, ctx) => femaleShare(Compute.actives(m, ctx, 'Permanent').filter(pred)),
    quality: (m, ctx) => {
      const pop = Compute.actives(m, ctx, 'Permanent').filter(pred);
      return pop.length && pop.length < 25 ? `Small base: ${femaleCounts(pop)}` : null;
    },
    drill: (m, ctx) => {
      const pop = Compute.actives(m, ctx, 'Permanent').filter(pred);
      return {
        title: `Gender split — ${label}`,
        columns: ['Asset', 'Female', 'Male', 'Female %'],
        rows: CONFIG.assets.filter((a) => ctx.asset === 'Group' || a === ctx.asset).map((a) => {
          const p = pop.filter((e) => e.asset === a);
          const f = p.filter((e) => e.gender === 'Female').length;
          return [a, fmtInt(f), fmtInt(p.length - f), p.length ? fmtPct(f / p.length * 100, 1) : '—'];
        })
      };
    }
  });
}

defineMetric({
  key: 'female_tt', label: 'Female share among TT', tab: 'diversity',
  group: 'Gender in talent pools', unit: '%', direction: 'higher',
  formulaText: 'Female TTs ÷ all TTs × 100',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Gender', 'TT Flag'] }],
  compute: (m, ctx) => femaleShare(Compute.actives(m, ctx, 'Permanent').filter((e) => e.tt_flag))
});

defineMetric({
  key: 'female_trainees', label: 'Female share among trainees', tab: 'diversity',
  group: 'Gender in talent pools', unit: '%', direction: 'higher', scorecard: 'Talent Acquisition',
  formulaText: 'Female trainees ÷ all trainees × 100 — the pipeline shifts the future mix',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Gender', 'Employee Class'] }],
  compute: (m, ctx) => femaleShare(Compute.actives(m, ctx, 'Trainee'))
});

defineMetric({
  key: 'disability_count', label: 'Employees with disability', tab: 'diversity',
  group: 'Inclusion', unit: '', decimals: 0, direction: null,
  formulaText: 'Active employees with Disability Flag = Y (count)',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Disability Flag'] }],
  caveat: 'Self-declared; blank flags read as N — coverage of the declaration drive matters.',
  compute: (m, ctx) => Compute.actives(m, ctx, null).filter((e) => e.disability_flag).length
});

defineMetric({
  key: 'intl_pct', label: 'International workforce', tab: 'diversity',
  group: 'Inclusion', unit: '%', decimals: 2, direction: null,
  formulaText: 'Active employees with Nationality ≠ Indian ÷ active employees × 100',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Nationality'] }],
  compute: (m, ctx) => {
    const a = Compute.actives(m, ctx, null).filter((e) => e.nationality);
    if (!a.length) return null;
    return a.filter((e) => e.nationality.toLowerCase() !== 'indian').length / a.length * 100;
  },
  quality: (m, ctx) => Compute.blankShareNote(m, ctx, 'employee_master', 'nationality', 'Nationality')
});
