/* CSV engine — hand-rolled RFC4180 parser, schema application with row-level
   error collection, file→schema matching, and CSV serialisation.
   Everything runs in this browser tab; nothing is ever uploaded. */

const CSV = {

  // text -> { headers, rows, warnings }
  parse(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
    const rows = [];
    const warnings = [];
    let field = '', row = [], inQuotes = false, fieldStart = true, strayQuotes = 0;
    const pushField = () => { row.push(field); field = ''; fieldStart = true; };
    const pushRow = () => { rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else field += c;
      } else if (c === '"' && fieldStart) {
        // RFC4180: a quote opens a quoted field ONLY at the start of the field.
        inQuotes = true;
        fieldStart = false;
      } else if (c === ',') {
        pushField();
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        pushField(); pushRow();
      } else {
        // a quote mid-field is a literal character (e.g. an inch mark) — kept, not
        // treated as a delimiter, so the rest of the file is never swallowed.
        if (c === '"') strayQuotes++;
        field += c;
        fieldStart = false;
      }
    }
    if (field !== '' || row.length) { pushField(); pushRow(); }
    if (inQuotes) warnings.push('A quoted value was never closed — check for an unmatched double-quote; the last value may be truncated.');
    if (strayQuotes) warnings.push(`${strayQuotes} stray double-quote${strayQuotes > 1 ? 's' : ''} found mid-value and kept as literal characters — quote a whole field if it should contain commas or quotes.`);
    // drop fully-empty trailing rows
    while (rows.length && rows[rows.length - 1].every((v) => v.trim() === '')) rows.pop();
    if (!rows.length) return { headers: [], rows: [], warnings: ['File is empty.'] };
    const headers = rows[0].map((h) => h.trim());
    return { headers, rows: rows.slice(1), warnings };
  },

  // Which schema does this parsed file belong to? -> { schemaId, missing, unexpected } | null
  matchSchema(headers) {
    const set = new Set(headers.map((h) => h.toLowerCase()));
    let best = null;
    for (const id of SCHEMA_IDS) {
      const cols = SCHEMAS[id].columns.map((c) => c.name.toLowerCase());
      const hit = cols.filter((c) => set.has(c)).length;
      const score = hit / Math.max(cols.length, set.size);
      if (!best || score > best.score) best = { schemaId: id, score, hit };
    }
    if (!best || best.hit < 2 || best.score < 0.5) return null;
    const schema = SCHEMAS[best.schemaId];
    const want = new Set(schema.columns.map((c) => c.name.toLowerCase()));
    return {
      schemaId: best.schemaId,
      missing: schema.columns.filter((c) => !set.has(c.name.toLowerCase())).map((c) => c.name),
      unexpected: headers.filter((h) => !want.has(h.toLowerCase()))
    };
  },

  // Validate + coerce parsed rows against a schema.
  // -> { rows: Object[], errors: [{column, code, message, rows:[n…], count}], stats }
  applySchema(schemaId, parsed) {
    const schema = SCHEMAS[schemaId];
    const colIndex = new Map();
    parsed.headers.forEach((h, i) => colIndex.set(h.toLowerCase(), i));
    const errs = new Map(); // column|code -> {rows, count}
    const addErr = (column, code, message, rowNo) => {
      const k = column + '|' + code;
      if (!errs.has(k)) errs.set(k, { column, code, message, rows: [], count: 0 });
      const e = errs.get(k);
      e.count++;
      if (e.rows.length < 50) e.rows.push(rowNo);
    };
    const seenKeys = new Set();
    const out = [];
    parsed.rows.forEach((raw, i) => {
      const rowNo = i + 2; // 1-based + header row
      const rec = { __row: rowNo };
      let rowOk = true;
      for (const col of schema.columns) {
        const idx = colIndex.get(col.name.toLowerCase());
        const rawVal = idx == null ? '' : (raw[idx] ?? '').trim();
        let val = rawVal === '' ? null : rawVal;
        if (val == null) {
          if (col.required) { addErr(col.name, 'missing_required', `Missing required value in "${col.name}"`, rowNo); rowOk = false; }
        } else {
          switch (col.type) {
            case 'date': {
              const d = parseDMY(val);
              if (d == null) { addErr(col.name, 'bad_date', `Couldn't read "${col.name}" — expected DD-MM-YYYY`, rowNo); val = null; if (col.required) rowOk = false; }
              else val = d;
              break;
            }
            case 'month': {
              const m = parseMY(val);
              if (m == null) { addErr(col.name, 'bad_month', `Couldn't read "${col.name}" — expected MM-YYYY`, rowNo); val = null; if (col.required) rowOk = false; }
              else val = m;
              break;
            }
            case 'int': case 'num': case 'pct': {
              const n = Number(val.replace(/,/g, ''));
              if (!isFinite(n)) { addErr(col.name, 'bad_number', `Couldn't read "${col.name}" — expected a number`, rowNo); val = null; if (col.required) rowOk = false; }
              else if (col.type === 'pct' && (n < 0 || n > 100)) { addErr(col.name, 'bad_number', `"${col.name}" outside 0–100`, rowNo); val = null; }
              else val = n;
              break;
            }
            case 'flag': {
              const f = val.toUpperCase();
              if (f !== 'Y' && f !== 'N') { addErr(col.name, 'bad_enum', `"${col.name}" must be Y or N`, rowNo); val = null; }
              else val = f === 'Y';
              break;
            }
            case 'enum': {
              const allowed = ENUMS[col.enum];
              const hitIdx = allowed.findIndex((a) => a.toLowerCase() === val.toLowerCase());
              if (hitIdx < 0) { addErr(col.name, 'bad_enum', `"${col.name}" must be one of: ${allowed.join(' / ')}`, rowNo); val = null; if (col.required) rowOk = false; }
              else val = allowed[hitIdx];
              break;
            }
            default: /* id | text */ break;
          }
        }
        rec[col.key] = val;
      }
      if (schema.keyColumn && rec[schema.keyColumn] != null) {
        const k = rec[schema.keyColumn];
        if (seenKeys.has(k) && schemaId !== 'learning_events') {
          addErr(schema.columns.find((c) => c.key === schema.keyColumn).name, 'duplicate_key', `Duplicate ${schema.keyColumn.replace(/_/g, ' ')}`, rowNo);
        }
        seenKeys.add(k);
      }
      if (rowOk) out.push(rec);
    });
    return {
      rows: out,
      errors: [...errs.values()],
      stats: { totalRows: parsed.rows.length, acceptedRows: out.length, droppedRows: parsed.rows.length - out.length }
    };
  },

  // rows of arrays -> CSV text (quoting only where needed)
  serialize(headerRow, rows) {
    const cell = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [headerRow, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
};
