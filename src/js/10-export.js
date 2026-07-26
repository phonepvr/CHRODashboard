/* Exports — all LOCAL Blob downloads; nothing is ever transmitted.
   Upload templates + the data dictionary are generated at runtime from
   SCHEMAS + REGISTRY, so template columns and metric inputs cannot drift. */

const Exports = (() => {

  function templateCSV(schemaId) {
    const schema = SCHEMAS[schemaId];
    const header = schema.columns.map((c) => c.name);
    const exampleRows = [0, 1, 2].map((i) =>
      schema.columns.map((c) => (c.ex && c.ex[i] != null) ? c.ex[i] : ''));
    return CSV.serialize(header, exampleRows);
  }

  function downloadTemplate(schemaId) {
    downloadBlob(schemaId + '.csv', templateCSV(schemaId));
  }

  // Which registry metrics consume a given file/column?
  function consumers(schemaId, colName) {
    return REGISTRY
      .filter((e) => e.inputs.some((i) => i.dataset === schemaId && i.columns.includes(colName)))
      .map((e) => e.key);
  }

  function typeLabel(col) {
    switch (col.type) {
      case 'date': return 'Date (DD-MM-YYYY)';
      case 'month': return 'Month (MM-YYYY)';
      case 'flag': return 'Flag (Y/N)';
      case 'enum': return 'One of: ' + ENUMS[col.enum].join(' / ');
      case 'pct': return 'Percent (0–100)';
      case 'int': return 'Whole number';
      case 'num': return 'Number';
      case 'id': return 'Identifier (text)';
      default: return 'Text';
    }
  }

  function dataDictionaryCSV() {
    const rows = [];
    for (const id of SCHEMA_IDS) {
      const s = SCHEMAS[id];
      for (const c of s.columns) {
        rows.push([
          id + '.csv', c.name, typeLabel(c), c.required ? 'Yes' : 'No',
          c.desc || '', consumers(id, c.name).join('; ') || '(context / joins)'
        ]);
      }
    }
    return CSV.serialize(
      ['File', 'Column', 'Type / allowed values', 'Required', 'Description', 'Used by metrics (registry keys)'],
      rows);
  }

  function downloadDataDictionary() {
    downloadBlob('data_dictionary.csv', dataDictionaryCSV());
  }

  function downloadAllTemplates() {
    // staggered — browsers drop some downloads when many fire in the same task
    SCHEMA_IDS.forEach((id, i) => setTimeout(() => downloadTemplate(id), i * 300));
    setTimeout(downloadDataDictionary, SCHEMA_IDS.length * 300);
  }

  function templatesModalHTML() {
    const items = SCHEMA_IDS.map((id) => {
      const s = SCHEMAS[id];
      return `<tr>
        <td><button class="btn btn-outline" data-template="${id}">${id}.csv</button></td>
        <td>${esc(s.label)}${s.source ? ` <span class="tile-src">[${esc(s.source)}]</span>` : ''}</td>
        <td>${esc(s.desc)}</td></tr>`;
    }).join('');
    return `
      <p>Blank CSV templates with 2–3 example rows showing the expected formats
      (dates <strong>DD-MM-YYYY</strong>, months MM-YYYY, flags Y/N). Generated from the same
      formula registry that computes every tile. Load any subset — tiles whose inputs are
      missing simply grey out.</p>
      <p style="margin-top:8px">
        <button class="btn btn-solid" data-template-all="1">Download all (12 templates + data dictionary)</button>
        <button class="btn btn-outline" data-template-dict="1">data_dictionary.csv</button>
      </p>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Template</th><th>Contents</th><th>Notes</th></tr></thead>
        <tbody>${items}</tbody></table></div>`;
  }

  function openTemplatesModal() {
    UI.Modal.open({ title: 'Download upload templates', html: templatesModalHTML() });
  }

  /* ---------- data exports (all local Blob downloads) ---------- */

  function metricsCSV(keys) {
    const f = App.state.filters;
    const rows = keys.map((k) => {
      const res = Compute.metric(k);
      const e = res.entry;
      return [
        e.key, e.label, e.tab, e.group, f.asset, f.band, CONFIG.periodLabel,
        res.available && res.value != null ? String(Math.round(res.value * 1000) / 1000) : '',
        res.target && res.target.value != null ? String(res.target.value) : '',
        e.direction || '', e.source || '', res.quality || (res.available ? '' : 'inputs not loaded')
      ];
    });
    return CSV.serialize(
      ['Metric Key', 'Metric', 'Tab', 'Group', 'Asset', 'Grade Band', 'Period', 'Value', 'Target', 'Direction', 'Source System', 'Note'],
      rows);
  }

  function exportTabCSV() {
    const keys = REGISTRY.filter((e) => e.tab === App.state.activeTab).map((e) => e.key);
    downloadBlob(`amns-hr-${App.state.activeTab}-metrics.csv`, metricsCSV(keys.length ? keys : REGISTRY.map((e) => e.key)));
  }

  function exportAllCSV() {
    downloadBlob('amns-hr-all-metrics.csv', metricsCSV(REGISTRY.map((e) => e.key)));
  }

  function drillCSV(d) {
    const strip = (c) => String(c ?? '').replace(/<[^>]*>/g, '');
    downloadBlob(d.title.replace(/\W+/g, '-').toLowerCase() + '.csv',
      CSV.serialize(d.columns, d.rows.map((r) => r.map(strip))));
  }

  /* ---------- chart PNG export (canvas.toBlob; no network, no tainting) ---------- */

  const SVG_STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linejoin',
    'stroke-linecap', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor'];

  function inlineStyles(src, dst) {
    const cs = getComputedStyle(src);
    for (const p of SVG_STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) dst.setAttribute(p, v); // SVG presentation attributes are kebab-case
    }
    const sk = src.children, dk = dst.children;
    for (let i = 0; i < sk.length; i++) inlineStyles(sk[i], dk[i]);
  }

  function svgToPng(svgEl, name) {
    const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
    const w = vb && vb.width ? vb.width : svgEl.clientWidth || 640;
    const h = vb && vb.height ? vb.height : svgEl.clientHeight || 240;
    const clone = svgEl.cloneNode(true);
    inlineStyles(svgEl, clone);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    const xml = new XMLSerializer().serializeToString(clone);
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * 2; canvas.height = h * 2;
      const c2d = canvas.getContext('2d');
      c2d.fillStyle = '#FFFFFF';
      c2d.fillRect(0, 0, canvas.width, canvas.height);
      c2d.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => { if (blob) downloadBlob(name, blob, 'image/png'); }, 'image/png');
    };
    img.src = url;
  }

  function exportTabChartsPNG() {
    const panel = document.getElementById('panel-' + App.state.activeTab);
    const cards = [...panel.querySelectorAll('.card')];
    let n = 0;
    for (const card of cards) {
      const svg = card.querySelector('svg');
      if (!svg) continue;
      const title = (card.querySelector('.card-title')?.textContent || 'chart').trim().replace(/\W+/g, '-').toLowerCase();
      setTimeout(() => svgToPng(svg, `amns-${title}.png`), n * 350);
      n++;
    }
    return n;
  }

  function openExportModal() {
    UI.Modal.open({
      title: 'Export — everything stays local', html: `
      <p>All exports are generated in this browser and saved as local downloads.
      Nothing is transmitted anywhere.</p>
      <div style="display:grid; gap:8px; margin-top:10px">
        <button class="btn btn-solid" data-export-charts>Charts on this tab → PNG</button>
        <button class="btn btn-outline" data-export-tab>Metrics on this tab (current filters) → CSV</button>
        <button class="btn btn-outline" data-export-all>Full filtered view — all metrics → CSV</button>
        <button class="btn btn-outline" data-export-print>Print pack → PDF (opens the print dialog)</button>
        <button class="btn btn-ghost" data-template-all>Upload templates + data dictionary</button>
      </div>
      <p class="chart-note" style="margin-top:8px">PNG exports render with the system font stack
      (noted in Methodology). Tile drill-downs offer their own row-level CSV download.</p>` });
  }

  return { templateCSV, downloadTemplate, downloadAllTemplates, dataDictionaryCSV, downloadDataDictionary,
           openTemplatesModal, openExportModal, exportTabCSV, exportAllCSV, exportTabChartsPNG, drillCSV, svgToPng };
})();
