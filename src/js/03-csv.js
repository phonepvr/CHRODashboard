/* CSV engine — hand-rolled RFC4180 parser, schema application with row-level
   error collection, file→schema matching, and CSV serialisation.
   Everything runs in this browser tab; nothing is ever uploaded. */

// enum comparison: case-insensitive, any dash (– — ‐ -) with or without spaces
function enumNorm(s) {
  return String(s).toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}

const CSV = {

  // text -> { headers, rows, warnings }
  // Scans delimiter-to-delimiter and slices (never char-by-char concatenation):
  // the mock alone is ~10 MB of CSV, so this sits on the load-time budget.
  parse(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
    const rows = [];
    const warnings = [];
    const n = text.length;
    const SPECIAL = /[,\r\n"]/g;
    let field = '', row = [], fieldStart = true, strayQuotes = 0, unclosed = false, i = 0;
    while (i < n) {
      if (fieldStart && text.charCodeAt(i) === 34) {
        // RFC4180: a quote opens a quoted field ONLY at the start of the field.
        let j = i + 1;
        for (;;) {
          const q = text.indexOf('"', j);
          if (q < 0) { field += text.slice(j); j = n; unclosed = true; break; }
          field += text.slice(j, q);
          if (text.charCodeAt(q + 1) === 34) { field += '"'; j = q + 2; } else { j = q + 1; break; }
        }
        i = j;
        fieldStart = false;
        continue;
      }
      SPECIAL.lastIndex = i;
      const m = SPECIAL.exec(text);
      const end = m ? m.index : n;
      if (end > i) { field += text.slice(i, end); fieldStart = false; }
      if (end === n) break;
      const c = text.charCodeAt(end);
      i = end + 1;
      if (c === 34) {
        // a quote mid-field is a literal character (e.g. an inch mark) — kept, not
        // treated as a delimiter, so the rest of the file is never swallowed.
        strayQuotes++;
        field += '"';
        continue;
      }
      row.push(field); field = ''; fieldStart = true;
      if (c === 44) continue;
      if (c === 13 && text.charCodeAt(i) === 10) i++;
      rows.push(row); row = [];
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    if (unclosed) warnings.push('A quoted value was never closed — check for an unmatched double-quote; the last value may be truncated.');
    if (strayQuotes) warnings.push(`${strayQuotes} stray double-quote${strayQuotes > 1 ? 's' : ''} found mid-value and kept as literal characters — quote a whole field if it should contain commas or quotes.`);
    // drop fully-empty trailing rows
    while (rows.length && rows[rows.length - 1].every((v) => v.trim() === '')) rows.pop();
    if (!rows.length) return { headers: [], rows: [], warnings: ['File is empty.'] };
    const headers = rows[0].map((h) => h.trim());
    return { headers, rows: rows.slice(1), warnings };
  },

  // Which schema does this parsed file belong to? -> { schemaId, score, cols, missing, unexpected } | null
  // Delegates to the field-mapping engine (03a-mapping.js): header similarity
  // against each column's name + `aka` synonyms, greedy 1:1, best total score
  // floored by the required-column count. Optional columns therefore never stop
  // a legacy file (written before they existed) from routing.
  matchSchema(headers, fileName) {
    const best = Mapping.detect(headers, fileName);
    if (!best) return null;
    const cols = best.assignment.cols;
    return {
      schemaId: best.schemaId, score: best.score, cols,
      missing: SCHEMAS[best.schemaId].columns.filter((c) => cols.get(c.key)?.header == null).map((c) => c.name),
      unexpected: Mapping.unmappedHeaders(headers, cols)
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
    // per-column plan, resolved once; dates/months/enums repeat heavily, so
    // their coercion is memoised per distinct raw value
    const plan = schema.columns.map((col) => ({
      col,
      idx: colIndex.get(col.name.toLowerCase()),
      memo: col.type === 'date' || col.type === 'month' || col.type === 'enum' ? new Map() : null,
      allowed: col.type === 'enum' ? new Map(ENUMS[col.enum].map((v) => [enumNorm(v), v])) : null
    }));
    const seenKeys = new Set();
    const out = [];
    parsed.rows.forEach((raw, i) => {
      const rowNo = i + 2; // 1-based + header row
      const rec = { __row: rowNo };
      let rowOk = true;
      for (const { col, idx, memo, allowed } of plan) {
        const rawVal = idx == null ? '' : (raw[idx] ?? '').trim();
        let val = rawVal === '' ? null : rawVal;
        if (val == null) {
          if (col.required) { addErr(col.name, 'missing_required', `Missing required value in "${col.name}"`, rowNo); rowOk = false; }
        } else {
          switch (col.type) {
            case 'date': {
              let d = memo.get(val);
              if (d === undefined) { d = parseDMY(val); memo.set(val, d); }
              if (d == null) { addErr(col.name, 'bad_date', `Couldn't read "${col.name}" — expected DD-MM-YYYY`, rowNo); val = null; if (col.required) rowOk = false; }
              else val = d;
              break;
            }
            case 'month': {
              let m = memo.get(val);
              if (m === undefined) { m = parseMY(val); memo.set(val, m); }
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
              let hit = memo.get(val);
              if (hit === undefined) { hit = allowed.get(enumNorm(val)) ?? null; memo.set(val, hit); }
              if (hit == null) { addErr(col.name, 'bad_enum', `"${col.name}" must be one of: ${ENUMS[col.enum].join(' / ')}`, rowNo); val = null; if (col.required) rowOk = false; }
              else val = hit;
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
      if (typeof v === 'number') return String(v);
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headerRow.map(cell).join(',')];
    for (const r of rows) lines.push(r.map(cell).join(','));
    return lines.join('\r\n') + '\r\n';
  }
};
