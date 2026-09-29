/* Access Matrix tab — generated ENTIRELY from PERSONAS, ACCESS_CLASSES, TABS
   and REGISTRY through the same Access.levelFor / Access.tabVisibleFor calls
   that drive rendering, so the IT hand-off cannot drift from the behaviour.
   access_matrix.csv (long format) is the acceptance specification. */

const AccessMatrix = (() => {

  const pill = (l) => `<span class="lvl lvl-${esc(l)}">${esc(ACCESS_LEVEL_LABEL[l])}</span>`;
  const tick = (ok) => (ok ? '<span class="lvl lvl-full">✓</span>' : '<span class="lvl lvl-hidden">—</span>');
  const classLabel = (id) => ACCESS_CLASSES[id]?.label || 'Unclassified';
  const tabLabel = (id) => (TABS.find((t) => t.id === id) || { label: id }).label;

  // a persona-column table; `cells(p)` returns trusted HTML built with esc()
  function personaTable(headLeft, rows) {
    const cur = Access.persona().id;
    return `<div class="table-scroll"><table class="data-table am-table">
      <thead><tr>${headLeft.map((h) => `<th>${esc(h)}</th>`).join('')}${PERSONAS.map((p) =>
        `<th class="${p.id === cur ? 'am-current' : ''}" title="${esc(p.label)}">${esc(p.short || p.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.left.map((c) => `<td>${c}</td>`).join('')}${PERSONAS.map((p) =>
        `<td class="${p.id === cur ? 'am-current' : ''}">${r.cells(p)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  function csv() {
    const out = [];
    for (const p of PERSONAS) {
      const base = [p.id, p.label, Access.scopeLabel(p), p.pii];
      for (const t of TABS) out.push(['tab', ...base, t.id, t.label, Access.tabVisibleFor(p, t.id) ? 'Y' : 'N', '', '', '', '', '']);
      for (const c of ACCESS_CLASS_IDS) out.push(['class', ...base, '', '', '', c, Access.levelForClass(p, c), '', '', '']);
      for (const e of REGISTRY) {
        const c = Access.classOf(e);
        out.push(['metric', ...base, e.tab, tabLabel(e.tab), Access.tabVisibleFor(p, e.tab) ? 'Y' : 'N',
          c || 'unclassified', Access.levelForClass(p, c), e.key, e.label, Access.levelFor(p, e)]);
      }
    }
    return CSV.serialize(['Record', 'Persona ID', 'Persona', 'Data Scope', 'PII', 'Tab ID', 'Tab', 'Tab Visible',
      'Access Class', 'Class Level', 'Metric Key', 'Metric', 'Metric Level'], out);
  }

  function download() { downloadBlob('access_matrix.csv', csv()); }

  const ENFORCEMENT = [
    ['Tab bar', 'Tabs outside the persona’s list are not rendered (no button, no panel)', 'Navigation built from the SSO-derived role; routes refuse direct access'],
    ['Tiles', 'Restricted → lock + “Restricted for …”, no value; Aggregate → value, no drill', 'API never returns a Hidden metric; the client renders only what it receives'],
    ['Charts & tooltips', 'A restricted card drops its body, so no mark, tooltip or PNG exists; peer assets are never drawn for a locked persona', 'Chart series served per scope; no peer-asset series for asset-bound roles'],
    ['“i” popover', 'Formula and inputs always (definitions are public); value-derived quality notes withheld', 'Same — definitions are not sensitive'],
    ['Drill-downs', 'Only Full metrics drill; identifiers pseudonymised (masked) or the table withheld (none)', 'Drill endpoints authorised per persona; HMAC pseudonyms server-side; each open logged'],
    ['Exports (CSV / PNG)', 'Metric CSV omits Restricted metrics; drill CSV reuses the masked rows', 'Server-generated, watermarked (user, time, persona), row-capped, logged'],
    ['Print pack', 'Only in-scope units and visible pages; restricted tiles print restricted', 'Server-rendered per persona; watermarked; logged'],
    ['Exec summary', 'Rules about restricted metrics are skipped', 'Generated server-side from permitted metrics only'],
    ['Scorecard', 'Restricted rows show “Restricted” and leave every mean', 'Scores computed from permitted metrics; persona totals labelled as such'],
    ['Search', 'Searches the rendered active tab only — nothing restricted is in it', 'Search index filtered by role and scope'],
    ['Asset / segment / function selectors', 'Locked (disabled) to the persona binding; the compute context re-applies the lock', 'Row-level security on asset, segment and function in the data layer'],
    ['Data Quality', 'Dataset-wide in the mockup (noted for scoped personas)', 'Scope-aware DQ per persona'],
    ['Field mapping / upload', 'Available to every persona (it is part of loading, D1)', 'Data-steward capability, validated server-side']
  ];

  const IT_REQUIREMENTS = [
    ['Server/data-side enforcement', 'This mockup only demonstrates the rules: every loaded row sits in the browser and anyone can switch persona. Production must enforce scope and class server/data-side; the client renders only what it is sent.'],
    ['Identity & SSO group mapping', 'Persona and binding (asset, segment, line function) come from corporate SSO (OIDC/SAML) groups or the HRIS position record — never a user-selectable switcher. Joiner/mover/leaver events re-bind or revoke; access reviewed quarterly. A “view as” switch becomes an audited admin impersonation.'],
    ['Row-level security', 'Rows filtered by asset, business segment and line function (and employee class) in the data layer. Rows whose Employee/Requisition ID is missing from the master count only at unscoped Group level, never inside a scope.'],
    ['Column-level security', 'Employee ID, name, DOB, gender, disability, nationality and Manager ID are column-protected; special-category attributes are aggregate-only.'],
    ['Metric-class security', 'Each metric carries an access class; Hidden metrics and their drill endpoints are never served; Aggregate returns pre-aggregated values only. New metrics are unclassified → hidden for every non-CHRO persona until classified (fail-closed).'],
    ['Disclosure control', `Small-cell suppression below ${CONFIG.minCell} on persona-restricted cuts (special-category counts, gender at small bases, domicile), plus complementary / differencing suppression — e.g. Group minus own asset, or two filter combinations subtracted from each other, must not re-identify a cell.`],
    ['Pseudonymisation', 'Keyed HMAC with the key in a KMS/HSM; only “identified” personas can re-identify; names never sent unless needed. Comply with the DPDP Act 2023 (purpose limitation, minimisation, notice, retention).'],
    ['Audit logging', 'Tamper-evident log of logins, persona/impersonation changes, restricted-tab views, every drill open (metric key + scope), every export and print, and every identifier reveal; retained per policy.'],
    ['Caching', 'Cache keys include the persona scope (the mockup memo key includes it); no cross-scope bleed in BI extracts or CDN copies.'],
    ['Policy as configuration', 'access_matrix.csv is the acceptance specification; policy changes go through change control; automated per-persona tests assert the visible metric set, scope and masking.']
  ];

  function render(panel) {
    const unclassified = REGISTRY.filter((e) => !Access.classOf(e));
    const overrides = REGISTRY.filter((e) => e.access);
    const cur = Access.persona();

    const personaRows = PERSONAS.map((p) => {
      const n = Access.counts(p);
      const tabs = TABS.filter((t) => Access.tabVisibleFor(p, t.id)).length;
      return [
        { html: `<strong>${esc(p.label)}</strong>${p.id === cur.id ? ' <span class="lvl lvl-agg">current</span>' : ''}<div class="am-sub">${esc(p.id)}</div>` },
        p.who, Access.scopeLabel(p), Access.PII_LABEL[p.pii], `${tabs} of ${TABS.length}`,
        fmtInt(n.full), fmtInt(n.agg), fmtInt(n.hidden),
        { html: `<button class="btn btn-outline am-preview" data-persona="${esc(p.id)}">Preview as</button>` }
      ];
    });

    const tabRows = TABS.map((t) => ({
      left: [esc(t.group), esc(t.label)],
      cells: (p) => tick(Access.tabVisibleFor(p, t.id))
    }));

    const classRows = ACCESS_CLASS_IDS.map((id) => {
      const c = ACCESS_CLASSES[id];
      const keys = overrides.filter((e) => e.access === id).map((e) => e.key);
      const covers = [...c.groups, ...keys.map((k) => k + ' (key)')].join(', ') || '(new feature metrics set this class on the entry)';
      return {
        left: [`<strong>${esc(c.label)}</strong><div class="am-sub">${esc(id)} · ${esc(c.desc)}</div>`, esc(covers),
          fmtInt(REGISTRY.filter((e) => Access.classOf(e) === id).length)],
        cells: (p) => pill(Access.levelForClass(p, id))
      };
    });

    const byTab = TABS.map((t) => [t, REGISTRY.filter((e) => e.tab === t.id)]).filter(([, es]) => es.length);
    const metricSections = byTab.map(([t, es]) => `
      <details class="am-details"><summary>${esc(t.label)} — ${es.length} metric${es.length === 1 ? '' : 's'}</summary>
        ${personaTable(['Metric', 'Registry key', 'Class', 'Drill'], es.map((e) => ({
          left: [esc(e.label), `<code>${esc(e.key)}</code>`, esc(classLabel(Access.classOf(e))) + (e.access ? ' <span class="am-sub">(override)</span>' : ''),
            e.drill ? 'yes' : '—'],
          cells: (p) => pill(Access.levelFor(p, e))
        })))}
      </details>`).join('');

    panel.innerHTML = `
      <div class="exec-band">
        <p class="exec-verdict">Access matrix — persona policy for IT hand-off</p>
        <ul class="exec-points">
          <li>Generated from the policy compiled into this build: ${PERSONAS.length} personas × ${TABS.length} tabs ×
            ${ACCESS_CLASS_IDS.length} data classes × ${REGISTRY.length} metrics — the same calls drive every tile, chart, drill, export and print page.</li>
          <li><strong>Mockup — not a security control.</strong> Access is simulated in this browser tab. Production must
            enforce scope server/data-side (see the IT requirements below).</li>
          <li>Levels: ${pill('full')} value + drill · ${pill('agg')} value only, no row-level detail ·
            ${pill('hidden')} lock placeholder, omitted from exports. Identifiers: identified · masked (stable pseudonym, e.g. ${esc(Access.pseudonym('E-0001'))}) · none.</li>
        </ul>
        <p style="margin-top:10px"><button class="btn btn-solid" data-export-access>Download access_matrix.csv</button></p>
      </div>
      ${unclassified.length ? `<div class="empty-note am-warn">Unclassified metrics (hidden for every non-CHRO persona): ${esc(unclassified.map((e) => e.key).join(', '))}</div>` : ''}

      <div class="section-head"><h2>Personas</h2><span class="sub">metric counts resolve every registry entry through Access.levelFor</span></div>
      ${UI.tableHTML(['Persona', 'Who', 'Data scope', 'Identifiers', 'Tabs', 'Full', 'Aggregate', 'Restricted', ''], personaRows)}

      <div class="section-head"><h2>Tabs × persona</h2><span class="sub">Field Mapping and Methodology are visible to every persona</span></div>
      ${personaTable(['Group', 'Tab'], tabRows)}

      <div class="section-head"><h2>Data classes × persona</h2><span class="sub">a metric’s own <code>access</code> field overrides its group’s class</span></div>
      ${personaTable(['Class', 'Covers (registry groups / keys)', 'Metrics'], classRows)}

      <div class="section-head"><h2>Metric-level resolution</h2><span class="sub">one section per tab</span></div>
      ${metricSections}

      <div class="section-head"><h2>Scope and identifier rules</h2></div>
      <ul class="am-list">
        <li><strong>Asset-locked</strong> (Asset HR Head, HRBP): the asset selector is locked; the compute context re-applies the lock;
          peer assets are never drawn; the Asset HR Head sees Group as a benchmark aggregate only; the print pack holds only the own asset.</li>
        <li><strong>Segment-locked</strong> (Business HR Head): the Business selector is locked to Operations or Projects on every tab.</li>
        <li><strong>Function-locked</strong> (HRBP): line function applied to every employee-keyed row; asset-month sources without a
          Function attribute (${esc([...NO_FUNCTION_DATASETS].map((d) => d + '.csv').join(', '))}) are not available at that scope.</li>
        <li><strong>Identifier columns</strong> in drills and detail tables: ${esc([...PII_ID_COLUMNS].join(', '))} → pseudonymised under
          “masked”; name columns (${esc([...PII_NAME_COLUMNS].join(', '))}) are dropped; under “none” person-level tables are withheld and counts remain.</li>
        <li><strong>Small cells</strong>: special-category counts below ${CONFIG.minCell} are withheld for every persona other than CHRO.</li>
      </ul>

      <div class="section-head"><h2>Enforcement points</h2></div>
      ${UI.tableHTML(['Surface', 'Mockup behaviour', 'Production requirement (server-side)'], ENFORCEMENT)}

      <div class="section-head"><h2>IT requirements</h2><span class="sub">production must enforce scope server/data-side; this mockup only demonstrates the rules</span></div>
      ${UI.tableHTML(['Requirement', 'Detail'], IT_REQUIREMENTS)}`;
  }

  return { csv, download, render };
})();

TabRenderers.access = (panel) => AccessMatrix.render(panel);
