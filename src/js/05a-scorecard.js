/* CHRO Scorecard engine.
   Scoring (verified against the reference model):
     higher-is-better: Score = Actual ÷ Target × 100
     lower-is-better:  Score = (2 × Target − Actual) ÷ Target × 100
   Function total = mean of metric scores; cumulative = mean of function totals.
   "Target not set" renders an em-dash and is excluded from the means.
   Scores clamped to [0, 200] so a single outlier cannot drown a function. */

const SCORECARD_FUNCTIONS = [
  'Talent Acquisition', 'Talent Management', 'Performance & Rewards',
  'L&D', 'HR Operations', 'Financial Indicators'
];

const Scorecard = (() => {

  function scoreOf(actual, target, direction) {
    if (actual == null || target == null || !isFinite(actual) || !isFinite(target) || target === 0) return null;
    const raw = direction === 'lower'
      ? (2 * target - actual) / target * 100
      : actual / target * 100;
    return Math.max(0, Math.min(200, raw));
  }

  function rowsFor(fn) {
    return REGISTRY.filter((e) => e.scorecard === fn).map((e) => {
      const res = Compute.metric(e.key);
      const prior = Compute.priorValue(e.key);
      const target = res.target ? res.target.value : null;
      const direction = (res.target && res.target.direction) || e.direction || 'higher';
      const score = res.available ? scoreOf(res.value, target, direction) : null;
      return { entry: e, prior, current: res.available ? res.value : null, target, direction, score, available: res.available };
    });
  }

  function compute() {
    const functions = SCORECARD_FUNCTIONS.map((fn) => {
      const rows = rowsFor(fn);
      const total = mean(rows.map((r) => r.score));
      return { fn, rows, total };
    });
    const cumulative = mean(functions.map((f) => f.total));
    return { functions, cumulative };
  }

  function scoreClass(s) {
    if (s == null) return '';
    if (s >= 100) return 'score-good';
    if (s >= 90) return 'score-warn';
    return 'score-bad';
  }

  // popover content for a score cell — the applied formula with real numbers
  function scoreInfoHTML(key) {
    const e = REG_BY_KEY.get(key);
    const res = Compute.metric(key);
    const target = res.target ? res.target.value : null;
    const direction = (res.target && res.target.direction) || e.direction || 'higher';
    const formula = direction === 'lower'
      ? 'Score = (2 × Target − Actual) ÷ Target × 100   (lower is better)'
      : 'Score = Actual ÷ Target × 100   (higher is better)';
    let worked = 'Target not set — no score; excluded from the function total.';
    if (target != null && res.value != null) {
      const s = scoreOf(res.value, target, direction);
      worked = direction === 'lower'
        ? `(2 × ${fmtNum(target, e.decimals)} − ${fmtNum(res.value, e.decimals)}) ÷ ${fmtNum(target, e.decimals)} × 100 = ${fmtNum(s, 1)}`
        : `${fmtNum(res.value, e.decimals)} ÷ ${fmtNum(target, e.decimals)} × 100 = ${fmtNum(s, 1)}`;
    }
    return `<h3>Score — ${esc(e.label)}</h3>
      <div class="po-formula">${esc(formula)}\n${esc(worked)}</div>
      <div class="po-row"><span class="po-k">Colour bands</span>
        ≥100 on/above target · 90–100 within 10% · &lt;90 off target</div>
      <div class="po-row"><span class="po-k">Target source</span>
        ${App.state.mode === 'mock' ? 'Illustrative demo target' : 'targets.csv'}</div>`;
  }

  return { compute, scoreOf, scoreClass, scoreInfoHTML, rowsFor };
})();
