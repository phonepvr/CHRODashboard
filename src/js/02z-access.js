/* Personas & access policy (D8 / D9) — ONE policy table and ONE resolver.
   Access.levelFor(persona, entry) → 'full' | 'agg' | 'hidden', and every surface
   asks it: tiles, charts, "i" popovers, drill-downs, exports, print pack, exec
   summary, scorecard, search and the tab bar. The Access Matrix tab is generated
   from the same tables, so the documentation cannot drift from the behaviour.
   Fail-closed: an unknown persona, an unclassified metric or an unlisted tab is
   hidden (only a persona holding '*' sees unclassified metrics).
   MOCKUP ONLY — every loaded row still sits in this browser tab and anyone can
   switch persona; production must enforce this policy server/data-side. */

const ACCESS_LEVEL_LABEL = { full: 'Full', agg: 'Aggregate only', hidden: 'Restricted' };

// Registry groups → class. An entry's own `access` field overrides its group.
// New metrics (feature tabs) set `access: '<class id>'` on the entry itself.
const ACCESS_CLASSES = {
  core: {
    label: 'Core workforce', desc: 'Headcount, demographics, attrition, diversity, managers',
    groups: ['Workforce', 'Attrition rates', 'Early turnover', 'Exit quality', 'Gender by grade band', 'Gender in talent pools', 'Inclusion']
  },
  talent: {
    label: 'Talent pools & succession', desc: 'TT / CT / CP, succession, talent-cohort exits',
    groups: ['Top Talent', 'Succession', 'Critical Positions', 'Cohort attrition']
  },
  perf: {
    label: 'Performance & recognition', desc: 'Goal setting, mid-year / annual cycle, promotions, recognition',
    groups: ['Performance management', 'Recognition']
  },
  hiring: {
    label: 'Hiring & internal mobility', desc: 'Requisitions, TA pipeline, new joiners, internal job portal',
    groups: ['Hiring', 'Portal funnel', 'Process discipline']
  },
  learning: {
    label: 'Learning & development', desc: 'Coverage, intensity, IDPs, LMS, programme quality',
    groups: ['Learning coverage', 'Learning intensity', 'Development plans', 'Learning platform', 'Programme quality']
  },
  org: {
    label: 'Organisation, positions & movement', desc: 'Positions, HC budget, vacancies, employee movements',
    groups: []
  },
  attendance: {
    label: 'Absence & attendance', desc: 'Absenteeism, planned leave, attendance of the permanent roll',
    groups: []
  },
  ops: {
    label: 'Operations, safety & contract labour', desc: 'Productivity, safety, IR, contract workforce, statutory compliance',
    groups: ['Productivity, Cost & Safety', 'Deployment', 'Statutory compliance']
  },
  cost: {
    label: 'Cost & compensation', desc: 'Manpower cost, cost per tonne, L&D spend (key-level)',
    groups: []
  },
  wellbeing: {
    label: 'Wellbeing & special-category', desc: 'Counselling / distress aggregates, disability',
    groups: ['Wellbeing (aggregates)']
  }
};
const ACCESS_CLASS_IDS = Object.keys(ACCESS_CLASSES);

// Visible to every persona: loading/mapping is part of using the tool (D1) and
// metric definitions are not data.
const ALWAYS_TABS = new Set(['fieldmap', 'methodology']);

