/* Registry + helpers — Overview "Employee demographics" (R1, R1a) and
   "Budget vs actual headcount" (R1b). Structure follows the reference
   Employee Demographics page; every figure is computed from declared inputs.
   Population ("on-roll") = Employee Class Permanent + Trainee at the as-of
   date; the contract workforce stays on Contract & Compliance. The budget
   matrix compares the PERMANENT roll with hc_budget.csv (positions exclude
   trainees). Everything lives in the DemoKit namespace (one shared global
   scope — see the Phase 8 file-ownership rule). */

const DemoKit = (() => {

  /* ---------- population & reference days ---------- */

  const onRollAt = (m, ctx, day) => Compute.activesAt(m, ctx, null, day);
  const onRoll = (m, ctx) => Compute.actives(m, ctx, null);
  const lyDay = (ctx) => monthEndDay(ctx.endMonth - 12);                 // (B)
  const fyOpenDay = (ctx) => Compute.fyStartDay(ctx) - 1;               // (C) day before FY start
  const dayAt = (ctx, mi) => Math.min(ctx.asOfDay, monthEndDay(mi));
  const pctChange = (a, b) => (a == null || b == null || !b ? null : (a - b) / b * 100);
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const BLANK = '(blank)';
  const TREND_MONTHS = 13;

  /* ---------- R1a domicile ---------- */

  const homeState = (asset) => CONFIG.assetHomeState[asset] || null;
  const hasDomicile = (e) => e.domicile_state != null && String(e.domicile_state).trim() !== '';
  const isLocal = (e) => hasDomicile(e) && homeState(e.asset) != null && norm(e.domicile_state) === norm(homeState(e.asset));

  /* ---------- superannuation ---------- */

  // whole months between the as-of month and the month the employee turns
  // retirementAge: the next 36 months (as-of month + 1 … + 36) fill the
  // [0, 36) buckets, since superannuation falls on that month's last day;
  // anyone already past it (still on roll) counts as 0 → the "<3M" bucket
  const monthsToSuper = (e, ctx) => (e.dob == null ? null : Math.max(0, retireMonthIdx(e.dob, CONFIG.retirementAge) - ctx.endMonth - 1));
  const SUPER_MAX = CONFIG.superannBuckets[CONFIG.superannBuckets.length - 1][2];
  const superBucket = (e, ctx) => bucketOf(monthsToSuper(e, ctx), CONFIG.superannBuckets);

  // assets a per-asset cut may list: persona chart scopes (never CONFIG.assets
  // directly), narrowed to the context asset
  const assetsInScope = (ctx) => Access.chartScopes().filter((a) => a !== 'Group' && (ctx.asset === 'Group' || a === ctx.asset));

  const levelRank = (lv) => { const i = CONFIG.levels.indexOf(lv); return i < 0 ? 999 : i; };
  const assetRank = (a) => { const i = CONFIG.assets.indexOf(a); return i < 0 ? 999 : i; };

  /* ---------- employee details (row-level, masked by persona) ---------- */

  const DETAIL_COLS = ['Employee Code', 'Name', 'Level', 'Band', 'Company', 'Asset', 'Function', 'Function Plant', 'Segment'];
  const DETAIL_PII = { ids: ['Employee Code'], names: ['Name'] };

  function detailRows(m, ctx) {
    return onRoll(m, ctx).slice()
      .sort((a, b) => assetRank(a.asset) - assetRank(b.asset) || levelRank(a.level) - levelRank(b.level) ||
        String(a.employee_id).localeCompare(String(b.employee_id)))
      .map((e) => [e.employee_id, e.name ?? '', e.level ?? BLANK, e.mgmt_band ?? BLANK, e.company ?? BLANK, e.asset,
        e.function ?? BLANK, e.function_plant ?? BLANK, Compute.segOf(e)]);
  }

  // tile drill for (A): aggregate composition — the person-level list is the
  // Employee details card (paged, masked, CSV), too long for a modal
  function hcDrill(m, ctx) {
    const rows = [];
    for (const a of assetsInScope(ctx)) {
      const pop = onRoll(m, { ...ctx, asset: a });
      for (const { key, n } of Compute.countBy(pop, (e) => e.mgmt_band, CONFIG.mgmtBands)) {
        const sub = pop.filter((e) => (e.mgmt_band ?? BLANK) === key);
        const perm = sub.filter((e) => e.employee_class === 'Permanent').length;
        rows.push([a, CONFIG.mgmtBandLabels[key] || key, fmtInt(perm), fmtInt(n - perm), fmtInt(n)]);
      }
    }
    return { title: 'On-roll headcount (A) by asset and management band', columns: ['Asset', 'Management band', 'Permanent', 'Trainee', 'On-roll (A)'], rows };
  }

  /* ---------- R1b budget vs actual ---------- */

  // latest budget month ≤ the context month among in-scope rows
  function budgetMonth(m, ctx) {
    let best = null;
    for (const r of m.hcBudget) {
      if (r.month == null || r.month > ctx.endMonth || !Compute.orgMatch(ctx, r)) continue;
      if (best == null || r.month > best) best = r.month;
    }
    return best;
  }

  // Asset → Function → Function Plant tree with budget / actual / vacant sums.
  // The grade-band filter does not apply (the budget carries no band).
  function bvaTree(m, ctx) {
    const c = { ...ctx, band: 'All' };
    const mi = budgetMonth(m, c);
    const assets = assetsInScope(c);
    const allowed = new Set(assets);
    const mk = (label) => ({ label, budget: 0, actual: 0, vacant: 0, kids: new Map() });
    const root = new Map(assets.map((a) => [a, mk(a)]));
    const total = mk('Total');
    const add = (asset, fn, plant, field, n) => {
      if (!allowed.has(asset)) return;
      const a = root.get(asset);
      const fk = norm(fn ?? BLANK), pk = norm(plant ?? BLANK);
      if (!a.kids.has(fk)) a.kids.set(fk, mk(fn ?? BLANK));
      const f = a.kids.get(fk);
      if (!f.kids.has(pk)) f.kids.set(pk, mk(plant ?? BLANK));
      const p = f.kids.get(pk);
      a[field] += n; f[field] += n; p[field] += n; total[field] += n;
    };
    if (mi != null) {
      for (const r of m.hcBudget) if (r.month === mi && Compute.orgMatch(c, r)) add(r.asset, r.function, r.function_plant, 'budget', r.budget_hc || 0);
    }
    for (const e of Compute.actives(m, c, 'Permanent')) add(e.asset, e.function, e.function_plant, 'actual', 1);
    const hasPos = m.has('positions');
    if (hasPos) {
      for (const p of m.positionRows) if (p.position_status === 'Vacant' && Compute.orgMatch(c, p)) add(p.asset, p.function, p.function_plant, 'vacant', 1);
    }
    const sortKids = (node) => {
      node.kids = new Map([...node.kids.entries()].sort((x, y) => y[1].budget - x[1].budget || y[1].actual - x[1].actual || (x[1].label < y[1].label ? -1 : 1)));
      for (const k of node.kids.values()) sortKids(k);
    };
    for (const a of root.values()) sortKids(a);
    // drop assets with nothing on either side (e.g. a segment an asset has no units in)
    for (const [k, a] of root) if (!a.budget && !a.actual && !a.vacant) root.delete(k);
    return { month: mi, assets: [...root.values()], total, hasPos };
  }

  const variance = (n) => n.actual - n.budget;
  const variancePct = (n) => (n.budget ? (n.actual - n.budget) / n.budget * 100 : null);

  // headline totals come from the same tree as the matrix, so they always reconcile
  function bvaTotals(m, ctx) {
    const t = bvaTree(m, ctx);
    return { month: t.month, budget: t.total.budget, actual: t.total.actual, vacant: t.total.vacant };
  }

  // last 12 months: Σ budget of that month vs permanent actives at its month-end
  function bvaSeries(m, ctx) {
    const c = { ...ctx, band: 'All' };
    const allowed = new Set(assetsInScope(c));
    const out = [];
    for (let mi = ctx.endMonth - 11; mi <= ctx.endMonth; mi++) {
      let budget = 0;
      for (const r of m.hcBudget) if (r.month === mi && allowed.has(r.asset) && Compute.orgMatch(c, r)) budget += r.budget_hc || 0;
      const actual = Compute.activesAt(m, c, 'Permanent', dayAt(ctx, mi)).filter((e) => allowed.has(e.asset)).length;
      out.push({ mi, budget: budget || null, actual });
    }
    return out;
  }

  const BVA_IN = {
    budget: { dataset: 'hc_budget', columns: ['Month', 'Asset', 'Business Segment', 'Function', 'Function Plant', 'Budget Headcount'] },
    actual: { dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Function', 'Function Plant', 'Business Segment', 'Employee Class', 'Date of Joining'] },
    positions: { dataset: 'positions', columns: ['Position ID', 'Asset', 'Business Segment', 'Function', 'Function Plant', 'Position Status', 'Vacant Since'] }
  };

  // flattened rows (drill + CSV)
  function bvaRows(tree) {
    const out = [];
    const row = (lvl, a, f, p, n) => [lvl, a, f, p, n.budget, n.actual, variance(n),
      variancePct(n) == null ? '' : Math.round(variancePct(n) * 10) / 10, tree.hasPos ? n.vacant : ''];
    for (const a of tree.assets) {
      out.push(row('Asset', a.label, '', '', a));
      for (const f of a.kids.values()) {
        out.push(row('Function', a.label, f.label, '', f));
        for (const p of f.kids.values()) out.push(row('Function Plant', a.label, f.label, p.label, p));
      }
    }
    out.push(row('Total', 'Total', '', '', tree.total));
    return out;
  }
  const BVA_COLS = ['Level', 'Asset', 'Function', 'Function Plant', 'Budget', 'Actual', 'Variance', 'Variance %', 'Vacant positions'];

  function bvaDrill(m, ctx) {
    const tree = bvaTree(m, ctx);
    return {
      title: `Budget vs actual headcount — ${tree.month == null ? 'no budget month' : monthIdxToLabel(tree.month)}`,
      columns: BVA_COLS,
      rows: bvaRows(tree).map((r) => r.map((v) => (typeof v === 'number' ? fmtNum(v, Number.isInteger(v) ? 0 : 1) : v)))
    };
  }

  /* ---------- small helpers for tiles & charts ---------- */

  function bridgeDrill(m, ctx) {
    const rows = assetsInScope(ctx).map((a) => {
      const c = { ...ctx, asset: a };
      const A = onRoll(m, c).length, B = onRollAt(m, c, lyDay(c)).length, C = onRollAt(m, c, fyOpenDay(c)).length;
      return [a, fmtInt(B), fmtInt(C), fmtInt(A), fmtPct(pctChange(A, B), 1), fmtPct(pctChange(A, C), 1)];
    });
    return {
      title: `On-roll headcount bridge — ${monthIdxToLabel(ctx.endMonth - 12)} · FY start · as of ${fmtDMY(ctx.asOfDay)}`,
      columns: ['Asset', 'B — same month last year', 'C — at FY start', 'A — as-of', 'YoY % (A−B)/B', 'YTD % (A−C)/C'],
      rows
    };
  }

  // [{key, n}] → barH items with share tips. `suppress` applies the small-cell
  // rule (Access.cellText, persona-restricted views only) to cuts by a personal
  // attribute (gender, domicile, age) — organisational cuts (level, unit,
  // company) stay exact, since a small unit is not a personal attribute.
  function dimItems(counts, total, { top = 0, focus = null, label = (k) => k, tipLabel = null, otherLabel = 'Other', suppress = false } = {}) {
    let list = counts;
    if (top && counts.length > top + 1) {
      const head = counts.filter((c) => c.key !== BLANK).slice(0, top);
      const keep = new Set(head.map((c) => c.key));
      const rest = counts.filter((c) => !keep.has(c.key) && c.key !== BLANK);
      const blank = counts.find((c) => c.key === BLANK);
      list = [...head];
      if (rest.length) list.push({ key: `${otherLabel} (${rest.length})`, n: rest.reduce((s, c) => s + c.n, 0), other: true });
      if (blank) list.push(blank);
    }
    const t = total || 1;
    return list.map((c) => {
      const full = (tipLabel || label)(c.key);
      const shown = String(label(c.key));
      const short = shown.length > 19 ? shown.slice(0, 18) + '…' : shown;
      const sup = suppress && Access.suppressed(c.n);
      return {
        label: short, value: sup ? null : c.n,
        sub: sup ? `<${CONFIG.minCell} (small cell)` : fmtPct(c.n / t * 100, 1),
        role: c.other ? 'ctx' : focus && focus(c.key) ? 'focus' : undefined,
        tip: `${full}: ${sup ? Access.cellText(c.n) : fmtInt(c.n)}${sup ? '' : ` (${fmtPct(c.n / t * 100, 1)} of ${fmtInt(total)})`}`
      };
    });
  }

  /* ---------- chart primitives the shared Charts module lacks ----------
     Same encoding rules as 06-charts.js: focus = Smart Red, thin marks,
     recessive grid, direct labels, data-tip on every mark. */

  // single-series trend with a label on every point; marks = {index: 'A'|'B'|'C'}
  function trendLine({ months, values, marks = {}, yFmt = (v) => fmtInt(v), title = '', h = 214, w = 640 }) {
    const padL = 46, padR = 22, padT = 26, padB = 24;
    const iw = w - padL - padR, ih = h - padT - padB;
    const vals = values.filter((v) => v != null && isFinite(v));
    if (vals.length < 2) return '<div class="chart-empty">Series too short to draw — need at least two months of data.</div>';
    const ticks = Charts.niceTicks(Math.min(...vals), Math.max(...vals));
    const yMin = ticks[0], yMax = ticks[ticks.length - 1] > yMin ? ticks[ticks.length - 1] : yMin + 1;
    const X = (i) => padL + i / (months.length - 1) * iw;
    const Y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * ih;
    const grid = ticks.map((t) => `<line x1="${padL}" y1="${Y(t).toFixed(1)}" x2="${padL + iw}" y2="${Y(t).toFixed(1)}" stroke="var(--ink-10)" stroke-width="1"/>
      <text x="${padL - 6}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end" class="ax">${esc(yFmt(t))}</text>`).join('');
    const pts = values.map((v, i) => (v == null || !isFinite(v) ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(' ');
    const last = values.length - 1;
    const dots = values.map((v, i) => {
      if (v == null || !isFinite(v)) return '';
      const mark = marks[i];
      const x = X(i).toFixed(1), y = Y(v);
      return `<circle cx="${x}" cy="${y.toFixed(1)}" r="${mark ? 3.4 : 2.4}" fill="${i === last ? 'var(--red)' : mark ? 'var(--black)' : 'var(--white)'}" stroke="${mark && i !== last ? 'var(--black)' : 'var(--red)'}" stroke-width="1.5"/>
        <text x="${i === 0 ? (X(i) - 4).toFixed(1) : x}" y="${(y - 8).toFixed(1)}" text-anchor="${i === 0 ? 'start' : 'middle'}" class="${mark ? 'bar-value' : 'ax'} ovd-pt">${esc(yFmt(v))}</text>
        ${mark ? `<text x="${x}" y="${(y + 16).toFixed(1)}" text-anchor="middle" class="ovd-mark${i === last ? ' is-focus' : ''}">${esc(mark)}</text>` : ''}`;
    }).join('');
    const xLabels = months.map((mi, i) => `<text x="${X(i).toFixed(1)}" y="${h - 6}" text-anchor="middle" class="ax">${esc(monthIdxToLabel(mi))}</text>`).join('');
    const strips = months.map((mi, i) => {
      const x0 = i === 0 ? padL : (X(i - 1) + X(i)) / 2;
      const x1 = i === last ? padL + iw : (X(i) + X(i + 1)) / 2;
      const v = values[i];
      const tip = `${monthIdxToLabel(mi)}: ${v == null ? 'no data' : yFmt(v)}${marks[i] ? ` (${marks[i]})` : ''}`;
      return `<rect x="${x0.toFixed(1)}" y="${padT}" width="${Math.max(0, x1 - x0).toFixed(1)}" height="${ih}" fill="transparent" data-tip="${esc(tip)}"/>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" preserveAspectRatio="xMidYMid meet">${title ? `<title>${esc(title)}</title>` : ''}
      ${grid}<polyline points="${pts}" fill="none" stroke="var(--red)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${xLabels}${strips}</svg>`;
  }

  // vertical columns (superannuation buckets); items [{label, value, sub, tip, role}]
  function columns({ items, fmt = (v) => fmtInt(v), h = 200, w = 640 }) {
    const padL = 14, padR = 14, padT = 30, padB = 36;
    const vals = items.map((i) => i.value).filter((v) => v != null && isFinite(v));
    if (!vals.length) return '<div class="chart-empty">No data for this chart.</div>';
    const max = Math.max(...vals, 1);
    const iw = w - padL - padR, ih = h - padT - padB;
    const slot = iw / items.length, bw = Math.min(64, slot * 0.58);
    const bars = items.map((it, i) => {
      const cx = padL + slot * (i + 0.5);
      const bh = it.value == null ? 0 : it.value / max * ih;
      const y = padT + ih - bh;
      const col = it.role === 'focus' ? 'var(--red)' : 'var(--ink-80)';
      return `<g data-tip="${esc(it.tip || '')}">
        <rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, it.value ? 1 : 0).toFixed(1)}" fill="${col}"/>
        <text x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="bar-value">${it.value == null ? esc(it.sub || '—') : esc(fmt(it.value))}</text>
        <text x="${cx.toFixed(1)}" y="${(padT + ih + 15).toFixed(1)}" text-anchor="middle" class="bar-label">${esc(it.label)}</text>
        ${it.value != null && it.sub ? `<text x="${cx.toFixed(1)}" y="${(padT + ih + 28).toFixed(1)}" text-anchor="middle" class="ax">${esc(it.sub)}</text>` : ''}
        <rect x="${(padL + slot * i).toFixed(1)}" y="${padT - 20}" width="${slot.toFixed(1)}" height="${ih + 20}" fill="transparent"/>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" preserveAspectRatio="xMidYMid meet">
      <line x1="${padL}" y1="${padT + ih}" x2="${padL + iw}" y2="${padT + ih}" stroke="var(--ink-30)" stroke-width="1"/>${bars}</svg>`;
  }

  /* ---------- Budget vs actual matrix (expandable tree table) ---------- */

  function statusCell(v, text) {
    const cls = v > 0 ? 'ovd-over' : v < 0 ? 'ovd-under' : 'ovd-on';
    const sym = v > 0 ? '▲' : v < 0 ? '▼' : '●';
    return `<td class="num ${cls}"><span aria-hidden="true">${sym}</span> ${esc(text)}</td>`;
  }
  const signed = (v, d = 0) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), d));

  function bvaRowHTML(node, depth, id, parentId, hasPos) {
    const kids = node.kids.size ? [...node.kids.keys()].map((_, i) => `${id}-${i}`) : [];
    const v = variance(node), vp = variancePct(node);
    const tog = kids.length
      ? `<button type="button" class="ovd-tog" data-ovd-toggle="${id}" aria-expanded="false" aria-controls="${kids.join(' ')}"
          aria-label="Expand ${esc(node.label)}"><span class="ovd-caret" aria-hidden="true">▸</span></button>`
      : '<span class="ovd-tog-pad" aria-hidden="true"></span>';
    const tip = `${node.label}: budget ${fmtInt(node.budget)} · actual ${fmtInt(node.actual)} · variance ${signed(v)}${vp == null ? '' : ` (${signed(vp, 1)}%)`}${hasPos ? ` · vacant ${fmtInt(node.vacant)}` : ''}`;
    return `<tr id="${id}" class="ovd-l${depth}" data-ovd-node="${id}"${parentId ? ` data-ovd-parent="${parentId}" hidden` : ''} data-tip="${esc(tip)}">
      <td><div class="ovd-name">${tog}<span>${esc(node.label)}</span></div></td>
      <td class="num">${fmtInt(node.budget)}</td>
      <td class="num">${fmtInt(node.actual)}</td>
      ${statusCell(v, signed(v))}
      ${vp == null ? '<td class="num">—</td>' : statusCell(v, signed(vp, 1) + '%')}
      <td class="num">${hasPos ? fmtInt(node.vacant) : '—'}</td>
    </tr>`;
  }

  function bvaHTML(tree) {
    if (!tree.assets.length) return '<div class="chart-empty">No budget or headcount rows in the current scope.</div>';
    const body = [];
    tree.assets.forEach((a, ai) => {
      const aid = `ovd-bva-${ai}`;
      body.push(bvaRowHTML(a, 0, aid, null, tree.hasPos));
      [...a.kids.values()].forEach((f, fi) => {
        const fid = `${aid}-${fi}`;
        body.push(bvaRowHTML(f, 1, fid, aid, tree.hasPos));
        [...f.kids.values()].forEach((p, pi) => body.push(bvaRowHTML(p, 2, `${fid}-${pi}`, fid, tree.hasPos)));
      });
    });
    const t = tree.total, tv = variance(t), tvp = variancePct(t);
    return `<div class="ovd-toolbar">
        <button type="button" class="btn btn-outline ovd-btn" data-ovd-expand-all aria-pressed="false">Expand all</button>
        <button type="button" class="btn btn-outline ovd-btn" data-ovd-bva-csv>Matrix → CSV</button>
        <span class="ovd-legend"><span class="ovd-over">▲ over budget</span><span class="ovd-under">▼ under budget</span><span class="ovd-on">● on budget</span></span>
      </div>
      <div class="table-scroll ovd-bva-scroll">
        <table class="data-table ovd-bva">
          <thead><tr><th scope="col">Asset → Function → Function Plant</th><th class="num" scope="col">Budget</th><th class="num" scope="col">Actual</th>
            <th class="num" scope="col">Variance</th><th class="num" scope="col">Var %</th><th class="num" scope="col">Vacant pos.</th></tr></thead>
          <tbody>${body.join('')}</tbody>
          <tfoot><tr class="ovd-total"><td><div class="ovd-name"><span class="ovd-tog-pad" aria-hidden="true"></span><span>Total</span></div></td>
            <td class="num">${fmtInt(t.budget)}</td><td class="num">${fmtInt(t.actual)}</td>
            ${statusCell(tv, signed(tv))}${tvp == null ? '<td class="num">—</td>' : statusCell(tv, signed(tvp, 1) + '%')}
            <td class="num">${tree.hasPos ? fmtInt(t.vacant) : '—'}</td></tr></tfoot>
        </table>
      </div>`;
  }

  // expand / collapse (buttons carry aria-expanded; Right/Left arrows too)
  function wireBva(root, tree) {
    if (!root) return;
    const rows = () => [...root.querySelectorAll('tr[data-ovd-node]')];
    const setOpen = (id, open) => {
      const btn = root.querySelector(`[data-ovd-toggle="${id}"]`);
      if (!btn) return;
      btn.setAttribute('aria-expanded', String(open));
      const label = btn.getAttribute('aria-label').replace(/^(Expand|Collapse) /, '');
      btn.setAttribute('aria-label', (open ? 'Collapse ' : 'Expand ') + label);
      for (const r of rows()) {
        if (r.dataset.ovdParent === id) {
          r.hidden = !open;
          if (!open) setOpen(r.dataset.ovdNode, false);
        }
      }
    };
    const allBtn = root.querySelector('[data-ovd-expand-all]');
    const syncAll = () => {
      const tg = [...root.querySelectorAll('[data-ovd-toggle]')];
      const allOpen = tg.length && tg.every((b) => b.getAttribute('aria-expanded') === 'true');
      if (allBtn) { allBtn.textContent = allOpen ? 'Collapse all' : 'Expand all'; allBtn.setAttribute('aria-pressed', String(!!allOpen)); }
    };
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-ovd-toggle]');
      if (t) { setOpen(t.dataset.ovdToggle, t.getAttribute('aria-expanded') !== 'true'); syncAll(); return; }
      if (e.target.closest('[data-ovd-expand-all]')) {
        const open = allBtn.getAttribute('aria-pressed') !== 'true';
        const tg = [...root.querySelectorAll('[data-ovd-toggle]')];
        if (open) for (const b of tg) setOpen(b.dataset.ovdToggle, true);
        else for (const b of tg) if (!root.querySelector(`tr[data-ovd-node="${b.dataset.ovdToggle}"]`).dataset.ovdParent) setOpen(b.dataset.ovdToggle, false);
        syncAll();
        return;
      }
      if (e.target.closest('[data-ovd-bva-csv]')) {
        downloadBlob(`amns-hr-budget-vs-actual${Access.fileSuffix()}.csv`, CSV.serialize(BVA_COLS, bvaRows(tree)));
      }
    });
    root.addEventListener('keydown', (e) => {
      const t = e.target.closest && e.target.closest('[data-ovd-toggle]');
      if (!t || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault();
      setOpen(t.dataset.ovdToggle, e.key === 'ArrowRight');
      syncAll();
    });
  }

  /* ---------- employee details table (paged, filterable, masked) ---------- */

  const PAGE = 50;

  function detailsHTML(t) {
    const nameCol = t.columns.includes('Name');
    return `<div class="ovd-toolbar">
        <label class="ovd-find">Find <input type="search" data-ovd-q placeholder="code, level, plant…" aria-label="Filter employee details"></label>
        <span class="ovd-count" data-ovd-count aria-live="polite"></span>
        <span class="ovd-pager">
          <button type="button" class="btn btn-outline ovd-btn" data-ovd-prev aria-label="Previous page">‹ Prev</button>
          <button type="button" class="btn btn-outline ovd-btn" data-ovd-next aria-label="Next page">Next ›</button>
        </span>
        <button type="button" class="btn btn-outline ovd-btn" data-ovd-csv>Rows → CSV</button>
      </div>
      ${nameCol ? '' : `<p class="chart-note ovd-masked-note">Identifiers are pseudonymised and names withheld for ${esc(Access.label())} — stable within this browser session only.</p>`}
      <div class="table-scroll ovd-details-scroll" role="region" aria-label="Employee details" tabindex="0">
        <table class="data-table ovd-details">
          <thead><tr>${t.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
          <tbody data-ovd-body></tbody>
        </table>
      </div>`;
  }

  function wireDetails(root, t) {
    if (!root) return;
    let page = 0, rows = t.rows;
    const body = root.querySelector('[data-ovd-body]');
    const count = root.querySelector('[data-ovd-count]');
    const prev = root.querySelector('[data-ovd-prev]'), next = root.querySelector('[data-ovd-next]');
    const draw = () => {
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      page = Math.min(page, pages - 1);
      const from = page * PAGE;
      const slice = rows.slice(from, from + PAGE);
      body.innerHTML = slice.length
        ? slice.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${t.columns.length}" class="ovd-none">No rows match.</td></tr>`;
      count.textContent = rows.length
        ? `Rows ${fmtInt(from + 1)}–${fmtInt(from + slice.length)} of ${fmtInt(rows.length)}${rows.length !== t.rows.length ? ` (filtered from ${fmtInt(t.rows.length)})` : ''}`
        : `0 of ${fmtInt(t.rows.length)}`;
      prev.disabled = page === 0;
      next.disabled = page >= pages - 1;
    };
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-ovd-prev]')) { page = Math.max(0, page - 1); draw(); return; }
      if (e.target.closest('[data-ovd-next]')) { page++; draw(); return; }
      if (e.target.closest('[data-ovd-csv]')) {
        // same serializer as the drill CSV; rows are the already-masked rows
        Exports.drillCSV({ title: `amns-hr-employee-details${Access.fileSuffix()}`, columns: t.columns, rows });
      }
    });
    root.querySelector('[data-ovd-q]').addEventListener('input', debounce((e) => {
      const q = e.target.value.trim().toLowerCase();
      rows = q ? t.rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(q))) : t.rows;
      page = 0;
      draw();
    }, 150));
    draw();
  }

  // canonical input columns shared by the on-roll metrics (registry `inputs`)
  const EMP_COLS = ['Employee ID', 'Asset', 'Grade Band', 'Function', 'Business Segment', 'Employee Class', 'Date of Joining'];
  const empInput = (...extra) => ({ dataset: 'employee_master', columns: [...EMP_COLS, ...extra] });

  return {
    EMP_COLS, empInput,
    onRoll, onRollAt, lyDay, fyOpenDay, dayAt, pctChange, TREND_MONTHS, BLANK,
    homeState, hasDomicile, isLocal, monthsToSuper, superBucket, SUPER_MAX,
    assetsInScope, levelRank, detailRows, hcDrill, DETAIL_COLS, DETAIL_PII,
    budgetMonth, bvaTree, bvaRows, bvaDrill, bvaTotals, bvaSeries, BVA_IN, variance, variancePct, BVA_COLS, bridgeDrill,
    dimItems, bvaHTML, wireBva, detailsHTML, wireDetails,
    // every point carries a label, so the trend keeps most of its width
    trendLine: (a) => Charts.fitted(trendLine, a, 560), columns: (a) => Charts.fitted(columns, a, 360),
    // distribution bars from [label, lo, hi) buckets (age / tenure on the permanent roll);
    // `suppress` applies the small-cell rule, as dimItems does, to a personal attribute (age)
    bucketBarItems(pop, buckets, valueOf, { suppress = false } = {}) {
      const total = pop.length || 1;
      return buckets.map(([label, min, max]) => {
        const n = pop.filter((e) => {
          const v = valueOf(e);
          return v != null && v >= min && v < max;
        }).length;
        if (suppress && Access.suppressed(n)) return { label, value: null, sub: `<${CONFIG.minCell} (small cell)`, tip: `${label}: ${Access.cellText(n)}` };
        return { label, value: n, tip: `${label}: ${fmtInt(n)} (${fmtPct(n / total * 100, 1)})` };
      });
    }
  };
})();

