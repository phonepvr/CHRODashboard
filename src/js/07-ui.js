/* UI managers: tabs, the "i" popover singleton, the drill-down modal singleton,
   and the shared tile renderer. Keyboard contract for the "i" pattern:
   focusable button, Enter/Space opens, Esc closes, aria-expanded kept true/false,
   focus returns to the trigger on close. */

// Grouped navigation (PHASE8_PLAN "Navigation"). Landing = Overview (or the
// persona's landing tab); Field Mapping sits first as the setup step.
const TAB_GROUPS = [
  { label: 'Setup', tabs: [{ id: 'fieldmap', label: 'Field Mapping' }] },
  { label: 'Executive', tabs: [{ id: 'overview', label: 'Overview' }, { id: 'scorecard', label: 'CHRO Scorecard' }, { id: 'outlook', label: 'Outlook' }] },
  { label: 'Workforce', tabs: [{ id: 'managers', label: 'Managers' }, { id: 'positions', label: 'Positions & Budget' }, { id: 'movement', label: 'Movement' }, { id: 'absence', label: 'Absenteeism' }] },
  { label: 'Talent', tabs: [{ id: 'talent', label: 'Talent Management' }, { id: 'performance', label: 'Performance' }, { id: 'lnd', label: 'L&D' }, { id: 'mobility', label: 'Internal Mobility' }] },
  { label: 'Acquisition & Retention', tabs: [{ id: 'ta', label: 'TA Pipeline' }, { id: 'joining', label: 'New Joining' }, { id: 'attrition', label: 'Attrition' }, { id: 'diversity', label: 'Diversity' }] },
  { label: 'Operations', tabs: [{ id: 'contract', label: 'Contract & Compliance' }] },
  { label: 'Governance', tabs: [{ id: 'quality', label: 'Data Quality' }, { id: 'methodology', label: 'Methodology' }, { id: 'access', label: 'Access Matrix' }] }
];
const TABS = TAB_GROUPS.flatMap((g) => g.tabs.map((t) => ({ ...t, group: g.label })));
// employee-keyed tabs — the grade-band filter applies; the segment filter applies everywhere
const GRADE_FILTER_TABS = new Set(['overview', 'scorecard', 'managers', 'movement', 'absence', 'talent', 'performance', 'lnd', 'mobility', 'joining', 'attrition', 'diversity']);

const TabRenderers = {}; // id -> (containerEl) => void

