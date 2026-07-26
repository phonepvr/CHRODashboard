/* REGISTRY — the single source of truth for every metric on the dashboard.
   Each entry drives: its tile, the "i" popover (formula, inputs, caveat, quality
   note), the Methodology appendix, the data dictionary ("used by"), scorecard
   rows, exec-summary rules and partial-load greying. No metric appears anywhere
   that is not in this registry.

   Entry contract:
   { key, label, tab, group, unit ('%','','d','₹','t',…), decimals,
     direction: 'higher'|'lower'|null,
     scorecard: 'Talent Acquisition'|'Talent Management'|'Performance & Rewards'|
                'L&D'|'HR Operations'|'Financial Indicators'|null,
     formulaText, inputs: [{dataset, columns:[…]}], caveat,
     cohort: null | 'TT' | …           (display annotation only)
     source: null | 'SCRUM' | 'Aparajita'
     compute(m, ctx) -> number|null    (m = joined model, ctx = filters)
     quality(m, ctx) -> string|null    (data-quality warning for the tile)
     spark(m, ctx)  -> number[]|null   (monthly series, oldest→newest)
     drill(m, ctx)  -> {title, columns, rows}|null
   } */

const REGISTRY = [];
const REG_BY_KEY = new Map();

function defineMetric(entry) {
  if (REG_BY_KEY.has(entry.key)) throw new Error('duplicate metric key ' + entry.key);
  entry.decimals = entry.decimals ?? 1;
  entry.direction = entry.direction ?? null;
  entry.scorecard = entry.scorecard ?? null;
  entry.caveat = entry.caveat ?? '';
  entry.source = entry.source ?? null;
  REGISTRY.push(entry);
  REG_BY_KEY.set(entry.key, entry);
}

/* =================== Workforce (Overview) =================== */

defineMetric({
  key: 'headcount_close', label: 'Closing headcount (permanent)', tab: 'overview',
  group: 'Workforce', unit: '', decimals: 0, direction: null,
  formulaText: 'Active permanent employees at period end\n= rows in employee master with Employee Class = Permanent,\n  Date of Joining ≤ as-of date, and no exit on or before as-of',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band', 'Employee Class', 'Date of Joining'] }],
  caveat: 'Contract workforce is tracked separately on the Contract Workforce tab. Exits are netted off when exits.csv is loaded; without it every row counts as active.',
  compute: (m, ctx) => Compute.actives(m, ctx, 'Permanent').length,
  spark: (m, ctx) => Compute.monthlySeries(m, ctx, (mm, day) => Compute.activesAt(m, ctx, 'Permanent', day).length),
  drill: (m, ctx) => Compute.drillHeadcount(m, ctx)
});

defineMetric({
  key: 'headcount_trainee', label: 'Trainees on roll', tab: 'overview',
  group: 'Workforce', unit: '', decimals: 0, direction: null,
  formulaText: 'Active employees at period end with Employee Class = Trainee',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Employee Class', 'Date of Joining'] }],
  compute: (m, ctx) => Compute.actives(m, ctx, 'Trainee').length
});

defineMetric({
  key: 'headcount_contract', label: 'Contract workforce', tab: 'overview',
  group: 'Workforce', unit: '', decimals: 0, direction: null, source: 'SCRUM',
  formulaText: 'Σ Contract Headcount across contractors for the latest month in the period',
  inputs: [{ dataset: 'contract_attendance', columns: ['Contractor', 'Asset', 'Month', 'Contract Headcount'] }],
  caveat: 'Attendance and statutory compliance only — no talent/L&D metrics apply to this population.',
  compute: (m, ctx) => Compute.contractHeadcount(m, ctx)
});

defineMetric({
  key: 'tt_count', label: 'Top Talent (TT)', tab: 'overview',
  group: 'Workforce', unit: '', decimals: 0, direction: null,
  formulaText: 'Active permanent employees with TT Flag = Y',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'TT Flag'] }],
  compute: (m, ctx) => Compute.actives(m, ctx, 'Permanent').filter((e) => e.tt_flag).length
});

