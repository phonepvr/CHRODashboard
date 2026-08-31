/* Data Quality engine — six dimensions, a transparent score, and a concrete
   issues list. Runs on whichever dataset is active (mock or loaded).
   Method (shown on the tab): each dimension scores 0–100; overall = simple mean
   of the dimensions that could be assessed. */

const DataQuality = (() => {

  const DIMENSIONS = {
    completeness: 'Share of non-blank cells across all template columns (optional columns included).',
    validity: 'Share of rows free of type errors and missing required values (rows dropped by validation count against this).',
    consistency: 'Share of cross-file references that resolve: exits→employees, applications→requisitions, succession→employees, learning/IDP/LMS→employees.',
    uniqueness: 'Share of rows free of duplicate primary keys.',
    timeliness: 'Monthly panels reach the as-of month; IDPs updated within 9 months.',
    conformity: 'Share of values conforming to the declared formats (dates DD-MM-YYYY, months MM-YYYY, Y/N flags, allowed enum values).'
  };

  function compute() {
    const issues = [];
    const dims = {};
    const m = Compute.build();
    const loaded = [...App.state.datasets.entries()];
    if (!loaded.length) return { overall: null, dims: {}, issues: [], method: DIMENSIONS };

    /* completeness */
    let cells = 0, blank = 0;
    for (const [id, d] of loaded) {
      const cols = SCHEMAS[id].columns;
      for (const r of d.rows) for (const c of cols) { cells++; if (r[c.key] == null) blank++; }
    }
    dims.completeness = cells ? (1 - blank / cells) * 100 : null;

    /* validity + conformity + uniqueness from validation errors */
    let rowsTotal = 0, dropped = 0, badFmt = 0, badVal = 0, dupes = 0;
    for (const [id, d] of loaded) {
      rowsTotal += d.stats.totalRows;
      dropped += d.stats.droppedRows;
      for (const e of d.errors) {
        if (e.code === 'bad_date' || e.code === 'bad_month' || e.code === 'bad_enum') badFmt += e.count;
        if (e.code === 'bad_number' || e.code === 'missing_required') badVal += e.count;
        if (e.code === 'duplicate_key') dupes += e.count;
        issues.push({
          severity: e.code === 'duplicate_key' || e.code === 'missing_required' ? 'high' : 'medium',
          where: id + '.csv — ' + e.column,
          what: `${e.message} (${e.count} row${e.count > 1 ? 's' : ''}${e.rows.length ? ', e.g. ' + e.rows.slice(0, 5).join(', ') : ''})`
        });
      }
    }
    dims.validity = rowsTotal ? Math.max(0, 1 - (badVal + dropped) / rowsTotal) * 100 : null;
    dims.conformity = rowsTotal ? Math.max(0, 1 - badFmt / rowsTotal) * 100 : null;
    dims.uniqueness = rowsTotal ? Math.max(0, 1 - dupes / rowsTotal) * 100 : null;
    if (dropped) issues.push({ severity: 'high', where: 'validation', what: `${dropped} rows dropped for missing/invalid required values — they are absent from every metric.` });

    /* consistency: cross-file joins */
    let refs = 0, broken = 0;
    const check = (list, getId, label) => {
      if (!m.emps.length || !list.length) return;
      let miss = 0;
      for (const r of list) {
        const id = getId(r);
        if (!id) continue;
        refs++;
        if (!m.empById.has(id)) { broken++; miss++; }
      }
      if (miss) issues.push({ severity: 'medium', where: label, what: `${miss} reference${miss > 1 ? 's' : ''} to Employee IDs that are not in the employee master.` });
    };
    if (m.has('employee_master')) {
      check(m.exits, (x) => x.employee_id, 'exits.csv — Employee ID');
      check(m.learning, (l) => l.employee_id, 'learning_events.csv — Employee ID');
      check(m.idp, (r) => r.employee_id, 'idp_status.csv — Employee ID');
      check(m.lms, (r) => r.employee_id, 'lms_usage.csv — Employee ID');
      check(m.succ.filter((s) => s.successor_id), (s) => s.successor_id, 'succession.csv — Successor Employee ID');
      check(m.apps, (a) => a.employee_id, 'internal_applications.csv — Applicant Employee ID');
    }
    if (m.has('internal_applications') && m.has('requisitions')) {
      let miss = 0;
      for (const a of m.apps) { if (a.requisition_id) { refs++; if (!m.reqById.has(a.requisition_id)) { broken++; miss++; } } }
      if (miss) issues.push({ severity: 'medium', where: 'internal_applications.csv — Requisition ID', what: `${miss} applications reference unknown requisitions.` });
    }
    dims.consistency = refs ? (1 - broken / refs) * 100 : null;

    /* timeliness */
    const timelinessParts = [];
    const ctx = Compute.ctxNow();
    for (const [id, rows] of [['production_safety', m.prod], ['contract_attendance', m.cAtt], ['contract_compliance', m.cComp], ['wellbeing', m.well]]) {
      if (!App.state.datasets.has(id) || !rows.length) continue;
      const latest = Compute.latestPanelMonth(rows, { asset: 'Group' });
      const lag = AS_OF_MONTH - latest;
      timelinessParts.push(Math.max(0, 1 - lag / 3) * 100);
      if (lag > 0) issues.push({ severity: lag > 1 ? 'high' : 'medium', where: id + '.csv', what: `Latest month is ${monthIdxToLabel(latest)} — ${lag} month${lag > 1 ? 's' : ''} behind the as-of date.` });
    }
    if (m.has('idp_status')) {
      const withDates = m.idp.filter((r) => r.idp_flag && r.last_updated != null);
      if (withDates.length) {
        const stale = withDates.filter((r) => ctx.asOfDay - r.last_updated > 270).length;
        timelinessParts.push((1 - stale / withDates.length) * 100);
        if (stale) issues.push({ severity: 'medium', where: 'idp_status.csv — Last Updated', what: `${stale} IDPs (${fmtPct(stale / withDates.length * 100, 0)}) not updated in over 9 months.` });
      }
    }
    dims.timeliness = timelinessParts.length ? mean(timelinessParts) : null;

    /* blank exit reasons — completeness issue worth naming */
    if (m.has('exits') && m.exits.length) {
      const blankReason = m.exits.filter((x) => !x.exit_reason).length;
      if (blankReason) issues.push({ severity: 'medium', where: 'exits.csv — Exit Reason', what: `${blankReason} exits (${fmtPct(blankReason / m.exits.length * 100, 0)}) have no recorded reason — attrition-driver analysis is weakened.` });
    }

    const vals = Object.values(dims).filter((v) => v != null);
    const overall = vals.length ? mean(vals) : null;
    issues.sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1));
    return { overall, dims, issues, method: DIMENSIONS };
  }

  return { compute, DIMENSIONS };
})();
