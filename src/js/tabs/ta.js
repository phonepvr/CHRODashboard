/* TA Pipeline tab (R4) — the TA Command Centre view on requisitions.csv and
   candidate_pipeline.csv. Metrics and helpers live in 02m-reg-ta.js (TAKit);
   this file only lays them out. Persona rules: every chart sits in
   Charts.card({infoKey}) (fail-closed), per-asset cuts iterate
   Access.chartScopes(), row tables go through Access.maskTable (pseudonyms for
   'masked', withheld for 'none') and small restricted cuts use Access.cellText.
   Encoding: Smart Red = the watch zone (aged, bottleneck, breach), black/greys
   = context; every bar is direct-labelled and carries a data-tip. */

TabRenderers.ta = (() => {

  const W = 640;
  const pctTxt = (v, d = 0) => (v == null ? '—' : fmtPct(v, d));
  const cnt = (n) => Access.cellText(n);
  const clip = (s, px) => { const max = Math.max(6, Math.floor((px - 12) / 6.1)); s = String(s); return s.length > max ? s.slice(0, max - 1) + '…' : s; };
  const ROLE_FILL = { focus: 'var(--red)', dark: 'var(--black)', mid: 'var(--ink-55)', ctx: 'var(--ink-30)' };

  /* ---------- marks ---------- */

  // Horizontal bar rows: direct value label after the bar, an aligned note
  // column on the right. items: [{label, value, text, note, role, tip, drill}].
  // `w` = viewBox width: narrower for three-up cards so the text keeps its size.
  function rows({ items, padL = 132, noteW = 150, valW = 62, rowH = 24, max = null, w = W, empty = 'No data for this chart.' }) {
    const vals = items.map((i) => i.value).filter((v) => v != null && isFinite(v));
    if (!items.length) return `<div class="chart-empty">${esc(empty)}</div>`;
    const top = (max ?? Math.max(0, ...vals)) || 1;
    const iw = w - padL - valW - noteW;
    const h = items.length * rowH + 8;
    const body = items.map((it, r) => {
      const y = 4 + r * rowH, ty = (y + rowH / 2 + 3.5).toFixed(1);
      const bw = it.value == null || !isFinite(it.value) ? 0 : Math.max(it.value > 0 ? 1.5 : 0, Math.min(1, it.value / top) * iw);
      const attrs = [
        `data-tip="${esc(it.tip || `${it.label}: ${it.text ?? fmtInt(it.value)}${it.note ? ' · ' + it.note : ''}`)}"`,
        it.drill ? `data-drill="${esc(it.drill)}" style="cursor:pointer"` : ''
      ].join(' ');
      return `<g class="ta-row${it.role === 'focus' ? ' is-focus' : ''}" ${attrs}>
        <rect x="0" y="${y}" width="${w}" height="${rowH}" fill="transparent"/>
        <text x="${padL - 8}" y="${ty}" text-anchor="end" class="bar-label">${esc(clip(it.label, padL))}</text>
        <rect x="${padL}" y="${y + 5}" width="${bw.toFixed(1)}" height="${rowH - 10}" fill="${ROLE_FILL[it.role] || 'var(--ink-80)'}"/>
        <text x="${(padL + bw + 6).toFixed(1)}" y="${ty}" class="bar-value">${esc(it.text ?? (it.value == null ? '—' : fmtInt(it.value)))}</text>
        ${it.note ? `<text x="${w - 4}" y="${ty}" text-anchor="end" class="ax">${esc(it.note)}</text>` : ''}
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
  }

  // Vertical histogram with count labels; bins from `breachFrom` on are red and
  // a dashed marker names the SLA line.
  function hist({ bins, breachFrom, marker, h = 200 }) {
    if (!bins.length) return '<div class="chart-empty">No filled requisitions in the period.</div>';
    const padL = 34, padR = 8, padT = 18, padB = 30;
    const iw = W - padL - padR, ih = h - padT - padB;
    const ticks = Charts.niceTicks(0, Math.max(1, ...bins.map((b) => b.n)), 4);
    const yMax = ticks[ticks.length - 1] || 1;
    const bw = iw / bins.length;
    const Y = (v) => padT + ih - v / yMax * ih;
    const every = bw < 40 ? Math.ceil(40 / bw) : 1;
    const grid = ticks.map((t) => `<line x1="${padL}" y1="${Y(t).toFixed(1)}" x2="${padL + iw}" y2="${Y(t).toFixed(1)}" stroke="var(--ink-10)"/>
      <text x="${padL - 6}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end" class="ax">${fmtInt(t)}</text>`).join('');
    const bars = bins.map((b, i) => {
      const x = padL + i * bw;
      const breach = i >= breachFrom;
      return `<g data-tip="${esc(`${b.label} days: ${fmtInt(b.n)} requisition${b.n === 1 ? '' : 's'}${breach ? ' — SLA breach' : ''}`)}">
        <rect x="${x.toFixed(1)}" y="${padT}" width="${bw.toFixed(1)}" height="${ih}" fill="transparent"/>
        <rect x="${(x + 2).toFixed(1)}" y="${Y(b.n).toFixed(1)}" width="${Math.max(1, bw - 4).toFixed(1)}" height="${(padT + ih - Y(b.n)).toFixed(1)}" fill="${breach ? 'var(--red)' : 'var(--ink-80)'}"/>
        ${b.n ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(Y(b.n) - 4).toFixed(1)}" text-anchor="middle" class="bar-value">${fmtInt(b.n)}</text>` : ''}
        ${i % every === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${h - 14}" text-anchor="middle" class="ax">${esc(b.label)}</text>` : ''}
      </g>`;
    }).join('');
    const mx = padL + breachFrom * bw;
    const mark = breachFrom < bins.length
      ? `<line x1="${mx.toFixed(1)}" y1="${padT - 6}" x2="${mx.toFixed(1)}" y2="${padT + ih}" stroke="var(--black)" stroke-dasharray="3 3"/>
         <text x="${(mx + 4).toFixed(1)}" y="${padT - 8}" class="ax">${esc(marker)}</text>` : '';
    return `<svg viewBox="0 0 ${W} ${h}" role="img" preserveAspectRatio="xMidYMid meet">${grid}${bars}${mark}
      <text x="${padL + iw / 2}" y="${h - 2}" text-anchor="middle" class="ax">days from Open Date to Joining Date</text></svg>`;
  }

  // dense table; `num` = indexes of right-aligned numeric columns
  function table(columns, rowsArr, num = [], cls = '') {
    const ns = new Set(num);
    const c = (v) => (v && typeof v === 'object' && 'html' in v ? v.html : esc(v));
    return `<div class="table-scroll"><table class="data-table ta-table ${cls}">
      <thead><tr>${columns.map((h, i) => `<th${ns.has(i) ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rowsArr.map((r) => `<tr>${r.map((v, i) => `<td${ns.has(i) ? ' class="num"' : ''}>${c(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }
  const withheld = (what) => `<div class="chart-empty chart-restricted">${Access.LOCK_SVG} ${esc(what)} withheld for ${esc(Access.label())} — no row-level detail; the tiles carry the aggregates.</div>`;

  const head = (title, sub) => `<div class="section-head"><h2>${esc(title)}</h2>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
  const tiles = (keys) => `<div class="tile-grid">${keys.map((k) => UI.tileHTML(k)).join('')}</div>`;
  const grid = (cards, extra = '') => `<div class="card-grid ta-cards ${extra}">${cards.join('')}</div>`;
  const drillIf = (key) => (Access.canDrill(key) ? key : null);
  const REQS = ['requisitions'];
  const CANDS = ['candidate_pipeline', 'requisitions'];

  /* ---------- cards ---------- */

  const STATUS_ORDER = ['Open', 'On Hold', 'Offered', 'TBO', 'Filled', 'Dropped', 'Closed'];
  function statusCard(m, ctx) {
    return Charts.card({
      title: 'Requisition book by status', sub: `as of ${CONFIG.asOf} · share of the book on the right`, infoKey: 'ta_reqs_total',
      body: needData(REQS, () => {
        const bk = TAKit.book(m, ctx);
        const counts = Compute.countBy(bk, (r) => TAKit.statusOf(r, ctx), STATUS_ORDER);
        return rows({
          padL: 70, noteW: 96, valW: 40, w: 440,
          items: counts.map(({ key, n }) => ({
            label: key, value: n, note: pctTxt(TAKit.pct(n, bk.length), 1) + ' of book',
            role: key === 'Filled' ? 'ctx' : key === 'Dropped' || key === 'Closed' ? 'mid' : undefined,
            drill: ['Open', 'On Hold', 'Offered', 'TBO'].includes(key) ? drillIf('ta_reqs_open') : key === 'Dropped' ? drillIf('ta_dropped') : null
          })),
          empty: 'No requisitions in scope.'
        });
      })
    });
  }

  const SC_KEYS = [['ta_reqs_total', 'Reqs'], ['ta_reqs_open', 'Open'], ['ta_aged_180_pct', 'Aged %'], ['ta_tbo', 'TBO'],
    ['ta_ttf_median', 'Med. TTF'], ['ta_sla_breach', 'SLA br.'], ['ta_offer_accept', 'Offer acc.'], ['ta_drop_rate', 'Drop %']];
  function scVal(key, res) {
    if (res.restricted || res.value == null) return '—';
    const e = REG_BY_KEY.get(key);
    if (e.unit === '%') return fmtPct(res.value, 1);
    if (e.unit === 'd') return fmtInt(res.value) + ' d';
    return cnt(res.value);
  }
  function scorecard(title, sub, cuts, infoKey, focusLabel) {
    return Charts.card({
      title, sub, infoKey,
      body: needData(REQS, () => {
        if (!cuts.length) return '<div class="chart-empty">No requisitions in scope.</div>';
        const body = cuts.map(({ label, ov }) => {
          const cells = SC_KEYS.map(([k]) => scVal(k, Compute.metric(k, ov)));
          const lbl = label === focusLabel ? { html: `<strong>${esc(label)}</strong>` } : label;
          return [lbl, ...cells];
        });
        return table(['Scope', ...SC_KEYS.map(([, l]) => l)], body, SC_KEYS.map((_, i) => i + 1));
      }),
      note: `Reqs, Open, Aged % (open > ${TAKit.AGED_DAYS} d), TBO and Drop % as of the as-of date; median TTF, SLA breach % and offer acceptance % over the selected period.`
    });
  }

  function ttfHistCard(m, ctx) {
    return Charts.card({
      title: 'Time-to-fill distribution', sub: `30-day bins · filled in period · red = SLA breach (> ${TAKit.SLA_DAYS} d)`, infoKey: 'ta_ttf_median',
      body: needData(REQS, () => {
        const t = TAKit.filledInPeriod(m, ctx).map((r) => TAKit.capped(TAKit.ttf(r))).filter((x) => x != null);
        if (!t.length) return '<div class="chart-empty">No filled requisitions in the period.</div>';
        const idx = (d) => (d === 0 ? 0 : Math.ceil(d / 30) - 1);   // 0–30, 31–60, … (upper bound inclusive)
        const top = Math.max(...t.map(idx));
        const bins = Array.from({ length: top + 1 }, (_, i) => ({ label: `${i ? i * 30 + 1 : 0}–${(i + 1) * 30}`, n: 0 }));
        for (const d of t) bins[idx(d)].n++;
        return hist({ bins, breachFrom: Math.round(TAKit.SLA_DAYS / 30), marker: `SLA ${TAKit.SLA_DAYS} d` });
      })
    });
  }

  function ttfLevelCard(m, ctx) {
    return Charts.card({
      title: 'Time to fill by level', sub: `median with p25–p75 · filled in period · 'n<${TAKit.MIN_N}' = too few to state`, infoKey: 'ta_ttf_median',
      body: needData(REQS, () => {
        const by = new Map();
        for (const r of TAKit.filledInPeriod(m, ctx)) {
          const t = TAKit.capped(TAKit.ttf(r));
          if (t == null) continue;
          const k = r.level || '(blank)';
          if (!by.has(k)) by.set(k, []);
          by.get(k).push(t);
        }
        const keys = [...CONFIG.levels.filter((l) => by.has(l)), ...[...by.keys()].filter((k) => !CONFIG.levels.includes(k)).sort()];
        return rows({
          items: keys.map((k) => {
            const s = TAKit.stats(by.get(k));
            const ok = s.n >= TAKit.MIN_N;
            return {
              label: k, value: ok ? s.median : null, text: ok ? fmtInt(s.median) + ' d' : `n<${TAKit.MIN_N}`,
              note: ok ? `p25–p75 ${fmtInt(s.p25)}–${fmtInt(s.p75)} · n=${cnt(s.n)}` : `n=${cnt(s.n)}`,
              role: ok && s.median > TAKit.SLA_DAYS ? 'focus' : undefined
            };
          }),
          padL: 80, noteW: 150, empty: 'No filled requisitions in the period.'
        });
      }),
      note: `Levels in grade-ladder order (senior → junior). Red = median above the ${TAKit.SLA_DAYS}-day SLA.`
    });
  }

  function funnelCard(m, ctx) {
    return Charts.card({
      title: 'Candidate funnel', sub: 'reached-stage counts · yield from the previous stage and from Applied', infoKey: 'ta_cand_join_yield',
      body: needData(CANDS, () => {
        const f = TAKit.funnel(m, ctx);
        if (!f[0].n) return '<div class="chart-empty">No candidates on in-scope requisitions.</div>';
        return rows({
          items: f.map((s, i) => ({
            label: s.label, value: s.n, text: fmtInt(s.n),
            note: i ? `${pctTxt(TAKit.pct(s.n, f[i - 1].n), 1)} of prev · ${pctTxt(TAKit.pct(s.n, f[0].n), 1)} of start` : '100% of start',
            role: i === 0 ? 'dark' : i === f.length - 1 ? 'focus' : undefined
          })),
          padL: 100, noteW: 168, valW: 50, w: 480
        });
      })
    });
  }

  function dwellCard(m, ctx) {
    return Charts.card({
      title: 'Stage dwell — where the time goes', sub: 'median days per transition · p25–p75 · bottleneck in red', infoKey: 'ta_bottleneck_days',
      body: needData(CANDS, () => {
        const d = TAKit.dwell(m, ctx);
        if (!d.some((s) => s.n)) return '<div class="chart-empty">No candidates with consecutive stage dates.</div>';
        return rows({
          items: d.map((s) => ({
            label: `${s.from} → ${s.to}`, value: s.median, text: s.median == null ? '—' : fmtInt(s.median) + ' d',
            note: s.n ? `${fmtInt(s.p25)}–${fmtInt(s.p75)} d · n=${fmtInt(s.n)}` : 'n=0',
            role: s.bottleneck ? 'focus' : undefined
          })),
          padL: 168, noteW: 104, valW: 44, w: 480
        });
      }),
      note: (() => { const b = TAKit.dwell(m, ctx).find((s) => s.bottleneck); return b ? `Bottleneck: ${b.from} → ${b.to}, median ${fmtInt(b.median)} days.` : ''; })()
    });
  }

  function ageingCard(m, ctx) {
    return Charts.card({
      title: 'Open requisitions by age', sub: `days open as of ${CONFIG.asOf} · red = aged (> ${TAKit.AGED_DAYS} d)`, infoKey: 'ta_aged_180',
      body: needData(REQS, () => {
        const open = TAKit.openReqs(m, ctx);
        if (!open.length) return '<div class="chart-empty">No open requisitions in scope.</div>';
        const labels = CONFIG.taAgeingBuckets.map((b) => b[0]);
        const counts = new Map(Compute.countBy(open, (r) => bucketOf(TAKit.ageOf(r, ctx), CONFIG.taAgeingBuckets), labels).map((c) => [c.key, c.n]));
        return rows({
          items: CONFIG.taAgeingBuckets.map(([label, lo]) => {
            const n = counts.get(label) || 0;
            return {
              label: label + ' d', value: n, note: pctTxt(TAKit.pct(n, open.length), 1) + ' of open',
              role: lo > TAKit.AGED_DAYS ? 'focus' : lo > TAKit.WORKLIST_DAYS ? undefined : 'ctx', drill: drillIf('ta_reqs_open')
            };
          }),
          padL: 70, noteW: 96, valW: 40, w: 440
        });
      })
    });
  }

  function reasonRows(list, keyFn, opts = {}) {
    const all = Compute.countBy(list, keyFn);
    const rec = all.filter((c) => c.key !== TAKit.NR && c.key !== '(blank)');
    const blank = all.filter((c) => c.key === TAKit.NR || c.key === '(blank)').reduce((s, c) => s + c.n, 0);
    const top = rec.slice(0, opts.top || 8);
    const items = TAKit.pareto(rec).slice(0, top.length).map((c) => ({
      label: c.key, value: c.n, note: opts.note ? opts.note(c) : `${pctTxt(c.share, 0)} · cum ${pctTxt(c.cum, 0)}`, role: opts.role
    }));
    if (blank) items.push({ label: TAKit.NR, value: blank, note: 'excluded from shares', role: 'ctx' });
    return { items, more: rec.length - top.length };
  }

  function ageingReasonCard(m, ctx) {
    return Charts.card({
      title: 'Ageing-reason Pareto', sub: 'open requisitions by recorded ageing reason · share and cumulative share', infoKey: 'ta_reqs_open',
      body: needData(REQS, () => {
        const open = TAKit.openReqs(m, ctx);
        if (!open.length) return '<div class="chart-empty">No open requisitions in scope.</div>';
        const { items } = reasonRows(open, (r) => r.ageing_reason || TAKit.NR, { role: 'mid' });
        return rows({ items, padL: 150, noteW: 104, valW: 36, w: 440 });
      }),
      note: 'TBO requisitions rarely carry an ageing reason — they are waiting on the joiner, not on sourcing.'
    });
  }

  function tboCard(m, ctx) {
    return Charts.card({
      title: 'TBO by days since acceptance', sub: 'offer accepted, not yet joined · red = waiting > 30 days', infoKey: 'ta_tbo',
      body: needData(REQS, () => {
        const tbo = TAKit.openReqs(m, ctx).filter((r) => TAKit.isTBO(r, ctx));
        if (!tbo.length) return '<div class="chart-empty">No TBO requisitions in scope.</div>';
        const counts = new Map();
        for (const r of tbo) {
          const k = bucketOf(TAKit.tboAge(r, ctx), TAKit.TBO_BUCKETS) || '(no acceptance date)';
          counts.set(k, (counts.get(k) || 0) + 1);
        }
        const items = TAKit.TBO_BUCKETS.map(([label, lo]) => ({
          label: label + ' d', value: counts.get(label) || 0, note: pctTxt(TAKit.pct(counts.get(label) || 0, tbo.length), 0) + ' of TBO',
          role: lo > 30 ? 'focus' : undefined, drill: drillIf('ta_tbo')
        }));
        if (counts.has('(no acceptance date)')) items.push({ label: '(no acceptance date)', value: counts.get('(no acceptance date)'), note: 'Req Status = TBO only', role: 'ctx' });
        return rows({ items, padL: 70, noteW: 96, valW: 40, w: 440 });
      })
    });
  }

  function worklistCard(m, ctx) {
    return Charts.card({
      title: `Aged-open worklist (> ${TAKit.WORKLIST_DAYS} days)`, sub: 'oldest first · top 20 on screen — the Open requisitions tile drills to every row (CSV)', infoKey: 'ta_aged_180',
      body: needData(REQS, () => {
        const list = TAKit.openReqs(m, ctx).filter((r) => TAKit.ageOf(r, ctx) > TAKit.WORKLIST_DAYS)
          .sort((a, b) => TAKit.ageOf(b, ctx) - TAKit.ageOf(a, ctx));
        if (!list.length) return `<div class="chart-empty">No open requisition is older than ${TAKit.WORKLIST_DAYS} days.</div>`;
        const ageCol = TAKit.OPEN_COLS.indexOf('Age (d)');
        const raw = list.slice(0, 20).map((r) => {
          const row = TAKit.openRow(r, ctx);
          if (TAKit.ageOf(r, ctx) > TAKit.AGED_DAYS) row[ageCol] = { html: `<span class="ta-hot">${esc(row[ageCol])}</span>` };
          return row;
        });
        const t = Access.maskTable(TAKit.OPEN_COLS, raw, { ids: ['Recruiter'], names: [] });
        if (!t) return withheld('The aged-open worklist');
        return table(t.columns, t.rows, [t.columns.indexOf('Age (d)')]) +
          `<div class="chart-note">${fmtInt(list.length)} open requisition${list.length === 1 ? '' : 's'} older than ${TAKit.WORKLIST_DAYS} days${list.length > 20 ? ` · showing the oldest 20` : ''}. Age in red = over ${TAKit.AGED_DAYS} days.${t.rows !== raw ? ' Recruiter codes pseudonymised for this persona.' : ''}</div>`;
      })
    });
  }

  function hiresBySourceCard(m, ctx) {
    return Charts.card({
      title: 'Hires by source', sub: 'filled requisitions in the book by Hire Source · share of hires', infoKey: 'ta_referral_share',
      body: needData(REQS, () => {
        const f = TAKit.filledBook(m, ctx);
        if (!f.length) return '<div class="chart-empty">No filled requisitions in scope.</div>';
        const counts = Compute.countBy(f, (r) => r.hire_source || TAKit.NR);
        const rec = counts.filter((c) => c.key !== TAKit.NR);
        const nr = counts.find((c) => c.key === TAKit.NR);
        const items = rec.map((c) => ({
          label: c.key, value: c.n, note: pctTxt(TAKit.pct(c.n, f.length), 1) + ' of hires',
          role: /^employee referral$/i.test(c.key) ? 'focus' : undefined
        }));
        if (nr) items.push({ label: TAKit.NR, value: nr.n, note: pctTxt(TAKit.pct(nr.n, f.length), 1) + ' of hires', role: 'ctx' });
        return rows({ items, padL: 150, noteW: 100 });
      })
    });
  }

  function sourceEffCard(m, ctx) {
    return Charts.card({
      title: 'Source effectiveness', sub: 'per sourcing channel · join rate = joined ÷ candidates · median TTF of the requisitions it filled', infoKey: 'ta_cand_join_yield',
      body: needData(REQS, () => {
        const { candBased, rows: src } = TAKit.sources(m, ctx);
        if (!src.length) return '<div class="chart-empty">No sourcing data in scope.</div>';
        const ttfTxt = (s) => (s.n >= TAKit.MIN_N ? fmtInt(s.median) : `n<${TAKit.MIN_N}`);
        if (candBased) {
          return table(['Source', 'Reqs', 'Candidates', 'Joined', 'Join rate', 'Med. TTF (d)'],
            src.map((s) => [s.key, fmtInt(s.reqs), fmtInt(s.cands), cnt(s.joins), pctTxt(s.joinRate, 1), ttfTxt(s.ttfStats)]), [1, 2, 3, 4, 5]);
        }
        return table(['Hire source', 'Reqs', 'Joined', 'Join rate', 'Med. TTF (d)'],
          src.map((s) => [s.key, fmtInt(s.reqs), cnt(s.joins), pctTxt(s.joinRate, 1), ttfTxt(s.ttfStats)]), [1, 2, 3, 4]) +
          '<div class="chart-note">candidate_pipeline.csv not loaded — requisition Hire Source shown instead.</div>';
      })
    });
  }

  function representationCard(m, ctx) {
    return Charts.card({
      title: 'Representation across the funnel', sub: 'female share of known gender at each stage · Unknown shown, never imputed', infoKey: 'ta_female_joined',
      body: needData(CANDS, () => {
        const f = TAKit.funnel(m, ctx);
        if (!f[0].n) return '<div class="chart-empty">No candidates on in-scope requisitions.</div>';
        return rows({
          items: f.map((s, i) => {
            const known = s.g.Female + s.g.Male + s.g.Other;
            const sup = Access.suppressed(s.g.Female) || Access.suppressed(known - s.g.Female);
            const v = sup ? null : TAKit.femaleShare(s.g);
            return {
              label: s.label, value: v, text: sup ? `<${CONFIG.minCell}` : pctTxt(v, 1),
              note: `F ${cnt(s.g.Female)} · M ${cnt(s.g.Male)}${s.g.Other ? ' · Other ' + cnt(s.g.Other) : ''} · Unknown ${cnt(s.g.Unknown)}`,
              role: i === f.length - 1 ? 'focus' : undefined
            };
          }),
          padL: 100, noteW: 176, valW: 50, w: 480
        });
      }),
      note: 'Share = Female ÷ (Female + Male + Other); candidates with no recorded gender are counted as Unknown and left out of the share.'
    });
  }

  function recruiterCard(m, ctx) {
    return Charts.card({
      title: 'Recruiter productivity', sub: `top 20 by open work-in-progress · median TTF only from ≥ ${TAKit.MIN_N} joins`, infoKey: 'ta_recruiter_max_open',
      body: needData(REQS, () => {
        const recs = TAKit.recruiters(m, ctx);
        if (!recs.length) return '<div class="chart-empty">No requisitions in scope.</div>';
        const raw = recs.slice(0, 20).map((o) => [o.key, fmtInt(o.reqs), cnt(o.open), cnt(o.aged), cnt(o.joins),
          o.ttfStats.n >= TAKit.MIN_N ? fmtInt(o.ttfStats.median) : `n<${TAKit.MIN_N}`]);
        const cols = ['Recruiter', 'Reqs', 'Open WIP', `Aged > ${TAKit.AGED_DAYS} d`, 'Joined', 'Median TTF (d)'];
        const t = Access.maskTable(cols, raw, { ids: ['Recruiter'], names: [] });
        if (!t) return withheld('Recruiter-level detail');
        const named = recs.filter((o) => o.key !== '(unassigned)');
        const medLoad = median(named.map((o) => o.open));
        return table(t.columns, t.rows, [1, 2, 3, 4, 5]) +
          `<div class="chart-note">${fmtInt(named.length)} recruiter${named.length === 1 ? '' : 's'} · median open load ${medLoad == null ? '—' : fmtNum(medLoad, 1)}${t.rows !== raw ? ' · recruiter codes pseudonymised for this persona (stable within this session)' : ''}.</div>`;
      })
    });
  }

  // bar labels are recruiter codes, so they pass the same Access.maskTable rule
  // as the productivity table (same pseudonyms; withheld for 'none')
  function recruiterLoadCard(m, ctx) {
    return Charts.card({
      title: 'Open load by recruiter', sub: `open requisitions per recruiter · red = holds requisitions aged > ${TAKit.AGED_DAYS} d`, infoKey: 'ta_recruiter_max_open',
      body: needData(REQS, () => {
        const recs = TAKit.recruiters(m, ctx).filter((o) => o.open > 0).slice(0, 14);
        if (!recs.length) return '<div class="chart-empty">No open requisitions in scope.</div>';
        const t = Access.maskTable(['Recruiter'], recs.map((o) => [o.key]), { ids: ['Recruiter'], names: [] });
        if (!t) return withheld('Recruiter-level detail');
        const med = median(TAKit.recruiters(m, ctx).filter((o) => o.key !== '(unassigned)').map((o) => o.open));
        return rows({
          // a suppressed cell draws no bar, so its length cannot restate the count
          items: recs.map((o, i) => ({
            label: t.rows[i][0], value: Access.suppressed(o.open) ? null : o.open, text: cnt(o.open),
            note: `${cnt(o.aged)} aged · ${fmtInt(o.reqs)} reqs`,
            role: o.aged > 0 ? 'focus' : undefined
          })),
          padL: 110, noteW: 120
        }) + `<div class="chart-note">Median open load ${med == null ? '—' : fmtNum(med, 1)} per recruiter.</div>`;
      })
    });
  }

  function reqDropCard(m, ctx) {
    return Charts.card({
      title: 'Requisition drops by reason', sub: 'Req Status = Dropped · Pareto share and cumulative share', infoKey: 'ta_drop_rate',
      body: needData(REQS, () => {
        const d = TAKit.book(m, ctx).filter(TAKit.isDropped);
        if (!d.length) return '<div class="chart-empty">No dropped requisitions in scope.</div>';
        const { items } = reasonRows(d, (r) => r.drop_reason || TAKit.NR, { role: 'mid' });
        return rows({ items: items.map((it) => ({ ...it, drill: drillIf('ta_dropped') })), padL: 160, noteW: 128 });
      })
    });
  }

  function candDropCard(m, ctx) {
    return Charts.card({
      title: 'Candidate drop-outs by reason', sub: 'Current Stage = Dropped · top 8 · the stage most of them had reached', infoKey: 'ta_cand_join_yield',
      body: needData(CANDS, () => {
        const d = TAKit.cands(m, ctx).filter((c) => c.current_stage === 'Dropped');
        if (!d.length) return '<div class="chart-empty">No candidate drop-outs in scope.</div>';
        const after = new Map();
        for (const c of d) {
          const k = c.drop_reason || TAKit.NR;
          if (!after.has(k)) after.set(k, new Map());
          const s = TAKit.STAGES[TAKit.reached(c)];
          after.get(k).set(s, (after.get(k).get(s) || 0) + 1);
        }
        const modeOf = (k) => [...(after.get(k) || new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
        const { items, more } = reasonRows(d, (c) => c.drop_reason || TAKit.NR, {
          note: (c) => `${pctTxt(c.share, 0)} · after ${modeOf(c.key)}`
        });
        return rows({ items, padL: 176, noteW: 132 }) + (more > 0 ? `<div class="chart-note">${fmtInt(more)} further reason${more === 1 ? '' : 's'} not shown.</div>` : '');
      }),
      note: 'Reasons are shown as recorded in the source — they must never carry candidate names.'
    });
  }

  /* ---------- tab ---------- */

  return (panel) => {
    const m = Compute.build(), ctx = Compute.ctxNow();
    const period = `${monthIdxToLabel(ctx.startMonth)} – ${monthIdxToLabel(ctx.endMonth)}`;
    const assetCuts = Access.chartScopes().map((a) => ({ label: a, ov: { asset: a } }));
    const fnCuts = m.has('requisitions')
      ? Compute.countBy(TAKit.book(m, ctx), (r) => r.function).filter((c) => c.key !== '(blank)').slice(0, 10)
        .map((c) => ({ label: c.key, ov: { fn: c.key } }))
      : [];
    panel.innerHTML = `
      <div class="empty-note ta-lead"><strong>Two bases.</strong> <em>Pipeline snapshot</em> = the requisition book as of
        ${esc(CONFIG.asOf)} (status as recorded; the period selector does not apply). <em>Delivery</em> = requisitions
        filled and candidate offers released in the selected period (${esc(period)}). Time to fill = Joining − Open (D3).
        The grade-band filter does not apply to requisitions.</div>

      ${head('Pipeline snapshot', `as of ${CONFIG.asOf} · every in-scope requisition`)}
      ${tiles(['ta_reqs_total', 'ta_reqs_open', 'ta_open_pct', 'ta_on_hold', 'ta_dropped', 'ta_tbo', 'ta_aged_180', 'ta_aged_180_pct'])}
      ${grid([statusCard(m, ctx), ageingCard(m, ctx), tboCard(m, ctx)])}

      ${head('Delivery in period', `${period} · filled = Joining Date (else Closed Date) in period · offers = candidate Offer Date in period`)}
      ${tiles(['ta_joins', 'ta_ttf_median', 'ta_sla_breach', 'ta_offer_accept'])}
      ${grid([ttfHistCard(m, ctx), ttfLevelCard(m, ctx)], 'ta-g2')}

      ${head('Scorecards', 'pipeline as of the as-of date · delivery over the selected period')}
      ${grid([scorecard('Scorecard by asset', 'the selected asset in bold', assetCuts, 'ta_reqs_open', ctx.asset),
        scorecard('Scorecard by function', 'top 10 functions by requisitions in the book', fnCuts, 'ta_reqs_open', null)], 'ta-g2')}

      ${head('Ageing worklist', `open requisitions as of ${CONFIG.asOf}`)}
      ${grid([ageingReasonCard(m, ctx), worklistCard(m, ctx)], 'ta-g12')}

      ${head('Funnel & velocity', 'every candidate on a book requisition')}
      ${tiles(['ta_cand_join_yield', 'ta_bottleneck_days', 'ta_female_applied', 'ta_female_joined'])}
      ${grid([funnelCard(m, ctx), dwellCard(m, ctx), representationCard(m, ctx)])}

      ${head('Sourcing', 'requisition book')}
      ${tiles(['ta_referral_share'])}
      ${grid([hiresBySourceCard(m, ctx), sourceEffCard(m, ctx)], 'ta-g2')}

      ${head('Recruiters', 'requisition book · codes masked by persona')}
      ${tiles(['ta_recruiters', 'ta_recruiter_max_open'])}
      ${grid([recruiterCard(m, ctx), recruiterLoadCard(m, ctx)], 'ta-g2')}

      ${head('Drop analysis', 'requisition book')}
      ${tiles(['ta_drop_rate'])}
      ${grid([reqDropCard(m, ctx), candDropCard(m, ctx)], 'ta-g2')}`;
  };
})();
