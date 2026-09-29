/* Data Quality tab — transparent score, six dimensions, concrete issues. */

TabRenderers.quality = (panel) => {
  const q = DataQuality.compute();
  const dimTiles = Object.entries(q.dims).map(([k, v]) => `
    <div class="tile ${v != null && v < 90 ? 'is-alert' : ''}">
      <span class="tile-label">${esc(k)}</span>
      <span class="tile-value">${v == null ? '—' : fmtNum(v, 1) + '<span class="unit">%</span>'}</span>
      <span class="tile-meta">${esc(q.method[k])}</span>
    </div>`).join('');

  const issueRows = q.issues.length
    ? q.issues.map((i) => [
        { html: `<span class="score-pill ${i.severity === 'high' ? 'score-bad' : 'score-warn'}">${esc(i.severity)}</span>` },
        i.where, i.what])
    : [];

  // the mockup's DQ is dataset-wide; production must scope it (Access Matrix)
  const scopeNote = Access.persona().scope === 'all' ? ''
    : `<div class="empty-note" style="margin-bottom:10px">Data quality is assessed on the whole loaded dataset —
      it is not narrowed to ${esc(Access.label())}. Production DQ must be scope-aware.</div>`;
  panel.innerHTML = `${scopeNote}
    <div class="section-head"><h2>Data quality score</h2>
      <span class="sub">computed on the active dataset (${App.state.mode === 'mock' ? 'illustrative' : 'loaded files'})</span></div>
    <div class="tile-grid">
      <div class="tile" style="border-top-color: var(--red)">
        <span class="tile-label">Overall score</span>
        <span class="tile-value">${q.overall == null ? '—' : fmtNum(q.overall, 1) + '<span class="unit">%</span>'}</span>
        <span class="tile-meta">simple mean of the assessable dimensions below — the method is the score</span>
      </div>
      ${dimTiles}
    </div>
    <div class="section-head"><h2>Issues found</h2><span class="sub">${q.issues.length} concrete issue${q.issues.length === 1 ? '' : 's'}</span></div>
    ${q.issues.length
      ? UI.tableHTML(['Severity', 'Where', 'What (and why it matters)'], issueRows)
      : '<div class="empty-note">No issues detected in the loaded data.</div>'}
    <p class="chart-note" style="margin-top:10px">Dimensions that cannot be assessed for the loaded subset
    (e.g. consistency with only one file) are excluded from the overall mean rather than assumed perfect.</p>`;
};
