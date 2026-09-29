/* Registry — TA Pipeline tab (R4): the TA Command Centre metric set ported onto
   requisitions.csv (+ its lifecycle columns) and candidate_pipeline.csv.

   Two bases, named on every tile and section:
   - Pipeline snapshot — the requisition BOOK: every in-scope requisition opened
     on or before the as-of date, with its status as recorded in the extract.
     The extract carries no status history, so these ignore the period selector.
   - Delivery in period — requisitions filled (Joining Date, else Closed Date) and
     candidate offers released inside the selected period.
   TTF = Joining − Open, fallback Closed − Open (D3). Aged = open > 180 d; the
   worklist is open > 90 d; SLA breach = TTF > 90 d (R4). Candidates are scoped
   through their requisition (asset / segment / function); a candidate whose
   requisition is not in requisitions.csv counts only when nothing narrows scope.
   Every entry sets access: 'hiring'. TAKit holds the shared helpers; the tab
   file (tabs/ta.js) renders from it. */

const TAKit = (() => {

  const SLA_DAYS = 90;        // R4: SLA breach = time to fill above 90 days (TA convention, not a benchmark)
  const TTF_CAP = 540;        // TA Command Centre: medians and distributions keep 0 ≤ d ≤ 540
  const AGED_DAYS = 180;      // D3: aged = open for more than 180 days
  const WORKLIST_DAYS = 90;   // D3: aged-open worklist = open for more than 90 days
  const MIN_N = 5;            // TA 'n<5' guard: no median from fewer than five values
  const STAGES = ['Applied', 'Screened', 'Interview', 'Offered', 'Offer Accepted', 'Joined'];
  const STAGE_COLS = ['applied_date', 'screened_date', 'interview_date', 'offer_date', 'offer_accepted_date', 'joined_date'];
  // days since offer acceptance ([label, lo, hi) like CONFIG buckets)
  const TBO_BUCKETS = [['0–7', 0, 8], ['8–15', 8, 16], ['16–30', 16, 31], ['31–60', 31, 61], ['>60', 61, Infinity]];
  const NR = '(not recorded)';
  // drills and row tables: identifiers handled by Access.maskTable (pseudonyms for
  // 'masked', withheld for 'none'); a Candidate ID column gets the CAN- prefix
  const PII = { ids: ['Recruiter', 'Hired employee', 'Candidate ID'], names: [] };
  const DRILL_MAX = 500;

  /* ---------- per-model memo (the model object is rebuilt on every data change) ---------- */

  const store = new WeakMap();
  function memo(m, key, fn) {
    let c = store.get(m);
    if (!c) { c = new Map(); store.set(m, c); }
    if (!c.has(key)) c.set(key, fn());
    return c.get(key);
  }
  const sk = (ctx) => [ctx.asset, ctx.segment, ctx.fn, ctx.asOfDay, ctx.startMonth, ctx.endMonth].join('|');
  // requisitions carry no grade band, so the band filter never narrows this tab
  const unscoped = (ctx) => Compute.isUnscoped({ ...ctx, band: 'All' });
  const periodFrom = (ctx) => monthEndDay(ctx.startMonth - 1) + 1;
  const inPeriod = (ctx, day) => day != null && day >= periodFrom(ctx) && day <= ctx.asOfDay;

  /* ---------- requisition status (as recorded in the extract) ---------- */

  const isDropped = (r) => r.req_status === 'Dropped';
  // the day a requisition was filled: Joining Date, else Closed Date (D3); never a dropped one
  const filledDay = (r) => (isDropped(r) ? null : r.joining_date ?? r.closed_date ?? null);
  const isFilled = (r, ctx) => { const d = filledDay(r); return d != null && d <= ctx.asOfDay; };
  // open = not joined and not dropped/closed (includes On Hold, Offered and TBO)
  const isOpen = (r, ctx) => Compute.reqOpen(r) && !isFilled(r, ctx);
  const isOnHold = (r, ctx) => isOpen(r, ctx) && r.req_status === 'On Hold';
  const isTBO = (r, ctx) => isOpen(r, ctx) && (r.offer_accepted_date != null || r.req_status === 'TBO');
  const ageOf = (r, ctx) => (r.open_date != null && r.open_date <= ctx.asOfDay ? ctx.asOfDay - r.open_date : null);
  const tboAge = (r, ctx) => (r.offer_accepted_date != null ? Math.max(0, ctx.asOfDay - r.offer_accepted_date) : null);
  function ttf(r) {
    const d = filledDay(r);
    if (d == null || r.open_date == null) return null;
    const t = d - r.open_date;
    return t >= 0 ? t : null;
  }
  const capped = (t) => (t != null && t <= TTF_CAP ? t : null);
  const statusOf = (r, ctx) => (isFilled(r, ctx) ? 'Filled' : isDropped(r) ? 'Dropped' : isTBO(r, ctx) ? 'TBO'
    : isOpen(r, ctx) ? (r.req_status && r.req_status !== 'Closed' ? r.req_status : 'Open') : (r.req_status || 'Closed'));

  /* ---------- populations ---------- */

  function book(m, ctx) {
    return memo(m, 'book|' + sk(ctx), () => m.reqs.filter((r) =>
      Compute.reqMatch(ctx, r) && !(r.open_date != null && r.open_date > ctx.asOfDay)));
  }
  const openReqs = (m, ctx) => memo(m, 'open|' + sk(ctx), () => book(m, ctx).filter((r) => isOpen(r, ctx)));
  const filledInPeriod = (m, ctx) => memo(m, 'fp|' + sk(ctx), () =>
    book(m, ctx).filter((r) => isFilled(r, ctx) && inPeriod(ctx, filledDay(r))));
  const filledBook = (m, ctx) => memo(m, 'fb|' + sk(ctx), () => book(m, ctx).filter((r) => isFilled(r, ctx)));

  function cands(m, ctx) {
    return memo(m, 'cands|' + sk(ctx), () => {
      const inBook = new Set(book(m, ctx));
      const orphanOk = unscoped(ctx);
      return m.candidates.filter((c) => {
        if (c.applied_date != null && c.applied_date > ctx.asOfDay) return false;
        const r = c.requisition_id != null ? m.reqById.get(c.requisition_id) : null;
        return r ? inBook.has(r) : orphanOk;
      });
    });
  }

  // furthest stage reached: the latest dated stage OR the Current Stage, whichever
  // is later — so counts stay monotonic when intermediate dates are missing
  function reached(c) {
    let i = 0;
    for (let k = STAGE_COLS.length - 1; k > 0; k--) if (c[STAGE_COLS[k]] != null) { i = k; break; }
    return Math.max(i, STAGES.indexOf(c.current_stage));
  }
  const genderOf = (c) => (c.gender === 'Female' || c.gender === 'Male' ? c.gender : c.gender ? 'Other' : 'Unknown');
  const offerAccepted = (c) => c.offer_accepted_date != null || c.joined_date != null ||
    c.current_stage === 'Offer Accepted' || c.current_stage === 'Joined';
  const offersInPeriod = (m, ctx) => memo(m, 'offers|' + sk(ctx), () => cands(m, ctx).filter((c) => inPeriod(ctx, c.offer_date)));

  /* ---------- small stats (linear-interpolated quantiles, as the TA dashboard) ---------- */

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const h = (sorted.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
  }
  function stats(values) {
    const v = values.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    return { n: v.length, median: quantile(v, 0.5), p25: quantile(v, 0.25), p75: quantile(v, 0.75) };
  }
  const pct = (a, b) => (b ? a / b * 100 : null);
  // delivery metrics (median, SLA breach, acceptance) are not stated from a base under MIN_N
  const guarded = (n, v) => (n < MIN_N ? null : v);
  const smallNote = (n, what) => (n > 0 && n < MIN_N ? `n<${MIN_N} — ${fmtInt(n)} ${what} in the period, too few to state` : null);
  const femaleShare = (g) => { const known = g.Female + g.Male + g.Other; return known ? g.Female / known * 100 : null; };

  /* ---------- cuts ---------- */

  function funnel(m, ctx) {
    return memo(m, 'funnel|' + sk(ctx), () => {
      const rows = STAGES.map((label) => ({ label, n: 0, g: { Female: 0, Male: 0, Other: 0, Unknown: 0 } }));
      for (const c of cands(m, ctx)) {
        const k = reached(c), g = genderOf(c);
        for (let i = 0; i <= k; i++) { rows[i].n++; rows[i].g[g]++; }
      }
      return rows;
    });
  }

  function dwell(m, ctx) {
    return memo(m, 'dwell|' + sk(ctx), () => {
      const cs = cands(m, ctx);
      const out = [];
      for (let i = 0; i < STAGES.length - 1; i++) {
        const a = STAGE_COLS[i], b = STAGE_COLS[i + 1];
        const vals = [];
        for (const c of cs) {
          if (c[a] == null || c[b] == null) continue;
          const d = c[b] - c[a];
          if (d >= 0 && d <= TTF_CAP) vals.push(d);
        }
        out.push({ from: STAGES[i], to: STAGES[i + 1], ...stats(vals) });
      }
      let bi = -1;
      out.forEach((s, i) => { if (s.median != null && (bi < 0 || s.median > out[bi].median)) bi = i; });
      if (bi >= 0) out[bi].bottleneck = true;
      return out;
    });
  }

  // Pareto rows [{key, n, share, cum}] from [{key, n}] (already sorted desc)
  function pareto(counts) {
    const total = counts.reduce((s, c) => s + c.n, 0);
    let cum = 0;
    return counts.map((c) => { cum += c.n; return { ...c, share: pct(c.n, total), cum: pct(cum, total) }; });
  }

  function recruiters(m, ctx) {
    return memo(m, 'rec|' + sk(ctx), () => {
      const by = new Map();
      for (const r of book(m, ctx)) {
        const k = r.recruiter || '(unassigned)';
        if (!by.has(k)) by.set(k, { key: k, reqs: 0, open: 0, aged: 0, joins: 0, ttf: [] });
        const o = by.get(k);
        o.reqs++;
        if (isOpen(r, ctx)) { o.open++; if (ageOf(r, ctx) > AGED_DAYS) o.aged++; }
        if (isFilled(r, ctx)) { o.joins++; const t = capped(ttf(r)); if (t != null) o.ttf.push(t); }
      }
      return [...by.values()].map((o) => ({ ...o, ttfStats: stats(o.ttf) }))
        .sort((a, b) => b.open - a.open || b.reqs - a.reqs || (a.key < b.key ? -1 : 1));
    });
  }

  // source effectiveness: candidate Source when candidate_pipeline is loaded,
  // else the requisition's Hire Source (the TA Command Centre's req-level view)
  function sources(m, ctx) {
    return memo(m, 'src|' + sk(ctx), () => {
      const by = new Map();
      const get = (k) => {
        if (!by.has(k)) by.set(k, { key: k, reqs: new Set(), cands: 0, joins: 0, ttf: [] });
        return by.get(k);
      };
      const candBased = m.has('candidate_pipeline');
      if (candBased) {
        for (const c of cands(m, ctx)) {
          const o = get(c.source || NR);
          o.cands++;
          if (c.requisition_id != null) o.reqs.add(c.requisition_id);
          if (reached(c) === STAGES.length - 1) {
            o.joins++;
            const r = m.reqById.get(c.requisition_id);
            const t = r ? capped(ttf(r)) : null;
            if (t != null) o.ttf.push(t);
          }
        }
      } else {
        for (const r of book(m, ctx)) {
          const o = get(r.hire_source || NR);
          o.reqs.add(r.requisition_id);
          o.cands++;
          if (isFilled(r, ctx)) { o.joins++; const t = capped(ttf(r)); if (t != null) o.ttf.push(t); }
        }
      }
      const rows = [...by.values()].map((o) => ({
        key: o.key, reqs: o.reqs.size, cands: o.cands, joins: o.joins,
        joinRate: pct(o.joins, o.cands), ttfStats: stats(o.ttf)
      })).sort((a, b) => b.cands - a.cands || (a.key < b.key ? -1 : 1));
      return { candBased, rows };
    });
  }

  /* ---------- drills (row-level; openDrill passes every one through Access.maskDrill) ---------- */

  const D = (d) => (d == null ? '' : fmtDMY(d));
  const n0 = (v) => (v == null ? '' : fmtInt(v));
  function drill(title, columns, rows) {
    const shown = rows.slice(0, DRILL_MAX);
    return {
      title: rows.length > DRILL_MAX ? `${title} — first ${DRILL_MAX} of ${fmtInt(rows.length)}` : title,
      columns, rows: shown, pii: PII
    };
  }
  const OPEN_COLS = ['Requisition', 'Asset', 'Function', 'Level', 'Status', 'Open date', 'Age (d)', 'Ageing reason', 'Recruiter'];
  const openRow = (r, ctx) => [r.requisition_id, r.asset, r.function || '', r.level || '', statusOf(r, ctx),
    D(r.open_date), n0(ageOf(r, ctx)), r.ageing_reason || '', r.recruiter || ''];
  function openDrill(title, list, ctx) {
    const rows = list.slice().sort((a, b) => (ageOf(b, ctx) ?? -1) - (ageOf(a, ctx) ?? -1));
    return drill(`${title} (${fmtInt(rows.length)}) — oldest first`, OPEN_COLS, rows.map((r) => openRow(r, ctx)));
  }
  const FILL_COLS = ['Requisition', 'Asset', 'Function', 'Level', 'Open date', 'Joining date', 'TTF (d)', 'Hire source', 'Recruiter', 'Hired employee'];
  function fillDrill(title, list) {
    const rows = list.slice().sort((a, b) => (ttf(b) ?? -1) - (ttf(a) ?? -1));
    return drill(`${title} (${fmtInt(rows.length)}) — slowest first`, FILL_COLS, rows.map((r) => [
      r.requisition_id, r.asset, r.function || '', r.level || '', D(r.open_date), D(filledDay(r)),
      n0(ttf(r)), r.hire_source || '', r.recruiter || '', r.hired_employee_id || '']));
  }
  const ALL_COLS = ['Requisition', 'Asset', 'Function', 'Level', 'Status', 'Open date', 'Age / TTF (d)', 'Recruiter'];
  function bookDrill(title, list, ctx) {
    const rows = list.slice().sort((a, b) => (b.open_date ?? 0) - (a.open_date ?? 0));
    return drill(`${title} (${fmtInt(rows.length)}) — newest first`, ALL_COLS, rows.map((r) => [
      r.requisition_id, r.asset, r.function || '', r.level || '', statusOf(r, ctx), D(r.open_date),
      n0(isFilled(r, ctx) ? ttf(r) : isOpen(r, ctx) ? ageOf(r, ctx) : null), r.recruiter || '']));
  }
  function droppedDrill(title, list) {
    const rows = list.slice().sort((a, b) => (b.open_date ?? 0) - (a.open_date ?? 0));
    return drill(`${title} (${fmtInt(rows.length)})`, ['Requisition', 'Asset', 'Function', 'Level', 'Open date', 'Drop reason', 'Recruiter'],
      rows.map((r) => [r.requisition_id, r.asset, r.function || '', r.level || '', D(r.open_date), r.drop_reason || NR, r.recruiter || '']));
  }
  function tboDrill(title, list, ctx) {
    const rows = list.slice().sort((a, b) => (tboAge(b, ctx) ?? -1) - (tboAge(a, ctx) ?? -1));
    return drill(`${title} (${fmtInt(rows.length)}) — longest waiting first`,
      ['Requisition', 'Asset', 'Function', 'Level', 'Offer date', 'Offer accepted', 'Days since acceptance', 'Recruiter'],
      rows.map((r) => [r.requisition_id, r.asset, r.function || '', r.level || '', D(r.offer_date), D(r.offer_accepted_date),
        n0(tboAge(r, ctx)), r.recruiter || '']));
  }
  function offerDrill(title, list, m) {
    const rows = list.slice().sort((a, b) => (b.offer_date ?? 0) - (a.offer_date ?? 0));
    return drill(`${title} (${fmtInt(rows.length)}) — newest first`,
      ['Candidate ID', 'Requisition', 'Asset', 'Source', 'Offer date', 'Offer accepted', 'Current stage', 'Drop reason', 'Recruiter'],
      rows.map((c) => [c.candidate_id, c.requisition_id || '', m.reqById.get(c.requisition_id)?.asset || '', c.source || '',
        D(c.offer_date), D(c.offer_accepted_date), c.current_stage || '', c.drop_reason || '', c.recruiter || '']));
  }

  /* ---------- tile quality notes ---------- */

  function blankNote(list, key, what) {
    if (!list.length) return null;
    const blank = list.filter((r) => r[key] == null || r[key] === '').length;
    const p = blank / list.length * 100;
    return p >= 1 ? `${fmtPct(p, 0)} of ${what}` : null;
  }
  function unknownGenderNote(list) {
    if (!list.length) return null;
    const p = list.filter((c) => genderOf(c) === 'Unknown').length / list.length * 100;
    return p > 20 ? `${fmtPct(p, 0)} of candidates have no recorded gender — shares are of known gender only` : null;
  }

  return {
    SLA_DAYS, TTF_CAP, AGED_DAYS, WORKLIST_DAYS, MIN_N, STAGES, STAGE_COLS, TBO_BUCKETS, NR, PII,
    periodFrom, inPeriod, isDropped, filledDay, isFilled, isOpen, isOnHold, isTBO, ageOf, tboAge, ttf, capped, statusOf,
    book, openReqs, filledInPeriod, filledBook, cands, reached, genderOf, offerAccepted, offersInPeriod, guarded, smallNote,
    quantile, stats, pct, femaleShare, funnel, dwell, pareto, recruiters, sources,
    drill, openDrill, fillDrill, bookDrill, droppedDrill, tboDrill, offerDrill, openRow, OPEN_COLS,
    blankNote, unknownGenderNote
  };
})();