/* =================== Employee demographics (Overview · R1 / R1a) =================== */

defineMetric({
  key: 'demo_hc_asof', label: 'Headcount as-of (A)', tab: 'overview', group: 'Employee demographics', access: 'core',
  unit: '', decimals: 0, direction: null,
  formulaText: 'On-roll headcount at the as-of date (A)\n= employee-master rows with Employee Class = Permanent or Trainee,\n  Date of Joining ≤ as-of and no exit on or before as-of\n(contract workforce excluded)',
  inputs: [DemoKit.empInput()],
  caveat: 'On-roll includes trainees (the GET level), unlike “Closing headcount (permanent)” in the headline row. Exits are netted off only when exits.csv is loaded. The drill-down splits A by asset and management band; the person-level list is the Employee details table below (masked per persona, CSV export).',
  compute: (m, ctx) => DemoKit.onRoll(m, ctx).length,
  spark: (m, ctx) => Compute.monthlySeries(m, ctx, (mi) => DemoKit.onRollAt(m, ctx, DemoKit.dayAt(ctx, mi)).length),
  drill: (m, ctx) => DemoKit.hcDrill(m, ctx)
});

defineMetric({
  key: 'demo_hc_ly', label: 'HC same month last year (B)', tab: 'overview', group: 'Employee demographics', access: 'core',
  unit: '', decimals: 0, direction: null,
  formulaText: 'On-roll headcount at the month-end twelve months before the as-of month (B)\n= the rule of (A), evaluated at that month-end',
  inputs: [DemoKit.empInput()],
  caveat: 'Needs leavers of the last 12 months in the employee master (matched to exits.csv); otherwise B is understated.',
  compute: (m, ctx) => DemoKit.onRollAt(m, ctx, DemoKit.lyDay(ctx)).length,
  drill: (m, ctx) => DemoKit.bridgeDrill(m, ctx)
});

