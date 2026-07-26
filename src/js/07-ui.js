/* UI managers: tabs, the "i" popover singleton, the drill-down modal singleton,
   and the shared tile renderer. Keyboard contract for the "i" pattern:
   focusable button, Enter/Space opens, Esc closes, aria-expanded kept true/false,
   focus returns to the trigger on close. */

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'talent', label: 'Talent Management' },
  { id: 'lnd', label: 'Learning & Development' },
  { id: 'mobility', label: 'Internal Mobility' },
  { id: 'attrition', label: 'Attrition' },
  { id: 'diversity', label: 'Diversity' },
  { id: 'scorecard', label: 'CHRO Scorecard' },
  { id: 'contract', label: 'Contract Workforce' },
  { id: 'outlook', label: 'Outlook' },
  { id: 'quality', label: 'Data Quality' },
  { id: 'methodology', label: 'Methodology' }
];
const GRADE_FILTER_TABS = new Set(['overview', 'talent', 'lnd', 'mobility', 'attrition', 'diversity', 'scorecard']);

const TabRenderers = {}; // id -> (containerEl) => void

const UI = (() => {

  /* ---------- tabs ---------- */

  function renderTabbar() {
    const tl = document.getElementById('tablist');
    tl.innerHTML = TABS.map((t, i) =>
      `<button role="tab" id="tab-${t.id}" aria-controls="panel-${t.id}"
        aria-selected="${t.id === App.state.activeTab}" tabindex="${t.id === App.state.activeTab ? 0 : -1}"
        data-tabid="${t.id}">${esc(t.label)}</button>`).join('');
    const main = document.getElementById('tab-panels');
    main.innerHTML = TABS.map((t) =>
      `<section role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}"
        ${t.id === App.state.activeTab ? '' : 'hidden'}></section>`).join('');

    tl.addEventListener('click', (e) => {
      const b = e.target.closest('[role="tab"]');
      if (b) activateTab(b.dataset.tabid);
    });
    tl.addEventListener('keydown', (e) => {
      const idx = TABS.findIndex((t) => t.id === App.state.activeTab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = (idx + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
        activateTab(TABS[next].id);
        document.getElementById('tab-' + TABS[next].id).focus();
      }
    });
  }

  function activateTab(id) {
    App.state.activeTab = id;
    for (const t of TABS) {
      const tab = document.getElementById('tab-' + t.id);
      const panel = document.getElementById('panel-' + t.id);
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
    const fn = TabRenderers[id];
    if (fn) { fn(panel); App.state.renderedTabs.add(id); }
    else panel.innerHTML = '<div class="empty-note">This section arrives in a later build phase.</div>';
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
    sel.title = applies ? '' : 'Grade-band filter applies to tabs 1–7 only';
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
    if (!res.available) {
      const missing = entry.inputs.filter((i) => !App.state.datasets.has(i.dataset)).map((i) => i.dataset + '.csv');
      return `<div class="tile is-empty" data-key="${entry.key}">
        <span class="tile-label">${esc(entry.label)}</span>${iBtn}
        <span class="tile-value">No data loaded for this metric</span>
        <span class="tile-meta">needs ${esc(missing.join(', '))}</span>
      </div>`;
    }
    const sparkHtml = res.spark ? Charts.spark(res.spark) : '';
    return `<div class="tile ${res.quality ? 'is-alert-quality' : ''}" data-key="${entry.key}" ${entry.drill ? `data-drill="${entry.key}" tabindex="0" role="button" aria-label="${esc(entry.label)} — open detail"` : ''}>
      <span class="tile-label">${esc(entry.label)}${entry.source ? ` <span class="tile-src">[${esc(entry.source)}]</span>` : ''}</span>
      ${iBtn}
      <span class="tile-value">${fmtMetric(entry, res.value)}</span>
      ${sparkHtml}
      <span class="tile-meta">${targetMeta(entry, res)}</span>
      ${res.quality ? `<span class="tile-quality">${esc(res.quality)}</span>` : ''}
    </div>`;
  }

  function popoverHTML(key) {
    const res = Compute.metric(key);
    const e = res.entry;
    const inputs = e.inputs.map((i) =>
      `<div>${esc(i.dataset)}.csv — ${esc(i.columns.join(', '))}${App.state.datasets.has(i.dataset) ? '' : ' <em>(not loaded)</em>'}</div>`).join('');
    return `<h3>${esc(e.label)}</h3>
      <div class="po-formula">${esc(e.formulaText)}</div>
      <div class="po-row"><span class="po-k">Inputs</span>${inputs}</div>
      ${e.caveat ? `<div class="po-row"><span class="po-k">Caveat</span>${esc(e.caveat)}</div>` : ''}
      ${e.source ? `<div class="po-row"><span class="po-k">Source system</span>${esc(e.source)}</div>` : ''}
      <div class="po-row"><span class="po-k">Data quality</span>${res.quality ? `<span class="po-warn">⚠ ${esc(res.quality)}</span>` : res.available ? 'No issues detected for this metric.' : 'Not computed — inputs not loaded.'}</div>`;
  }

  function tableHTML(columns, rows) {
    return `<div class="table-scroll"><table class="data-table">
      <thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${typeof c === 'string' && c.startsWith('<') ? c : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  return { renderTabbar, activateTab, renderActiveTab, invalidateTabs, syncBandFilterApplicability, Popover, Modal, tileHTML, popoverHTML, tableHTML, fmtMetric, targetMeta };
})();