/* =================== Pipeline snapshot (the requisition book, as of) =================== */

defineMetric({
  key: 'ta_reqs_total', label: 'Total requisitions', tab: 'ta', group: 'Pipeline snapshot', access: 'hiring',
  unit: '', decimals: 0, direction: null,
  formulaText: 'Count of requisitions in scope with Open Date ≤ as-of\n(the requisition book — open, on hold, TBO, filled and dropped alike)',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date'] }],
  caveat: 'Status is taken from the extract as recorded (no status history), so every Pipeline-snapshot figure is a picture at the as-of date and ignores the period selector. Scope: asset, business segment and function; the grade-band filter does not apply to requisitions.',
  compute: (m, ctx) => TAKit.book(m, ctx).length,
  drill: (m, ctx) => TAKit.bookDrill('Requisition book', TAKit.book(m, ctx), ctx)
});

defineMetric({
  key: 'ta_reqs_open', label: 'Open requisitions', tab: 'ta', group: 'Pipeline snapshot', access: 'hiring',
  unit: '', decimals: 0, direction: null,
  formulaText: 'Requisitions in the book that are neither joined nor dropped/closed:\nno Joining Date, no Closed Date, Req Status ∉ {Dropped, Closed}\n(includes On Hold, Offered and TBO — TA convention)',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Closed Date', 'Req Status', 'Joining Date'] }],
  compute: (m, ctx) => TAKit.openReqs(m, ctx).length,
  drill: (m, ctx) => TAKit.openDrill('Open requisitions', TAKit.openReqs(m, ctx), ctx)
});

