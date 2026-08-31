/* Registry — additions incorporated from the second reference pass
   (corporate executive-dashboard spec + talent-capability MIS structure):
   workforce demographics, hiring/separation depth, performance-cycle
   discipline, L&D quality/cost, recognition coverage, wellbeing aggregates.
   Same rules as everywhere: generalized nomenclature, no reference figures. */

/* ---------- shared helpers for this block ---------- */

function seniorEmp(m, e) {
  return e.grade_band === 'VP & above' || (e.grade && m.SENIOR_GRADES.has(String(e.grade).toUpperCase()));
}

function learnRows12m(m, ctx) {
  const from = monthEndDay(ctx.endMonth - 12) + 1;
  return m.learning.filter((l) => {
    if (l.start_date == null || l.start_date < from || l.start_date > ctx.asOfDay) return false;
    const e = m.empById.get(l.employee_id);
    if (!e) return ctx.asset === 'Group' && ctx.band === 'All';
    return Compute.empMatch(e, ctx);
  });
}

/* =================== Workforce demographics (Overview) =================== */

defineMetric({
  key: 'avg_age', label: 'Average age', tab: 'overview',
  group: 'Workforce', unit: '', decimals: 1, direction: null,
  formulaText: 'Σ age of active permanent employees ÷ active permanent employees (years)',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'DOB'] }],
  caveat: 'Read with the age-distribution chart below — an average hides a twin-peaked plant.',
  compute: (m, ctx) => {
    const a = Compute.actives(m, ctx, 'Permanent').filter((e) => e.dob != null);
    return a.length ? mean(a.map((e) => yearsBetween(e.dob, ctx.asOfDay))) : null;
  }
});

defineMetric({
  key: 'avg_tenure', label: 'Average tenure', tab: 'overview',
  group: 'Workforce', unit: '', decimals: 1, direction: null,
  formulaText: 'Σ company tenure of active permanent employees ÷ active permanent employees (years)',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Date of Joining'] }],
  compute: (m, ctx) => {
    const a = Compute.actives(m, ctx, 'Permanent').filter((e) => e.doj != null);
    return a.length ? mean(a.map((e) => yearsBetween(e.doj, ctx.asOfDay))) : null;
  }
});

/* =================== Hiring & separation depth =================== */

defineMetric({
  key: 'senior_joins', label: 'Senior joiners in period', tab: 'talent',
  group: 'Hiring', unit: '', decimals: 0, direction: null,
  formulaText: 'Active employees with Date of Joining in the period at senior grades\n(AGM+ or VP & above) — count',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Grade', 'Grade Band', 'Date of Joining', 'Function'] }],
  caveat: 'The drill-down is the "key senior hires" table: month, grade, function, asset.',
  compute: (m, ctx) => m.emps.filter((e) => !e.__exit && seniorEmp(m, e) && e.doj != null &&
    Compute.empMatch(e, ctx) &&
    dayToMonthIdx(e.doj) >= ctx.startMonth && dayToMonthIdx(e.doj) <= ctx.endMonth).length,
  drill: (m, ctx) => {
    const rows = m.emps.filter((e) => !e.__exit && seniorEmp(m, e) && e.doj != null &&
      Compute.empMatch(e, ctx) &&
      dayToMonthIdx(e.doj) >= ctx.startMonth && dayToMonthIdx(e.doj) <= ctx.endMonth)
      .sort((a, b) => b.doj - a.doj);
    return {
      title: `Senior joiners in period (${rows.length})`,
      columns: ['Month', 'Employee', 'Grade', 'Function', 'Asset'],
      rows: rows.map((e) => [monthIdxToLabel(dayToMonthIdx(e.doj)), e.employee_id, e.grade || '', e.function || '', e.asset])
    };
  }
});

defineMetric({
  key: 'senior_exits', label: 'Senior exits in period', tab: 'attrition',
  group: 'Cohort attrition', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Exits in period at senior grades (AGM+ or VP & above) — count',
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date', 'Exit Reason'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Grade', 'Grade Band'] }],
  caveat: 'The drill-down is the "key senior exits" table with stated reasons.',
  compute: (m, ctx) => Compute.exitsInPeriod(m, ctx, null).filter((x) => seniorEmp(m, x.__emp)).length,
  drill: (m, ctx) => {
    const rows = Compute.exitsInPeriod(m, ctx, null).filter((x) => seniorEmp(m, x.__emp))
      .sort((a, b) => b.exit_date - a.exit_date);
    return {
      title: `Senior exits in period (${rows.length})`,
      columns: ['Month', 'Employee', 'Grade', 'Function', 'Asset', 'Reason'],
      rows: rows.map((x) => [monthIdxToLabel(dayToMonthIdx(x.exit_date)), x.employee_id,
        x.__emp.grade || '', x.__emp.function || '', x.__emp.asset, x.exit_reason || '(blank)'])
    };
  }
});

