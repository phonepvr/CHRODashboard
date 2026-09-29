/* Field mapping (D1 / D2) — header auto-match, template detection, and the
   in-memory field map (seeds + source-system labels). Matches on HEADER NAMES
   only, never on cell values. A confirmed mapping renames the parsed headers to
   the canonical template names before CSV.applySchema, so validation and every
   metric run unchanged. Memory only: nothing here survives a reload. */

const Mapping = (() => {

  const THRESHOLD = 0.6;
  // canonical fields that identify or describe a person (PII chip on the mapping
  // step; their sample values follow the persona's identifier rule)
  const PII_KEYS = new Set(['employee_id', 'name', 'dob', 'gender', 'manager_id', 'nationality', 'disability_flag',
    'domicile_state', 'hired_employee_id', 'incumbent_id', 'successor_id', 'candidate_id', 'recruiter']);
  const FIELD_MAP_HEADERS = ['Template', 'Template Column', 'Source System', 'Source Field/Header', 'Required', 'Type', 'Status', 'Used by metrics'];

  // session-only preferences: schemaId -> Map(colKey -> {header, how}) and schemaId -> source label
  const seeds = new Map();
  const sources = new Map();

  /* ---------- similarity ---------- */

  function normHdr(s) {
    return String(s ?? '').replace(/ /g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function prep(s) {
    const n = normHdr(s);
    return { raw: s, n, ns: n.replace(/ /g, ''), pad: ' ' + n + ' ', toks: new Set(n ? n.split(' ') : []) };
  }

  // Substring matches only on whole words, and a one-word header is never taken
  // as a substring of a longer name ('Date' would otherwise match every date
  // field, 'ct' would match inside 'contract').
  function simPrepared(h, c) {
    if (!h.n || !c.n) return 0;
    if (h.n === c.n) return 1;
    if (h.ns === c.ns) return 0.97;
    if (h.pad.includes(c.pad) || (h.toks.size > 1 && c.pad.includes(h.pad))) return 0.86;
    let inter = 0;
    for (const t of h.toks) if (c.toks.has(t)) inter++;
    return inter ? inter / (h.toks.size + c.toks.size - inter) * 0.8 : 0;
  }

  const headerSimilarity = (header, candidate) => simPrepared(prep(header), prep(candidate));

  // per schema: one prepared candidate list (name + aka) per column, built once
  const candCache = new Map();
  function candidates(schemaId) {
    if (!candCache.has(schemaId)) {
      candCache.set(schemaId, SCHEMAS[schemaId].columns.map((c) => [c.name, ...(c.aka || [])].map(prep)));
    }
    return candCache.get(schemaId);
  }

  /* ---------- assignment ---------- */

  // -> {cols: Map(colKey -> {idx, header, score, how, via}), total, matched}
  // Seeds (imported field map / earlier manual choices) apply first; the rest is
  // greedy 1:1 by score over every (column, header) pair at or above THRESHOLD.
  function assign(schemaId, headers, hp = headers.map(prep), seedMap = seeds) {
    const cols = SCHEMAS[schemaId].columns;
    const cands = candidates(schemaId);
    const out = new Map();
    const usedH = new Set();
    const seed = seedMap.get(schemaId);
    if (seed) {
      for (const c of cols) {
        const s = seed.get(c.key);
        if (!s) continue;
        const want = normHdr(s.header);
        const idx = hp.findIndex((h, i) => !usedH.has(i) && h.n === want);
        if (idx < 0) continue;
        usedH.add(idx);
        const auto = Math.max(...cands[cols.indexOf(c)].map((k) => simPrepared(hp[idx], k)));
        out.set(c.key, { idx, header: headers[idx], score: 1, how: auto === 1 ? 'exact' : s.how, via: s.header });
      }
    }
    const pairs = [];
    cols.forEach((c, ci) => {
      if (out.has(c.key)) return;
      hp.forEach((h, hi) => {
        if (usedH.has(hi)) return;
        let best = 0, via = null;
        for (const k of cands[ci]) {
          const s = simPrepared(h, k);
          if (s > best) { best = s; via = k.raw; }
        }
        if (best >= THRESHOLD) pairs.push({ ci, hi, score: best, via });
      });
    });
    pairs.sort((a, b) => b.score - a.score || a.ci - b.ci || a.hi - b.hi);
    for (const p of pairs) {
      const key = cols[p.ci].key;
      if (out.has(key) || usedH.has(p.hi)) continue;
      usedH.add(p.hi);
      out.set(key, { idx: p.hi, header: headers[p.hi], score: p.score, how: p.score === 1 ? 'exact' : 'fuzzy', via: p.via });
    }
    let total = 0, matched = 0;
    for (const v of out.values()) if (v.header != null) { total += v.score; matched++; }
    return { cols: out, total, matched };
  }

  const baseName = (fileName) => normHdr(String(fileName || '').replace(/\.[^.]*$/, '')).replace(/ /g, '_');

  // Template detection: best total match score, floored by the template's
  // required-column count so tiny files cannot claim big templates; a file named
  // after a template wins near-ties. -> {schemaId, score, cover, assignment} | null
  function detect(headers, fileName) {
    const hp = headers.map(prep);
    const nHeaders = hp.filter((h) => h.n).length;
    const named = baseName(fileName);
    const scored = SCHEMA_IDS.map((id) => {
      const cols = SCHEMAS[id].columns;
      const a = assign(id, headers, hp);
      const required = cols.filter((c) => c.required).length;
      return { schemaId: id, score: a.total / Math.max(nHeaders, required, 1), cover: a.total / cols.length, assignment: a };
    }).filter((s) => s.assignment.matched >= 2 && s.score >= 0.5);
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score || b.cover - a.cover);
    const byName = scored.find((s) => s.schemaId === named);
    return byName && byName.score >= scored[0].score - 0.1 ? byName : scored[0];
  }

  // Manual pick of a header (index or null) for one field; keeps the map 1:1 —
  // a header taken from another field leaves that field unmapped.
  function setManual(cols, headers, schemaId, key, idx) {
    if (idx != null) {
      for (const [k, v] of cols) if (k !== key && v.idx === idx) cols.set(k, { idx: null, header: null, score: 0, how: 'manual' });
      const c = SCHEMAS[schemaId].columns.find((x) => x.key === key);
      const hp = prep(headers[idx]);
      const auto = Math.max(...[c.name, ...(c.aka || [])].map((k) => simPrepared(hp, prep(k))));
      cols.set(key, { idx, header: headers[idx], score: auto, how: 'manual' });
    } else {
      cols.set(key, { idx: null, header: null, score: 0, how: 'manual' });
    }
  }

  // Renamed copy of a parsed file: mapped headers take the canonical name,
  // unmapped ones get a prefix no template column can equal. Rows are shared.
  function applyMapping(parsed, schemaId, cols) {
    const byIdx = new Map();
    for (const c of SCHEMAS[schemaId].columns) {
      const v = cols.get(c.key);
      if (v && v.idx != null) byIdx.set(v.idx, c.name);
    }
    return { ...parsed, headers: parsed.headers.map((h, i) => byIdx.get(i) ?? '(unmapped) ' + h) };
  }

  function unmappedHeaders(headers, cols) {
    const used = new Set([...cols.values()].map((v) => v.idx).filter((i) => i != null));
    return headers.filter((h, i) => !used.has(i) && String(h).trim() !== '');
  }

  const missingRequired = (schemaId, cols) =>
    SCHEMAS[schemaId].columns.filter((c) => c.required && !(cols.get(c.key)?.header != null));

  // plain snapshot stored on the dataset (the Field Mapping tab reads it)
  function snapshot(fileName, parsed, schemaId, cols) {
    const out = {};
    for (const [k, v] of cols) if (v.header != null) out[k] = { header: v.header, how: v.how, score: v.score };
    return { fileName, schemaId, cols: out, unmapped: unmappedHeaders(parsed.headers, cols) };
  }

  // manual header picks carry over to the next load of the same template (this
  // session); a seed applies only when its header is present in the new file
  function remember(schemaId, cols) {
    for (const [k, v] of cols) if (v.how === 'manual' && v.header != null) seedOf(schemaId).set(k, { header: v.header, how: 'manual' });
  }
  function seedOf(schemaId) {
    if (!seeds.has(schemaId)) seeds.set(schemaId, new Map());
    return seeds.get(schemaId);
  }

  /* ---------- metric consumers ---------- */

  function consumers(schemaId, colName) {
    return REGISTRY
      .filter((e) => e.inputs.some((i) => i.dataset === schemaId && i.columns.includes(colName)))
      .map((e) => e.key);
  }

  // metrics whose every input column is mapped; `mapped` = Map(schemaId -> Set(column names))
  function coverage(mapped) {
    let full = 0, partial = 0;
    for (const e of REGISTRY) {
      const ok = e.inputs.map((i) => (mapped.has(i.dataset) ? i.columns.filter((c) => mapped.get(i.dataset).has(c)).length / i.columns.length : 0));
      if (ok.every((x) => x === 1)) full++;
      else if (ok.every((x, n) => mapped.has(e.inputs[n].dataset))) partial++;
    }
    return { full, partial, total: REGISTRY.length };
  }

  // Map(schemaId -> Set(mapped canonical names)) for the loaded datasets
  function loadedColumns() {
    const out = new Map();
    for (const [id, d] of App.state.datasets) {
      const cols = d.mapping ? d.mapping.cols : Object.fromEntries(SCHEMAS[id].columns.map((c) => [c.key, 1]));
      out.set(id, new Set(SCHEMAS[id].columns.filter((c) => cols[c.key]).map((c) => c.name)));
    }
    return out;
  }

  /* ---------- field_map.csv ---------- */

  const sourceOf = (schemaId) => sources.get(schemaId) || SCHEMAS[schemaId].source || '';
  function setSource(schemaId, value) {
    const v = String(value ?? '').trim();
    if (!v || v === SCHEMAS[schemaId].source) sources.delete(schemaId); else sources.set(schemaId, v);
  }

  // one row per template column: the current mapping, or the seed for a template not loaded
  function fieldMapRows() {
    const rows = [];
    for (const id of SCHEMA_IDS) {
      const d = App.state.datasets.get(id);
      const seed = seeds.get(id);
      for (const c of SCHEMAS[id].columns) {
        const cur = d ? (d.mapping ? d.mapping.cols[c.key] : { header: c.name, how: 'exact' }) : null;
        const next = seed?.get(c.key);
        const header = d ? cur?.header ?? '' : next?.header ?? '';
        const status = !d ? 'Not loaded' : cur ? 'Mapped' : c.required ? 'Missing' : 'Optional';
        rows.push({ schemaId: id, col: c, source: sourceOf(id), header, how: d ? cur?.how || null : next?.how || null, status,
          next: next && next.header != null && normHdr(next.header) !== normHdr(header) ? next.header : null,
          consumers: consumers(id, c.name) });
      }
    }
    return rows;
  }

  function fieldMapCSV() {
    return CSV.serialize(FIELD_MAP_HEADERS, fieldMapRows().map((r) => [
      r.schemaId + '.csv', r.col.name, r.source, r.header, r.col.required ? 'Yes' : 'No',
      Exports.typeLabel(r.col), r.status, r.consumers.join('; ') || '(context / joins)'
    ]));
  }

  const isFieldMap = (headers) => {
    const set = new Set(headers.map(normHdr));
    return ['template', 'template column', 'source field header'].every((h) => set.has(h));
  };

  // pre-seeds the next load; -> {mappings, templates, sources, skipped}
  function importFieldMap(text) {
    const parsed = CSV.parse(text);
    const at = (name) => parsed.headers.findIndex((h) => normHdr(h) === normHdr(name));
    const iT = at('Template'), iC = at('Template Column'), iS = at('Source System'), iH = at('Source Field/Header');
    const res = { mappings: 0, templates: new Set(), sources: 0, skipped: 0 };
    if (iT < 0 || iC < 0 || iH < 0) return { ...res, templates: 0, error: 'Not a field map — expected the columns Template, Template Column and Source Field/Header.' };
    const srcSeen = new Set();
    for (const r of parsed.rows) {
      const id = normHdr(String(r[iT] ?? '').replace(/\.csv$/i, '')).replace(/ /g, '_');
      const schema = SCHEMAS[id];
      const want = normHdr(r[iC]);
      const col = schema && schema.columns.find((c) => normHdr(c.name) === want || c.key === want.replace(/ /g, '_'));
      if (!col) { if (String(r[iT] ?? '').trim()) res.skipped++; continue; }
      if (iS >= 0 && String(r[iS] ?? '').trim() && !srcSeen.has(id)) { srcSeen.add(id); setSource(id, r[iS]); res.sources++; }
      const header = String(r[iH] ?? '').trim();
      if (!header) continue;
      seedOf(id).set(col.key, { header, how: 'imported' });
      res.mappings++;
      res.templates.add(id);
    }
    return { ...res, templates: res.templates.size };
  }

  const hasSeeds = () => [...seeds.values()].some((m) => m.size);

  return {
    THRESHOLD, PII_KEYS, FIELD_MAP_HEADERS,
    normHdr, headerSimilarity, assign, detect, setManual, applyMapping, unmappedHeaders, missingRequired,
    snapshot, remember, consumers, coverage, loadedColumns,
    sourceOf, setSource, fieldMapRows, fieldMapCSV, isFieldMap, importFieldMap, hasSeeds
  };
})();