defineMetric({
  key: 'ta_open_pct', label: '% of book open', tab: 'ta', group: 'Pipeline snapshot', access: 'hiring',
  unit: '%', decimals: 1, direction: 'lower',
  formulaText: 'Open requisitions ÷ total requisitions (book) × 100',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Closed Date', 'Req Status', 'Joining Date'] }],
  compute: (m, ctx) => TAKit.pct(TAKit.openReqs(m, ctx).length, TAKit.book(m, ctx).length)
});

defineMetric({
  key: 'ta_on_hold', label: 'On hold', tab: 'ta', group: 'Pipeline snapshot', access: 'hiring',
  unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Open requisitions with Req Status = On Hold (count)',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Req Status'] }],
  compute: (m, ctx) => TAKit.openReqs(m, ctx).filter((r) => TAKit.isOnHold(r, ctx)).length,
  drill: (m, ctx) => TAKit.openDrill('Requisitions on hold', TAKit.openReqs(m, ctx).filter((r) => TAKit.isOnHold(r, ctx)), ctx)
});

defineMetric({
  key: 'ta_dropped', label: 'Dropped', tab: 'ta', group: 'Pipeline snapshot', access: 'hiring',
  unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Requisitions in the book with Req Status = Dropped (count)',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Req Status', 'Drop Reason'] }],
  caveat: 'The extract carries no drop date, so drops are counted over the whole book, not by period.',
  compute: (m, ctx) => TAKit.book(m, ctx).filter(TAKit.isDropped).length,
  quality: (m, ctx) => TAKit.blankNote(TAKit.book(m, ctx).filter(TAKit.isDropped), 'drop_reason', 'dropped requisitions have no Drop Reason'),
  drill: (m, ctx) => TAKit.droppedDrill('Dropped requisitions', TAKit.book(m, ctx).filter(TAKit.isDropped))
});