defineMetric({
  key: 'demo_hc_fy_start', label: 'HC at FY start (C)', tab: 'overview', group: 'Employee demographics', access: 'core',
  unit: '', decimals: 0, direction: null,
  formulaText: `On-roll headcount on the last day before the fiscal year starts (C)\n= the rule of (A), evaluated at the month-end before FY start\n(fiscal year starts in month ${CONFIG.fyStartMonth} — CONFIG.fyStartMonth; 1 = calendar year)`,
  inputs: [DemoKit.empInput()],
  caveat: 'Also the “closing headcount of the previous year” — the base of every YTD change.',
  compute: (m, ctx) => DemoKit.onRollAt(m, ctx, DemoKit.fyOpenDay(ctx)).length,
  drill: (m, ctx) => DemoKit.bridgeDrill(m, ctx)
});

defineMetric({
  key: 'demo_hc_yoy_pct', label: '% change YoY (A−B)/B', tab: 'overview', group: 'Employee demographics', access: 'core',
  unit: '%', decimals: 1, direction: null,
  formulaText: '(A − B) ÷ B × 100\nA = on-roll headcount as-of · B = on-roll headcount at the same month-end last year',
  inputs: [DemoKit.empInput()],
  caveat: 'A change in headcount is neither good nor bad by itself — read it with the budget matrix below.',
  compute: (m, ctx) => DemoKit.pctChange(DemoKit.onRoll(m, ctx).length, DemoKit.onRollAt(m, ctx, DemoKit.lyDay(ctx)).length),
  spark: (m, ctx) => {
    const out = [];
    for (let mi = ctx.histStart + 12; mi <= ctx.endMonth; mi++) {
      out.push(DemoKit.pctChange(DemoKit.onRollAt(m, ctx, DemoKit.dayAt(ctx, mi)).length, DemoKit.onRollAt(m, ctx, monthEndDay(mi - 12)).length));
    }
    return out;
  },
  drill: (m, ctx) => DemoKit.bridgeDrill(m, ctx)
});

