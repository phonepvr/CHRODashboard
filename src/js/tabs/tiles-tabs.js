/* Tile-grid tab renderers: Talent, L&D, Mobility, Attrition, Diversity,
   Contract — registry-driven, grouped into sections. Charts join in the
   interactivity phase; the chart slots are stable ids. */

function renderTilesByGroup(panel, tabId, opts = {}) {
  const entries = REGISTRY.filter((e) => e.tab === tabId);
  const groups = [...new Set(entries.map((e) => e.group))];
  panel.innerHTML =
    (opts.leadHTML || '') +
    groups.map((g) => `
      <div class="section-head"><h2>${esc(g)}</h2>${opts.groupSubs?.[g] ? `<span class="sub">${esc(opts.groupSubs[g])}</span>` : ''}</div>
      <div class="tile-grid">
        ${entries.filter((e) => e.group === g).map((e) => UI.tileHTML(e.key)).join('')}
      </div>
      <div class="chart-slot" id="charts-${tabId}-${g.replace(/\W+/g, '-').toLowerCase()}"></div>`).join('') +
    (opts.tailHTML || '');
}

TabRenderers.talent = (panel) => renderTilesByGroup(panel, 'talent', {
  groupSubs: { 'Hiring': 'feeds the CHRO Scorecard' }
});

TabRenderers.lnd = (panel) => renderTilesByGroup(panel, 'lnd', {
  groupSubs: { 'Learning coverage': 'trailing 12 months, by cohort' }
});

TabRenderers.mobility = (panel) => renderTilesByGroup(panel, 'mobility', {
  groupSubs: { 'Portal funnel': 'openings → postings → applications → outcomes (period)' }
});

TabRenderers.attrition = (panel) => {
  const attrTile = UI.tileHTML('attr_annualised'); // headline repeats here in context
  renderTilesByGroup(panel, 'attrition', {
    leadHTML: `<div class="section-head"><h2>Attrition rates</h2>
        <span class="sub">annualised; superannuation excluded</span></div>
      <div class="tile-grid">${attrTile}</div>`
  });
};

TabRenderers.diversity = (panel) => renderTilesByGroup(panel, 'diversity', {
  leadHTML: `<div class="section-head"><h2>Overall</h2></div>
    <div class="tile-grid">${UI.tileHTML('female_pct')}</div>`
});

TabRenderers.contract = (panel) => renderTilesByGroup(panel, 'contract', {
  leadHTML: `<div class="empty-note" style="margin-bottom:10px">
    <strong>Separate population.</strong> Only deployment/attendance
    <span class="tile-src">[SCRUM]</span> and statutory compliance
    <span class="tile-src">[Aparajita]</span> apply to the contract workforce —
    talent, L&amp;D and succession metrics deliberately do not. The grade-band
    filter does not apply here.</div>`
});