defineMetric({
  key: 'ta_tbo', label: 'TBO (to be onboarded)', tab: 'ta', group: 'Pipeline snapshot', access: 'hiring',
  unit: '', decimals: 0, direction: 'lower',
  formulaText: 'Open requisitions whose offer is accepted but the candidate has not joined:\nOffer Accepted Date present (or Req Status = TBO) and no Joining Date (count)',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Req Status', 'Offer Accepted Date', 'Joining Date'] }],
  caveat: 'Pipeline risk: every TBO is a hire that can still renege. The TBO buckets below age them from the acceptance date.',
  compute: (m, ctx) => TAKit.openReqs(m, ctx).filter((r) => TAKit.isTBO(r, ctx)).length,
  drill: (m, ctx) => TAKit.tboDrill('TBO requisitions', TAKit.openReqs(m, ctx).filter((r) => TAKit.isTBO(r, ctx)), ctx)
});

defineMetric({
  key: 'ta_aged_180', label: 'Aged > 180 days (open)', tab: 'ta', group: 'Pipeline snapshot', access: 'hiring',
  unit: '', decimals: 0, direction: 'lower',
  formulaText: `Open requisitions with (as-of − Open Date) > ${TAKit.AGED_DAYS} days (count)`,
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Closed Date', 'Req Status', 'Joining Date'] }],
  caveat: 'Age is recomputed from Open Date at the as-of date; any ageing column in the source is ignored (TA convention).',
  compute: (m, ctx) => TAKit.openReqs(m, ctx).filter((r) => TAKit.ageOf(r, ctx) > TAKit.AGED_DAYS).length,
  drill: (m, ctx) => TAKit.openDrill(`Open requisitions aged > ${TAKit.AGED_DAYS} days`,
    TAKit.openReqs(m, ctx).filter((r) => TAKit.ageOf(r, ctx) > TAKit.AGED_DAYS), ctx)
});

