/* Performance tab (R6) — the goal-setting → mid-year → annual review cycle.
   Cycle-progress strip + headline tiles, a status funnel per phase, completion
   for one chosen phase by asset / function / management band / level /
   business segment, laggard functions and the line managers holding pending
   items. Flags and statuses only — never ratings. Data helpers: PerfKit
   (02o-reg-performance.js). Everything renders inside `panel`, so the tab also
   renders into a detached element (tests, persona previews). */

TabRenderers.performance = (panel) => {
  const P = PerfKit;
  const m = Compute.build(), ctx = Compute.ctxNow();
  const loaded = App.state.datasets.has('pms_status') && App.state.datasets.has('employee_master');
  const need = (builder) => needData(['pms_status', 'employee_master'], builder);
  const pct = (v, d = 1) => (v == null ? '—' : fmtPct(v, d));
  const short = (s, n = 19) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  const minN = CONFIG.minCell;
  const scopeWord = (p) => (p.scoped ? 'in scope' : 'in the cycle');

  /* ---------- 1 · cycle-progress strip ---------- */

  function stepHTML(p, i) {
    const res = Compute.metric(p.key);
    const c = P.completion(m, ctx, p.id);
    const f = P.funnel(m, ctx, p.id);
    const wait = P.awaitingCount(m, ctx, p.id);
    const last = f.statuses.length - 1;
    const value = res.restricted ? `<span class="tile-lock">${Access.LOCK_SVG} Restricted</span>`
      : !res.available ? '—' : UI.fmtMetric(res.entry, res.value);
    const segs = f.statuses.map((s, k) => {
      const share = f.n ? f.at[k] / f.n * 100 : 0;
      const cls = k === last ? 'perf-st-final' : 'perf-st-' + Math.min(k, 2);
      return { s, n: f.at[k], share, cls };
    });
    return `<div class="perf-step" data-phase="${p.id}">
      <div class="perf-step-k">Step ${i + 1}</div>
      <div class="perf-step-name">${esc(p.label)}</div>
      <button class="i-btn" data-info="${p.key}" aria-expanded="false" aria-label="About ${esc(p.label)} completion: formula and inputs">i</button>
      <div class="perf-step-val">${value}</div>
      <div class="perf-step-n">${fmtInt(c.done)} of ${fmtInt(c.n)} ${scopeWord(p)} complete</div>
      <div class="perf-stack" role="img" aria-label="${esc(p.label + ' status mix: ' + segs.map((x) => `${x.s} ${fmtInt(x.n)}`).join(', '))}">
        ${segs.filter((x) => x.n > 0).map((x) => `<span class="${x.cls}" style="width:${x.share.toFixed(2)}%"
          data-tip="${esc(`${p.label} · ${x.s}: ${fmtInt(x.n)} (${fmtPct(x.share, 1)})`)}"></span>`).join('')}
      </div>
      <div class="perf-legend">${segs.map((x) => `<span data-tip="${esc(`${x.s}: ${fmtInt(x.n)} of ${fmtInt(f.n)}`)}"><i class="perf-sw ${x.cls}"></i>${esc(x.s)} <b>${fmtPct(x.share, 0)}</b></span>`).join('')}</div>
      <div class="perf-step-meta">${res.entry && !res.restricted ? UI.targetMeta(res.entry, res) : ''}
        <span data-tip="${esc(`Status = ${p.waiting}: the employee’s step is done, the line manager’s is next`)}">${fmtInt(wait)} awaiting line manager</span></div>
    </div>`;
  }

  const stripHTML = () => `<div class="perf-strip">${P.PHASES.map(stepHTML).join('')}</div>`;

  /* ---------- 2 · status funnels ---------- */

  function funnelCard(p) {
    const f = loaded ? P.funnel(m, ctx, p.id) : null;
    const notes = [];
    if (f && f.n) {
      notes.push(`${fmtInt(f.at[0])} not started (${fmtPct(f.at[0] / f.n * 100, 0)})`);
      if (f.placed === f.n) notes.push(`no ${p.statusCol} values — everyone placed by the complete flag`);
      else if (f.placed) notes.push(`${fmtInt(f.placed)} without a status, placed by the complete flag`);
      if (f.mismatch) notes.push(`${fmtInt(f.mismatch)} where status and flag disagree`);
    }
    return Charts.card({
      title: `${p.label} — status funnel`,
      sub: `${p.base}: ${p.scoped ? 'flag filled' : 'every cycle row'} · bars = employees at or beyond each status · hover for conversion`,
      infoKey: p.key,
      body: need(() => (f.n ? Charts.funnel({ stages: f.stages })
        : `<div class="chart-empty">No employees ${scopeWord(p)} for the selected scope.</div>`)),
      note: notes.join(' · ')
    });
  }

  /* ---------- 3 · completion by dimension (chosen phase) ---------- */

  function assetItems(p) {
    const locked = !!Access.lockedAsset();
    return Access.chartScopes().map((a) => {
      const res = Compute.metric(p.key, { asset: a });
      const c = P.completion(m, ChartData.subCtx(ctx, a), p.id);
      return {
        label: a, value: res.value, role: a === ctx.asset ? 'focus' : undefined,
        sub: `${Access.cellText(c.done)}/${Access.cellText(c.n)}`,
        tip: `${a}: ${pct(res.value)} complete · ${fmtInt(c.done)} of ${fmtInt(c.n)} ${scopeWord(p)}` +
          (locked ? (a === 'Group' ? '\nGroup (benchmark)' : '') : a === 'Group' ? '\nClick to reset focus' : '\nClick to focus ' + a),
        setAsset: locked ? null : a
      };
    });
  }

  // one bar per key; the lowest cut with n ≥ minCell is the red focus bar;
  // persona-restricted small cells are withheld (Access.suppressed)
  // (cycle rows whose Employee ID is not in the master have no attributes; they
  // only exist unscoped and get their own bar)
  function dimItems(p, keyFn, order, labelOf = (k) => k) {
    const cuts = P.completionBy(m, ctx, p.id, (x) => (x.e ? keyFn(x) : P.NO_EMP), order);
    const ok = cuts.filter((c) => c.key !== P.BLANK && c.key !== P.NO_EMP && c.n >= minN && !Access.suppressed(c.n));
    const worst = ok.length > 1 ? ok.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;
    return cuts.map((c) => {
      const label = c.key === P.NO_EMP ? '(not in master)' : labelOf(c.key);
      if (Access.suppressed(c.n)) {
        return { label: short(label), value: null, sub: `n<${minN} withheld`, tip: `${label}: fewer than ${minN} ${scopeWord(p)} — withheld for this persona` };
      }
      return {
        label: short(label), value: c.pct, role: c === worst ? 'focus' : undefined,
        sub: `${fmtInt(c.done)}/${fmtInt(c.n)}`,
        tip: `${label}: ${pct(c.pct)} complete · ${fmtInt(c.done)} of ${fmtInt(c.n)} ${scopeWord(p)}` +
          (c === worst ? `\nLowest completion (n ≥ ${minN})` : c.n < minN ? `\nSmall base (n < ${minN})` : '')
      };
    });
  }

  function byCards(p) {
    const target = Compute.metric(p.key).target?.value ?? null;
    const bars = (items) => (items.length ? Charts.barH({ items, fmt: (v) => fmtPct(v, 0), target })
      : `<div class="chart-empty">No employees ${scopeWord(p)} for the selected scope.</div>`);
    const card = (title, sub, builder) => Charts.card({ title, sub, infoKey: p.key, body: need(() => bars(builder())) });
    const redNote = `lowest with n ≥ ${minN} in red · done/${p.scoped ? 'in scope' : 'in cycle'} beside each bar`;
    return [
      card(`${p.label} by asset`, 'selected asset in red · click a bar to focus', () => assetItems(p)),
      card(`${p.label} by business segment`, redNote, () => dimItems(p, ({ e }) => Compute.segOf(e), [...CONFIG.segments, 'Unassigned'])),
      card(`${p.label} by function`, redNote, () => dimItems(p, ({ e }) => e.function ?? null)),
      card(`${p.label} by level`, `${redNote} · ladder senior → junior`, () => dimItems(p, ({ e }) => e.level ?? null, CONFIG.levels)),
      card(`${p.label} by management band`, redNote, () => dimItems(p, ({ e }) => e.mgmt_band ?? null, CONFIG.mgmtBands,
        (k) => CONFIG.mgmtBandLabels[k] || k))
    ].join('');
  }

  /* ---------- 4 · laggard functions + pending with managers ---------- */

  function laggardTable(p) {
    const lag = P.laggards(m, ctx, p.id, 5);
    if (!lag.length) return `<div class="chart-empty">No function has ${minN} or more employees ${scopeWord(p)} for the selected scope.</div>`;
    const overall = P.completion(m, ctx, p.id).pct;
    const byPhase = new Map(P.PHASES.map((q) => [q.id, new Map(P.completionBy(m, ctx, q.id, ({ e }) => e?.function ?? null).map((c) => [c.key, c]))]));
    const rows = lag.map((c, i) => {
      const gap = c.pct - overall;
      return [String(i + 1), c.key, fmtInt(byPhase.get('goal').get(c.key)?.n ?? 0),
        ...P.PHASES.map((q) => {
          const x = byPhase.get(q.id).get(c.key);
          const t = x?.pct == null ? '—' : fmtPct(x.pct, 1);
          return q.id === p.id ? { html: `<strong>${esc(t)}</strong>` } : t;
        }),
        { html: `<span class="${gap < 0 ? 'perf-neg' : ''}">${gap >= 0 ? '+' : '−'}${esc(fmtNum(Math.abs(gap), 1))} pp</span>` }];
    });
    return `<div class="perf-lag">${UI.tableHTML(['#', 'Function', 'In cycle', ...P.PHASES.map((q) => q.label), 'Gap vs scope'], rows)}</div>`;
  }

  // row-level: full level + identifiers per the persona's PII level (D9)
  function managerTable() {
    if (Access.level('perf_awaiting_manager') !== 'full') {
      return `<div class="chart-empty perf-withheld">${Access.LOCK_SVG} Aggregate only for ${esc(Access.label())} — line-manager detail is not shown.</div>`;
    }
    const all = P.byManager(m, ctx);
    const named = all.filter((c) => c.named);
    if (!named.length) return '<div class="chart-empty">No items awaiting a named line manager for the selected scope.</div>';
    const raw = named.slice(0, 10).map(P.managerRow);
    const t = Access.maskTable(P.MANAGER_COLUMNS, raw);
    if (!t) {
      return `<div class="chart-empty perf-withheld">${Access.LOCK_SVG} Row-level detail withheld for ${esc(Access.label())} (identifiers: none) — the tile carries the count.</div>`;
    }
    const orphan = all.filter((c) => !c.named).reduce((s, c) => s + c.employees, 0);
    const notes = [
      named.length > 10 ? `${fmtInt(named.length - 10)} more line managers — open the “Awaiting line-manager action” tile for the full list` : '',
      orphan ? `${fmtInt(orphan)} awaiting employees have no line manager on record` : ''
    ].filter(Boolean);
    return (t.rows !== raw ? `<p class="chart-note perf-masked">Identifiers pseudonymised for ${esc(Access.label())} — stable within this browser session only.</p>` : '') +
      `<div class="perf-mgr">${UI.tableHTML(t.columns, t.rows)}</div>` +
      (notes.length ? `<div class="chart-note">${esc(notes.join(' · '))}.</div>` : '');
  }

  function stuckCards(p) {
    return [
      Charts.card({
        title: `Laggard functions — ${p.label.toLowerCase()}`,
        sub: `five lowest completion rates · functions with ≥ ${minN} ${scopeWord(p)} · all three phases for context`,
        infoKey: p.key, body: need(() => laggardTable(p))
      }),
      Charts.card({
        title: 'Line managers holding pending items',
        sub: 'top 10 by employees awaiting their action · counts per phase',
        infoKey: 'perf_awaiting_manager', body: need(managerTable)
      })
    ].join('');
  }

  /* ---------- page ---------- */

  const p0 = P.phase(P.state.phase);
  const tiles = REGISTRY.filter((e) => e.tab === 'performance').map((e) => UI.tileHTML(e.key)).join('');
  panel.innerHTML = `
    <div class="section-head"><h2>Cycle progress</h2>
      <span class="sub">Goal setting → Mid-year → Annual review · current-cycle snapshot (the period selector does not apply) · records on system, not conversations</span></div>
    ${Charts.card({ title: 'Goal → Mid-year → Annual', sub: 'completion per phase · status mix below each · hover for counts', access: 'perf', body: need(stripHTML) })}
    <div class="tile-grid perf-tiles">${tiles}</div>

    <div class="section-head"><h2>Status funnel</h2>
      <span class="sub">Not started → … → final, per phase</span></div>
    <div class="card-grid perf-funnels">${P.PHASES.map(funnelCard).join('')}</div>

    <div class="section-head perf-by-head"><h2>Completion by</h2>
      <span class="sub">one phase at a time</span>
      <div class="perf-phase" role="group" aria-label="Phase shown in the completion cuts">
        ${P.PHASES.map((q) => `<button type="button" class="perf-phase-btn" data-perf-phase="${q.id}" aria-pressed="${q.id === p0.id}">${esc(q.label)}</button>`).join('')}
      </div></div>
    <div class="card-grid perf-by" data-perf-slot="by">${byCards(p0)}</div>

    <div class="section-head"><h2>Where the cycle is stuck</h2>
      <span class="sub">laggard functions · line managers with items awaiting their action</span></div>
    <div class="card-grid perf-stuck" data-perf-slot="stuck">${stuckCards(p0)}</div>`;

  // the phase switch re-renders only the cuts that depend on it (focus stays put)
  panel.querySelector('.perf-phase').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-perf-phase]');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    P.state.phase = b.dataset.perfPhase;
    const p = P.phase(P.state.phase);
    for (const x of panel.querySelectorAll('[data-perf-phase]')) x.setAttribute('aria-pressed', String(x === b));
    panel.querySelector('[data-perf-slot="by"]').innerHTML = byCards(p);
    panel.querySelector('[data-perf-slot="stuck"]').innerHTML = stuckCards(p);
  });
};
