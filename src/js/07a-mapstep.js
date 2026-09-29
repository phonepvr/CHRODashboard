/* "Map your columns" — the mandatory step between parsing and the dashboard
   (D1). Every load passes through it: mock (one-click confirm), the first BYOF
   load and every "Load / add files". One card per file: its template
   (auto-detected, overridable) and one row per template field with the source
   header, match confidence, sample values and the metrics it feeds. Missing
   required fields block Confirm. The parsed files are held here in memory only
   until Confirm or Back. */

const MapStep = (() => {

  let st = null;          // { files, mode, notes, onConfirm }
  let wired = false;
  const root = () => document.getElementById('map-step');
  // the mock is canonical: session seeds (imported / manual) never re-map it
  const seedMap = () => (st && st.mode === 'mock' ? new Map() : undefined);

  function prepareFile(f) {
    const headers = f.parsed.headers;
    const det = f.hint ? { schemaId: f.hint, score: null, assignment: Mapping.assign(f.hint, headers, undefined, seedMap()) }
      : headers.length ? Mapping.detect(headers, f.name) : null;
    return {
      name: f.name, parsed: f.parsed,
      auto: det ? det.schemaId : null, autoScore: det ? det.score : null, hinted: !!f.hint,
      schemaId: det ? det.schemaId : null,
      cols: det ? det.assignment.cols : new Map(),
      samples: new Map(), open: false
    };
  }

  /* ---------- per-file state ---------- */

  function samplesOf(f, idx) {
    if (!f.samples.has(idx)) {
      const seen = new Set();
      for (const r of f.parsed.rows) {
        const v = String(r[idx] ?? '').trim();
        if (v && !seen.has(v)) { seen.add(v); if (seen.size === 3) break; }
      }
      f.samples.set(idx, [...seen]);
    }
    return f.samples.get(idx);
  }

  const missingOf = (f) => (f.schemaId ? Mapping.missingRequired(f.schemaId, f.cols) : []);
  const blocked = (f) => missingOf(f).length > 0;
  const mappedCount = (f) => [...f.cols.values()].filter((v) => v.header != null).length;
  const unmappedOf = (f) => (f.schemaId ? Mapping.unmappedHeaders(f.parsed.headers, f.cols) : f.parsed.headers.filter((h) => h.trim()));
  const needsAttention = (f) => !f.schemaId || blocked(f) || unmappedOf(f).length > 0 ||
    [...f.cols.values()].some((v) => v.how === 'fuzzy');
  const included = () => st.files.filter((f) => f.schemaId);
  const isBlocked = () => !included().length || included().some(blocked);

  // metric coverage after Confirm: already-loaded files stay unless this batch replaces them
  function coverageNow() {
    const mapped = App.state.mode === 'byof' && st.mode === 'byof' ? Mapping.loadedColumns() : new Map();
    for (const f of included()) {
      mapped.set(f.schemaId, new Set(SCHEMAS[f.schemaId].columns.filter((c) => f.cols.get(c.key)?.header != null).map((c) => c.name)));
    }
    return Mapping.coverage(mapped);
  }

  /* ---------- markup ---------- */

  const plural = (n, one, many = one + 's') => `${fmtInt(n)} ${n === 1 ? one : many}`;
  const SHORT_TYPE = { id: 'identifier', text: 'text', date: 'date DD-MM-YYYY', month: 'month MM-YYYY', int: 'whole number', num: 'number', pct: 'percent 0–100', flag: 'flag Y/N' };
  const shortType = (c) => (c.type === 'enum' ? `one of ${ENUMS[c.enum].length} values` : SHORT_TYPE[c.type] || c.type);

  function counterText(f) {
    const n = f.schemaId ? SCHEMAS[f.schemaId].columns.length : 0;
    return `${fmtInt(mappedCount(f))} of ${fmtInt(n)} fields mapped · ${plural(f.parsed.rows.length, 'row')} · ${plural(unmappedOf(f).length, 'unmapped header')}`;
  }

  function matchChip(v, c) {
    if (!v || v.header == null) return `<span class="ms-chip ms-chip-missing${c.required ? '' : ' is-optional'}">missing</span>`;
    if (v.how === 'exact') {
      const why = Mapping.normHdr(v.header) === Mapping.normHdr(c.name) ? 'Header equals the template name' : `Header equals the listed synonym “${v.via || v.header}”`;
      return `<span class="ms-chip ms-chip-exact" title="${esc(why)}">exact</span>`;
    }
    if (v.how === 'fuzzy') return `<span class="ms-chip ms-chip-fuzzy" title="${esc(`Closest known name: “${v.via}” — please check`)}">fuzzy ${Math.round(v.score * 100)}%</span>`;
    if (v.how === 'imported') return '<span class="ms-chip ms-chip-manual" title="From the imported field_map.csv">imported</span>';
    return '<span class="ms-chip ms-chip-manual" title="Chosen on this screen">manual</span>';
  }

  function rowHTML(f, i, c) {
    const v = f.cols.get(c.key);
    const mapped = v && v.header != null;
    const opts = '<option value="">— unmapped —</option>' + f.parsed.headers.map((h, hi) =>
      (h.trim() ? `<option value="${hi}"${mapped && v.idx === hi ? ' selected' : ''}>${esc(h)}</option>` : '')).join('');
    const pii = Mapping.PII_KEYS.has(c.key);
    const samples = !mapped ? '<span class="ms-muted">—</span>'
      : pii && Access.pii() !== 'identified' ? '<span class="ms-muted">withheld (personal data)</span>'
      : samplesOf(f, v.idx).map((s) => `<span class="ms-sample">${esc(s.length > 28 ? s.slice(0, 27) + '…' : s)}</span>`).join('') || '<span class="ms-muted">(all blank)</span>';
    const used = Mapping.consumers(f.schemaId, c.name);
    return `<tr class="${!mapped && c.required ? 'is-missing' : ''}" data-ms-key="${esc(c.key)}">
      <td><span class="ms-field">${esc(c.name)}</span><span class="ms-type" title="${esc(Exports.typeLabel(c))}">${esc(shortType(c))}</span></td>
      <td class="ms-req">${c.required ? '<span class="ms-chip ms-chip-req">Required</span>' : '<span class="ms-chip ms-chip-opt">Optional</span>'}${pii ? '<span class="ms-chip ms-chip-pii" title="Identifies or describes a person">PII</span>' : ''}</td>
      <td><select class="ms-select" data-ms-file="${i}" data-ms-col="${esc(c.key)}" aria-label="Source header for ${esc(c.name)}">${opts}</select></td>
      <td>${matchChip(v, c)}</td>
      <td class="ms-samples">${samples}</td>
      <td class="ms-used">${used.length ? `<span title="${esc(used.join(', '))}">used by ${plural(used.length, 'metric')}</span>` : '<span class="ms-muted">joins / context</span>'}</td>
    </tr>`;
  }

  function stateOf(f) {
    if (!f.parsed.headers.length) return ['bad', 'Empty file'];
    if (!f.schemaId) return ['off', 'Skipped'];
    if (blocked(f)) return ['bad', 'Blocked'];
    if (needsAttention(f)) return ['warn', 'Check'];
    return ['ok', 'Ready'];
  }

  function cardHTML(f, i) {
    const s = f.schemaId ? SCHEMAS[f.schemaId] : null;
    const [cls, label] = stateOf(f);
    const tplOpts = `<option value="">— Skip this file —</option>` + SCHEMA_IDS.map((id) =>
      `<option value="${id}"${id === f.schemaId ? ' selected' : ''}>${id}.csv — ${esc(SCHEMAS[id].label)}</option>`).join('');
    const detect = !f.parsed.headers.length ? 'The file is empty — nothing to map.'
      : f.hinted ? 'Illustrative file — generated for this template.'
      : !f.auto ? 'Not recognised as any template from its header names. Choose a template or skip the file.'
      : f.auto !== f.schemaId ? `Detected ${f.auto}.csv (match ${fmtNum(f.autoScore * 100, 0)}%) — overridden here.`
      : `Detected from the header names (match ${fmtNum(f.autoScore * 100, 0)}%).`;
    const twin = f.schemaId && st.files.find((g, j) => j > i && g.schemaId === f.schemaId);
    const missing = missingOf(f);
    const unmapped = unmappedOf(f);
    const warn = (f.parsed.warnings || []).filter((w) => w !== 'File is empty.');
    return `<details class="ms-card ms-${cls}" data-ms-file="${i}"${f.open ? ' open' : ''}>
      <summary>
        <span class="ms-fname">${esc(f.name)}</span>
        <span class="ms-tpl">${s ? `→ ${esc(f.schemaId)}.csv · ${esc(s.label)}` : '→ not loaded'}</span>
        <span class="ms-counter">${s ? esc(counterText(f)) : esc(plural(f.parsed.rows.length, 'row'))}</span>
        <span class="ms-state ms-state-${cls}">${esc(label)}</span>
      </summary>
      <div class="ms-card-body">
        <div class="ms-card-controls">
          <label class="ctl">Template
            <select data-ms-template="${i}" aria-label="Template for ${esc(f.name)}"${f.parsed.headers.length ? '' : ' disabled'}>${tplOpts}</select>
          </label>
          <span class="ms-detect">${esc(detect)}</span>
        </div>
        ${twin ? `<div class="ms-note ms-note-warn">${esc(twin.name)} is also mapped to ${esc(f.schemaId)}.csv — only the last file per template is kept.</div>` : ''}
        ${missing.length ? `<div class="ms-note ms-note-bad" role="alert">Required field${missing.length > 1 ? 's' : ''} not mapped: <strong>${esc(missing.map((c) => c.name).join(', '))}</strong>.
          Pick the source header for ${missing.length > 1 ? 'each' : 'it'}, or set Template to “Skip this file” — Confirm stays blocked until then.</div>` : ''}
        ${warn.map((w) => `<div class="ms-note ms-note-warn">${esc(w)}</div>`).join('')}
        ${unmapped.length ? `<div class="ms-note ms-note-unmapped">${plural(unmapped.length, 'header')} ${unmapped.length === 1 ? 'is' : 'are'} not mapped to any field
          (shown so new columns are never silently dropped — assign ${unmapped.length === 1 ? 'it' : 'them'} below if relevant):
          <span class="ms-hdrs">${unmapped.map((h) => `<span class="hdr-chip">${esc(h)}</span>`).join('')}</span></div>` : ''}
        ${s ? `<div class="table-scroll"><table class="data-table ms-table">
          <thead><tr><th>Template field</th><th>Required</th><th>Source header</th><th>Match</th><th>Sample values</th><th>Used by</th></tr></thead>
          <tbody>${s.columns.map((c) => rowHTML(f, i, c)).join('')}</tbody></table></div>` : ''}
      </div>
    </details>`;
  }

  function intro() {
    const notes = (st.notes || []).map((n) => `<p class="ms-note ms-note-warn">${esc(n)}</p>`).join('');
    const seeded = Mapping.hasSeeds() && st.mode === 'byof'
      ? '<p>Mappings from an imported <strong>field_map.csv</strong> or chosen earlier in this session were applied first.</p>' : '';
    const body = st.mode === 'mock'
      ? `<p><span class="chip chip-mock">Illustrative data</span> All ${plural(st.files.length, 'template')} of the seeded
          mock are matched exactly — review any file below, then confirm. This is the same step a real load goes through.</p>`
      : `<p>Each file was matched to an upload template by its header names, and each template field to the closest
          source header — the exact name, a listed synonym, or a fuzzy match of at least ${Mapping.THRESHOLD * 100}%.
          Check the fuzzy matches, fix any dropdown, then confirm.</p>${seeded}`;
    return `${body}<p class="ms-fine">Nothing leaves this browser: files are parsed locally and held in memory only.
      The mapping is not stored — export it as field_map.csv from the Field Mapping tab.</p>${notes}`;
  }

  function render() {
    const multi = st.files.length > 3;
    root().innerHTML = `
      <div class="ms-top">
        <div class="hdr-stroke" aria-hidden="true"></div>
        <div class="wordmark hdr-wordmark"><span class="wm-mark">AM/NS</span></div>
        <div class="ms-headings">
          <h1 id="ms-title" class="ms-title" tabindex="-1">Map your columns</h1>
          <p class="ms-sub" id="ms-summary"></p>
        </div>
        <div class="ms-actions">
          <button class="btn btn-ghost" type="button" data-ms-back>← Back</button>
          <button class="btn btn-solid" type="button" id="ms-confirm" data-ms-confirm>Confirm &amp; analyse →</button>
        </div>
      </div>
      <div class="ms-inner">
        <div class="ms-intro">${intro()}</div>
        <div class="ms-status" id="ms-status" role="status"></div>
        ${multi ? '<p class="ms-tools"><button class="btn btn-outline" type="button" data-ms-expand>Expand all</button></p>' : ''}
        <div id="ms-files">${st.files.map(cardHTML).join('')}</div>
        <div class="ms-bottom"><button class="btn btn-solid" type="button" id="ms-confirm-bottom" data-ms-confirm>Confirm &amp; analyse →</button></div>
      </div>`;
    updateChrome();
  }

  function updateChrome() {
    const inc = included();
    let n = 0, mapped = 0, rows = 0, unmapped = 0;
    for (const f of inc) {
      n += SCHEMAS[f.schemaId].columns.length;
      mapped += mappedCount(f);
      rows += f.parsed.rows.length;
      unmapped += unmappedOf(f).length;
    }
    const cov = coverageNow();
    root().querySelector('#ms-summary').textContent =
      `${plural(st.files.length, 'file')} · ${fmtInt(mapped)} of ${fmtInt(n)} fields mapped · ${plural(rows, 'row')} · ${plural(unmapped, 'unmapped header')} · feeds ${fmtInt(cov.full)} of ${fmtInt(cov.total)} metrics in full`;
    const nBlocked = inc.filter(blocked).length;
    const status = !inc.length ? 'No file is assigned to a template — choose one, or go back.'
      : nBlocked ? `${plural(nBlocked, 'file')} blocked: map the required fields or skip ${nBlocked === 1 ? 'that file' : 'those files'}.`
      : `Ready — ${plural(inc.length, 'file')} will be loaded.`;
    const el = root().querySelector('#ms-status');
    el.textContent = status;
    el.className = 'ms-status ' + (isBlocked() ? 'is-bad' : 'is-ok');
    for (const b of root().querySelectorAll('[data-ms-confirm]')) {
      b.disabled = isBlocked();
      b.title = isBlocked() ? status : '';
    }
  }

  function rerenderCards(i, focusSel) {
    const host = root().querySelector('#ms-files');
    if (i == null) host.innerHTML = st.files.map(cardHTML).join('');
    else root().querySelector(`details[data-ms-file="${i}"]`).outerHTML = cardHTML(st.files[i], i);
    updateChrome();
    if (focusSel) root().querySelector(focusSel)?.focus();
  }

  /* ---------- events ---------- */

  function wire() {
    if (wired) return;
    wired = true;
    const el = root();
    el.addEventListener('change', (e) => {
      if (!st) return;
      const tpl = e.target.closest('[data-ms-template]');
      if (tpl) {
        const i = +tpl.dataset.msTemplate, f = st.files[i];
        f.schemaId = tpl.value || null;
        f.cols = f.schemaId ? Mapping.assign(f.schemaId, f.parsed.headers, undefined, seedMap()).cols : new Map();
        f.open = true;
        rerenderCards(null, `[data-ms-template="${i}"]`);
        return;
      }
      const sel = e.target.closest('[data-ms-col]');
      if (sel) {
        const i = +sel.dataset.msFile, f = st.files[i], key = sel.dataset.msCol;
        Mapping.setManual(f.cols, f.parsed.headers, f.schemaId, key, sel.value === '' ? null : +sel.value);
        rerenderCards(i, `details[data-ms-file="${i}"] [data-ms-col="${key}"]`);
      }
    });
    el.addEventListener('click', (e) => {
      if (!st) return;
      if (e.target.closest('[data-ms-confirm]')) { confirm(); return; }
      if (e.target.closest('[data-ms-back]')) { cancel(); return; }
      const ex = e.target.closest('[data-ms-expand]');
      if (ex) {
        const open = ex.textContent === 'Expand all';
        st.files.forEach((f) => { f.open = open; });
        el.querySelectorAll('details.ms-card').forEach((d) => { d.open = open; });
        ex.textContent = open ? 'Collapse all' : 'Expand all';
      }
    });
    // toggle does not bubble — capture it to remember each card's state
    el.addEventListener('toggle', (e) => {
      if (st && e.target.matches('details.ms-card')) st.files[+e.target.dataset.msFile].open = e.target.open;
    }, true);
  }

  /* ---------- lifecycle ---------- */

  // files: [{name, parsed, hint?}] · opts: {mode: 'mock'|'byof', notes?, onConfirm(mapped)}
  function open(files, opts) {
    UI.Popover.close();
    UI.Modal.close();
    st = { ...opts, files: [] };
    st.files = files.map(prepareFile);
    for (const f of st.files) f.open = st.files.length <= 3 || needsAttention(f);
    wire();
    render();
    document.getElementById('load-gate').hidden = true;
    document.getElementById('app').hidden = true;
    root().hidden = false;
    window.scrollTo(0, 0);
    root().querySelector(isBlocked() ? '#ms-title' : '#ms-confirm').focus();
  }

  // drops the parsed files; the previous screen comes back (gate or dashboard)
  function close() {
    st = null;
    root().hidden = true;
    root().innerHTML = '';
    const gate = App.state.mode === 'gate';
    document.getElementById('load-gate').hidden = !gate;
    document.getElementById('app').hidden = gate;
  }

  function confirm() {
    if (!st || isBlocked()) return;
    const out = st.files.map((f) => ({ name: f.name, parsed: f.parsed, schemaId: f.schemaId, cols: f.cols }));
    for (const f of out) if (f.schemaId) Mapping.remember(f.schemaId, f.cols);
    const done = st.onConfirm;
    close();
    done(out);
  }

  function cancel() {
    close();
    (App.state.mode === 'gate' ? document.getElementById('gate-mock') : document.getElementById('btn-add')).focus();
  }

  return { open, close, isOpen: () => !!st };
})();
