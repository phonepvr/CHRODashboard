/* Methodology tab — generated from the formula registry and schemas.
   No metric appears in the product that is not in this appendix. The Phase 8
   decisions (docs/PHASE8_PLAN.md D1–D11) and the feature definitions below are
   the documented form of choices the code makes; keep them in step with it. */

// [id, topic, decision] — docs/PHASE8_PLAN.md "Decisions"
const PHASE8_DECISIONS = [
  ['D1', 'Field mapping', 'A “Map your columns” step after every load (gate → map → dashboard; mock data is a one-click confirm) plus the Field Mapping tab, first in the bar. The map lives in memory only and exports / imports as field_map.csv. Not persona-restricted — loading is part of using the tool.'],
  ['D2', 'Auto-match', 'Header names are normalised, then scored: equal 1.00 · equal without spaces 0.97 · whole-word substring 0.86 · token Jaccard × 0.8. Threshold 0.6, greedy one-to-one by score; per-field synonym lists live in the templates.'],
  ['D3', 'Recruitment model', 'Requisition-level requisitions.csv (with its lifecycle columns) plus candidate-level candidate_pipeline.csv for the stage funnel. Time to fill = Joining − Open, else Closed − Open. Ageing buckets 0–30 · 31–60 · 61–90 · 91–180 · 181–365 · 365+ days; aged = open > 180 days; worklist = open > 90 days.'],
  ['D4', 'As-of date', () => `One fixed as-of date (${CONFIG.asOf}, CONFIG.asOf) — “headcount yesterday” reads “headcount as-of”. An as-of month selector is deferred (P2).`],
  ['D5', 'Year basis', () => `Fiscal year starting in month ${CONFIG.fyStartMonth} (CONFIG.fyStartMonth; 1 = calendar year). Every YTD figure uses it.`],
  ['D6', 'Attrition', 'Annualised attrition stays canonical. Absolute YTD attrition = separations YTD ÷ average(FY-start headcount, as-of headcount). Exit Type Retirement is counted on its own and excluded from every attrition rate.'],
  ['D7', 'Business segment', 'A global Business filter (All · Operations · Projects) on every tab. An employee’s segment = its own column → org_units.csv by Function Plant → Unassigned (seen only under All). Asset-month panels use an optional segment column; without it the tile says the segment is not available in the source.'],
  ['D8', 'Personas', 'Eight personas and one policy table; Access.levelFor(persona, metric) → Full · Aggregate only · Restricted, fail-closed, applied to tiles, charts, popovers, drill-downs, exports, print, the executive summary, the scorecard and search. Asset-, segment- and function-locked personas have those selectors locked. A mockup of the rules, not a security control.'],
  ['D9', 'Identifiers (PII)', () => `Detail tables show Employee ID and name only at PII level “identified”; “masked” shows a stable per-session pseudonym (EMP-xxxxxx); “none” withholds row-level tables (counts only). Small-cell suppression below ${CONFIG.minCell} (CONFIG.minCell) on persona-restricted cuts.`],
  ['D10', 'Shared-services scope', 'In scope: headcount vs approved budget, vacancy and fill, contract-to-on-roll ratio, contract-labour cost per man-day and statutory compliance. Out of scope: CSR and administration cost (not HR).'],
  ['D11', 'Deferred', 'Line-manager and MC-member personas, the TA forecast set (it overlaps Outlook), a TA per-HR-head review mode, a grade_ladder template and the as-of month selector (P2).']
];