defineMetric({
  key: 'demo_hc_ytd_pct', label: '% change YTD (A−C)/C', tab: 'overview', group: 'Employee demographics', access: 'core',
  unit: '%', decimals: 1, direction: null,
  formulaText: '(A − C) ÷ C × 100\nA = on-roll headcount as-of · C = on-roll headcount at the start of the fiscal year',
  inputs: [DemoKit.empInput()],
  compute: (m, ctx) => DemoKit.pctChange(DemoKit.onRoll(m, ctx).length, DemoKit.onRollAt(m, ctx, DemoKit.fyOpenDay(ctx)).length),
  drill: (m, ctx) => DemoKit.bridgeDrill(m, ctx)
});

defineMetric({
  key: 'demo_women_hc', label: 'Women headcount (D)', tab: 'overview', group: 'Employee demographics', access: 'core',
  unit: '', decimals: 0, direction: null, suppress: true,
  formulaText: 'On-roll employees with Gender = Female at the as-of date (D)',
  inputs: [DemoKit.empInput('Gender')],
  compute: (m, ctx) => DemoKit.onRoll(m, ctx).filter((e) => e.gender === 'Female').length,
  drill: (m, ctx) => ({
    title: 'Women on roll by asset and management band',
    columns: ['Asset', 'Management band', 'Women (D)', 'On-roll (A)', '% women'],
    rows: DemoKit.assetsInScope(ctx).flatMap((a) => {
      const pop = DemoKit.onRoll(m, { ...ctx, asset: a });
      const bands = Compute.countBy(pop, (e) => e.mgmt_band, CONFIG.mgmtBands);
      return bands.map(({ key, n }) => {
        const d = pop.filter((e) => (e.mgmt_band ?? DemoKit.BLANK) === key && e.gender === 'Female').length;
        return [a, CONFIG.mgmtBandLabels[key] || key, Access.cellText(d), fmtInt(n), !n || Access.suppressed(d) || Access.suppressed(n - d) ? '—' : fmtPct(d / n * 100, 1)];
      });
    })
  })
});

