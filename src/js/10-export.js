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

  return { templateCSV, downloadTemplate, downloadAllTemplates, dataDictionaryCSV, downloadDataDictionary, openTemplatesModal };
})();