// scope: 'all' | 'asset' | 'segment' | 'asset+function'
// tabs:  '*' (every tab, minus hideTabs) or a list of tab ids (+ ALWAYS_TABS)
// levels: per access class; '*' applies to every class incl. unclassified
// pii:   'identified' | 'masked' | 'none'
// sections: optional narrowing inside a visible tab — scorecard: functions shown,
//        outlook: access classes of the panels shown (D8 "Scorecard (financial), Outlook cost")
// short: label for chips, footers and matrix column heads
const PERSONAS = [
  {
    id: 'chro', label: 'CHRO (Group)', short: 'CHRO (Group)', scope: 'all', tabs: '*', levels: { '*': 'full' }, pii: 'identified',
    who: 'Chief HR Officer and the Group HR leadership team — the default view.'
  },
  {
    id: 'asset_head', label: 'Asset HR Head', short: 'Asset HR Head', scope: 'asset', benchmark: true, tabs: '*', hideTabs: ['access'],
    levels: { core: 'full', talent: 'full', perf: 'full', hiring: 'full', learning: 'full', org: 'full', attendance: 'full', ops: 'full', cost: 'agg', wellbeing: 'agg' },
    pii: 'identified',
    who: 'HR Head of one asset. Group appears only as a benchmark; peer assets never appear.'
  },
  {
    id: 'segment_head', label: 'Business HR Head (Ops / Projects)', short: 'Business HR Head', scope: 'segment',
    tabs: ['overview', 'managers', 'positions', 'movement', 'absence', 'talent', 'performance', 'lnd', 'mobility', 'ta', 'joining', 'attrition'],
    levels: { core: 'full', talent: 'full', perf: 'full', hiring: 'full', learning: 'full', org: 'full', attendance: 'full', ops: 'agg', cost: 'hidden', wellbeing: 'hidden' },
    pii: 'identified',
    who: 'HR Head of one business segment (Operations or Projects) across all assets.'
  },
  {
    id: 'coe_ta', label: 'TA & Mobility COE', short: 'TA & Mobility COE', scope: 'all', landing: 'ta',
    tabs: ['overview', 'ta', 'joining', 'mobility', 'positions', 'attrition'],
    levels: { core: 'full', hiring: 'full', org: 'full', learning: 'agg', attendance: 'agg', ops: 'agg', talent: 'hidden', perf: 'hidden', cost: 'hidden', wellbeing: 'hidden' },
    pii: 'masked',
    who: 'Head of Talent Acquisition, recruitment and internal mobility.'
  },
  {
    id: 'coe_talent', label: 'Talent & L&D COE', short: 'Talent & L&D COE', scope: 'all', landing: 'talent',
    tabs: ['talent', 'performance', 'lnd', 'mobility', 'movement', 'diversity'],
    levels: { core: 'full', talent: 'full', perf: 'full', hiring: 'full', learning: 'full', org: 'full', attendance: 'agg', ops: 'agg', cost: 'agg', wellbeing: 'hidden' },
    pii: 'identified',
    who: 'Head of Talent Management (TT / CT, succession, performance cycle) and L&D.'
  },
  {
    id: 'coe_cnb', label: 'C&B / HR Finance', short: 'C&B / HR Finance', scope: 'all',
    tabs: ['overview', 'positions', 'scorecard', 'outlook'],
    levels: { cost: 'full', org: 'full', core: 'agg', perf: 'agg', hiring: 'agg', learning: 'agg', attendance: 'agg', ops: 'agg', talent: 'hidden', wellbeing: 'hidden' },
    sections: { scorecard: ['Financial Indicators'], outlook: ['cost'] },
    pii: 'none',
    who: 'Head of Compensation & Benefits, HR cost and manpower budgeting.'
  },
  {
    id: 'hrops', label: 'HR Ops, IR & Shared Services', short: 'HR Ops & IR', scope: 'all', landing: 'contract',
    tabs: ['contract', 'absence', 'movement', 'quality'],
    levels: { core: 'full', ops: 'full', attendance: 'full', org: 'full', hiring: 'agg', learning: 'agg', cost: 'agg', wellbeing: 'agg', talent: 'hidden', perf: 'hidden' },
    pii: 'masked',
    who: 'Head of HR Operations, Industrial Relations, Shared Services and contract-labour compliance; data steward for uploads.'
  },
  {
    id: 'hrbp', label: 'HR Business Partner', short: 'HRBP', scope: 'asset+function',
    tabs: ['overview', 'talent', 'performance', 'lnd', 'attrition', 'absence', 'managers'],
    levels: { core: 'full', perf: 'full', learning: 'full', attendance: 'full', org: 'full', talent: 'agg', hiring: 'agg', cost: 'hidden', ops: 'hidden', wellbeing: 'hidden' },
    pii: 'masked',
    who: 'HRBP for one asset and one line function.'
  }
];
const PERSONA_BY_ID = new Map(PERSONAS.map((p) => [p.id, p]));

// Asset-month panels carry no Function attribute: under a function scope their
// metrics cannot be narrowed, so they resolve to "not available at this scope".
const NO_FUNCTION_DATASETS = new Set(['production_safety', 'contract_attendance', 'contract_compliance', 'wellbeing', 'statutory_compliance']);