defineMetric({
  key: 'ct_count', label: 'Critical Talent (CT)', tab: 'overview',
  group: 'Workforce', unit: '', decimals: 0, direction: null,
  formulaText: 'Active permanent employees with CT Flag = Y',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'CT Flag'] }],
  compute: (m, ctx) => Compute.actives(m, ctx, 'Permanent').filter((e) => e.ct_flag).length
});

defineMetric({
  key: 'cp_count', label: 'Critical Positions (CP)', tab: 'overview',
  group: 'Workforce', unit: '', decimals: 0, direction: null,
  formulaText: 'Positions in the succession file with Position Level = CP\n(falls back to employees flagged Critical Position when succession.csv is absent)',
  inputs: [{ dataset: 'succession', columns: ['Position ID', 'Position Level'] }],
  compute: (m, ctx) => Compute.cpPositions(m, ctx)
});

defineMetric({
  key: 'near_retirement_pct', label: 'Within 5 yrs of superannuation', tab: 'overview',
  group: 'Workforce', unit: '%', direction: 'lower',
  formulaText: `Active permanent employees with age ≥ ${CONFIG.retirementAge - 5}\n÷ active permanent employees × 100\n(retirement age ${CONFIG.retirementAge}, configurable)`,
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'DOB'] }],
  caveat: 'Deterministic from DOB — see the superannuation glidepath on Outlook.',
  compute: (m, ctx) => {
    const a = Compute.actives(m, ctx, 'Permanent').filter((e) => e.dob != null);
    if (!a.length) return null;
    const near = a.filter((e) => yearsBetween(e.dob, ctx.asOfDay) >= CONFIG.retirementAge - 5);
    return near.length / a.length * 100;
  },
  quality: (m, ctx) => Compute.blankShareNote(m, ctx, 'employee_master', 'dob', 'DOB')
});

defineMetric({
  key: 'span_of_control', label: 'Span of control', tab: 'overview',
  group: 'Workforce', unit: '', direction: null,
  formulaText: 'Individual contributors ÷ people managers\n(managers = active employees referenced as Manager ID by ≥1 active employee)',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Manager ID'] }],
  caveat: 'Managers with dotted-line teams are counted once, by direct reports only.',
  compute: (m, ctx) => {
    const a = Compute.actives(m, ctx, 'Permanent');
    if (!a.length) return null;
    const mgrIds = new Set(a.map((e) => e.manager_id).filter(Boolean));
    const managers = a.filter((e) => mgrIds.has(e.employee_id)).length;
    if (!managers) return null;
    return (a.length - managers) / managers;
  }
});

defineMetric({
  key: 'attr_annualised', label: 'Annualised attrition', tab: 'overview',
  group: 'Workforce', unit: '%', direction: 'lower', scorecard: 'HR Operations',
  formulaText: '(Exits in period ÷ average headcount over period) × (12 ÷ months in period) × 100',
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Date of Joining', 'Employee Class'] }],
  caveat: 'Permanent roll; voluntary + involuntary exits; superannuation excluded.',
  compute: (m, ctx) => Compute.annualisedAttrition(m, ctx),
  spark: (m, ctx) => Compute.monthlySeries(m, ctx, (mm) => Compute.monthAttritionRate(m, ctx, mm)),
  quality: (m, ctx) => Compute.blankExitReasonNote(m, ctx)
});

defineMetric({
  key: 'female_pct', label: 'Female share of workforce', tab: 'overview',
  group: 'Workforce', unit: '%', direction: 'higher', scorecard: 'HR Operations',
  formulaText: 'Active permanent female employees ÷ active permanent employees × 100',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Gender'] }],
  compute: (m, ctx) => {
    const a = Compute.actives(m, ctx, 'Permanent');
    if (!a.length) return null;
    return a.filter((e) => e.gender === 'Female').length / a.length * 100;
  }
});
