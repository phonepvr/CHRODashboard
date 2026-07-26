/* App bootstrap — state, load gate, dataset loading (mock + BYOF), controls.
   State lives in memory only: no storage APIs, nothing persists a reload. */

const App = {
  state: {
    mode: 'gate',                 // 'gate' | 'mock' | 'byof'
    datasets: new Map(),          // schemaId -> {rows, errors, stats, sourceName}
    dataVersion: 0,
    filters: { asset: 'Group', band: 'All', periodMonths: 3 },
    activeTab: 'overview',
    renderedTabs: new Set(),
    loadedFileNames: []
  }
};

(() => {

  /* ---------- dataset loading ---------- */

  function storeParsed(schemaId, parsed, sourceName) {
    const applied = CSV.applySchema(schemaId, parsed);
    App.state.datasets.set(schemaId, { ...applied, sourceName, headers: parsed.headers, parseWarnings: parsed.warnings });
    return applied;
  }

  function loadMock() {
    App.state.datasets.clear();
    const files = Mock.toCSVs();
    for (const [schemaId, text] of files) {
      storeParsed(schemaId, CSV.parse(text), 'Illustrative');
    }
    App.state.loadedFileNames = [];
    enterDashboard('mock');
  }

  function loadFiles(fileList) {
    const files = [...fileList].filter((f) => /\.csv$/i.test(f.name) || f.type.includes('csv') || f.type === 'text/plain');
    if (!files.length) {
      UI.Modal.open({ title: 'No CSV files found', html: '<p>Please drop .csv files exported from the upload templates.</p>' });
      return;
    }
    const results = [];
    let done = 0;
    // clear mock data on first real load; keep previously loaded real files (partial loads add up)
    if (App.state.mode === 'mock') App.state.datasets.clear();
    for (const f of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const parsed = CSV.parse(String(reader.result));
        const match = CSV.matchSchema(parsed.headers);
        if (!match) {
          results.push({ file: f.name, ok: false, note: 'Not recognised as any template — headers do not match. Download the templates to see the expected columns.' });
        } else {
          const applied = storeParsed(match.schemaId, parsed, f.name);
          results.push({
            file: f.name, ok: true, schemaId: match.schemaId,
            missing: match.missing, unexpected: match.unexpected,
            stats: applied.stats, errors: applied.errors
          });
          if (!App.state.loadedFileNames.includes(f.name)) App.state.loadedFileNames.push(f.name);
        }
        if (++done === files.length) finishLoad(results);
      };
      reader.onerror = () => {
        results.push({ file: f.name, ok: false, note: 'Could not read the file.' });
        if (++done === files.length) finishLoad(results);
      };
      reader.readAsText(f);
    }
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
      const missing = r.missing.length ? `<li class="lr-err">Missing columns: ${esc(r.missing.join(', '))}</li>` : '';
      const unexpected = r.unexpected.length ? `<li>Ignored unexpected columns: ${esc(r.unexpected.join(', '))}</li>` : '';
      return `<div class="lr-file">${esc(r.file)} → ${esc(r.schemaId)}.csv</div>
        <div class="lr-ok">✓ ${fmtInt(r.stats.acceptedRows)} of ${fmtInt(r.stats.totalRows)} rows loaded${r.stats.droppedRows ? ` · ${fmtInt(r.stats.droppedRows)} dropped (missing/invalid required values)` : ''}</div>
        ${errs || missing || unexpected ? `<ul>${missing}${unexpected}${errs}</ul>` : ''}`;
    });
    const notLoaded = SCHEMA_IDS.filter((id) => !App.state.datasets.has(id));
    const partial = notLoaded.length
      ? `<p style="margin-top:10px">Not loaded yet: ${notLoaded.map((i) => i + '.csv').join(', ')} — the tiles that need them show “No data loaded for this metric”. You can drop more files any time via <em>Reset / load different data</em>.</p>`
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
  }

  function enterDashboard(mode) {
    App.state.mode = mode;
    App.state.dataVersion++;
    document.getElementById('load-gate').hidden = true;
    document.getElementById('app').hidden = false;
    refreshChrome();
    UI.invalidateTabs();
    if (typeof PrintPack !== 'undefined') PrintPack.markDirty();
  }

  function resetToGate() {
    App.state.datasets.clear();
    App.state.loadedFileNames = [];
    App.state.dataVersion++;
    App.state.mode = 'gate';
    App.state.renderedTabs.clear();
    document.getElementById('app').hidden = true;
    document.getElementById('load-gate').hidden = false;
    document.getElementById('gate-mock').focus();
  }

  /* ---------- controls ---------- */

  function initControls() {
    const selAsset = document.getElementById('sel-asset');
    selAsset.innerHTML = ['Group', ...CONFIG.assets].map((a) => `<option>${a}</option>`).join('');
    const selBand = document.getElementById('sel-band');
    selBand.innerHTML = ['All', ...CONFIG.gradeBands].map((b) =>
      `<option value="${esc(b)}">${esc(b === 'All' ? 'All bands' : CONFIG.bandLabels[b])}</option>`).join('');
    const selPeriod = document.getElementById('sel-period');
    selPeriod.innerHTML = [
      ['3', 'FY-Q1 (3 mo)'], ['6', 'FY-H1 (6 mo)'], ['12', 'Full year (12 mo)']
    ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    selAsset.addEventListener('change', () => { App.state.filters.asset = selAsset.value; UI.invalidateTabs(); refreshChrome(); });
    selBand.addEventListener('change', () => { App.state.filters.band = selBand.value; UI.invalidateTabs(); });
    selPeriod.addEventListener('change', () => { App.state.filters.periodMonths = +selPeriod.value; UI.invalidateTabs(); });

    document.getElementById('search').addEventListener('input', debounce((e) => {
      const q = e.target.value.trim().toLowerCase();
      const panel = document.getElementById('panel-' + App.state.activeTab);
      panel.querySelectorAll('.tile, .card').forEach((t) => {
        t.style.display = !q || t.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }, 120));

    document.getElementById('btn-reset').addEventListener('click', resetToGate);
    document.getElementById('btn-templates').addEventListener('click', Exports.openTemplatesModal);
    document.getElementById('btn-howto').addEventListener('click', openHowTo);
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
        <li><strong>ⓘ on every tile</strong> — the exact formula, input columns, caveats and data-quality notes. Keyboard: Tab to the ⓘ, Enter to open, Esc to close.</li>
        <li><strong>Click a tile</strong> with a pointer cursor to drill into the underlying rows.</li>
        <li><strong>Asset selector</strong> recomputes every tab for Group, Hazira, Paradeep, Vizag or Kirandul; the grade-band filter applies to tabs 1–7.</li>
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
      const drill = e.target.closest('[data-drill]');
      if (drill && !e.target.closest('[data-info]')) openDrill(drill.dataset.drill);
    });
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-drill][role="button"]')) {
        e.preventDefault();
        openDrill(e.target.dataset.drill);
      }
    });
  }

  function openDrill(key) {
    const res = Compute.metric(key);
    if (!res.entry || !res.entry.drill || !res.available) return;
    const d = res.entry.drill(Compute.build(), res.ctx);
    if (!d) return;
    UI.Modal.open({ title: d.title, html: UI.tableHTML(d.columns, d.rows) });
  }

  /* ---------- boot ---------- */

  document.addEventListener('DOMContentLoaded', () => {
    UI.renderTabbar();
    initControls();
    initGate();
    initDelegation();
    refreshChrome();
  });

  App.loadMock = loadMock;       // exposed for tests
  App.resetToGate = resetToGate;
  App.refreshChrome = refreshChrome;
})();