defineMetric({
  key: 'attr_voluntary', label: 'Voluntary attrition (annualised)', tab: 'attrition',
  group: 'Attrition rates', unit: '%', direction: 'lower',
  formulaText: '(Voluntary exits in period ÷ average headcount) × (12 ÷ months in period) × 100',
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date', 'Exit Type'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Date of Joining', 'Employee Class'] }],
  caveat: 'The regrettable, influenceable share of total attrition — the retention lever.',
  compute: (m, ctx) => Compute.annualisedAttritionWhere(m, ctx, (x) => x.exit_type === 'Voluntary'),
  spark: (m, ctx) => Compute.monthlySeries(m, ctx, (mi) =>
    Compute.monthAttritionRateWhere(m, ctx, mi, (x) => x.exit_type === 'Voluntary'))
});

/* =================== Performance-cycle discipline =================== */

defineMetric({
  key: 'goal_setting_pct', label: 'Goal-setting completion', tab: 'talent',
  group: 'Performance management', unit: '%', direction: 'higher', scorecard: 'Performance & Rewards',
  formulaText: 'Employees with Goal Setting Complete Flag = Y ÷ employees in the cycle × 100',
  inputs: [{ dataset: 'pms_status', columns: ['Employee ID', 'Goal Setting Complete Flag'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band'] }],
  compute: (m, ctx) => Compute.pmsCompletion(m, ctx, 'goal_flag')
});

defineMetric({
  key: 'midyear_review_pct', label: 'Mid-year review completion', tab: 'talent',
  group: 'Performance management', unit: '%', direction: 'higher', scorecard: 'Performance & Rewards',
  formulaText: 'Employees with Mid-Year Review Complete Flag = Y ÷ employees in the cycle × 100',
  inputs: [{ dataset: 'pms_status', columns: ['Employee ID', 'Mid-Year Review Complete Flag'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band'] }],
  caveat: 'Reviews only count once recorded on the system — conversations without records score zero.',
  compute: (m, ctx) => Compute.pmsCompletion(m, ctx, 'midyear_flag')
});

/* =================== Recognition =================== */

defineMetric({
  key: 'recognition_coverage', label: 'Recognition coverage (unique, 12 m)', tab: 'talent',
  group: 'Recognition', unit: '%', direction: 'higher', scorecard: 'Performance & Rewards',
  formulaText: 'Distinct employees receiving ≥1 award in the trailing 12 months\n÷ active headcount × 100',
  inputs: [{ dataset: 'recognition', columns: ['Employee ID', 'Award Date'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band'] }],
  caveat: 'Unique coverage, not award volume — repeat awards to the same people do not move it.',
  compute: (m, ctx) => Compute.recognitionCoverage(m, ctx)
});

defineMetric({
  key: 'awards_total', label: 'Awards given (12 m)', tab: 'talent',
  group: 'Recognition', unit: '', decimals: 0, direction: null,
  formulaText: 'Award rows with Award Date in the trailing 12 months — count',
  inputs: [{ dataset: 'recognition', columns: ['Employee ID', 'Award Date', 'Award Name'] }],
  compute: (m, ctx) => {
    const from = monthEndDay(ctx.endMonth - 12) + 1;
    return m.recog.filter((r) => {
      if (r.award_date == null || r.award_date < from || r.award_date > ctx.asOfDay) return false;
      const e = m.empById.get(r.employee_id);
      if (!e) return ctx.asset === 'Group' && ctx.band === 'All';
      return Compute.empMatch(e, ctx);
    }).length;
  },
  drill: (m, ctx) => {
    const from = monthEndDay(ctx.endMonth - 12) + 1;
    const byName = new Map();
    const uniq = new Map();
    for (const r of m.recog) {
      if (r.award_date == null || r.award_date < from || r.award_date > ctx.asOfDay) continue;
      const e = m.empById.get(r.employee_id);
      if (e && !Compute.empMatch(e, ctx)) continue;
      if (!e && !(ctx.asset === 'Group' && ctx.band === 'All')) continue;
      const k = r.award_name || '(unnamed)';
      byName.set(k, (byName.get(k) || 0) + 1);
      if (!uniq.has(k)) uniq.set(k, new Set());
      uniq.get(k).add(r.employee_id);
    }
    return {
      title: 'Awards by programme (trailing 12 months)',
      columns: ['Award', 'Awards given', 'Unique recipients'],
      rows: [...byName.entries()].sort((a, b) => b[1] - a[1])
        .map(([k, n]) => [k, fmtInt(n), fmtInt(uniq.get(k).size)])
    };
  }
});

/* =================== L&D depth: safety, compliance, quality, cost =================== */

defineMetric({
  key: 'safety_learning_days', label: 'Safety learning days per employee', tab: 'lnd',
  group: 'Learning intensity', unit: '', decimals: 2, direction: 'higher',
  formulaText: 'Σ Person-Days of HSE-category events (trailing 12 m) ÷ cohort headcount',
  inputs: [{ dataset: 'learning_events', columns: ['Employee ID', 'Start Date', 'Person-Days', 'Category'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band'] }],
  caveat: 'Needs the optional Category column; rows without it are excluded from the numerator.',
  compute: (m, ctx) => {
    const pop = Compute.actives(m, ctx, null);
    if (!pop.length) return null;
    const days = learnRows12m(m, ctx).filter((l) => l.category === 'HSE')
      .reduce((s, l) => s + (l.person_days || 0), 0);
    return days / pop.length;
  },
  quality: (m, ctx) => Compute.blankShareNote(m, ctx, 'learning_events', 'category', 'Category')
});

defineMetric({
  key: 'compliance_coverage', label: 'Compliance training coverage', tab: 'lnd',
  group: 'Programme quality', unit: '%', direction: 'higher', scorecard: 'L&D',
  formulaText: 'Employees with ≥1 COMPLETED Compliance-category event (trailing 12 m)\n÷ active headcount × 100',
  inputs: [{ dataset: 'learning_events', columns: ['Employee ID', 'Start Date', 'Category', 'Completion Status'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band'] }],
  caveat: 'Code-of-conduct / ethics / harassment-prevention style modules. Statutory cycles vary — read against your own refresh policy.',
  compute: (m, ctx) => {
    const pop = Compute.actives(m, ctx, null);
    if (!pop.length) return null;
    const covered = new Set(learnRows12m(m, ctx)
      .filter((l) => l.category === 'Compliance' && l.completion !== 'In Progress')
      .map((l) => l.employee_id));
    return pop.filter((e) => covered.has(e.employee_id)).length / pop.length * 100;
  }
});

defineMetric({
  key: 'programme_completion_pct', label: 'Programme completion rate', tab: 'lnd',
  group: 'Programme quality', unit: '%', direction: 'higher',
  formulaText: 'Events with Completion Status = Completed ÷ events carrying a status\n(trailing 12 months) × 100',
  inputs: [{ dataset: 'learning_events', columns: ['Employee ID', 'Start Date', 'Completion Status'] }],
  compute: (m, ctx) => {
    const rows = learnRows12m(m, ctx).filter((l) => l.completion != null);
    if (!rows.length) return null;
    return rows.filter((l) => l.completion === 'Completed').length / rows.length * 100;
  }
});

defineMetric({
  key: 'learning_feedback_avg', label: 'Average programme feedback', tab: 'lnd',
  group: 'Programme quality', unit: '', decimals: 1, direction: 'higher', scorecard: 'L&D',
  formulaText: 'Mean of Feedback Score (1–5) across events with a score, trailing 12 months',
  inputs: [{ dataset: 'learning_events', columns: ['Employee ID', 'Start Date', 'Feedback Score'] }],
  caveat: 'Self-reported satisfaction, not effectiveness — pair with the coverage and completion tiles.',
  compute: (m, ctx) => {
    const rows = learnRows12m(m, ctx).filter((l) => l.feedback != null);
    return rows.length ? mean(rows.map((l) => l.feedback)) : null;
  },
  quality: (m, ctx) => {
    const rows = learnRows12m(m, ctx);
    if (!rows.length) return null;
    const scored = rows.filter((l) => l.feedback != null).length;
    const pct = scored / rows.length * 100;
    return pct < 60 ? `Only ${fmtPct(pct, 0)} of events carry a feedback score` : null;
  },
  drill: (m, ctx) => {
    const byProg = new Map();
    for (const l of learnRows12m(m, ctx)) {
      const k = l.programme || '(unnamed)';
      if (!byProg.has(k)) byProg.set(k, { n: 0, done: 0, withStatus: 0, fb: [], cost: 0 });
      const p = byProg.get(k);
      p.n++;
      if (l.completion != null) { p.withStatus++; if (l.completion === 'Completed') p.done++; }
      if (l.feedback != null) p.fb.push(l.feedback);
      p.cost += l.cost || 0;
    }
    return {
      title: 'Programme summary (trailing 12 months)',
      columns: ['Programme', 'Participants', 'Completion', 'Avg feedback', 'Cost / participant'],
      rows: [...byProg.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, p]) => [
        k, fmtInt(p.n),
        p.withStatus ? fmtPct(p.done / p.withStatus * 100, 0) : '—',
        p.fb.length ? fmtNum(mean(p.fb), 1) + '/5' : '—',
        p.n ? fmtINR(p.cost / p.n) : '—'
      ])
    };
  }
});

defineMetric({
  key: 'lnd_cost_per_emp', label: 'L&D cost per employee (12 m)', tab: 'lnd',
  group: 'Programme quality', unit: '₹', decimals: 0, direction: 'lower', scorecard: 'L&D',
  formulaText: 'Σ Cost of learning events (trailing 12 m) ÷ active headcount',
  inputs: [{ dataset: 'learning_events', columns: ['Employee ID', 'Start Date', 'Cost'] },
           { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Grade Band'] }],
  caveat: 'Lower is treated as better against a budget target — but starving development also "wins". Read with coverage.',
  compute: (m, ctx) => {
    const pop = Compute.actives(m, ctx, null);
    if (!pop.length) return null;
    const cost = learnRows12m(m, ctx).reduce((s, l) => s + (l.cost || 0), 0);
    return cost / pop.length;
  }
});

/* =================== Diversity & wellbeing =================== */

defineMetric({
  key: 'female_incl_trainees', label: 'Female share incl. trainees', tab: 'diversity',
  group: 'Gender in talent pools', unit: '%', direction: 'higher',
  formulaText: 'Female active employees (permanent + trainee) ÷ all active (permanent + trainee) × 100',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Gender', 'Employee Class'] }],
  caveat: 'The trainee pipeline pulls this above the permanent-only figure when intake is diverse.',
  compute: (m, ctx) => {
    const a = Compute.actives(m, ctx, null);
    if (!a.length) return null;
    return a.filter((e) => e.gender === 'Female').length / a.length * 100;
  }
});

defineMetric({
  key: 'counselling_sessions', label: 'Counselling sessions (period)', tab: 'diversity',
  group: 'Wellbeing (aggregates)', unit: '', decimals: 0, direction: null,
  formulaText: 'Σ Counselling Sessions across asset-months in the period',
  inputs: [{ dataset: 'wellbeing', columns: ['Asset', 'Month', 'Counselling Sessions'] }],
  caveat: 'Aggregate counts only — no individual health or counselling data enters this dashboard, by design.',
  compute: (m, ctx) => Compute.wellbeingSum(m, ctx, 'sessions')
});

defineMetric({
  key: 'counselled_unique_pct', label: 'Employees using counselling', tab: 'diversity',
  group: 'Wellbeing (aggregates)', unit: '%', decimals: 1, direction: null,
  formulaText: 'Σ Unique Employees Counselled (period) ÷ active headcount × 100',
  inputs: [{ dataset: 'wellbeing', columns: ['Asset', 'Month', 'Unique Employees Counselled'] },
           { dataset: 'employee_master', columns: ['Employee ID'] }],
  caveat: 'Uniques are per asset-month, so across months the sum can double-count a repeat user — treat as an upper bound. Higher utilisation is not bad news; it usually means the service is trusted.',
  compute: (m, ctx) => {
    const uniq = Compute.wellbeingSum(m, ctx, 'unique_counselled');
    const pop = Compute.actives(m, ctx, null).length;
    if (uniq == null || !pop) return null;
    return uniq / pop * 100;
  }
});

defineMetric({
  key: 'distress_cases', label: 'Distress cases (period)', tab: 'diversity',
  group: 'Wellbeing (aggregates)', unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Σ Distress Cases across asset-months in the period',
  inputs: [{ dataset: 'wellbeing', columns: ['Asset', 'Month', 'Distress Cases'] }],
  caveat: 'Severe escalations, aggregate count only. Any non-zero value deserves a conversation, not a chart.',
  compute: (m, ctx) => Compute.wellbeingSum(m, ctx, 'distress')
});

defineMetric({
  key: 'wellness_attendees', label: 'Wellness programme attendees', tab: 'diversity',
  group: 'Wellbeing (aggregates)', unit: '', decimals: 0, direction: null,
  formulaText: 'Σ Wellness Programme Attendees across asset-months in the period',
  inputs: [{ dataset: 'wellbeing', columns: ['Asset', 'Month', 'Wellness Programme Attendees'] }],
  compute: (m, ctx) => Compute.wellbeingSum(m, ctx, 'wellness_attendees')
});