const UI = (() => {

  /* ---------- tabs ---------- */

  let tabbarWired = false;
  const visibleTabs = () => TABS.filter((t) => Access.canSeeTab(t.id));

  // Tabs a persona may not see are never rendered (no button, no panel).
  function renderTabbar() {
    const tl = document.getElementById('tablist');
    const vis = new Set(visibleTabs().map((t) => t.id));
    if (!vis.has(App.state.activeTab)) App.state.activeTab = Access.landingTab();
    const active = App.state.activeTab;
    tl.innerHTML = TAB_GROUPS.map((g, gi) => {
      const tabs = g.tabs.filter((t) => vis.has(t.id));
      if (!tabs.length) return '';
      return `<div class="tabgroup" role="presentation">
        <span class="tabgroup-label" id="tabgroup-${gi}" aria-hidden="true">${esc(g.label)}</span>
        <div class="tabgroup-tabs" role="presentation">${tabs.map((t) =>
          `<button role="tab" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-describedby="tabgroup-${gi}"
            aria-selected="${t.id === active}" tabindex="${t.id === active ? 0 : -1}"
            data-tabid="${t.id}">${esc(t.label)}</button>`).join('')}</div>
      </div>`;
    }).join('');
    document.getElementById('tab-panels').innerHTML = [...vis].map((id) =>
      `<section role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}"
        ${id === active ? '' : 'hidden'}></section>`).join('');
    App.state.renderedTabs.clear();
    syncBandFilterApplicability();
    if (tabbarWired) return;
    tabbarWired = true;
    tl.addEventListener('click', (e) => {
      const b = e.target.closest('[role="tab"]');
      if (b) activateTab(b.dataset.tabid);
    });
    // roving tabindex across every visible tab, regardless of group
    tl.addEventListener('keydown', (e) => {
      const list = visibleTabs();
      const idx = list.findIndex((t) => t.id === App.state.activeTab);
      let next = null;
      if (e.key === 'ArrowRight') next = (idx + 1) % list.length;
      else if (e.key === 'ArrowLeft') next = (idx + list.length - 1) % list.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      if (next == null) return;
      e.preventDefault();
      activateTab(list[next].id);
      const btn = document.getElementById('tab-' + list[next].id);
      btn.focus();
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function activateTab(id) {
    if (!Access.canSeeTab(id)) return;
    App.state.activeTab = id;
    for (const t of visibleTabs()) {
      const tab = document.getElementById('tab-' + t.id);
      const panel = document.getElementById('panel-' + t.id);
      if (!tab || !panel) continue;
      const sel = t.id === id;
      tab.setAttribute('aria-selected', sel);
      tab.tabIndex = sel ? 0 : -1;
      panel.hidden = !sel;
    }
    renderActiveTab();
    syncBandFilterApplicability();
  }

  function renderActiveTab() {
    const id = App.state.activeTab;
    if (App.state.renderedTabs.has(id)) return;
    const panel = document.getElementById('panel-' + id);
    if (!panel || !Access.canSeeTab(id)) return;
    (TabRenderers[id] || ((p) => placeholder(p, id)))(panel);
    App.state.renderedTabs.add(id);
  }

  // clean stand-in for feature tabs not built yet (their own tab file replaces it)
  function placeholder(panel, id) {
    const t = TABS.find((x) => x.id === id);
    panel.innerHTML = `<div class="section-head"><h2>${esc(t ? t.label : id)}</h2>
        <span class="sub">${esc(t ? t.group : '')}</span></div>
      <div class="empty-note placeholder-note">This section is being built — see docs/PHASE8_PLAN.md</div>`;
  }

  function invalidateTabs() {
    App.state.renderedTabs.clear();
    Compute.invalidate();
    renderActiveTab();
    if (typeof PrintPack !== 'undefined') PrintPack.markDirty();
  }

  function syncBandFilterApplicability() {
    const sel = document.getElementById('sel-band');
    const applies = GRADE_FILTER_TABS.has(App.state.activeTab);
    sel.disabled = !applies;
    sel.title = applies ? '' : 'Grade-band filter applies to employee-keyed tabs only';
  }

  /* ---------- "i" popover ---------- */

  const Popover = (() => {
    const root = () => document.getElementById('popover-root');
    let trigger = null;

    function open(btn, html) {
      close();
      trigger = btn;
      btn.setAttribute('aria-expanded', 'true');
      const el = document.createElement('div');
      el.className = 'popover';
      el.setAttribute('role', 'dialog');
      el.innerHTML = `<button class="po-close" aria-label="Close">×</button>` + html;
      root().appendChild(el);
      const r = btn.getBoundingClientRect();
      const w = el.offsetWidth;
      let left = Math.min(r.left, window.innerWidth - w - 12);
      el.style.top = (r.bottom + window.scrollY + 6) + 'px';
      el.style.left = Math.max(8, left + window.scrollX) + 'px';
      el.querySelector('.po-close').addEventListener('click', close);
      setTimeout(() => {
        document.addEventListener('click', onDocClick, true);
        document.addEventListener('keydown', onKey, true);
      }, 0);
      el.querySelector('.po-close').focus();
    }
    function onDocClick(e) {
      if (!root().contains(e.target) && e.target !== trigger) close();
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    function close() {
      if (!root().childElementCount) return;
      root().innerHTML = '';
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
      if (trigger) { trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); trigger = null; }
    }
    return { open, close };
  })();

  /* ---------- modal ---------- */

  const Modal = (() => {
    const root = () => document.getElementById('modal-root');
    let lastFocus = null;

    function open({ title, html }) {
      lastFocus = document.activeElement;
      root().innerHTML = `
        <div class="modal-backdrop">
          <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
            <div class="modal-head"><h3>${esc(title)}</h3>
              <button class="po-close" aria-label="Close">×</button></div>
            <div class="modal-body">${html}</div>
          </div>
        </div>`;
      const bd = root().firstElementChild;
      bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
      bd.querySelector('.po-close').addEventListener('click', close);
      document.addEventListener('keydown', onKey, true);
      bd.querySelector('.po-close').focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') { // basic focus trap
        const f = root().querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    function close() {
      root().innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      if (lastFocus) { lastFocus.focus(); lastFocus = null; }
    }
    return { open, close };
  })();

  /* ---------- shared tile renderer ---------- */

  function fmtMetric(entry, v) {
    if (v == null || !isFinite(v)) return '—';
    if (entry.unit === '%') return `${fmtNum(v, entry.decimals)}<span class="unit">%</span>`;
    if (entry.unit === '₹') return esc(fmtINR(v));
    if (entry.unit === 't') return `${fmtInt(v)}<span class="unit">t</span>`;
    if (entry.unit === 'd') return `${fmtNum(v, entry.decimals)}<span class="unit">days</span>`;
    if (entry.decimals === 0) return fmtInt(v);
    return fmtNum(v, entry.decimals);
  }

  function targetMeta(entry, res) {
    if (!entry.direction) return '';
    if (!res.target || res.target.value == null) return `<span>Target not set</span>`;
    const t = res.target.value, v = res.value;
    if (v == null) return `<span>Target ${fmtNum(t, entry.decimals)}</span>`;
    const dir = res.target.direction || entry.direction;
    const met = dir === 'higher' ? v >= t : v <= t;
    return `<span class="${met ? 'good' : 'bad'}">${met ? '●' : '▲'} target ${fmtNum(t, entry.decimals)}${entry.unit === '%' ? '%' : ''}</span>`;
  }

  function tileHTML(key) {
    const res = Compute.metric(key);
    const entry = res.entry;
    if (!entry) return '';
    const iBtn = `<button class="i-btn ${res.quality ? 'i-warn' : ''}" data-info="${entry.key}"
      aria-expanded="false" aria-label="About ${esc(entry.label)}: formula and inputs">i</button>`;
    // restricted: label + lock only — no value, spark, quality text or drill
    if (res.restricted) {
      const who = Access.label();
      return `<div class="tile is-restricted" data-key="${entry.key}" data-restricted="${esc(res.restricted)}">
        <span class="tile-label">${esc(entry.label)}</span>${iBtn}
        <span class="tile-value tile-lock">${Access.LOCK_SVG} Restricted for ${esc(who)}</span>
        <span class="tile-meta">${esc(Access.restrictedReason(res))}</span>
      </div>`;
    }
    if (!res.available) {
      const missing = entry.inputs.filter((i) => !App.state.datasets.has(i.dataset)).map((i) => i.dataset + '.csv');
      return `<div class="tile is-empty" data-key="${entry.key}">
        <span class="tile-label">${esc(entry.label)}</span>${iBtn}
        <span class="tile-value">No data loaded for this metric</span>
        <span class="tile-meta">needs ${esc(missing.join(', '))}</span>
      </div>`;
    }
    const sparkHtml = res.spark ? Charts.spark(res.spark) : '';
    // 'agg' = the value, but no drill and no row-level detail
    const drillable = Access.canDrill(entry);
    const agg = res.level === 'agg';
    // a suppressed share has no "<5" reading: the percentage is withheld outright
    const share = res.suppressed && entry.unit === '%';
    const value = share ? `Withheld — a cell below ${CONFIG.minCell}` : res.suppressed ? `&lt;${CONFIG.minCell}` : fmtMetric(entry, res.value);
    return `<div class="tile ${res.quality ? 'is-alert-quality' : ''}" data-key="${entry.key}" ${drillable ? `data-drill="${entry.key}" tabindex="0" role="button" aria-label="${esc(entry.label)} — open detail"` : ''}>
      <span class="tile-label">${esc(entry.label)}${entry.source ? ` <span class="tile-src">[${esc(entry.source)}]</span>` : ''}</span>
      ${iBtn}
      <span class="tile-value${share ? ' tile-lock' : ''}">${value}</span>
      ${sparkHtml}
      <span class="tile-meta">${targetMeta(entry, res)}${agg ? '<span class="tile-badge">Aggregate only</span>' : ''}${res.suppressed ? '<span class="tile-badge">Small cell</span>' : ''}</span>
      ${res.quality ? `<span class="tile-quality">${esc(res.quality)}</span>` : ''}
    </div>`;
  }

  // Definitions are public (they are on Methodology); values and quality notes
  // of a restricted metric are not.
  function popoverHTML(key) {
    const res = Compute.metric(key);
    const e = res.entry;
    const inputs = e.inputs.map((i) =>
      `<div>${esc(i.dataset)}.csv — ${esc(i.columns.join(', '))}${App.state.datasets.has(i.dataset) ? '' : ' <em>(not loaded)</em>'}</div>`).join('');
    const dq = res.restricted ? `Withheld — ${esc(Access.restrictedReason(res))}.`
      : res.quality ? `<span class="po-warn">⚠ ${esc(res.quality)}</span>`
      : res.available ? 'No issues detected for this metric.' : 'Not computed — inputs not loaded.';
    return `<h3>${esc(e.label)}</h3>
      <div class="po-formula">${esc(e.formulaText)}</div>
      <div class="po-row"><span class="po-k">Inputs</span>${inputs}</div>
      ${e.caveat ? `<div class="po-row"><span class="po-k">Caveat</span>${esc(e.caveat)}</div>` : ''}
      ${e.source ? `<div class="po-row"><span class="po-k">Source system</span>${esc(e.source)}</div>` : ''}
      <div class="po-row"><span class="po-k">Access</span>${esc(Access.describe(e))}</div>
      <div class="po-row"><span class="po-k">Data quality</span>${dq}</div>`;
  }

  // Cells are ALWAYS escaped unless explicitly wrapped as {html: '…'} by our
  // own renderers — loaded CSV content can never smuggle markup into the DOM.
  function tableHTML(columns, rows) {
    const cell = (c) => (c && typeof c === 'object' && 'html' in c) ? c.html : esc(c);
    return `<div class="table-scroll"><table class="data-table">
      <thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  return { renderTabbar, activateTab, renderActiveTab, invalidateTabs, syncBandFilterApplicability, visibleTabs, placeholder, Popover, Modal, tileHTML, popoverHTML, tableHTML, fmtMetric, targetMeta };
})();