defineMetric({
  key: 'demo_women_pct', label: '% women D/A', tab: 'overview', group: 'Employee demographics', access: 'core',
  unit: '%', decimals: 1, direction: 'higher',
  formulaText: 'D ÷ A × 100\nD = on-roll women · A = on-roll headcount as-of',
  inputs: [DemoKit.empInput('Gender')],
  caveat: 'On-roll basis (trainees included); “Female share of workforce” in the headline row is the permanent-roll figure.',
  compute: (m, ctx) => {
    const a = DemoKit.onRoll(m, ctx);
    return a.length ? a.filter((e) => e.gender === 'Female').length / a.length * 100 : null;
  },
  suppressShare: (m, ctx) => femaleCells(DemoKit.onRoll(m, ctx)),
  quality: (m, ctx) => Compute.blankShareNote(m, ctx, 'employee_master', 'gender', 'Gender')
});

defineMetric({
  key: 'demo_local_domicile_pct', label: 'Local domicile %', tab: 'overview', group: 'Employee demographics', access: 'core',
  unit: '%', decimals: 1, direction: null,
  formulaText: 'On-roll employees whose Domicile State = the home state of their own Asset\n÷ on-roll employees with a Domicile State × 100\n(home state per asset — CONFIG.assetHomeState: ' +
    Object.entries(CONFIG.assetHomeState).map(([a, s]) => `${a} → ${s}`).join(', ') + ')',
  inputs: [DemoKit.empInput('Domicile State')],
  caveat: 'Blank domicile rows are left out of the denominator and reported as a data-quality note. The population scope of the reference view (“ANG”) is not defined yet — this tile covers the selected scope.',
  compute: (m, ctx) => {
    const a = DemoKit.onRoll(m, ctx).filter(DemoKit.hasDomicile);
    return a.length ? a.filter(DemoKit.isLocal).length / a.length * 100 : null;
  },
  quality: (m, ctx) => Compute.blankShareNote(m, ctx, 'employee_master', 'domicile_state', 'Domicile State'),
  drill: (m, ctx) => ({
    title: 'Local domicile by asset',
    columns: ['Asset', 'Home state', 'On-roll with domicile', 'Local', 'Local %', 'Blank domicile'],
    rows: DemoKit.assetsInScope(ctx).map((a) => {
      const pop = DemoKit.onRoll(m, { ...ctx, asset: a });
      const known = pop.filter(DemoKit.hasDomicile);
      const local = known.filter(DemoKit.isLocal).length;
      return [a, DemoKit.homeState(a) || '—', fmtInt(known.length), fmtInt(local), known.length ? fmtPct(local / known.length * 100, 1) : '—', fmtInt(pop.length - known.length)];
    })
  })
});

