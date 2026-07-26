/* Registry — Attrition */

defineMetric({
  key: 'attr_ytd', label: 'Attrition — fiscal YTD (annualised)', tab: 'attrition',
  group: 'Attrition rates', unit: '%', direction: 'lower',
  formulaText: '(Exits since 1 April ÷ average headcount since 1 April)\n× (12 ÷ elapsed months) × 100',
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Date of Joining', 'Employee Class'] }],
  compute: (m, ctx) => Compute.ytdAttrition(m, ctx)
});

const ATTR_COHORTS = [
  ['attr_tt_count', 'TT exits', (e) => e.tt_flag, 'Talent Management'],
  ['attr_ct_count', 'CT exits', (e) => e.ct_flag, null],
  ['attr_trainee_count', 'Trainee exits', (e) => e.employee_class === 'Trainee', null]
];
for (const [key, label, pred, sc] of ATTR_COHORTS) {
  defineMetric({
    key, label: label + ' in period', tab: 'attrition',
    group: 'Cohort attrition', unit: '', decimals: 0, direction: 'lower', scorecard: sc,
    formulaText: `Exits in period where the employee ${label === 'Trainee exits' ? 'is a Trainee' : 'is flagged ' + label.split(' ')[0]} (count)`,
    inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date'] },
             { dataset: 'employee_master', columns: ['Employee ID', 'TT Flag', 'CT Flag', 'Employee Class'] }],
    compute: (m, ctx) => Compute.exitsInPeriod(m, ctx, null).filter((x) => pred(x.__emp)).length,
    drill: (m, ctx) => {
      const xs = Compute.exitsInPeriod(m, ctx, null).filter((x) => pred(x.__emp));
      return {
        title: `${label} in period (${xs.length})`,
        columns: ['Employee', 'Asset', 'Band', 'Exit date', 'Type', 'Reason'],
        rows: xs.map((x) => [x.employee_id, x.__emp.asset, CONFIG.bandLabels[x.__emp.grade_band] || '', fmtDMY(x.exit_date), x.exit_type, x.exit_reason || '(blank)'])
      };
    }
  });
}

defineMetric({
  key: 'attr_early_1y', label: 'Early turnover (≤1 yr tenure)', tab: 'attrition',
  group: 'Early turnover', unit: '%', direction: 'lower', scorecard: 'HR Operations',
  formulaText: 'Exits in period with tenure ≤1 year ÷ joins in the trailing 12 months × 100',
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Date of Joining'] }],
  compute: (m, ctx) => {
    const joins = Compute.joinsInWindow(m, ctx, 12, null).length;
    if (!joins) return null;
    const early = Compute.exitsInPeriod(m, ctx, null)
      .filter((x) => x.__emp.doj != null && yearsBetween(x.__emp.doj, x.exit_date) <= 1);
    return early.length / joins * 100;
  }
});

defineMetric({
  key: 'attr_early_2y', label: 'Early turnover (≤2 yrs tenure)', tab: 'attrition',
  group: 'Early turnover', unit: '%', direction: 'lower',
  formulaText: 'Exits in period with tenure ≤2 years ÷ joins in the trailing 24 months × 100',
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Date of Joining'] }],
  compute: (m, ctx) => {
    const joins = Compute.joinsInWindow(m, ctx, 24, null).length;
    if (!joins) return null;
    const early = Compute.exitsInPeriod(m, ctx, null)
      .filter((x) => x.__emp.doj != null && yearsBetween(x.__emp.doj, x.exit_date) <= 2);
    return early.length / joins * 100;
  }
});

defineMetric({
  key: 'attr_rehire_ok', label: 'Exits tagged OK to rehire', tab: 'attrition',
  group: 'Exit quality', unit: '', decimals: 0, direction: null,
  formulaText: 'Exits in period with OK-to-Rehire Flag = Y (count)',
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date', 'OK-to-Rehire Flag'] }],
  caveat: 'A boomerang-hiring pool — read together with Closure Mode = Boomerang on requisitions.',
  compute: (m, ctx) => Compute.exitsInPeriod(m, ctx, null).filter((x) => x.rehire_flag).length
});

defineMetric({
  key: 'attr_regretted', label: 'Regretted attrition', tab: 'attrition',
  group: 'Exit quality', unit: '%', direction: 'lower', scorecard: 'HR Operations',
  formulaText: 'Exits in period with Regretted Flag = Y ÷ exits in period × 100',
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date', 'Regretted Flag'] }],
  compute: (m, ctx) => {
    const xs = Compute.exitsInPeriod(m, ctx, null);
    if (!xs.length) return null;
    return xs.filter((x) => x.regretted_flag).length / xs.length * 100;
  },
  quality: (m) => Compute.blankExitReasonNote()
});