defineMetric({
  key: 'ta_aged_180_pct', label: '% of open aged > 180 days', tab: 'ta', group: 'Pipeline snapshot', access: 'hiring',
  unit: '%', decimals: 1, direction: 'lower',
  formulaText: `Open requisitions aged > ${TAKit.AGED_DAYS} days ÷ open requisitions × 100`,
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Closed Date', 'Req Status', 'Joining Date'] }],
  compute: (m, ctx) => {
    const open = TAKit.openReqs(m, ctx);
    return TAKit.pct(open.filter((r) => TAKit.ageOf(r, ctx) > TAKit.AGED_DAYS).length, open.length);
  }
});

/* =================== Delivery in the selected period =================== */

defineMetric({
  key: 'ta_joins', label: 'Requisitions filled in period', tab: 'ta', group: 'Delivery in period', access: 'hiring',
  unit: '', decimals: 0, direction: 'higher',
  formulaText: 'Requisitions (not dropped) whose Joining Date — else Closed Date — falls in the selected period (count)',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Joining Date', 'Closed Date', 'Req Status'] }],
  compute: (m, ctx) => TAKit.filledInPeriod(m, ctx).length,
  spark: (m, ctx) => {
    const filled = TAKit.book(m, ctx).filter((r) => TAKit.isFilled(r, ctx));
    return Compute.monthlySeries(m, ctx, (mi) => filled.filter((r) => dayToMonthIdx(TAKit.filledDay(r)) === mi).length);
  },
  drill: (m, ctx) => TAKit.fillDrill('Requisitions filled in period', TAKit.filledInPeriod(m, ctx))
});

