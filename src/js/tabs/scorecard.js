/* CHRO Scorecard tab — Actual/Target/Score model per HR function. */

TabRenderers.scorecard = (panel) => {
  const sc = Scorecard.compute();
  const anyTargets = Compute.build().targets.size > 0;

  const fnBlock = (f) => {
    if (!f.rows.length) return '';
    const rows = f.rows.map((r) => {
      const e = r.entry;
      const fmt = (v) => v == null ? '—' : (e.unit === '%' ? fmtNum(v, e.decimals) : e.unit === '₹' ? fmtINR(v) : fmtNum(v, e.decimals));
      const scoreCell = r.score == null
        ? '<td class="num">—</td>'
        : `<td class="num ${Scorecard.scoreClass(r.score)}"><span class="score-pill">${fmtNum(r.score, 1)}</span></td>`;
      return `<tr>
        <td>${esc(e.label)}${e.unit === '%' ? ' (%)' : e.unit ? ` (${e.unit})` : ''}
          <button class="i-btn i-inline" data-scoreinfo="${e.key}" aria-expanded="false"
            aria-label="Scoring of ${esc(e.label)}">i</button></td>
        <td class="num">${r.available ? fmt(r.prior) : '—'}</td>
        <td class="num">${r.available ? fmt(r.current) : 'no data'}</td>
        <td class="num">${r.target == null ? 'Target not set' : fmt(r.target)}</td>
        ${scoreCell}
      </tr>`;
    }).join('');
    return `
      <div class="section-head"><h2>${esc(f.fn)}</h2></div>
      <div class="table-scroll"><table class="data-table sc-table">
        <thead><tr><th>Metric</th><th class="num">Prior actual</th><th class="num">Current actual</th>
          <th class="num">Target</th><th class="num">Score</th></tr></thead>
        <tbody>${rows}
          <tr class="sc-total"><td>Function total (mean of scored metrics)</td><td></td><td></td><td></td>
            <td class="num ${Scorecard.scoreClass(f.total)}">${f.total == null ? '—' : fmtNum(f.total, 1)}</td></tr>
        </tbody></table></div>`;
  };

  panel.innerHTML = `
    <div class="sc-cumulative">
      <div class="sc-cum-stroke" aria-hidden="true"></div>
      <div>
        <span class="sc-cum-label">Cumulative CHRO score</span>
        <span class="sc-cum-value ${Scorecard.scoreClass(sc.cumulative)}">${sc.cumulative == null ? '—' : fmtNum(sc.cumulative, 1)}</span>
        <span class="sc-cum-note">mean of the six function totals · ${esc(CONFIG.periodLabel)} vs prior period</span>
      </div>
      <div class="sc-legend">
        <span class="score-pill score-good">≥100 on target</span>
        <span class="score-pill score-warn">90–100 within 10%</span>
        <span class="score-pill score-bad">&lt;90 off target</span>
      </div>
    </div>
    ${anyTargets ? '' : `<div class="empty-note" style="margin-top:10px">No targets loaded — provide targets.csv (or use mock data) to score the scorecard. Metrics without targets show an em-dash and are excluded from totals.</div>`}
    ${sc.functions.map(fnBlock).join('')}`;
};
