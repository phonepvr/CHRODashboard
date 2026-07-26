/* Overview tab — executive summary band (deterministic, rule-based) +
   headline KPI grid + the steel-specific Productivity, Cost & Safety block. */

TabRenderers.overview = (panel) => {
  const entries = REGISTRY.filter((e) => e.tab === 'overview');
  const groups = [...new Set(entries.map((e) => e.group))];
  panel.innerHTML = `
    ${ExecSummary.bandHTML()}
    ${groups.map((g) => `
      <div class="section-head"><h2>${esc(g)}</h2>
        <span class="sub">${g === 'Productivity, Cost & Safety'
          ? 'steel-specific block — see Methodology'
          : esc(CONFIG.periodLabel) + ' · as of ' + esc(CONFIG.asOf)}</span></div>
      <div class="tile-grid">
        ${entries.filter((e) => e.group === g).map((e) => UI.tileHTML(e.key)).join('')}
      </div>`).join('')}`;
};