// [area, rule] — definitions each feature tab applies (see its registry file)
const PHASE8_DEFINITIONS = [
  ['Overview — demographics', 'On-roll = Employee Class Permanent or Trainee, active at the date (contract workforce excluded). A = as-of, B = same month-end last year, C = the day before the fiscal year starts; % YoY = (A − B) ÷ B, % YTD = (A − C) ÷ C. Local domicile = Domicile State equals the home state of the employee’s own asset (CONFIG.assetHomeState). The Attrition strip’s “Headcount as-of (permanent)” is the permanent roll only — the attrition denominator — so it is lower than A.'],
  ['Overview — budget vs actual', 'Budget = Σ Budget Headcount in hc_budget.csv for the latest budget month on or before the as-of month, matched on Asset, Business Segment and Function. Actual = active permanent employees (budgets cover permanent positions; trainees excluded). Variance = Actual − Budget (positive = over budget).'],
  ['New Joining', 'A hire = an employee-master row whose Date of Joining falls in the fiscal YTD window [first day of the fiscal year, as-of]. Every Employee Class counts and so do joiners who have since left — a hiring count, not a headcount. The period selector does not apply on this tab.'],
  ['Movement', 'One row per event; “To” = the state after it. A movement counts for its From AND its To asset / segment / function, so a transfer out counts for the asset it left. The grade band is the employee’s current band. Rows whose Employee ID is not in the master count only when no filter narrows the scope. Access: counts and the internal movement rate are class “org”; the promotion rate is class “perf”, like every promotion metric.'],
  ['TA Pipeline', () => `Snapshot tiles use the whole requisition book open on or before the as-of date and ignore the period selector (the extract has no status history); delivery tiles use the selected period. TTF (D3) is capped at ${TAKit.TTF_CAP} days in medians and histograms; SLA breach = TTF > ${TAKit.SLA_DAYS} days (a policy line, not a benchmark). Offer acceptance is per candidate. TBO buckets ${TAKit.TBO_BUCKETS.map((b) => b[0]).join(' · ')} days. Drops are counted over the whole book (the extract carries no drop date).`],
  ['Attrition', () => `Opening headcount = active permanent employees at close of the day before the fiscal year starts. Absolute YTD attrition follows D6. Rate cuts with an average headcount below ${CONFIG.minBase} (CONFIG.minBase) are greyed and marked *; off the CHRO view, cells under ${CONFIG.minCell} exits are suppressed. Suppression is cell by cell, not complementary (see the Access Matrix).`],
  ['Performance', 'Flags and statuses only — never ratings or narratives. Goal setting and mid-year use every employee in the cycle; a blank annual-review flag means out of scope for the annual cycle and leaves the denominator. Rows are scoped through the employee master; orphan rows count only when the scope is unfiltered.'],
  ['Managers', 'Line manager = an active on-roll employee (Permanent or Trainee) named as Manager ID by at least one other active employee. Every cut keys on the manager’s own record; direct reports are one level down. Manager ID is a snapshot, so the tab is as-of only. Overview’s “Individual contributors per manager” is a different, whole-roll ratio on the permanent roll.'],
  ['Positions & Budget', () => `Vacancy rate = Vacant ÷ (Filled + Vacant); Frozen and On Hold are reported apart. Budgeted but unfilled = Budgeted Flag Y and status Vacant or On Hold (Frozen excluded). “Without open requisition” = Requisition ID blank, unknown, closed or dropped. Vacancy ageing reuses the TA buckets; > ${PosKit.AGED} days = aged. The budget is the latest hc_budget.csv month on or before the as-of month. Lists naming incumbents are masked or withheld by persona; vacancy lists name no one and are shown even at PII “none”.`],
  ['Absenteeism', () => `Absenteeism = Σ unplanned absence days ÷ Σ scheduled days; attendance = Σ days present ÷ Σ scheduled days (on-roll, joined to the employee master). Day counts only — never reasons. The frequent-absence cohort (≥ ${AbsKit.FREQ_SPELLS} spells in the trailing ${AbsKit.TRAIL} months) is a COUNT ONLY: no list, no drill. Per-employee day counts reach “identified” personas only, without spells; “masked” personas get asset × function totals with suppression below ${CONFIG.minCell}; “none” is withheld.`],
  ['Contract & Compliance', 'Statutory items belong to the period their Due Date falls in; an item not yet due is never a miss; “pending past due” is a stock at the as-of date. Manning mix = contract headcount ÷ permanent on-roll at the same asset and segment. Cost per man-day = Σ contract-labour cost ÷ Σ man-days present (access class “cost”); it has no target — there is no defensible benchmark.'],
  ['Personas at load', 'A load from the gate opens on the persona’s own landing tab when it declares one (TA & Mobility COE → TA Pipeline, Talent & L&D COE → Talent, HR Ops → Contract & Compliance); otherwise Overview. The HR Business Partner holds the organisation class at Full with masked identifiers, so the Managers tab shows a pseudonymised manager list.'],
  ['Targets & summary rules', 'Illustrative demo targets (mock only) are rates, medians or zero targets, so each holds at every scope — never a count that depends on scope size. An executive-summary rule speaks only about a metric the persona can see, and only against a target, the approved budget, a due date or the D3 ageing threshold; no benchmark is invented.'],
  ['Print pack', 'One page per unit in scope (Group and each asset, or the persona’s own asset): summary, curated tiles, a compact workforce & talent row, two charts and the watch list — sized so each unit page fits one A4 sheet. Restricted tiles print restricted.']
];