defineMetric({
  key: 'ta_ttf_median', label: 'Median time to fill (joining − open)', tab: 'ta', group: 'Delivery in period', access: 'hiring',
  unit: 'd', decimals: 0, direction: 'lower',
  formulaText: `Median of (Joining Date − Open Date) in days over requisitions filled in the period\n(Closed Date when Joining Date is blank — D3); values kept 0 ≤ d ≤ ${TAKit.TTF_CAP}`,
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Joining Date', 'Closed Date', 'Req Status'] }],
  caveat: `D3 measures to the joining day; the CHRO Scorecard’s “Median time to fill” uses this same definition. Linear-interpolated median, as in the TA Command Centre. Not stated from fewer than ${TAKit.MIN_N} filled requisitions.`,
  compute: (m, ctx) => { const s = TAKit.stats(TAKit.filledInPeriod(m, ctx).map((r) => TAKit.capped(TAKit.ttf(r)))); return TAKit.guarded(s.n, s.median); },
  quality: (m, ctx) => {
    const s = TAKit.stats(TAKit.filledInPeriod(m, ctx).map((r) => TAKit.capped(TAKit.ttf(r))));
    return TAKit.smallNote(s.n, 'filled requisitions') || TAKit.blankNote(TAKit.filledInPeriod(m, ctx), 'joining_date', 'filled requisitions have no Joining Date — Closed Date used');
  },
  spark: (m, ctx) => {
    const filled = TAKit.book(m, ctx).filter((r) => TAKit.isFilled(r, ctx));
    return Compute.monthlySeries(m, ctx, (mi) => TAKit.stats(filled
      .filter((r) => dayToMonthIdx(TAKit.filledDay(r)) === mi).map((r) => TAKit.capped(TAKit.ttf(r)))).median);
  },
  drill: (m, ctx) => TAKit.fillDrill('Time to fill — requisitions filled in period', TAKit.filledInPeriod(m, ctx))
});

