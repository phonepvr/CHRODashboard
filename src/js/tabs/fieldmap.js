/* Field Mapping tab (D1) — the current mapping of every upload template, loaded
   or not: source system (editable), template field, type, required, the source
   header it is read from, and the metrics it feeds. Exports / imports
   field_map.csv; an import pre-seeds the next load. This table is the
   integration spec for IT. Memory only — nothing is stored. */

TabRenderers.fieldmap = (panel) => {
  const rows = Mapping.fieldMapRows();
  const byId = new Map(SCHEMA_IDS.map((id) => [id, rows.filter((r) => r.schemaId === id)]));
  const loaded = SCHEMA_IDS.filter((id) => App.state.datasets.has(id));
  const cov = Mapping.coverage(Mapping.loadedColumns());
  const pill = (status) => `<span class="fm-status fm-${status.replace(/\s+/g, '-').toLowerCase()}">${esc(status)}</span>`;
  const how = (r) => (r.status === 'Mapped' && r.how && r.how !== 'exact'
    ? ` <span class="ms-chip ${r.how === 'fuzzy' ? 'ms-chip-fuzzy' : 'ms-chip-manual'}">${esc(r.how)}</span>` : '');

  const summary = SCHEMA_IDS.map((id) => {
    const d = App.state.datasets.get(id);
    const rs = byId.get(id);
    const mapped = rs.filter((r) => r.status === 'Mapped').length;
    return [
      { html: `<a class="linklike" href="#fm-${id}">${esc(id)}.csv</a>` },
      SCHEMAS[id].label,
      { html: `<input class="fm-source" type="text" data-fm-source="${id}" value="${esc(Mapping.sourceOf(id))}" aria-label="Source system for ${id}.csv">` },
      { html: d ? pill('Loaded') : pill('Not loaded') },
      d ? `${fmtInt(mapped)} of ${fmtInt(rs.length)}` : '—',
      d ? (App.state.mode === 'mock' ? 'Illustrative mock' : d.mapping?.fileName || d.sourceName) : '—'
    ];
  });

  const sections = SCHEMA_IDS.map((id) => {
    const s = SCHEMAS[id], d = App.state.datasets.get(id);
    const unmapped = d?.mapping?.unmapped || [];
    return `<div class="fm-tpl" id="fm-${id}"><div class="section-head"><h2>${esc(id)}.csv</h2>
        <span class="sub">${esc(s.label)} · source: ${esc(Mapping.sourceOf(id))} · ${d ? 'loaded from ' + esc(App.state.mode === 'mock' ? 'the illustrative mock' : d.mapping?.fileName || d.sourceName) : 'not loaded'}</span></div>
      ${unmapped.length ? `<p class="fm-unmapped">Unmapped source headers (ignored): ${unmapped.map((h) => `<span class="hdr-chip">${esc(h)}</span>`).join('')}</p>` : ''}
      ${UI.tableHTML(['Template field', 'Type / format', 'Required', 'Mapped source header', 'Status', 'Used by metrics'],
        byId.get(id).map((r) => [
          { html: `<strong>${esc(r.col.name)}</strong> <span class="ms-muted">${esc(r.col.key)}</span>` },
          Exports.typeLabel(r.col),
          r.col.required ? 'Yes' : 'No',
          { html: !d ? (r.header ? `<span class="fm-next">next load: <code class="fm-hdr">${esc(r.header)}</code></span>` : '<span class="ms-muted">not loaded</span>')
              : (r.header ? `<code class="fm-hdr">${esc(r.header)}</code>${how(r)}` : '<span class="ms-muted">—</span>') +
                (r.next ? `<span class="fm-next">next load: <code class="fm-hdr">${esc(r.next)}</code></span>` : '') },
          { html: pill(r.status) },
          r.consumers.length ? r.consumers.join(', ') : '(context / joins)'
        ]))}</div>`;
  }).join('');

  panel.innerHTML = `
    <div class="exec-band">
      <p class="exec-verdict">Field mapping — which source field feeds each template column</p>
      <ul class="exec-points">
        <li><strong>For IT:</strong> this table is the integration spec. Each row names the source system and the
          source field or header that feeds one template column, and the metrics that depend on it. A production
          feed should deliver exactly these columns — or keep this map current.</li>
        <li><strong>Every load</strong> passes the <em>Map your columns</em> step: files are matched to a template by
          their header names, fields to headers by name or listed synonym, then fuzzy similarity (at least
          ${Mapping.THRESHOLD * 100}%). Required fields must be mapped before the dashboard opens.</li>
        <li><strong>Memory only.</strong> The mapping lives in this browser tab and is gone on reload. Export it as
          field_map.csv; import it next time (here or on the load screen) to pre-seed the mapping of renamed headers.</li>
        <li><strong>Coverage:</strong> ${fmtInt(loaded.length)} of ${fmtInt(SCHEMA_IDS.length)} templates loaded ·
          ${fmtInt(cov.full)} of ${fmtInt(cov.total)} metrics have every input column mapped${cov.partial ? ` · ${fmtInt(cov.partial)} more have a column unmapped` : ''}.</li>
      </ul>
    </div>
    <p class="fm-actions">
      <button class="btn btn-solid" type="button" data-fm-export>Export field_map.csv</button>
      <button class="btn btn-outline" type="button" data-fm-import>Import field_map.csv</button>
      <span class="chart-note">Source system is editable per template; it is carried into the export.</span>
    </p>
    <details class="fm-method">
      <summary>How auto-match works</summary>
      <p>Header names are normalised (lower case; any run of other characters becomes one space). A header then
        scores 1.00 against a field name or synonym when equal, 0.97 when equal ignoring spaces, 0.86 when one
        contains the other as whole words (a one-word header is never a substring match), otherwise the share of
        shared words × 0.8. Pairs scoring at least ${Mapping.THRESHOLD} are assigned greedily, highest first, one header
        per field. A file goes to the template with the best total score, floored by the template’s number of
        required columns; a file named after a template wins near-ties. Cell values are never used.</p>
    </details>
    <div class="section-head"><h2>Templates</h2><span class="sub">${fmtInt(SCHEMA_IDS.length)} upload templates · source system per template</span></div>
    ${UI.tableHTML(['Template', 'Contents', 'Source system', 'Status', 'Fields mapped', 'Loaded from'], summary)}
    ${sections}`;

  panel.querySelector('[data-fm-export]').addEventListener('click', () => downloadBlob('field_map.csv', Mapping.fieldMapCSV()));
  panel.querySelector('[data-fm-import]').addEventListener('click', () => document.getElementById('fieldmap-input').click());
  for (const inp of panel.querySelectorAll('[data-fm-source]')) {
    inp.addEventListener('change', () => {
      Mapping.setSource(inp.dataset.fmSource, inp.value);
      inp.value = Mapping.sourceOf(inp.dataset.fmSource);
      const sub = panel.querySelector(`#fm-${inp.dataset.fmSource} .sub`);
      if (sub) sub.textContent = sub.textContent.replace(/source: [^·]*·/, `source: ${inp.value} ·`);
    });
  }
};
