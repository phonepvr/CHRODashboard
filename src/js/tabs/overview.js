/* Overview tab — executive summary band (full rules arrive with the metrics
   phase) + headline KPI grid, all driven by the registry. */

TabRenderers.overview = (panel) => {
  const keys = REGISTRY.filter((e) => e.tab === 'overview').map((e) => e.key);
  panel.innerHTML = `
    <div id="exec-band-slot"></div>
    <div class="section-head"><h2>Headline indicators</h2>
      <span class="sub">${esc(CONFIG.periodLabel)} · as of ${esc(CONFIG.asOf)}</span></div>
    <div class="tile-grid">${keys.map((k) => UI.tileHTML(k)).join('')}</div>`;
  const slot = panel.querySelector('#exec-band-slot');
  if (typeof ExecSummary !== 'undefined') slot.innerHTML = ExecSummary.bandHTML();
};