defineMetric({
  key: 'ta_sla_breach', label: 'SLA breach (TTF > 90 days)', tab: 'ta', group: 'Delivery in period', access: 'hiring',
  unit: '%', decimals: 1, direction: 'lower',
  formulaText: `Requisitions filled in the period with TTF > ${TAKit.SLA_DAYS} days\n÷ requisitions filled in the period with a valid TTF (≥ 0, no cap) × 100`,
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Joining Date', 'Closed Date', 'Req Status'] }],
  caveat: `The ${TAKit.SLA_DAYS}-day SLA is the TA convention named in the requirement — a policy line, not an external benchmark. Not stated from fewer than ${TAKit.MIN_N} filled requisitions.`,
  compute: (m, ctx) => {
    const t = TAKit.filledInPeriod(m, ctx).map(TAKit.ttf).filter((x) => x != null);
    return TAKit.guarded(t.length, TAKit.pct(t.filter((x) => x > TAKit.SLA_DAYS).length, t.length));
  },
  quality: (m, ctx) => TAKit.smallNote(TAKit.filledInPeriod(m, ctx).map(TAKit.ttf).filter((x) => x != null).length, 'filled requisitions'),
  drill: (m, ctx) => TAKit.fillDrill(`Filled in period with TTF > ${TAKit.SLA_DAYS} days`,
    TAKit.filledInPeriod(m, ctx).filter((r) => TAKit.ttf(r) > TAKit.SLA_DAYS))
});

defineMetric({
  key: 'ta_offer_accept', label: 'Offer acceptance rate', tab: 'ta', group: 'Delivery in period', access: 'hiring',
  unit: '%', decimals: 1, direction: 'higher',
  formulaText: 'Candidate offers released in the period that were accepted\n(Offer Accepted Date present, or the candidate reached Offer Accepted / Joined)\n÷ candidate offers released in the period (Offer Date in period) × 100',
  inputs: [{ dataset: 'candidate_pipeline', columns: ['Candidate ID', 'Requisition ID', 'Offer Date', 'Offer Accepted Date', 'Joined Date', 'Current Stage'] },
           { dataset: 'requisitions', columns: ['Requisition ID', 'Asset'] }],
  caveat: 'Counted per candidate offer: a requisition row carries only the selected candidate’s offer, so a requisition-level rate would read close to 100%. Offers released in the last few days may not be answered yet.',
  compute: (m, ctx) => {
    const o = TAKit.offersInPeriod(m, ctx);
    return TAKit.guarded(o.length, TAKit.pct(o.filter(TAKit.offerAccepted).length, o.length));
  },
  quality: (m, ctx) => {
    const o = TAKit.offersInPeriod(m, ctx);
    const r = TAKit.pct(o.filter(TAKit.offerAccepted).length, o.length);
    return TAKit.smallNote(o.length, 'offers') || (o.length > 20 && r >= 97 ? '≥97% acceptance on more than 20 offers — declined offers are probably not being logged' : null);
  },
  drill: (m, ctx) => TAKit.offerDrill('Candidate offers released in period', TAKit.offersInPeriod(m, ctx), m)
});

/* =================== Funnel & velocity (candidates on book requisitions) =================== */