defineMetric({
  key: 'demo_superann_3y', label: 'Superannuation due ≤ 3 yrs', tab: 'overview', group: 'Employee demographics', access: 'core',
  unit: '', decimals: 0, direction: null,
  formulaText: `On-roll employees reaching superannuation age ${CONFIG.retirementAge} within the next 36 months\n(superannuation month = as-of month + 1 … + 36; bucket = that month − as-of month − 1)\n(buckets ${CONFIG.superannBuckets.map((b) => b[0]).join(' · ')}; CONFIG.retirementAge, CONFIG.superannBuckets)`,
  inputs: [DemoKit.empInput('DOB')],
  caveat: 'Deterministic from DOB. Anyone still on roll past the superannuation month counts in “<3M”. The drill-down lists the people (identifiers follow the persona’s PII rule).',
  compute: (m, ctx) => DemoKit.onRoll(m, ctx).filter((e) => DemoKit.superBucket(e, ctx) != null).length,
  quality: (m, ctx) => Compute.blankShareNote(m, ctx, 'employee_master', 'dob', 'DOB'),
  drill: (m, ctx) => {
    const rows = DemoKit.onRoll(m, ctx)
      .filter((e) => DemoKit.superBucket(e, ctx) != null)
      .map((e) => ({ e, mt: DemoKit.monthsToSuper(e, ctx) }))
      .sort((x, y) => x.mt - y.mt || String(x.e.employee_id).localeCompare(String(y.e.employee_id)));
    return {
      title: `Superannuation due within 36 months (${fmtInt(rows.length)})`,
      columns: ['Employee ID', 'Name', 'Asset', 'Function', 'Level', 'Superannuation month', 'Bucket'],
      rows: rows.map(({ e }) => [e.employee_id, e.name ?? '', e.asset, e.function ?? DemoKit.BLANK, e.level ?? DemoKit.BLANK,
        monthIdxToLabel(Math.max(ctx.endMonth, retireMonthIdx(e.dob, CONFIG.retirementAge))), DemoKit.superBucket(e, ctx)])
    };
  }
});