TabRenderers.methodology = (panel) => {
  const tabName = (id) => (TABS.find((t) => t.id === id) || { label: id }).label;
  const byTab = {};
  for (const e of REGISTRY) (byTab[e.tab] = byTab[e.tab] || []).push(e);

  const metricRows = (entries) => entries.map((e) => [
    e.label,
    e.key,
    { html: `<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;white-space:pre-wrap">${esc(e.formulaText)}</span>` },
    e.inputs.map((i) => i.dataset + '.csv').join(', '),
    e.direction ? (e.direction === 'higher' ? 'higher is better' : 'lower is better') : '—',
    e.scorecard || '—'
  ]);

  const cellOf = (v) => (typeof v === 'function' ? v() : v);
  const decisions = `
    <div class="section-head"><h2>Phase 8 decisions</h2><span class="sub">docs/PHASE8_PLAN.md D1–D11 — changeable, each applied as described</span></div>
    ${UI.tableHTML(['#', 'Topic', 'Decision'], PHASE8_DECISIONS.map(([id, topic, text]) => [id, topic, cellOf(text)]))}
    <div class="section-head"><h2>Feature definitions</h2><span class="sub">the rules behind the Phase 8 tabs, tiles, print pack and summary</span></div>
    ${UI.tableHTML(['Area', 'Definition'], PHASE8_DEFINITIONS.map(([area, text]) => [area, cellOf(text)]))}`;

  const sections = Object.entries(byTab).map(([tab, entries]) => `
    <div class="section-head"><h2>${esc(tabName(tab))}</h2><span class="sub">${entries.length} metrics</span></div>
    ${UI.tableHTML(['Metric', 'Registry key', 'Formula', 'Inputs', 'Direction', 'Scorecard function'], metricRows(entries))}
  `).join('');

  panel.innerHTML = `
    <div class="exec-band">
      <p class="exec-verdict">Methodology &amp; definitions</p>
      <ul class="exec-points">
        <li>One <strong>formula registry</strong> is the single source of truth: it generates every tile,
          every “i” popover, the upload templates, the data dictionary, the scorecard rows and this appendix.
          No metric appears anywhere that is not on this page.</li>
        <li><strong>Scoring model</strong> — higher-is-better: <em>Score = Actual ÷ Target × 100</em>;
          lower-is-better: <em>Score = (2 × Target − Actual) ÷ Target × 100</em>. Function total = mean of scored
          metrics; cumulative score = mean of function totals; “Target not set” is excluded, never assumed.</li>
        <li><strong>Periods</strong> — the period selector picks the trailing 3, 6 or 12 months to the as-of month
          (currently ${esc(periodText(Compute.ctxNow()))}); every period label on screen, in exports and in print is that window. The as-of date
          (${esc(CONFIG.asOf)}), the fiscal-year start month (${CONFIG.fyStartMonth}) and retirement age (${CONFIG.retirementAge}) are single
          configurable constants. Snapshot tabs (positions, requisition book, managers) are as-of; YTD tiles use the fiscal year.</li>
        <li><strong>Productivity, Cost &amp; Safety</strong> is a steel-specific block added for AM/NS —
          it extends the classic HR MIS structure that the other tabs follow.</li>
        <li><strong>Grievance tracking</strong> is out of scope: no input template carries grievance data,
          and this dashboard shows nothing it cannot compute from its declared inputs.</li>
        <li><strong>Wellbeing is aggregate-only by design</strong> — wellbeing.csv carries asset-month counts;
          no individual health, counselling or medical data can enter this dashboard. Likewise the
          performance-cycle and recognition metrics use flags and dates only, never ratings or narratives.</li>
        <li><strong>Deliberate exclusions</strong> from the reference material: higher-education enrolment
          administration, CSR and administration cost, and external-workforce cost beyond contract labour — each
          needs an input this schema does not define, and nothing is shown that cannot be computed from declared inputs.
          Budget vs actual headcount (hc_budget.csv), position vacancy (positions.csv) and contract-labour cost per
          man-day (contract_attendance.csv) are in scope.</li>
        <li><strong>Privacy</strong> — all computation happens in this browser tab. The page makes zero network
          requests, stores nothing (no cookies, no local storage), and all exports are local downloads.
          In illustrative mode every number is synthetic, generated by a seeded PRNG.</li>
        <li><strong>Targets</strong> come only from targets.csv (or the illustrative demo targets in mock mode:
          rates, medians or zero targets only). No external benchmarks are invented.</li>
        <li><strong>Type</strong> — Albert Sans, embedded under the SIL Open Font License 1.1
          (see OFL-AlbertSans.txt in the repository). PNG chart exports fall back to the system font stack.</li>
      </ul>
    </div>
    ${decisions}
    ${sections}
    <div class="section-head"><h2>Input templates</h2><span class="sub">the full column dictionary is downloadable as data_dictionary.csv</span></div>
    ${UI.tableHTML(['Template', 'Contents', 'Source system'],
      SCHEMA_IDS.map((id) => [id + '.csv', SCHEMAS[id].desc, SCHEMAS[id].source || '—']))}`;
};