defineMetric({
  key: 'ta_cand_join_yield', label: 'Applicant-to-join yield', tab: 'ta', group: 'Funnel & velocity', access: 'hiring',
  unit: '%', decimals: 1, direction: 'higher',
  formulaText: 'Candidates who reached Joined ÷ candidates in the funnel (Applied) × 100\nA candidate reached a stage if it carries that stage’s date, any later stage’s date,\nor a later Current Stage (keeps the funnel monotonic when dates are missing)',
  inputs: [{ dataset: 'candidate_pipeline', columns: ['Candidate ID', 'Requisition ID', 'Applied Date', 'Screened Date', 'Interview Date', 'Offer Date', 'Offer Accepted Date', 'Joined Date', 'Current Stage'] },
           { dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date'] }],
  caveat: 'Whole book, not the period: recent applicants have not had time to progress, so a period cohort would understate conversion.',
  compute: (m, ctx) => {
    const f = TAKit.funnel(m, ctx);
    return TAKit.pct(f[f.length - 1].n, f[0].n);
  }
});

defineMetric({
  key: 'ta_bottleneck_days', label: 'Bottleneck stage dwell', tab: 'ta', group: 'Funnel & velocity', access: 'hiring',
  unit: 'd', decimals: 0, direction: 'lower',
  formulaText: `Largest median dwell among the five stage transitions\n(Applied→Screened, Screened→Interview, Interview→Offered, Offered→Offer Accepted, Offer Accepted→Joined);\neach median over candidates carrying both dates, 0 ≤ d ≤ ${TAKit.TTF_CAP}`,
  inputs: [{ dataset: 'candidate_pipeline', columns: ['Candidate ID', 'Requisition ID', 'Applied Date', 'Screened Date', 'Interview Date', 'Offer Date', 'Offer Accepted Date', 'Joined Date'] },
           { dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date'] }],
  caveat: 'The stage-dwell chart names the bottleneck transition (in red) with its p25–p75 and n.',
  compute: (m, ctx) => TAKit.dwell(m, ctx).find((s) => s.bottleneck)?.median ?? null
});

/* =================== Sourcing & representation =================== */

defineMetric({
  key: 'ta_referral_share', label: 'Referral share of hires', tab: 'ta', group: 'Sourcing', access: 'hiring',
  unit: '%', decimals: 1, direction: null,
  formulaText: 'Filled requisitions (book) with Hire Source = Employee Referral\n÷ filled requisitions with a recorded Hire Source × 100',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Joining Date', 'Closed Date', 'Req Status', 'Hire Source'] }],
  compute: (m, ctx) => {
    const f = TAKit.filledBook(m, ctx).filter((r) => r.hire_source);
    return TAKit.pct(f.filter((r) => /^employee referral$/i.test(String(r.hire_source).trim())).length, f.length);
  },
  quality: (m, ctx) => TAKit.blankNote(TAKit.filledBook(m, ctx), 'hire_source', 'filled requisitions have no Hire Source')
});

defineMetric({
  key: 'ta_female_applied', label: 'Female share of applicants', tab: 'ta', group: 'Funnel & velocity', access: 'hiring',
  unit: '%', decimals: 1, direction: null,
  formulaText: 'Female ÷ (Female + Male + Other) among candidates in the funnel (book) × 100\nBlank gender = Unknown: excluded from the denominator and shown explicitly',
  inputs: [{ dataset: 'candidate_pipeline', columns: ['Candidate ID', 'Requisition ID', 'Gender'] },
           { dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date'] }],
  compute: (m, ctx) => TAKit.femaleShare(TAKit.funnel(m, ctx)[0].g),
  quality: (m, ctx) => TAKit.unknownGenderNote(TAKit.cands(m, ctx))
});

defineMetric({
  key: 'ta_female_joined', label: 'Female share of joiners', tab: 'ta', group: 'Funnel & velocity', access: 'hiring',
  unit: '%', decimals: 1, direction: null,
  formulaText: 'Female ÷ (Female + Male + Other) among candidates who reached Joined (book) × 100\nRead against the applicant share: a drop along the funnel shows where representation is lost',
  inputs: [{ dataset: 'candidate_pipeline', columns: ['Candidate ID', 'Requisition ID', 'Gender', 'Joined Date', 'Current Stage'] },
           { dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date'] }],
  compute: (m, ctx) => { const f = TAKit.funnel(m, ctx); return TAKit.femaleShare(f[f.length - 1].g); },
  quality: (m, ctx) => TAKit.unknownGenderNote(TAKit.cands(m, ctx).filter((c) => TAKit.reached(c) === TAKit.STAGES.length - 1))
});

/* =================== Recruiters =================== */

defineMetric({
  key: 'ta_recruiters', label: 'Recruiters with requisitions', tab: 'ta', group: 'Recruiters', access: 'hiring',
  unit: '', decimals: 0, direction: null,
  formulaText: 'Distinct non-blank Recruiter values on requisitions in the book',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Recruiter'] }],
  compute: (m, ctx) => new Set(TAKit.book(m, ctx).map((r) => r.recruiter).filter(Boolean)).size,
  quality: (m, ctx) => TAKit.blankNote(TAKit.book(m, ctx), 'recruiter', 'requisitions have no Recruiter')
});

defineMetric({
  key: 'ta_recruiter_max_open', label: 'Highest open load (one recruiter)', tab: 'ta', group: 'Recruiters', access: 'hiring',
  unit: '', decimals: 0, direction: null,
  formulaText: 'Maximum over recruiters of open requisitions assigned (count)\nRead with the median load in the productivity table — balanced is better',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Closed Date', 'Req Status', 'Joining Date', 'Recruiter'] }],
  compute: (m, ctx) => {
    const r = TAKit.recruiters(m, ctx).filter((x) => x.key !== '(unassigned)');
    return r.length ? Math.max(...r.map((x) => x.open)) : null;
  }
});

/* =================== Drops =================== */

defineMetric({
  key: 'ta_drop_rate', label: 'Requisition drop rate', tab: 'ta', group: 'Drop analysis', access: 'hiring',
  unit: '%', decimals: 1, direction: 'lower',
  formulaText: 'Dropped requisitions ÷ total requisitions (book) × 100',
  inputs: [{ dataset: 'requisitions', columns: ['Requisition ID', 'Asset', 'Open Date', 'Req Status', 'Drop Reason'] }],
  compute: (m, ctx) => TAKit.pct(TAKit.book(m, ctx).filter(TAKit.isDropped).length, TAKit.book(m, ctx).length),
  drill: (m, ctx) => TAKit.droppedDrill('Dropped requisitions', TAKit.book(m, ctx).filter(TAKit.isDropped))
});
