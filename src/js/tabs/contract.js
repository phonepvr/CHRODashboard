/* Contract & Compliance tab — contract workforce deployment and cost [SCRUM],
   contractor compliance indices and the asset-level statutory register
   [Aparajita]. Sections are laid out in a fixed order (any other group on this
   tab follows). Helpers: renderTilesByGroup-style markup, fillSlot, needData
   (tiles-tabs.js) and CompKit (02s-reg-compliance.js). Every card goes through
   Charts.card with its metric key, so persona levels apply; per-asset cuts use
   Access.chartScopes(); row-level tables pass Access.maskTable. */

TabRenderers.contract = (panel) => {
  const m = Compute.build(), ctx = Compute.ctxNow();
  const entries = REGISTRY.filter((e) => e.tab === 'contract');
  const ORDER = ['Deployment', 'Contract labour cost', 'Statutory compliance', 'Statutory register'];
  const groups = [...new Set([...ORDER.filter((g) => entries.some((e) => e.group === g)), ...entries.map((e) => e.group)])];
  const SUBS = {
    'Deployment': `${CompKit.src('contract_attendance')} contract workforce · manning mix against the permanent roll [HRMS]`,
    'Contract labour cost': `${CompKit.src('contract_attendance')} invoiced cost per man-day present`,
    'Statutory compliance': `${CompKit.src('contract_compliance')} contractor-level indices, contractor-months in the period`,
    'Statutory register': `${CompKit.src('statutory_compliance')} asset-level remittances, returns and licence renewals · due-date basis`
  };
  const slug = (g) => g.replace(/\W+/g, '-').toLowerCase();
  panel.innerHTML = `<div class="empty-note" style="margin-bottom:10px">
      <strong>Separate population.</strong> Only deployment/attendance
      <span class="tile-src">[SCRUM]</span> and statutory compliance
      <span class="tile-src">[Aparajita]</span> apply to the contract workforce —
      talent, L&amp;D and succession metrics deliberately do not. The grade-band
      filter does not apply here. The statutory register counts each item once, in the
      period its <strong>due date</strong> falls in; items not yet due are never misses.</div>` +
    groups.map((g) => `
      <div class="section-head"><h2>${esc(g)}</h2>${SUBS[g] ? `<span class="sub">${esc(SUBS[g])}</span>` : ''}</div>
      <div class="tile-grid">${entries.filter((e) => e.group === g).map((e) => UI.tileHTML(e.key)).join('')}</div>
      <div class="ck-stack" id="ck-pre-${slug(g)}"></div>
      <div class="chart-slot card-grid${g === 'Deployment' ? ' ck-grid-2' : ''}" id="charts-contract-${slug(g)}" style="margin-top:10px"></div>
      <div class="ck-stack" id="ck-post-${slug(g)}"></div>`).join('');

  // a card whose body is only built when the persona may see it
  const card = (opts, build) => Charts.card({ ...opts, body: Access.cardLevel(opts.infoKey, opts.access) === 'hidden' ? '' : build() });
  const full = (key) => Access.level(key) === 'full';
  const stack = (where, g, html) => { const el = document.getElementById(`ck-${where}-${slug(g)}`); if (el) el.innerHTML = html; };
  const sub = (s) => ChartData.subCtx(ctx, s);
  const target = (key) => Compute.metric(key).target?.value ?? null;

  /* ---------------- Deployment ---------------- */

  fillSlot('contract', 'Deployment', [
    Charts.card({
      title: 'Daily attendance trend', sub: '[SCRUM] man-days present ÷ deployed, monthly', infoKey: 'contract_attendance_pct',
      body: needData(['contract_attendance'], () => {
        const { months, series } = ChartData.assetLines(ctx, (asset, mi) => {
          const c = ChartData.subCtx(ctx, asset);
          const rows = m.cAtt.filter((r) => r.month === mi && Compute.panelMatch(c, r));
          const dep = rows.reduce((s, r) => s + (r.mandays_deployed || 0), 0);
          return dep ? rows.reduce((s, r) => s + (r.mandays_present || 0), 0) / dep * 100 : null;
        });
        return Charts.line({ months, series, yFmt: (v) => fmtPct(v, 0), target: Compute.metric('contract_attendance_pct').target?.value ?? null });
      })
    }),
    Charts.card({
      title: 'Contract headcount by contractor', sub: '[SCRUM] latest month, top 10', infoKey: 'contract_hc',
      body: needData(['contract_attendance'], () => {
        const latest = Compute.latestPanelMonth(m.cAtt, ctx);
        if (latest == null) return '<div class="chart-empty">No contractor rows in the period.</div>';
        const rows = m.cAtt.filter((r) => r.month === latest && Compute.panelMatch(ctx, r))
          .sort((a, b) => (b.contract_headcount || 0) - (a.contract_headcount || 0)).slice(0, 10);
        return Charts.barH({
          items: rows.map((r) => ({
            label: r.contractor, value: r.contract_headcount, sub: r.asset,
            tip: `${r.contractor} @ ${r.asset}: ${fmtInt(r.contract_headcount)} workers\nAttendance ${r.mandays_deployed ? fmtPct(r.mandays_present / r.mandays_deployed * 100, 1) : '—'}`
          })), fmt: (v) => fmtInt(v)
        });
      })
    }),
    card({
      title: 'Contract-to-on-roll ratio by asset', infoKey: 'contract_onroll_ratio',
      sub: `${CompKit.src('contract_attendance')} ÷ ${CompKit.src('employee_master')} latest month · contract per permanent employee · click to focus`
    }, () => needData(['contract_attendance', 'employee_master'], () => {
      const counts = [];
      const items = CompKit.scopeBars(ctx, (s) => {
        const x = CompKit.mix(m, sub(s));
        if (!x) return { value: null, sub: '', tip: `${s}: no contract rows` };
        const hide = Access.suppressed(x.onroll);
        counts.push(`${s} ${fmtInt(x.contract)} : ${Access.cellText(x.onroll)}`);
        return {
          value: hide ? null : x.ratio,
          tip: `${s} · ${monthIdxToLabel(x.month)}\nContract ${fmtInt(x.contract)} · on-roll ${Access.cellText(x.onroll)}\nRatio ${hide || x.ratio == null ? '—' : fmtNum(x.ratio, 2)} contract per permanent employee`
        };
      });
      return items.some((i) => i.value != null)
        ? Charts.barH({ items, fmt: (v) => fmtNum(v, 2) }) + `<div class="chart-note ck-counts">Contract : on-roll headcount — ${esc(counts.join(' · '))}</div>`
        : '<div class="chart-empty">No contract rows for this scope.</div>';
    })),
    card({
      title: 'Manning-mix trend', sub: `${CompKit.src('contract_attendance')} contract headcount ÷ permanent on-roll, monthly · selected scope in red`, infoKey: 'contract_onroll_ratio'
    }, () => needData(['contract_attendance', 'employee_master'], () => {
      const { months, series } = ChartData.assetLines(ctx, (asset, mi) => CompKit.ratioAt(m, sub(asset), mi));
      return Charts.line({ months, series, yFmt: (v) => fmtNum(v, 1) });
    }))
  ].join(''));

  /* ---------------- Contract labour cost ---------------- */

  fillSlot('contract', 'Contract labour cost', [
    card({
      title: 'Cost per manday trend', sub: `${CompKit.src('contract_attendance')} Σ contract labour cost ÷ Σ man-days present, monthly`, infoKey: 'contract_cost_per_manday'
    }, () => needData(['contract_attendance'], () => {
      const { months, series } = ChartData.assetLines(ctx, (asset, mi) => CompKit.costAt(m, sub(asset), mi));
      if (!series.some((s) => s.values.some((v) => v != null))) return '<div class="chart-empty">No Contract Labour Cost values in contract_attendance.csv.</div>';
      return Charts.line({ months, series, yFmt: (v) => '₹' + fmtInt(v), target: target('contract_cost_per_manday') });
    })),
    card({
      title: 'Cost per manday by contractor', infoKey: 'contract_cost_per_manday',
      sub: `${CompKit.src('contract_attendance')} ${monthIdxToLabel(ctx.startMonth)}–${monthIdxToLabel(ctx.endMonth)} · top 12, highest first · above the scope average in black`
    }, () => needData(['contract_attendance'], () => {
      if (!full('contract_cost_per_manday')) {
        return `<div class="chart-empty">Contractor-level cost is row-level commercial detail — ${esc(Access.label())} sees the aggregate tiles and trend only.</div>`;
      }
      const rows = CompKit.byContractor(m, ctx).slice(0, 12);
      if (!rows.length) return '<div class="chart-empty">No contractor cost in the period.</div>';
      const avg = CompKit.costPerManday(m, ctx);
      return Charts.barH({
        items: rows.map((x) => ({
          label: x.contractor, value: x.cpm, sub: x.asset, role: avg != null && x.cpm > avg ? undefined : 'ctx',
          tip: `${x.contractor} @ ${x.asset} (${x.seg})\n₹${fmtInt(x.cpm)} per manday · scope ₹${fmtInt(avg)}\n${fmtInt(x.md)} man-days · ${fmtINR(x.cost)}`
        })),
        fmt: (v) => '₹' + fmtInt(v)
      });
    }))
  ].join(''));

  /* ---------------- Contractor compliance indices (unchanged) ---------------- */

  fillSlot('contract', 'Statutory compliance', Charts.card({
    title: 'Compliance indices', sub: '[Aparajita] period averages vs the composite bar', infoKey: 'contract_compliance_idx',
    body: needData(['contract_compliance'], () => Charts.barH({
      items: [
        ['PF/ESI remittance', 'c_pf_esi'], ['Wage timeliness', 'c_wage'],
        ['Licence validity', 'c_licence'], ['Safety induction', 'c_induction'],
        ['Composite', 'contract_compliance_idx']
      ].map(([label, key]) => {
        const v = Compute.metric(key).value;
        return { label, value: v, role: label === 'Composite' ? 'focus' : undefined, tip: `${label}: ${v == null ? '—' : fmtPct(v, 1)}` };
      }),
      fmt: (v) => fmtPct(v, 1),
      target: Compute.metric('contract_compliance_idx').target?.value ?? null
    }))
  }));

  /* ---------------- Statutory register ---------------- */

  const from = CompKit.periodFrom(ctx);
  const win = `due ${fmtDMY(from)} – ${fmtDMY(ctx.asOfDay)}`;

  // status board: compliance item × asset (persona scopes), on-time % per cell
  function heatTable() {
    const scopes = Access.chartScopes();
    const inWin = (r) => r.due_date != null && r.due_date >= from && r.due_date <= ctx.asOfDay;
    const per = new Map(scopes.map((s) => {
      const c = sub(s);
      return [s, {
        due: CompKit.dueRows(m, c),
        open: CompKit.overdueRows(m, c),
        na: CompKit.scoped(m, c).filter((r) => r.status === 'Not applicable' && inWin(r))
      }];
    }));
    const all = [...per.values()].flatMap((p) => [...p.due, ...p.open, ...p.na]);
    const items = CompKit.itemOrder(all);
    if (!items.length) return '<div class="chart-empty">No statutory items in scope.</div>';
    const cell = (item, s) => {
      const p = per.get(s);
      const pick = (rows) => (item == null ? rows : rows.filter((r) => CompKit.itemOf(r) === item));
      const t = CompKit.tally(pick(p.due), ctx.asOfDay);
      const open = pick(p.open).length;
      const name = item ?? 'All items';
      const openMark = open ? `<span class="ck-open" aria-label="${open} open past due">●${open}</span>` : '';
      const cls = s === 'Group' ? ' ck-group' : '';
      if (!t.n) {
        const na = pick(p.na).length;
        const tip = `${name} · ${s}\n${na ? 'Not applicable' : 'Nothing due in the period'}${open ? `\n${open} open past due (earlier months)` : ''}`;
        return `<td class="ck-cell ${na ? 'ck-na' : 'ck-none'}${cls}" data-ck-scope="${esc(s)}" data-tip="${esc(tip)}">${na ? 'n/a' : '—'}${openMark}</td>`;
      }
      const miss = 1 - t.onTime / t.n;
      const tip = `${name} · ${s} · ${win}\nOn time ${fmtInt(t.onTime)} of ${fmtInt(t.n)} (${fmtPct(t.pct, 1)})\nLate ${fmtInt(t.late)} · pending past due ${fmtInt(t.open)}${open ? `\nOpen past due at as-of (any month): ${open}` : ''}`;
      return `<td class="ck-cell${cls}" style="--ck-miss:${miss.toFixed(3)}" data-ck-scope="${esc(s)}" data-ck-pct="${t.pct.toFixed(1)}" data-tip="${esc(tip)}">${fmtPct(t.pct, 0)}${openMark}</td>`;
    };
    const head = scopes.map((s) => `<th class="num${s === ctx.asset ? ' ck-focus' : ''}${s === 'Group' ? ' ck-group' : ''}" scope="col">${esc(s)}${s === 'Group' && Access.lockedAsset() ? ' <span class="ck-bench">benchmark</span>' : ''}</th>`).join('');
    const body = items.map((item) => `<tr data-ck-item="${esc(item)}"><th scope="row">${esc(item)}</th>${scopes.map((s) => cell(item, s)).join('')}</tr>`).join('');
    const total = `<tr class="ck-total" data-ck-item="(all)"><th scope="row">All items</th>${scopes.map((s) => cell(null, s)).join('')}</tr>`;
    return `<div class="table-scroll"><table class="data-table ck-heat">
        <thead><tr><th scope="col">Compliance item</th>${head}</tr></thead>
        <tbody>${body}${total}</tbody></table></div>
      <div class="ck-legend">
        <span><i class="ck-swatch" style="--ck-miss:0"></i>all on time</span>
        <span><i class="ck-swatch" style="--ck-miss:0.5"></i>half missed</span>
        <span><i class="ck-swatch" style="--ck-miss:1"></i>all missed</span>
        <span><span class="ck-open">●n</span> open past due at as-of (any month)</span>
        <span>n/a not applicable · — nothing due in the period</span>
      </div>`;
  }

  function ageing() {
    const rows = CompKit.overdueRows(m, ctx);
    if (!rows.length) return '<div class="chart-empty">Nothing is past due at the as-of date.</div>';
    const b = Compute.countBy(rows, (r) => bucketOf(CompKit.daysPastDue(r, ctx), CONFIG.taAgeingBuckets), CONFIG.taAgeingBuckets.map((x) => x[0]));
    const n = new Map(b.map((x) => [x.key, x.n]));
    return Charts.barH({
      items: CONFIG.taAgeingBuckets.map(([label, lo]) => {
        const inB = rows.filter((r) => bucketOf(CompKit.daysPastDue(r, ctx), CONFIG.taAgeingBuckets) === label);
        return {
          label: label + ' days', value: n.get(label) || 0, role: lo > 90 ? 'focus' : undefined,
          tip: `${label} days past due: ${fmtInt(n.get(label) || 0)} item${n.get(label) === 1 ? '' : 's'}${inB.length ? '\n' + inB.slice(0, 4).map((r) => `${r.compliance_item} · ${r.asset}`).join('\n') : ''}`
        };
      }),
      fmt: (v) => fmtInt(v)
    });
  }

  function worklist() {
    if (!full('stat_pending_overdue') || Access.pii() === 'none') {
      return `<div class="chart-empty">Item-level worklist is row-level detail — ${esc(Access.label())} sees the counts and ageing only.</div>`;
    }
    const rows = CompKit.overdueRows(m, ctx);
    if (!rows.length) return '<div class="chart-empty">Nothing is past due at the as-of date.</div>';
    const cap = 40;
    const t = Access.maskTable(['Asset', 'Business segment', 'Compliance item', 'Month', 'Due date', 'Days past due'],
      rows.slice(0, cap).map((r) => {
        const d = CompKit.daysPastDue(r, ctx);
        return [r.asset, Compute.segOf(r), r.compliance_item, r.month == null ? '—' : monthIdxToLabel(r.month), fmtDMY(r.due_date),
          { html: `<span class="ck-age${d > 90 ? ' ck-age-hi' : ''}">${esc(fmtInt(d))}</span>` }];
      }));
    if (!t) return `<div class="chart-empty">Row-level detail withheld for ${esc(Access.label())}.</div>`;
    return `<div class="ck-worklist">${UI.tableHTML(t.columns, t.rows)}</div>` +
      (rows.length > cap ? `<div class="chart-note">Showing the ${cap} oldest of ${fmtInt(rows.length)} — open the “Pending items past due” tile for all.</div>` : '');
  }

  stack('pre', 'Statutory register', card({
    title: 'Compliance by item × asset', infoKey: 'stat_ontime_pct',
    sub: `[${CompKit.SRC_STAT}] on-time % of applicable items ${win} · tint deepens with the share missed`
  }, () => needData(['statutory_compliance'], heatTable)));

  fillSlot('contract', 'Statutory register', [
    card({
      title: 'On-time % by due month', infoKey: 'stat_ontime_pct',
      sub: `[${CompKit.SRC_STAT}] items falling due each month · a single miss moves a small asset by several points`
    }, () => needData(['statutory_compliance'], () => {
      const months = CompKit.dueMonths(m, ctx);
      const series = CompKit.scopeLines(ctx, months, (s, mi) => CompKit.monthTally(m, sub(s), mi).pct);
      return Charts.line({ months, series, yFmt: (v) => fmtPct(v, 0), target: target('stat_ontime_pct') });
    })),
    card({
      title: 'Pending past due — ageing', infoKey: 'stat_pending_overdue',
      sub: `[${CompKit.SRC_STAT}] days past due at ${fmtDMY(ctx.asOfDay)} · any compliance month · over 90 days in red`
    }, () => needData(['statutory_compliance'], ageing))
  ].join(''));

  stack('post', 'Statutory register', card({
    title: 'Open items past due — worklist', infoKey: 'stat_pending_overdue',
    sub: `[${CompKit.SRC_STAT}] oldest first · statutory items, not people`
  }, () => needData(['statutory_compliance'], worklist)));
};