/* =================== Budget vs actual headcount (Overview · R1b) =================== */

defineMetric({
  key: 'bva_budget_hc', label: 'Budget headcount', tab: 'overview', group: 'Budget vs actual', access: 'org',
  unit: '', decimals: 0, direction: null,
  formulaText: 'Σ Budget Headcount in hc_budget.csv for the budget month\n(budget month = latest Month ≤ as-of month; rows matched on Asset, Business Segment and Function)',
  inputs: [DemoKit.BVA_IN.budget],
  caveat: 'The grade-band filter does not apply: the budget carries no grade band. A Level split, when present, is summed.',
  compute: (m, ctx) => DemoKit.bvaTotals(m, ctx).budget,
  drill: (m, ctx) => DemoKit.bvaDrill(m, ctx)
});

defineMetric({
  key: 'bva_actual_hc', label: 'Actual headcount (vs budget)', tab: 'overview', group: 'Budget vs actual', access: 'org',
  unit: '', decimals: 0, direction: null,
  formulaText: 'Active permanent employees at the as-of date, matched on Asset, Business Segment and Function\n(trainees excluded — the budget covers permanent positions; grade-band filter not applied)',
  inputs: [DemoKit.BVA_IN.actual],
  caveat: 'Equals “Closing headcount (permanent)” when the grade-band filter is All.',
  compute: (m, ctx) => DemoKit.bvaTotals(m, ctx).actual,
  drill: (m, ctx) => DemoKit.bvaDrill(m, ctx)
});