// Drill / detail-table columns that identify a person. IDs are pseudonymised
// under 'masked'; name columns are dropped. A drill may declare its own
// {pii: {ids: [...], names: [...]}} to override the detection.
const PII_ID_COLUMNS = new Set(['Employee', 'Employee ID', 'Employee Code', 'Applicant', 'Incumbent', 'Incumbent ID', 'Successor', 'Successor ID', 'Manager', 'Manager ID', 'Candidate', 'Candidate ID']);
const PII_NAME_COLUMNS = new Set(['Name', 'Employee Name', 'Manager Name', 'Candidate Name', 'Incumbent Name']);

const Access = (() => {

  const NO_ACCESS = { id: '(unknown)', label: 'Unknown persona', scope: 'all', tabs: [], levels: {}, pii: 'none', who: '' };
  const CLASS_BY_GROUP = new Map();
  for (const [id, c] of Object.entries(ACCESS_CLASSES)) for (const g of c.groups) CLASS_BY_GROUP.set(g, id);

  // per-session salt: pseudonyms are stable within this tab, unlinkable across
  // reloads. crypto.getRandomValues — no storage, no network.
  const SALT = (() => {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return a[0].toString(36) + a[1].toString(36);
  })();

  const personaOf = (p) => (typeof p === 'string' ? PERSONA_BY_ID.get(p) : p) || NO_ACCESS;
  const binding = () => App.state.persona || { id: 'chro' };
  const current = () => personaOf(binding().id);
  const entryOf = (e) => (typeof e === 'string' ? REG_BY_KEY.get(e) : e);

  function classOf(entry) {
    const e = entryOf(entry);
    if (!e) return null;
    if (e.access) return ACCESS_CLASSES[e.access] ? e.access : null;
    return CLASS_BY_GROUP.get(e.group) || null;
  }

  function levelForClass(persona, classId) {
    const p = personaOf(persona);
    const l = (classId && p.levels[classId]) || p.levels['*'] || 'hidden';
    return ACCESS_LEVEL_LABEL[l] ? l : 'hidden';
  }

  function levelFor(persona, entry) {
    const e = entryOf(entry);
    if (!e) return 'hidden';
    return levelForClass(persona, classOf(e));
  }

  // the level surfaces actually serve: an asset-grain source (no Function
  // attribute) cannot be narrowed to a line function, so it is Restricted there
  function grainBlocked(persona, entry) {
    const e = entryOf(entry);
    return !!e && scopeHas(personaOf(persona), 'function') && e.inputs.some((i) => NO_FUNCTION_DATASETS.has(i.dataset));
  }
  const effectiveLevelFor = (persona, entry) => (grainBlocked(persona, entry) ? 'hidden' : levelFor(persona, entry));

  // a persona's narrowing inside a visible tab (scorecard functions, outlook classes)
  function sectionAllowedFor(persona, area, id) {
    const list = personaOf(persona).sections?.[area];
    return !list || list.includes(id);
  }
  const sectionAllowed = (area, id) => sectionAllowedFor(current(), area, id);

  const level = (entry) => levelFor(current(), entry);
  const canSee = (entry) => level(entry) !== 'hidden';
  const canDrill = (entry) => { const e = entryOf(entry); return !!(e && e.drill && level(e) === 'full'); };

  function tabVisibleFor(persona, tabId) {
    const p = personaOf(persona);
    if (!TABS.some((t) => t.id === tabId)) return false;
    if (p === NO_ACCESS) return false;
    if (ALWAYS_TABS.has(tabId)) return true;
    if (p.tabs === '*') return !(p.hideTabs || []).includes(tabId);
    return p.tabs.includes(tabId);
  }
  const canSeeTab = (tabId) => tabVisibleFor(current(), tabId);

  function landingTab() {
    const p = current();
    const vis = TABS.filter((t) => canSeeTab(t.id));
    if (p.landing && canSeeTab(p.landing)) return p.landing;
    if (canSeeTab('overview')) return 'overview';
    const content = vis.find((t) => !ALWAYS_TABS.has(t.id));
    return (content || vis[0] || TABS[0]).id;
  }

  /* ---------- scope ---------- */

  const scopeHas = (p, dim) => p.scope === dim || (p.scope === 'asset+function' && (dim === 'asset' || dim === 'function'));
  const lockedAsset = () => (scopeHas(current(), 'asset') ? binding().asset || CONFIG.assets[0] : null);
  const lockedSegment = () => (scopeHas(current(), 'segment') ? binding().segment || CONFIG.segments[0] : null);
  // an unbound function scope matches nothing rather than everything
  const lockedFunction = () => (scopeHas(current(), 'function') ? binding().fn || '(unassigned)' : null);

  // may a computation context be served to this persona?
  function ctxAllowed(ctx) {
    const a = lockedAsset();
    if (a && ctx.asset !== a && !(ctx.asset === 'Group' && current().benchmark)) return false;
    const s = lockedSegment();
    if (s && ctx.segment !== s) return false;
    const f = lockedFunction();
    if (f && ctx.fn !== f) return false;
    return true;
  }

  const canFocusAsset = (a) => !lockedAsset() || a === lockedAsset();
  // assets a chart may draw: peers never appear for an asset-locked persona
  function chartScopes() {
    const a = lockedAsset();
    if (!a) return [...CONFIG.assets, 'Group'];
    return current().benchmark ? [a, 'Group'] : [a];
  }
  function printScopes() {
    const a = lockedAsset();
    return a ? [a] : ['Group', ...CONFIG.assets];
  }

  // the largest line function at the bound asset (HRBP default binding)
  function defaultFunction(asset) {
    const rows = App.state.datasets.get('employee_master')?.rows || [];
    const counts = new Map();
    for (const e of rows) if (e.function && (!asset || e.asset === asset)) counts.set(e.function, (counts.get(e.function) || 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] || null;
  }
  function functionsAt(asset) {
    const rows = App.state.datasets.get('employee_master')?.rows || [];
    return [...new Set(rows.filter((e) => e.function && (!asset || e.asset === asset)).map((e) => e.function))].sort();
  }

  /* ---------- labels ---------- */

  function scopeLabel(persona, b) {
    const p = personaOf(persona);
    b = b || {};
    switch (p.scope) {
      case 'asset': return `Own asset${b.asset ? ' (' + b.asset + ')' : ''}${p.benchmark ? ' · Group as benchmark' : ''}`;
      case 'segment': return `Own business segment${b.segment ? ' (' + b.segment + ')' : ''}`;
      case 'asset+function': return `Own asset + line function${b.asset ? ' (' + b.asset + (b.fn ? ' · ' + b.fn : '') + ')' : ''}`;
      default: return 'All assets and segments';
    }
  }
  const PII_LABEL = { identified: 'Identifiers shown', masked: 'Identifiers masked (pseudonyms)', none: 'No row-level detail' };

  function label() {
    const p = current(), b = binding();
    const bind = p.scope === 'asset' ? b.asset || lockedAsset()
      : p.scope === 'segment' ? b.segment || lockedSegment()
      : p.scope === 'asset+function' ? [lockedAsset(), b.fn].filter(Boolean).join(' · ')
      : '';
    return (p.short || p.label) + (bind ? ' · ' + bind : '');
  }
  const isDefault = () => current().id === 'chro';
  const token = () => { const b = binding(); return [b.id, lockedAsset() || '', lockedSegment() || '', lockedFunction() || ''].join(':'); };
  const fileSuffix = () => (isDefault() ? '' : '-' + current().id);

  function counts(persona) {
    const out = { full: 0, agg: 0, hidden: 0 };
    for (const e of REGISTRY) out[effectiveLevelFor(persona, e)]++;
    return out;
  }

  /* ---------- identifiers (D9) ---------- */

  const pii = () => current().pii || 'none';

  // FNV-1a alone maps near-identical IDs to near-identical hashes (order and
  // adjacency would show through the mask); the murmur3 finaliser avalanches it.
  function fmix32(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  // six hex digits collide within a few thousand IDs: the session maps keep
  // each token unique (a clash re-hashes with a counter), memory only
  const tokenById = new Map(), idByToken = new Map();
  function pseudonym(id, prefix = 'EMP') {
    if (id == null || id === '') return id;
    const key = prefix + '|' + id;
    let t = tokenById.get(key);
    if (t) return t;
    for (let i = 0; !t || idByToken.has(t); i++) {
      t = prefix + '-' + fmix32(hash32(SALT + '|' + id + (i ? '|' + i : ''))).toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
    }
    tokenById.set(key, t);
    idByToken.set(t, key);
    return t;
  }

  // → {columns, rows} with identifiers handled for the persona, or null when the
  // persona may see no row-level detail at all.
  function maskTable(columns, rows, spec) {
    const ids = new Set(spec?.ids || columns.filter((c) => PII_ID_COLUMNS.has(c)));
    const names = new Set(spec?.names || columns.filter((c) => PII_NAME_COLUMNS.has(c)));
    const level = pii();
    if (level === 'identified' || (!ids.size && !names.size)) return { columns, rows };
    if (level !== 'masked') return null;
    const keep = columns.map((c, i) => (names.has(c) ? -1 : i)).filter((i) => i >= 0);
    const idIdx = new Set(columns.map((c, i) => (ids.has(c) ? i : -1)).filter((i) => i >= 0));
    const plain = (v) => (v && typeof v === 'object' && 'html' in v ? String(v.html).replace(/<[^>]*>/g, '') : v);
    return {
      columns: keep.map((i) => columns[i]),
      rows: rows.map((r) => keep.map((i) => {
        if (!idIdx.has(i)) return r[i];
        const v = plain(r[i]);
        if (v == null || v === '' || /^\(.*\)$/.test(String(v))) return v;   // '(vacant)', '(blank)'
        return pseudonym(v, /^Candidate/.test(columns[i]) ? 'CAN' : 'EMP');
      }))
    };
  }

  function maskDrill(d) {
    if (!d) return d;
    const t = maskTable(d.columns, d.rows, d.pii);
    if (!t) return null;
    if (t.columns === d.columns && t.rows === d.rows) return d;
    return { ...d, ...t, title: d.title + ' — identifiers masked' };
  }

  // small-cell suppression on persona-restricted views (CONFIG.minCell)
  const suppressionOn = () => !isDefault();
  const suppressed = (n) => suppressionOn() && n != null && n > 0 && n < CONFIG.minCell;
  const cellText = (n, fmt = fmtInt) => (suppressed(n) ? `<${CONFIG.minCell}` : fmt(n));

  /* ---------- restricted-state markup ---------- */

  const LOCK_SVG = '<svg class="lock-ico" viewBox="0 0 12 14" width="11" height="13" aria-hidden="true"><rect x="1" y="6" width="10" height="7.5" fill="currentColor"/><path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

  function restrictedReason(res) {
    const e = res.entry;
    if (res.restricted === 'scope') return 'Outside this persona’s data scope';
    if (res.restricted === 'grain') return 'Asset-level source — not available at line-function scope';
    if (res.restricted === 'section') return 'Outside this persona’s sections of this tab';
    return (ACCESS_CLASSES[classOf(e)]?.label || 'Unclassified metric') + ' · not in this persona’s profile';
  }

  function restrictedChartHTML(what) {
    return `<div class="chart-empty chart-restricted">${LOCK_SVG} Restricted for ${esc(label())}${what ? ' — ' + esc(what) : ''}</div>`;
  }

  // level of a chart card: explicit class wins, else its metric key; fail-closed
  function cardLevel(infoKey, classId) {
    if (classId) return levelForClass(current(), classId);
    if (infoKey && REG_BY_KEY.has(infoKey)) return level(infoKey);
    return levelForClass(current(), null);
  }

  function describe(entry) {
    const e = entryOf(entry);
    const cls = ACCESS_CLASSES[classOf(e)]?.label || 'Unclassified';
    const l = level(e);
    return `${cls} · ${ACCESS_LEVEL_LABEL[l]} for ${label()}${l === 'full' ? ' · ' + PII_LABEL[pii()].toLowerCase() : ''}`;
  }

  return {
    classOf, levelFor, levelForClass, effectiveLevelFor, grainBlocked, sectionAllowed, sectionAllowedFor, level, canSee, canDrill,
    tabVisibleFor, canSeeTab, landingTab,
    lockedAsset, lockedSegment, lockedFunction, ctxAllowed, canFocusAsset, chartScopes, printScopes,
    defaultFunction, functionsAt,
    persona: current, personaOf, label, scopeLabel, isDefault, token, fileSuffix, counts, describe,
    pii, PII_LABEL, pseudonym, maskTable, maskDrill,
    suppressionOn, suppressed, cellText,
    LOCK_SVG, restrictedReason, restrictedChartHTML, cardLevel
  };
})();
