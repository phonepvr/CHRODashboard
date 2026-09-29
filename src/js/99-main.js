/* App bootstrap — state, load gate, dataset loading (mock + BYOF), controls.
   State lives in memory only: no storage APIs, nothing persists a reload. */

const App = {
  state: {
    mode: 'gate',                 // 'gate' | 'mock' | 'byof'
    datasets: new Map(),          // schemaId -> {rows, errors, stats, sourceName}
    dataVersion: 0,
    filters: { asset: 'Group', band: 'All', segment: 'All', fn: 'All', periodMonths: 3 },
    persona: { id: 'chro', asset: null, segment: null, fn: null },   // D8 — memory only
    activeTab: 'overview',
    renderedTabs: new Set(),
    loadedFileNames: []
  }
};

(() => {

  /* ---------- dataset loading: gate → parse → map your columns → dashboard ---------- */

  // the confirmed mapping renames the headers first, so validation and every
  // metric see the canonical template columns
  function storeMapped(f, sourceName) {
    const applied = CSV.applySchema(f.schemaId, Mapping.applyMapping(f.parsed, f.schemaId, f.cols));
    App.state.datasets.set(f.schemaId, {
      ...applied, sourceName, headers: f.parsed.headers, parseWarnings: f.parsed.warnings,
      mapping: Mapping.snapshot(f.name, f.parsed, f.schemaId, f.cols)
    });
    return applied;
  }

  function loadMock() {
    const files = [...Mock.toCSVs()].map(([schemaId, text]) => ({ name: schemaId + '.csv', parsed: CSV.parse(text), hint: schemaId }));
    MapStep.open(files, { mode: 'mock', onConfirm: commitMock });
  }

  function commitMock(mapped) {
    App.state.datasets.clear();
    for (const f of mapped) if (f.schemaId) storeMapped(f, 'Illustrative');
    App.state.loadedFileNames = [];
    enterDashboard('mock');
  }

  const readText = (f) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: f.name, text: String(reader.result) });
    reader.onerror = () => resolve({ name: f.name, error: true });
    reader.readAsText(f);
  });

  function loadFiles(fileList) {
    if (MapStep.isOpen()) return;
    const files = [...fileList].filter((f) => /\.csv$/i.test(f.name) || f.type.includes('csv') || f.type === 'text/plain');
    if (!files.length) {
      UI.Modal.open({ title: 'No CSV files found', html: '<p>Please drop .csv files exported from the upload templates.</p>' });
      return;
    }
    Promise.all(files.map(readText)).then((read) => {
      const failed = [], data = [], notes = [];
      for (const r of read) {
        if (r.error) { failed.push({ file: r.name, ok: false, note: 'Could not read the file.' }); continue; }
        const parsed = CSV.parse(r.text);
        // a field_map.csv in the batch pre-seeds the mapping of the data files
        if (Mapping.isFieldMap(parsed.headers)) notes.push(fieldMapNote(r.name, Mapping.importFieldMap(r.text)));
        else data.push({ name: r.name, parsed });
      }
      for (const f of failed) notes.push(`${f.file}: ${f.note}`);
      if (!data.length) {
        UI.Modal.open({ title: 'Field map imported', html: notes.map((n) => `<p>${esc(n)}</p>`).join('') });
        if (App.state.renderedTabs.delete('fieldmap')) UI.renderActiveTab();
        return;
      }
      MapStep.open(data, { mode: 'byof', notes, onConfirm: (mapped) => commitFiles(mapped, failed) });
    });
  }

  function fieldMapNote(name, r) {
    return r.error ? `${name}: ${r.error}`
      : `${name}: field map imported — ${r.mappings} source header${r.mappings === 1 ? '' : 's'} for ${r.templates} template${r.templates === 1 ? '' : 's'}` +
        `${r.sources ? `, ${r.sources} source-system label${r.sources === 1 ? '' : 's'}` : ''}${r.skipped ? `; ${r.skipped} row${r.skipped === 1 ? '' : 's'} not recognised` : ''}. ` +
        'They pre-seed the mapping of the next files you load (memory only).';
  }

  function importFieldMapFile(file) {
    readText(file).then((r) => {
      const note = r.error ? `${r.name}: could not read the file.` : fieldMapNote(r.name, Mapping.importFieldMap(r.text));
      UI.Modal.open({ title: 'Field map import', html: `<p>${esc(note)}</p>` });
      if (App.state.renderedTabs.delete('fieldmap')) UI.renderActiveTab();
    });
  }

  function commitFiles(mapped, failed) {
    // first real load replaces the mock; later loads add up (or replace per template)
    if (App.state.mode === 'mock') { App.state.datasets.clear(); App.state.loadedFileNames = []; }
    const results = [...failed];
    const seen = new Map();   // schemaId -> first file this batch (collision report)
    for (const f of mapped) {
      if (!f.schemaId) {
        results.push({ file: f.name, ok: false, note: f.parsed.headers.length
          ? 'Not loaded — skipped on the mapping step (no template assigned). Download the templates to see the expected columns.'
          : 'Not loaded — the file is empty.' });
        continue;
      }
      const collidesWith = seen.get(f.schemaId);
      seen.set(f.schemaId, f.name);
      const applied = storeMapped(f, f.name);
      const cols = SCHEMAS[f.schemaId].columns;
      results.push({
        file: f.name, ok: true, schemaId: f.schemaId,
        missing: cols.filter((c) => f.cols.get(c.key)?.header == null).map((c) => c.name),
        unexpected: Mapping.unmappedHeaders(f.parsed.headers, f.cols),
        renamed: cols.filter((c) => { const v = f.cols.get(c.key); return v && v.header != null && v.header !== c.name; }).length,
        stats: applied.stats, errors: applied.errors,
        warnings: f.parsed.warnings,
        collidesWith
      });
      if (!App.state.loadedFileNames.includes(f.name)) App.state.loadedFileNames.push(f.name);
    }
    finishLoad(results);
  }

  function finishLoad(results) {
    const anyOk = results.some((r) => r.ok);
    if (anyOk) enterDashboard('byof');
    UI.Modal.open({ title: 'Load report', html: loadReportHTML(results) });
  }

  function loadReportHTML(results) {
    const parts = results.map((r) => {
      if (!r.ok) return `<div class="lr-file">${esc(r.file)}</div><div class="lr-err">✕ ${esc(r.note)}</div>`;
      const errs = r.errors.map((e) =>
        `<li class="lr-err">${esc(e.message)} — ${e.count} row${e.count > 1 ? 's' : ''}` +
        (e.rows.length ? ` (e.g. row${e.rows.length > 1 ? 's' : ''} ${e.rows.slice(0, 6).join(', ')}${e.count > 6 ? '…' : ''})` : '') + `</li>`).join('');
      const missing = r.missing.length ? `<li>Optional columns not mapped: ${esc(r.missing.join(', '))}</li>` : '';
      const unexpected = r.unexpected.length ? `<li>Ignored unmapped columns: ${esc(r.unexpected.join(', '))}</li>` : '';
      const renamed = r.renamed ? `<li>${r.renamed} column${r.renamed > 1 ? 's' : ''} read from renamed source headers (see the Field Mapping tab)</li>` : '';
      const parseWarn = (r.warnings || []).map((w) => `<li class="lr-err">${esc(w)}</li>`).join('');
      const collide = r.collidesWith ? `<li class="lr-err">Both this file and “${esc(r.collidesWith)}” map to ${esc(r.schemaId)}.csv — this one replaced it. Load only one file per template.</li>` : '';
      return `<div class="lr-file">${esc(r.file)} → ${esc(r.schemaId)}.csv</div>
        <div class="lr-ok">✓ ${fmtInt(r.stats.acceptedRows)} of ${fmtInt(r.stats.totalRows)} rows loaded${r.stats.droppedRows ? ` · ${fmtInt(r.stats.droppedRows)} dropped (missing/invalid required values)` : ''}</div>
        ${errs || missing || unexpected || parseWarn || collide || renamed ? `<ul>${collide}${parseWarn}${renamed}${missing}${unexpected}${errs}</ul>` : ''}`;
    });
    const notLoaded = SCHEMA_IDS.filter((id) => !App.state.datasets.has(id));
    const partial = notLoaded.length
      ? `<p style="margin-top:10px">Not loaded yet: ${notLoaded.map((i) => i + '.csv').join(', ')} — the tiles that need them show “No data loaded for this metric”. Use <em>Load / add files</em> in the header to add them without losing what’s already loaded.</p>`
      : '';
    return `<div class="load-report">${parts.join('')}${partial}
      <p style="margin-top:10px"><strong>Nothing left your browser.</strong> Files were parsed locally and are held in memory only — a reload clears them.</p></div>`;
  }

  /* ---------- mode & chrome ---------- */

  function chipText() {
    if (App.state.mode === 'mock') return 'Illustrative data';
    if (App.state.mode === 'byof') {
      const n = App.state.loadedFileNames;
      const label = n.length <= 2 ? n.join(', ') : `${n.length} files`;
      return `${label} · as of ${CONFIG.asOf}`;
    }
    return '';
  }

  function refreshChrome() {
    const chip = document.getElementById('data-chip');
    const ftChip = document.getElementById('ft-chip');
    const cls = App.state.mode === 'mock' ? 'chip chip-mock' : 'chip chip-live';
    chip.textContent = chipText(); chip.className = cls;
    ftChip.textContent = chipText(); ftChip.className = cls;
    document.getElementById('ft-asof').textContent = `As of ${CONFIG.asOf} · ${CONFIG.periodLabel}`;
    const seg = 'Business: ' + Compute.ctxNow().segment;
    document.getElementById('scope-chip').textContent = seg;
    document.getElementById('ft-scope').textContent = seg;
    document.getElementById('ft-persona').textContent = 'Persona: ' + Access.label();
    document.getElementById('btn-persona').textContent = 'Viewing as: ' + Access.label() + ' ▾';
    const p = Access.persona(), n = Access.counts(p);
    document.getElementById('persona-banner').innerHTML =
      `<span><strong>Persona view:</strong> ${esc(Access.label())} — ${esc(Access.scopeLabel(p, App.state.persona))} ·
        ${esc(Access.PII_LABEL[p.pii].toLowerCase())} · ${fmtInt(n.hidden)} metrics restricted, ${fmtInt(n.agg)} aggregate-only</span>
      <span class="mockup-tag">Persona view — mockup, not a security control</span>
      ${Access.canSeeTab('access') ? '<button class="linklike" data-open-access>Open Access Matrix</button>' : ''}`;
  }

  /* ---------- personas (D8) ---------- */

  // selectors a persona's scope locks are disabled and titled; leaving a locked
  // persona resets them to the unscoped defaults
  function applyPersonaChrome() {
    const p = Access.persona();
    const lockTitle = (what) => `Locked to ${what} by the ${p.label} persona (mockup)`;
    const f = App.state.filters;
    const selAsset = document.getElementById('sel-asset');
    const lockA = Access.lockedAsset();
    const assets = lockA ? [lockA] : ['Group', ...CONFIG.assets];
    selAsset.innerHTML = assets.map((a) => `<option>${esc(a)}</option>`).join('');
    if (lockA) f.asset = lockA;
    else if (!assets.includes(f.asset)) f.asset = 'Group';
    selAsset.value = f.asset;
    selAsset.disabled = !!lockA;
    selAsset.title = lockA ? lockTitle(lockA) : '';

    const selSeg = document.getElementById('sel-seg');
    const lockS = Access.lockedSegment();
    if (lockS) f.segment = lockS;
    selSeg.value = f.segment;
    selSeg.disabled = !!lockS;
    selSeg.title = lockS ? lockTitle(lockS) : '';

    const lockF = Access.lockedFunction();
    const selFn = document.getElementById('sel-fn');
    document.getElementById('ctl-fn').hidden = !lockF;
    selFn.innerHTML = lockF ? `<option>${esc(lockF)}</option>` : '';
    selFn.title = lockF ? lockTitle(lockF) : '';
    f.fn = lockF || 'All';
  }

  function setPersona(id, bind = {}) {
    const p = PERSONA_BY_ID.get(id);
    if (!p) return false;
    const before = { asset: Access.lockedAsset(), segment: Access.lockedSegment() };
    const hasAsset = p.scope === 'asset' || p.scope === 'asset+function';
    const asset = CONFIG.assets.includes(bind.asset) ? bind.asset : CONFIG.assets[0];
    const segment = CONFIG.segments.includes(bind.segment) ? bind.segment : CONFIG.segments[0];
    let fn = null;
    if (p.scope === 'asset+function') {
      const fns = Access.functionsAt(asset);
      fn = bind.fn && fns.includes(bind.fn) ? bind.fn : Access.defaultFunction(asset);
    }
    App.state.persona = { id, asset: hasAsset ? asset : null, segment: p.scope === 'segment' ? segment : null, fn };
    if (before.asset && !Access.lockedAsset()) App.state.filters.asset = 'Group';
    if (before.segment && !Access.lockedSegment()) App.state.filters.segment = 'All';
    UI.Popover.close();
    UI.Modal.close();
    App.__lastDrill = null;
    applyPersonaChrome();
    if (App.state.mode !== 'gate') {
      UI.renderTabbar();
      UI.invalidateTabs();          // re-renders the active tab and rebuilds the print pack
    }
    refreshChrome();
    syncGatePersona();
    return true;
  }

  const personaOptions = (sel) => PERSONAS.map((p) =>
    `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
  const listOptions = (list, sel) => list.map((v) => `<option${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

  function syncGatePersona() {
    const b = App.state.persona, p = Access.persona();
    document.getElementById('gate-persona').value = b.id;
    document.getElementById('gate-persona-asset-wrap').hidden = !b.asset;
    document.getElementById('gate-persona-seg-wrap').hidden = !b.segment;
    if (b.asset) document.getElementById('gate-persona-asset').value = b.asset;
    if (b.segment) document.getElementById('gate-persona-seg').value = b.segment;
    document.getElementById('gate-persona-desc').textContent =
      `${p.who} Scope: ${Access.scopeLabel(p, b)} · ${Access.PII_LABEL[p.pii]}.`;
  }

  function initPersonaGate() {
    const sel = document.getElementById('gate-persona');
    const selA = document.getElementById('gate-persona-asset');
    const selS = document.getElementById('gate-persona-seg');
    sel.innerHTML = personaOptions(App.state.persona.id);
    selA.innerHTML = listOptions(CONFIG.assets, CONFIG.assets[0]);
    selS.innerHTML = listOptions(CONFIG.segments, CONFIG.segments[0]);
    const apply = () => setPersona(sel.value, { asset: selA.value, segment: selS.value });
    for (const el of [sel, selA, selS]) el.addEventListener('change', apply);
    syncGatePersona();
  }

  function openPersonaModal() {
    const b = App.state.persona;
    UI.Modal.open({
      title: 'Persona view', html: `
      <p>Preview the dashboard as another HR persona. <span class="mockup-tag">Persona view — mockup, not a security control</span></p>
      <div class="persona-list" role="radiogroup" aria-label="Persona">
        ${PERSONAS.map((p) => `<label class="persona-opt">
          <input type="radio" name="pm-persona" value="${esc(p.id)}"${p.id === b.id ? ' checked' : ''}>
          <span class="pm-name">${esc(p.label)}</span>
          <span class="pm-desc">${esc(p.who)}</span>
          <span class="pm-meta">${esc(Access.scopeLabel(p))} · ${esc(Access.PII_LABEL[p.pii])}</span>
        </label>`).join('')}
      </div>
      <div class="persona-bind">
        <label class="ctl" id="pm-asset-wrap">Asset <select id="pm-asset">${listOptions(CONFIG.assets, b.asset || CONFIG.assets[0])}</select></label>
        <label class="ctl" id="pm-seg-wrap">Business <select id="pm-seg">${listOptions(CONFIG.segments, b.segment || CONFIG.segments[0])}</select></label>
        <label class="ctl" id="pm-fn-wrap">Line function <select id="pm-fn"></select></label>
      </div>
      <p style="margin-top:10px"><button class="btn btn-solid" data-persona-apply>Apply persona view</button></p>` });
    const root = document.getElementById('modal-root');
    const sync = () => {
      const p = PERSONA_BY_ID.get(root.querySelector('input[name="pm-persona"]:checked')?.value) || PERSONAS[0];
      const asset = root.querySelector('#pm-asset').value;
      root.querySelector('#pm-asset-wrap').hidden = !(p.scope === 'asset' || p.scope === 'asset+function');
      root.querySelector('#pm-seg-wrap').hidden = p.scope !== 'segment';
      root.querySelector('#pm-fn-wrap').hidden = p.scope !== 'asset+function';
      const fnSel = root.querySelector('#pm-fn');
      const keep = fnSel.value || (b.asset === asset ? b.fn : null);
      const fns = Access.functionsAt(asset);
      fnSel.innerHTML = listOptions(fns, fns.includes(keep) ? keep : Access.defaultFunction(asset));
    };
    root.querySelectorAll('input[name="pm-persona"], #pm-asset').forEach((el) => el.addEventListener('change', sync));
    sync();
  }

  function applyPersonaModal() {
    const root = document.getElementById('modal-root');
    const id = root.querySelector('input[name="pm-persona"]:checked')?.value;
    if (!id) return;
    setPersona(id, { asset: root.querySelector('#pm-asset').value, segment: root.querySelector('#pm-seg').value, fn: root.querySelector('#pm-fn').value });
  }

  function enterDashboard(mode) {
    App.state.mode = mode;
    App.state.dataVersion++;
    // an HRBP bound before data existed gets the largest function at its asset
    const b = App.state.persona;
    if (b.asset && Access.persona().scope === 'asset+function' && !Access.functionsAt(b.asset).includes(b.fn)) {
      b.fn = Access.defaultFunction(b.asset);
    }
    document.getElementById('load-gate').hidden = true;
    document.getElementById('app').hidden = false;
    applyPersonaChrome();
    UI.renderTabbar();
    refreshChrome();
    UI.invalidateTabs();
    if (typeof PrintPack !== 'undefined') PrintPack.markDirty();
    // the mapping step's Confirm button is gone; the active tab takes focus
    // (and is where the load report returns it)
    if (document.activeElement === document.body) document.getElementById('tab-' + App.state.activeTab)?.focus();
  }

  function resetToGate() {
    App.state.datasets.clear();
    App.state.loadedFileNames = [];
    App.state.dataVersion++;
    App.state.mode = 'gate';
    App.state.renderedTabs.clear();
    App.__lastDrill = null;                       // drop any retained drill rows
    Compute.invalidate();
    // wipe the pre-rendered print pack immediately: otherwise a Ctrl+P at the
    // empty gate would print the previous dataset's confidential pages.
    document.getElementById('print-root').innerHTML = '';
    if (typeof PrintPack !== 'undefined') PrintPack.markDirty();
    document.getElementById('app').hidden = true;
    document.getElementById('load-gate').hidden = false;
    syncGatePersona();                            // the persona survives a reset
    document.getElementById('gate-mock').focus();
  }

  /* ---------- controls ---------- */

  function initControls() {
    const selAsset = document.getElementById('sel-asset');
    selAsset.innerHTML = ['Group', ...CONFIG.assets].map((a) => `<option>${a}</option>`).join('');
    const selBand = document.getElementById('sel-band');
    selBand.innerHTML = ['All', ...CONFIG.gradeBands].map((b) =>
      `<option value="${esc(b)}">${esc(b === 'All' ? 'All bands' : CONFIG.bandLabels[b])}</option>`).join('');
    const selSeg = document.getElementById('sel-seg');
    selSeg.innerHTML = ['All', ...CONFIG.segments].map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    const selPeriod = document.getElementById('sel-period');
    selPeriod.innerHTML = [
      ['3', 'FY-Q1 (3 mo)'], ['6', 'FY-H1 (6 mo)'], ['12', 'Full year (12 mo)']
    ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    selAsset.addEventListener('change', () => { App.state.filters.asset = selAsset.value; UI.invalidateTabs(); refreshChrome(); });
    selBand.addEventListener('change', () => { App.state.filters.band = selBand.value; UI.invalidateTabs(); });
    selSeg.addEventListener('change', () => { App.state.filters.segment = selSeg.value; UI.invalidateTabs(); refreshChrome(); });
    selPeriod.addEventListener('change', () => { App.state.filters.periodMonths = +selPeriod.value; UI.invalidateTabs(); });

    // Search filters the rendered DOM of the active tab only: hidden tabs are
    // never rendered and restricted tiles/cards carry no value text. Any future
    // cross-tab or registry search must filter on Access.canSeeTab + canSee.
    document.getElementById('search').addEventListener('input', debounce((e) => {
      const q = e.target.value.trim().toLowerCase();
      const panel = document.getElementById('panel-' + App.state.activeTab);
      panel.querySelectorAll('.tile, .card').forEach((t) => {
        t.style.display = !q || t.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }, 120));

    document.getElementById('btn-reset').addEventListener('click', resetToGate);
    document.getElementById('btn-templates').addEventListener('click', Exports.openTemplatesModal);
    document.getElementById('btn-add').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('btn-howto').addEventListener('click', openHowTo);
    document.getElementById('btn-persona').addEventListener('click', openPersonaModal);
    document.getElementById('btn-print').addEventListener('click', () => {
      if (typeof PrintPack !== 'undefined') PrintPack.ensureFresh();
      window.print();
    });
    document.getElementById('btn-export').addEventListener('click', () => {
      if (typeof Exports.openExportModal === 'function') Exports.openExportModal();
      else UI.Modal.open({ title: 'Export', html: '<p>Chart PNG / CSV exports arrive in a later build phase. Upload templates are available now via Templates.</p>' });
    });
  }

  function openHowTo() {
    UI.Modal.open({
      title: 'How to use this dashboard', html: `
      <ul style="padding-left:18px; display:grid; gap:6px">
        <li><strong>Map your columns</strong> — every load (the mock included) stops at a mapping step: files are matched to the upload templates and fields to your source headers; fix any match, then confirm. The <strong>Field Mapping</strong> tab shows the result and exports it as field_map.csv.</li>
        <li><strong>ⓘ on every tile</strong> — the exact formula, input columns, caveats and data-quality notes. Keyboard: Tab to the ⓘ, Enter to open, Esc to close.</li>
        <li><strong>Click a tile</strong> with a pointer cursor to drill into the underlying rows.</li>
        <li><strong>Asset selector</strong> recomputes every tab for Group, Hazira, Paradeep, Vizag or Kirandul; <strong>Business</strong> narrows every tab to Operations or Projects; the grade-band filter applies to employee-keyed tabs.</li>
        <li><strong>Viewing as</strong> previews the dashboard as another HR persona (scope, restricted metrics, masked identifiers). It is a mockup of the policy, not a security control.</li>
        <li><strong>Templates</strong> downloads the blank CSV upload templates and the data dictionary — the exact schema this dashboard reads.</li>
        <li><strong>Print pack</strong> produces a paginated A4 pack: cover, Group summary, one page per asset, data quality and methodology.</li>
        <li><strong>Privacy</strong> — everything runs in this browser tab. No uploads, no cookies, no storage; reloading clears all data.</li>
      </ul>` });
  }

  /* ---------- gate wiring ---------- */

  function initGate() {
    const gate = document.getElementById('load-gate');
    const input = document.getElementById('file-input');
    document.getElementById('gate-mock').addEventListener('click', loadMock);
    document.getElementById('gate-load').addEventListener('click', () => input.click());
    document.getElementById('gate-templates').addEventListener('click', Exports.openTemplatesModal);
    input.addEventListener('change', () => { if (input.files.length) { loadFiles(input.files); input.value = ''; } });
    const fmInput = document.getElementById('fieldmap-input');
    document.getElementById('gate-fieldmap').addEventListener('click', () => fmInput.click());
    fmInput.addEventListener('change', () => { if (fmInput.files.length) { importFieldMapFile(fmInput.files[0]); fmInput.value = ''; } });

    const loadCard = document.getElementById('gate-load');
    for (const el of [gate]) {
      el.addEventListener('dragover', (e) => { e.preventDefault(); loadCard.classList.add('dragover'); });
      el.addEventListener('dragleave', (e) => { if (e.target === gate) loadCard.classList.remove('dragover'); });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        loadCard.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
      });
    }

    // Global guard: once the dashboard is showing, a file dropped anywhere would
    // otherwise navigate the tab to that file and destroy all in-memory state.
    // Swallow the default everywhere and route dropped CSVs into the loader.
    document.addEventListener('dragover', (e) => { if (App.state.mode !== 'gate' || MapStep.isOpen()) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      if (MapStep.isOpen()) { e.preventDefault(); return; }   // finish or go back first
      if (App.state.mode === 'gate') return; // gate has its own handler above
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
    });
  }

  /* ---------- global delegation ("i", drill, template buttons) ---------- */

  function initDelegation() {
    document.addEventListener('click', (e) => {
      const iBtn = e.target.closest('[data-info]');
      if (iBtn) { UI.Popover.open(iBtn, UI.popoverHTML(iBtn.dataset.info)); return; }
      const sBtn = e.target.closest('[data-scoreinfo]');
      if (sBtn) { UI.Popover.open(sBtn, Scorecard.scoreInfoHTML(sBtn.dataset.scoreinfo)); return; }
      const jump = e.target.closest('[data-jump]');
      if (jump) {
        const entry = REG_BY_KEY.get(jump.dataset.jump);
        if (entry) {
          UI.activateTab(entry.tab);
          const tile = document.querySelector(`#panel-${entry.tab} [data-key="${entry.key}"]`);
          if (tile) { tile.scrollIntoView({ block: 'center' }); tile.style.outline = '2px solid var(--red)'; setTimeout(() => { tile.style.outline = ''; }, 1600); }
        }
        return;
      }
      const tpl = e.target.closest('[data-template]');
      if (tpl) { Exports.downloadTemplate(tpl.dataset.template); return; }
      if (e.target.closest('[data-template-all]')) { Exports.downloadAllTemplates(); return; }
      if (e.target.closest('[data-template-dict]')) { Exports.downloadDataDictionary(); return; }
      if (e.target.closest('[data-export-charts]')) { Exports.exportTabChartsPNG(); UI.Modal.close(); return; }
      if (e.target.closest('[data-export-tab]')) { Exports.exportTabCSV(); return; }
      if (e.target.closest('[data-export-all]')) { Exports.exportAllCSV(); return; }
      if (e.target.closest('[data-export-print]')) { UI.Modal.close(); PrintPack.ensureFresh(); window.print(); return; }
      if (e.target.closest('[data-export-access]')) { AccessMatrix.download(); return; }
      if (e.target.closest('[data-persona-apply]')) { applyPersonaModal(); return; }
      if (e.target.closest('[data-open-access]')) { UI.activateTab('access'); return; }
      const asPersona = e.target.closest('[data-persona]');
      if (asPersona) { setPersona(asPersona.dataset.persona); return; }
      const drillDl = e.target.closest('[data-drill-csv]');
      if (drillDl && App.__lastDrill) { Exports.drillCSV(App.__lastDrill); return; }
      const setAsset = e.target.closest('[data-setasset]');
      if (setAsset) {
        if (!Access.canFocusAsset(setAsset.dataset.setasset)) return;
        App.state.filters.asset = setAsset.dataset.setasset;
        document.getElementById('sel-asset').value = setAsset.dataset.setasset;
        UI.invalidateTabs();
        refreshChrome();
        return;
      }
      const drill = e.target.closest('[data-drill]');
      if (drill && !e.target.closest('[data-info]')) openDrill(drill.dataset.drill);
    });

    // shared chart tooltip (marks carry data-tip)
    const tip = document.createElement('div');
    tip.id = 'tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t) { tip.textContent = t.dataset.tip; tip.hidden = false; }
      else tip.hidden = true;
    });
    document.addEventListener('mousemove', (e) => {
      if (tip.hidden) return;
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      const y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8);
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    });
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-drill][role="button"]')) {
        e.preventDefault();
        openDrill(e.target.dataset.drill);
      }
    });
  }

  // Row-level choke point: only 'full' metrics drill, and every drill passes
  // Access.maskDrill (pseudonyms for 'masked', withheld for 'none'). The CSV
  // download reuses the masked object.
  function openDrill(key) {
    const res = Compute.metric(key);
    if (!res.entry || !res.entry.drill || !res.available || !Access.canDrill(res.entry)) return;
    const raw = res.entry.drill(Compute.build(), res.ctx);
    if (!raw) return;
    const d = Access.maskDrill(raw);
    if (!d) {
      App.__lastDrill = null;
      UI.Modal.open({
        title: 'Row-level detail withheld',
        html: `<p>This drill-down lists individual people. The ${esc(Access.label())} persona sees
          aggregates only (identifiers: none), so the rows are not shown — the tile value is the aggregate.</p>`
      });
      return;
    }
    App.__lastDrill = d;
    UI.Modal.open({
      title: d.title,
      html: `<p style="margin-bottom:8px"><button class="btn btn-outline" data-drill-csv>Download these rows → CSV</button></p>` +
        (d !== raw ? `<p class="chart-note" style="margin-bottom:6px">Identifiers are pseudonymised for ${esc(Access.label())} — stable within this browser session only.</p>` : '') +
        UI.tableHTML(d.columns, d.rows)
    });
  }

  /* ---------- boot ---------- */

  document.addEventListener('DOMContentLoaded', () => {
    UI.renderTabbar();
    initControls();
    initGate();
    initPersonaGate();
    initDelegation();
    applyPersonaChrome();
    refreshChrome();
  });

  App.loadMock = loadMock;       // exposed for tests
  App.importFieldMapFile = importFieldMapFile;
  App.resetToGate = resetToGate;
  App.refreshChrome = refreshChrome;
  App.setPersona = setPersona;
})();