defineMetric({
  key: 'bva_variance', label: 'Variance (actual − budget)', tab: 'overview', group: 'Budget vs actual', access: 'org',
  unit: '', decimals: 0, direction: null,
  formulaText: 'Actual − Budget\nActual = active permanent employees at as-of · Budget = Σ Budget Headcount for the budget month\n(positive = over budget · negative = under budget)',
  inputs: [DemoKit.BVA_IN.budget, DemoKit.BVA_IN.actual],
  caveat: 'The matrix below breaks the variance down Asset → Function → Function Plant.',
  compute: (m, ctx) => { const t = DemoKit.bvaTotals(m, ctx); return t.month == null ? null : t.actual - t.budget; },
  spark: (m, ctx) => DemoKit.bvaSeries(m, ctx).map((p) => (p.budget ? p.actual - p.budget : null)),
  drill: (m, ctx) => DemoKit.bvaDrill(m, ctx)
});

defineMetric({
  key: 'bva_variance_pct', label: 'Variance % of budget', tab: 'overview', group: 'Budget vs actual', access: 'org',
  unit: '%', decimals: 1, direction: null,
  formulaText: '(Actual − Budget) ÷ Budget × 100',
  inputs: [DemoKit.BVA_IN.budget, DemoKit.BVA_IN.actual],
  compute: (m, ctx) => { const t = DemoKit.bvaTotals(m, ctx); return t.budget ? (t.actual - t.budget) / t.budget * 100 : null; },
  spark: (m, ctx) => DemoKit.bvaSeries(m, ctx).map((p) => (p.budget ? (p.actual - p.budget) / p.budget * 100 : null)),
  drill: (m, ctx) => DemoKit.bvaDrill(m, ctx)
});

defineMetric({
  key: 'bva_vacant_positions', label: 'Vacant positions', tab: 'overview', group: 'Budget vs actual', access: 'org',
  unit: '', decimals: 0, direction: null,
  formulaText: 'Positions with Position Status = Vacant, matched on Asset, Business Segment and Function',
  inputs: [DemoKit.BVA_IN.positions],
  caveat: 'All vacant positions, budgeted or not; frozen and on-hold positions are not vacancies. Ageing and requisition cover sit on Positions & Budget.',
  compute: (m, ctx) => m.positionRows.filter((p) => p.position_status === 'Vacant' && Compute.orgMatch(ctx, p)).length,
  drill: (m, ctx) => {
    const rows = m.positionRows.filter((p) => p.position_status === 'Vacant' && Compute.orgMatch(ctx, p))
      .sort((a, b) => (a.vacant_since ?? Infinity) - (b.vacant_since ?? Infinity));
    return {
      title: `Vacant positions (${fmtInt(rows.length)})`,
      columns: ['Position ID', 'Position title', 'Asset', 'Function', 'Function Plant', 'Level', 'Budgeted', 'Vacant since', 'Days vacant', 'Requisition ID'],
      rows: rows.map((p) => [p.position_id, p.position_title ?? '', p.asset, p.function ?? DemoKit.BLANK, p.function_plant ?? DemoKit.BLANK,
        p.level ?? DemoKit.BLANK, p.budgeted_flag == null ? '' : p.budgeted_flag ? 'Y' : 'N', fmtDMY(p.vacant_since),
        p.vacant_since == null ? '—' : fmtInt(ctx.asOfDay - p.vacant_since), p.requisition_id || '(none)'])
    };
  }
});
