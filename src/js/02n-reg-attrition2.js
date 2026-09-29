/* Registry — Attrition page additions (R5, reference page 3 structure):
   fiscal-YTD KPI strip (D6 absolute attrition), involuntary rate, annualised
   attrition RATE cuts by tenure / company / asset / function plant / MC member /
   management band / level / generation / gender, reason categories, and the
   employee-wise details rows. Retirements are never attrition: they are counted
   in their own tile and excluded from every rate here.
   AttrKit is this feature's only top-level name; tabs/attrition.js composes the
   page from it. Nothing here runs at load time except defineMetric. */

const AttrKit = (() => {

  const MIN_BASE = 20;          // average headcount below which a rate is flagged "small base"
  const TOP_PLANTS = 12;        // function plants drawn (highest rates with an adequate base)
  const BLANK = '(blank)';      // Compute.countBy / rateBy blank key
  const TYPES = ['All', 'Voluntary', 'Involuntary'];
  const state = { type: 'All' }; // page-level exit-type toggle (session memory only)

  const typePred = (type) => (type === 'Voluntary' || type === 'Involuntary' ? (x) => x.exit_type === type : null);
  const typeLabel = (type) => (type === 'All' ? 'All exit types' : type + ' exits');
  const periodLabel = (ctx) => `${monthIdxToLabel(ctx.startMonth)} – ${monthIdxToLabel(ctx.endMonth)}`;
  const short = (s, n = 17) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* ---------- fiscal YTD (D5 / D6) ---------- */

  function ytdCtx(ctx) {
    const s = fyStartMonthIdx(ctx.endMonth);
    return { ...ctx, startMonth: s, periodMonths: ctx.endMonth - s + 1 };
  }
  const ytdLabel = (ctx) => periodLabel(ytdCtx(ctx));
  // attrition separations (voluntary + involuntary), permanent roll, FY start → as-of
  const sepYtd = (m, ctx) => Compute.exitsInPeriod(m, ytdCtx(ctx), 'Permanent');
  const retYtd = (m, ctx) => Compute.exitsInPeriod(m, ytdCtx(ctx), 'Permanent', true).filter((x) => !x.__attr);
  // opening headcount = close of the day before the fiscal year starts
  const hcFyStart = (m, ctx) => Compute.activesAt(m, ctx, 'Permanent', Compute.fyStartDay(ctx) - 1).length;
  const hcAsOf = (m, ctx) => Compute.actives(m, ctx, 'Permanent').length;
  function absYtd(m, ctx) {
    const avg = (hcFyStart(m, ctx) + hcAsOf(m, ctx)) / 2;
    return avg ? sepYtd(m, ctx).length / avg * 100 : null;
  }

  /* ---------- dimensions for the rate cuts ---------- */

  const companyOf = (m, e) => e.company || Compute.orgOf(m, e.function_plant)?.company || null;
  const mcOf = (m, e) => Compute.orgOf(m, e.function_plant)?.mc_member || null;
  const byKeyNatural = (a, b) => String(a.key).localeCompare(String(b.key), 'en', { numeric: true });

  // employee_master columns every attrition figure reads
  const EMP_IN = ['Employee ID', 'Date of Joining', 'Employee Class'];
  const genRule = CONFIG.generations.map(([g, lo, hi]) =>
    `${g} ${lo === -Infinity ? '≤' + (hi - 1) : hi === Infinity ? lo + '+' : lo + '–' + String(hi - 1).slice(2)}`).join(', ');

  // cols = extra employee_master columns (canonical names); blank = [row key, label] for the tile note
  const DIMS = [
    { id: 'tenure', key: 'attr_rate_tenure', noun: 'tenure bucket', plural: 'tenure buckets', col: 'Tenure',
      title: 'Attrition rate by tenure', needs: ['exits', 'employee_master'],
      cols: ['Date of Joining'], blank: ['doj', 'Date of Joining'],
      rule: 'Tenure = years from Date of Joining to each month-end (headcount) or to the exit date (exits),\nbucketed ' + CONFIG.tenureBuckets.map((b) => b[0]).join(' / '),
      keyFn: () => (e, day) => (e.doj == null ? null : bucketOf(yearsBetween(e.doj, day), CONFIG.tenureBuckets)),
      order: () => CONFIG.tenureBuckets.map((b) => b[0]) },
    { id: 'gender', key: 'attr_rate_gender', noun: 'gender', plural: 'genders', col: 'Gender',
      title: 'Attrition rate by gender', needs: ['exits', 'employee_master'],
      cols: ['Gender'], blank: ['gender', 'Gender'],
      rule: 'Gender from the employee master — rates per gender do not add up to the total',
      keyFn: () => (e) => e.gender || null, order: () => ENUMS.gender },
    { id: 'generation', key: 'attr_rate_generation', noun: 'generation', plural: 'generations', col: 'Generation',
      title: 'Attrition rate by generation', needs: ['exits', 'employee_master'],
      cols: ['DOB'], blank: ['dob', 'DOB'],
      rule: 'Generation from the DOB birth year: ' + genRule,
      keyFn: () => (e) => generationOf(e.dob), order: () => CONFIG.generations.map((g) => g[0]) },
    { id: 'band', key: 'attr_rate_band', noun: 'management band', plural: 'management bands', col: 'Management band',
      title: 'Attrition rate by management band', needs: ['exits', 'employee_master'],
      cols: ['Management Band'], blank: ['mgmt_band', 'Management Band'],
      rule: 'Management Band from the employee master (' + CONFIG.mgmtBands.join(' / ') + ')',
      keyFn: () => (e) => e.mgmt_band || null, order: () => CONFIG.mgmtBands,
      labelOf: (k) => CONFIG.mgmtBandLabels[k] || k },
    { id: 'level', key: 'attr_rate_level', noun: 'level', plural: 'levels', col: 'Level',
      title: 'Attrition rate by level', needs: ['exits', 'employee_master'],
      cols: ['Level'], blank: ['level', 'Level'],
      rule: 'Level from the employee master, ladder order ' + CONFIG.levels[0] + ' … ' + CONFIG.levels[CONFIG.levels.length - 1],
      keyFn: () => (e) => e.level || null, order: () => CONFIG.levels },
    { id: 'company', key: 'attr_rate_company', noun: 'company', plural: 'companies', col: 'Company',
      title: 'Attrition rate by company', needs: ['exits', 'employee_master'],
      cols: ['Company', 'Function Plant'], blank: ['company', 'Company'],
      rule: 'Company from the employee master (else org_units by Function Plant)',
      keyFn: (m) => (e) => companyOf(m, e), order: () => CONFIG.companies },
    { id: 'asset', key: 'attr_rate_asset', noun: 'asset', plural: 'assets', col: 'Asset',
      title: 'Attrition rate by asset', needs: ['exits', 'employee_master'],
      cols: ['Asset'], blank: ['asset', 'Asset'],
      rule: 'Asset from the employee master; the chart draws the persona’s chart scopes (assets + Group)',
      keyFn: () => (e) => e.asset || null, order: () => CONFIG.assets },
    { id: 'mc', key: 'attr_rate_mc', noun: 'MC member', plural: 'MC members', col: 'MC member',
      title: 'Attrition rate by MC member', needs: ['exits', 'employee_master', 'org_units'],
      cols: ['Function Plant'], blank: null,
      rule: 'MC Member from org_units, joined on the employee’s Function Plant',
      keyFn: (m) => (e) => mcOf(m, e), sort: byKeyNatural },
    { id: 'plant', key: 'attr_rate_plant', noun: 'function plant', plural: 'function plants', col: 'Function plant',
      title: `Attrition rate by function plant — top ${TOP_PLANTS}`, needs: ['exits', 'employee_master'],
      cols: ['Function Plant'], blank: ['function_plant', 'Function Plant'],
      rule: `Function Plant from the employee master; the chart draws the ${TOP_PLANTS} highest rates`,
      keyFn: () => (e) => e.function_plant || null, top: TOP_PLANTS }
  ];
  const DIM_BY_ID = new Map(DIMS.map((d) => [d.id, d]));

  const blankLabel = (dim) => (dim.id === 'mc' ? '(no org_units match)' : '(not recorded)');

  function decorate(r, dim) {
    const suppressed = Access.suppressed(r.exits);
    return {
      key: r.key,
      label: r.key === BLANK ? blankLabel(dim) : (dim.labelOf ? dim.labelOf(r.key) : String(r.key)),
      exits: r.exits, avgHc: r.avgHc,
      rate: suppressed ? null : r.rate,
      small: r.avgHc < MIN_BASE, blank: r.key === BLANK, suppressed
    };
  }

  // per-asset rows iterate the persona's chart scopes (peers never reach a locked persona)
  function assetRows(m, ctx, pred) {
    const scopes = Access.chartScopes();
    const zero = (s) => ({ key: s, exits: 0, avgHc: 0, rate: null });
    const one = (s) => Compute.rateBy(m, { ...ctx, asset: s }, () => s, { pred })[0] || zero(s);
    // a persona allowed the Group view gets every asset from one pass at Group scope
    if (!scopes.includes('Group') && ctx.asset !== 'Group') return scopes.map(one);
    const g = { ...ctx, asset: 'Group' };
    const by = new Map(Compute.rateBy(m, g, (e) => e.asset, { pred }).map((r) => [r.key, r]));
    return scopes.map((s) => (s === 'Group' ? one(s) : by.get(s) || zero(s)));
  }

  // one cut: [{key, label, exits, avgHc, rate, small, blank, suppressed}] in display order
  function cut(m, ctx, dim, type = 'All') {
    const pred = typePred(type);
    let rows = dim.id === 'asset' ? assetRows(m, ctx, pred)
      : Compute.rateBy(m, ctx, dim.keyFn(m), { pred, order: dim.order ? dim.order() : undefined });
    if (dim.sort) rows = rows.slice().sort((a, b) => (a.key === BLANK) - (b.key === BLANK) || dim.sort(a, b));
    return rows.map((r) => decorate(r, dim));
  }

  const eligible = (rows) => rows.filter((r) => !r.small && !r.blank && r.rate != null);
  function peakRow(rows) {
    const el = eligible(rows);
    return el.length ? el.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
  }
  // metric value of a cut: the highest rate among values with an adequate base
  function peak(m, ctx, dim) {
    const rows = dim.id === 'asset'
      ? Compute.rateBy(m, ctx, dim.keyFn(m)).map((r) => decorate(r, dim))
      : cut(m, ctx, dim, 'All');
    const p = peakRow(rows);
    return p ? p.rate : null;
  }

  // top-N plants by rate among adequate bases; the rest are counted in the note
  function topPlants(rows, n) {
    const el = eligible(rows).sort((a, b) => b.rate - a.rate);
    return { shown: el.slice(0, n), omitted: rows.length - Math.min(el.length, n), total: rows.length };
  }

  function tipOf(r, type, extra) {
    return [
      r.label,
      `${typeLabel(type)} · annualised rate: ${r.rate == null ? (r.suppressed ? 'suppressed (small cell)' : '—') : fmtPct(r.rate, 1)}`,
      `Exits: ${Access.cellText(r.exits)} · average headcount: ${fmtNum(r.avgHc, 1)}`,
      r.small ? `* small base (average headcount < ${MIN_BASE})` : '',
      extra || ''
    ].filter(Boolean).join('\n');
  }

  // Charts.barH items for a cut; the highest adequate-base rate (or the focused
  // asset) is Smart Red, small bases and blanks are grey and marked *
  function cutItems(m, ctx, dim, type) {
    const all = cut(m, ctx, dim, type);
    let rows = all, note = '';
    const empty = !all.length ? 'No headcount in scope for this cut.'
      : all.every((r) => r.blank) ? `${dim.col} is not recorded for anyone in scope — nothing to cut by.`
      : `No ${dim.noun} reaches an average headcount of ${MIN_BASE} in scope.`;
    if (dim.top) {
      const t = topPlants(all, dim.top);
      rows = t.shown;
      note = `${fmtInt(t.shown.length)} of ${fmtInt(t.total)} plants shown — highest rates with average headcount ≥ ${MIN_BASE}` +
        (t.omitted ? `; ${fmtInt(t.omitted)} not drawn (lower rate, small base${Access.suppressionOn() ? ', suppressed cell' : ''} or blank) — full list in the table` : '');
    }
    const drillable = Access.canDrill(dim.key);
    const focusKey = dim.id === 'asset' ? ctx.asset : peakRow(rows)?.key;
    const locked = !!Access.lockedAsset();
    const items = rows.map((r) => {
      const isFocus = r.key === focusKey;
      const setAsset = dim.id === 'asset' && !locked ? r.key : null;
      return {
        label: short(r.label) + (r.small ? ' *' : ''),
        value: r.rate,
        sub: r.suppressed ? `<${CONFIG.minCell} exits` : '',
        role: isFocus ? 'focus' : (r.small || r.blank) ? 'ctx' : undefined,
        tip: tipOf(r, type, setAsset ? (r.key === 'Group' ? 'Click to reset focus' : 'Click to focus ' + r.key)
          : drillable ? 'Click for the full table' : ''),
        setAsset,
        drill: !setAsset && drillable ? dim.key : null
      };
    });
    const flags = [];
    if (rows.some((r) => r.small)) flags.push(`* grey = small base (average headcount < ${MIN_BASE}); rates swing on a handful of exits`);
    if (rows.some((r) => r.suppressed)) flags.push(`— = fewer than ${CONFIG.minCell} exits, suppressed for this persona`);
    return { items, note: items.length ? [note, ...flags].filter(Boolean).join(' · ') : '', empty };
  }

  // aggregate drill table for a cut: all, voluntary and involuntary side by side
  function cutTable(m, ctx, dim) {
    const [all, vol, inv] = TYPES.map((t) => cut(m, ctx, dim, t));
    const find = (rows, k) => rows.find((r) => r.key === k) || { exits: 0, rate: null, suppressed: false };
    let rows = all;
    if (dim.top) rows = all.slice().sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
    const pct = (r) => (r.rate == null ? (r.suppressed ? 'suppressed' : '—') : fmtPct(r.rate, 1));
    return {
      title: `Attrition by ${dim.noun} — ${periodLabel(ctx)}, annualised (${rows.length})`,
      columns: [dim.col, 'Avg headcount', 'Exits', 'Voluntary', 'Involuntary', 'Rate — all', 'Rate — voluntary', 'Rate — involuntary', 'Base'],
      rows: rows.map((r) => {
        const v = find(vol, r.key), i = find(inv, r.key);
        return [r.label, fmtNum(r.avgHc, 1), Access.cellText(r.exits), Access.cellText(v.exits), Access.cellText(i.exits),
          pct(r), pct(v), pct(i), r.blank ? 'blank' : r.small ? `small (< ${MIN_BASE})` : 'ok'];
      })
    };
  }

  function blankNote(m, ctx, key, label) {
    return Compute.blankShareNote(m, ctx, 'employee_master', key, label);
  }
  function unmatchedPlantNote(m) {
    if (!m.emps.length) return null;
    const miss = m.emps.filter((e) => !Compute.orgOf(m, e.function_plant)).length;
    return miss ? `${fmtPct(miss / m.emps.length * 100, 1)} of employees have a Function Plant not found in org_units — shown as “(no org_units match)”` : null;
  }

  /* ---------- reason categories ---------- */

  function reasonRows(m, ctx, type) {
    const pred = typePred(type);
    const xs = Compute.exitsInPeriod(m, ctx, 'Permanent').filter((x) => !pred || pred(x));
    return { xs, rows: Compute.countBy(xs, (x) => x.exit_reason_category || null, ENUMS.exitReasonCategory) };
  }

  function reasonItems(m, ctx, type) {
    const { xs, rows } = reasonRows(m, ctx, type);
    const named = rows.filter((r) => r.key !== BLANK);
    const topKey = named.slice().sort((a, b) => b.n - a.n)[0]?.key;
    const items = rows.slice().sort((a, b) => (a.key === BLANK) - (b.key === BLANK) || b.n - a.n).map((r) => {
      const sup = Access.suppressed(r.n);
      const label = r.key === BLANK ? '(not recorded)' : r.key;
      return {
        label: short(label), value: sup ? null : r.n, sub: sup ? `<${CONFIG.minCell}` : '',
        role: r.key === topKey ? 'focus' : r.key === BLANK ? 'ctx' : undefined,
        tip: `${label}\n${typeLabel(type)}: ${Access.cellText(r.n)} exits${sup ? '' : ` (${fmtPct(r.n / xs.length * 100, 1)} of ${fmtInt(xs.length)})`}`,
        drill: Access.canDrill('attr_reason_top') ? 'attr_reason_top' : null
      };
    });
    return { items, total: xs.length, hasCategory: named.length > 0 };
  }

  function reasonTable(m, ctx) {
    const [all, vol, inv] = TYPES.map((t) => reasonRows(m, ctx, t));
    const n = (res, k) => res.rows.find((r) => r.key === k)?.n || 0;
    return {
      title: `Exits by reason category — ${periodLabel(ctx)} (${all.xs.length})`,
      columns: ['Reason category', 'Exits', 'Share', 'Voluntary', 'Involuntary'],
      rows: all.rows.map((r) => [r.key === BLANK ? '(not recorded)' : r.key, Access.cellText(r.n),
        Access.suppressed(r.n) ? 'suppressed' : fmtPct(r.n / all.xs.length * 100, 1),
        Access.cellText(n(vol, r.key)), Access.cellText(n(inv, r.key))])
    };
  }

  /* ---------- employee-wise detail rows ---------- */

  const DETAIL_COLUMNS = ['Employee ID', 'Name', 'Level', 'Band', 'Company', 'Asset', 'Function Plant', 'Exit date', 'Type', 'Reason category', 'Tenure (yrs)'];

  function detailRows(m, xs) {
    return xs.slice().sort((a, b) => b.exit_date - a.exit_date || String(a.employee_id).localeCompare(String(b.employee_id)))
      .map((x) => {
        const e = x.__emp;
        return [x.employee_id, e.name || '', e.level || '', CONFIG.mgmtBandLabels[e.mgmt_band] || e.mgmt_band || '',
          companyOf(m, e) || '', e.asset || '', e.function_plant || '', fmtDMY(x.exit_date), x.exit_type || '',
          x.exit_reason_category || '(blank)', e.doj != null ? fmtNum(yearsBetween(e.doj, x.exit_date), 1) : ''];
      });
  }

  // separations in the selected period for the details table (toggle-scoped)
  const periodExits = (m, ctx, type) => {
    const pred = typePred(type);
    return Compute.exitsInPeriod(m, ctx, 'Permanent').filter((x) => !pred || pred(x));
  };

  /* ---------- small aggregate drills ---------- */

  function hcByAssetBand(m, ctx, day, title) {
    const rows = [];
    for (const asset of Access.chartScopes().filter((a) => a !== 'Group')) {
      if (ctx.asset !== 'Group' && asset !== ctx.asset) continue;
      for (const band of CONFIG.mgmtBands) {
        const n = Compute.activesAt(m, { ...ctx, asset }, 'Permanent', day).filter((e) => e.mgmt_band === band).length;
        rows.push([asset, CONFIG.mgmtBandLabels[band] || band, fmtInt(n)]);
      }
    }
    return { title, columns: ['Asset', 'Management band', 'Permanent headcount'], rows };
  }

  function absByAsset(m, ctx) {
    const rows = Access.chartScopes().map((s) => {
      const c = { ...ctx, asset: s };
      const open = hcFyStart(m, c), close = hcAsOf(m, c), sep = sepYtd(m, c).length;
      const avg = (open + close) / 2;
      return [s, fmtInt(open), fmtInt(close), fmtNum(avg, 1), Access.cellText(sep),
        Access.suppressed(sep) ? 'suppressed' : avg ? fmtPct(sep / avg * 100, 2) : '—'];
    });
    return {
      title: `Absolute attrition — fiscal YTD ${ytdLabel(ctx)}, by asset`,
      columns: ['Asset', 'FY-start headcount', 'As-of headcount', 'Average', 'Separations YTD', 'Absolute attrition'],
      rows
    };
  }

  /* ---------- page fragments (composed by tabs/attrition.js; run after load) ---------- */

  const DETAIL_LIMIT = 100;     // rows drawn on the page; the CSV carries every row
  const loaded = (ids) => ids.every((id) => App.state.datasets.has(id));
  const missingHTML = (ids) => `<div class="chart-empty">No data loaded for this chart — needs ${esc(ids.map((i) => i + '.csv').join(', '))}.</div>`;

  // native radios: arrow keys move + select inside the group, Tab leaves it
  function toolbarHTML() {
    return `<div class="attr-bar" id="attr-bar">
      <div class="attr-toggle" role="radiogroup" aria-labelledby="attr-type-lbl">
        <span class="attr-toggle-k" id="attr-type-lbl">Exit type</span>
        ${TYPES.map((t) => `<label class="attr-opt"><input type="radio" name="attr-type" value="${esc(t)}"${t === state.type ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('')}
      </div>
      <span class="attr-bar-note">Re-scopes the rate cuts, the reason chart and the attrition details ·
        the year-to-date strip, trends and type split always cover every exit type · retirements are never attrition</span>
    </div>`;
  }

  // one rateBy row for the whole scope and type (the "overall" reference in card subs)
  function overall(m, ctx, type) {
    const r = Compute.rateBy(m, ctx, () => 'all', { pred: typePred(type) })[0];
    return r ? decorate(r, { id: 'overall' }) : null;
  }

  function cutsHTML(m, ctx, type) {
    const tot = loaded(['exits', 'employee_master']) ? overall(m, ctx, type) : null;
    const ref = tot && tot.rate != null ? ` · overall ${fmtPct(tot.rate, 1)}` : '';
    const cards = DIMS.map((dim) => {
      let body, note = '';
      if (!loaded(dim.needs)) body = missingHTML(dim.needs);
      else {
        const r = cutItems(m, ctx, dim, type);
        note = r.note;
        body = r.items.length ? Charts.barH({ items: r.items, fmt: (v) => fmtPct(v, 1) })
          : `<div class="chart-empty">${esc(r.empty)}</div>`;
      }
      const how = dim.id === 'asset' ? (Access.lockedAsset() ? 'own asset + Group benchmark' : 'selected scope in red — click a bar to focus')
        : 'highest adequate-base rate in red — click a bar for the table';
      return Charts.card({ title: dim.title, sub: `${typeLabel(type)} · annualised${ref} · ${how}`, infoKey: dim.key, body, note });
    });
    // reason categories (counts, not rates)
    let rBody, rNote = '';
    if (!loaded(['exits', 'employee_master'])) rBody = missingHTML(['exits', 'employee_master']);
    else {
      const r = reasonItems(m, ctx, type);
      rBody = !r.total ? '<div class="chart-empty">No exits of this type in the selected period.</div>'
        : r.hasCategory ? Charts.barH({ items: r.items, fmt: (v) => fmtInt(v) })
        : '<div class="chart-empty">Exit Reason Category is not filled in exits.csv — the free-text reasons are on “Exits by stated reason”.</div>';
      rNote = r.total ? `${Access.cellText(r.total)} exits in the period; blank categories surfaced, not hidden` : '';
    }
    cards.push(Charts.card({ title: 'Exits by reason category', sub: `${typeLabel(type)} · counts · largest category in red`, infoKey: 'attr_reason_top', body: rBody, note: rNote }));
    return `<div class="section-head"><h2>Attrition rate by dimension</h2>
        <span class="sub" data-attr-type-sub>${esc(typeLabel(type))} · annualised · ${esc(periodLabel(ctx))} · permanent roll · retirements excluded</span></div>
      <div class="card-grid attr-cuts">${cards.join('')}</div>`;
  }

  // vol / invol / all rates for the scope — every type, independent of the toggle
  function typeChartHTML(m, ctx) {
    const needs = ['exits', 'employee_master'];
    let body, note = '';
    if (!loaded(needs)) body = missingHTML(needs);
    else {
      const rows = TYPES.map((t) => ({ t, r: overall(m, ctx, t) || { exits: 0, avgHc: 0, rate: null, suppressed: false } }));
      const ret = Compute.exitsInPeriod(m, ctx, 'Permanent', true).filter((x) => !x.__attr).length;
      body = Charts.barH({
        items: rows.map(({ t, r }) => ({
          label: t === 'All' ? 'All types' : t, value: r.rate,
          sub: r.suppressed ? `<${CONFIG.minCell} exits` : '',
          role: t === 'Voluntary' ? 'focus' : t === 'All' ? 'ctx' : undefined,
          tip: `${t === 'All' ? 'All exit types' : t}: ${r.rate == null ? '—' : fmtPct(r.rate, 1)} annualised\nExits: ${Access.cellText(r.exits)} · average headcount: ${fmtNum(r.avgHc, 1)}`
        })),
        fmt: (v) => fmtPct(v, 1)
      });
      note = rows.map(({ t, r }) => `${t === 'All' ? 'All' : t} ${Access.cellText(r.exits)}`).join(' · ') +
        ` exits · ${Access.cellText(ret)} retirements in the period, counted separately`;
    }
    return Charts.card({
      title: 'Attrition rate by type', sub: `annualised · ${periodLabel(ctx)} · voluntary (the retention lever) in red`,
      infoKey: 'attr_involuntary', body, note
    });
  }

  // {title, columns, rows} of the toggle-scoped separations, identifiers handled
  // for the persona — null when row-level detail is withheld
  function detailsTable(m, ctx, type) {
    if (!loaded(['exits', 'employee_master']) || Access.level('attr_sep_ytd') !== 'full') return null;
    const xs = periodExits(m, ctx, type);
    const t = Access.maskTable(DETAIL_COLUMNS, detailRows(m, xs));
    return t ? { title: `Attrition details ${typeLabel(type)} ${periodLabel(ctx)}`, ...t } : null;
  }

  function detailsHTML(m, ctx, type) {
    const head = `<div class="section-head"><h2>Attrition details — employee-wise</h2>
      <span class="sub">${esc(typeLabel(type))} · permanent roll · ${esc(periodLabel(ctx))} · retirements excluded (see Retirements — fiscal YTD)</span></div>`;
    const wrap = (inner, restricted) => `${head}<div class="card attr-details${restricted ? ' is-restricted' : ''}" data-access="core">
      <div class="card-title">Separations in the selected period</div>${inner}</div>`;
    if (!loaded(['exits', 'employee_master'])) return wrap(missingHTML(['exits', 'employee_master']));
    const t = detailsTable(m, ctx, type);
    if (!t) {
      const why = Access.level('attr_sep_ytd') !== 'full' ? 'aggregate-only access to this data class' : 'identifiers: none';
      return wrap(`<div class="chart-empty chart-restricted">${Access.LOCK_SVG} Row-level detail withheld for ${esc(Access.label())} — ${esc(why)}. The counts above are the aggregate.</div>`, true);
    }
    const shown = t.rows.slice(0, DETAIL_LIMIT);
    const masked = Access.pii() !== 'identified';
    return wrap(`<div class="attr-details-bar">
        <span class="attr-details-count">${shown.length < t.rows.length ? `Latest ${fmtInt(shown.length)} of ${fmtInt(t.rows.length)} separations — the CSV has every row` : `${fmtInt(t.rows.length)} separation${t.rows.length === 1 ? '' : 's'}`}</span>
        ${masked ? `<span class="attr-details-mask">Identifiers pseudonymised for ${esc(Access.label())} — stable within this browser session only</span>` : ''}
        ${t.rows.length ? '<button class="btn btn-outline" type="button" data-attr-csv>Download rows → CSV</button>' : ''}
      </div>
      ${t.rows.length ? UI.tableHTML(t.columns, shown) : '<div class="chart-empty">No separations of this type in the selected period for this scope.</div>'}`);
  }

  return {
    MIN_BASE, TOP_PLANTS, TYPES, DIMS, DIM_BY_ID, DETAIL_COLUMNS, DETAIL_LIMIT, EMP_IN, state,
    typePred, typeLabel, periodLabel, ytdCtx, ytdLabel, short,
    sepYtd, retYtd, hcFyStart, hcAsOf, absYtd,
    cut, peak, peakRow, cutItems, cutTable, blankNote, unmatchedPlantNote,
    reasonRows, reasonItems, reasonTable,
    detailRows, periodExits, hcByAssetBand, absByAsset,
    toolbarHTML, overall, cutsHTML, typeChartHTML, detailsTable, detailsHTML
  };
})();

/* =================== KPI strip — fiscal YTD (D5 / D6) =================== */

defineMetric({
  key: 'attr_sep_ytd', label: 'Separated — fiscal YTD', tab: 'attrition', access: 'core',
  group: 'Attrition — year to date', unit: '', decimals: 0, direction: null,
  formulaText: `Count of exits with Exit Date from ${FY_START_LABEL} (fiscal year start) to the as-of date\nwhere Exit Type = Voluntary or Involuntary, permanent roll\n(Exit Type = Retirement excluded — see “Retirements — fiscal YTD”)`,
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date', 'Exit Type'] },
           { dataset: 'employee_master', columns: AttrKit.EMP_IN }],
  caveat: 'Fiscal year per CONFIG.fyStartMonth (D5). The drill-down is the employee-wise separation list — identifiers follow the persona’s PII level.',
  compute: (m, ctx) => AttrKit.sepYtd(m, ctx).length,
  drill: (m, ctx) => {
    const xs = AttrKit.sepYtd(m, ctx);
    return { title: `Separations — fiscal YTD ${AttrKit.ytdLabel(ctx)} (${xs.length})`, columns: AttrKit.DETAIL_COLUMNS, rows: AttrKit.detailRows(m, xs) };
  }
});

defineMetric({
  key: 'attr_hc_fystart', label: 'Headcount at FY start (permanent)', tab: 'attrition', access: 'core',
  group: 'Attrition — year to date', unit: '', decimals: 0, direction: null,
  formulaText: `Active permanent employees at the close of the day before ${FY_START_LABEL}\n= Date of Joining before the fiscal year start and no exit on or before that day\n(the fiscal year’s opening headcount)`,
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Employee Class', 'Date of Joining'] }],
  caveat: 'Opening headcount of the absolute-attrition denominator (D6). Exits are netted off when exits.csv is loaded; current employee-master attributes are used for asset, band and segment.',
  compute: (m, ctx) => AttrKit.hcFyStart(m, ctx),
  drill: (m, ctx) => AttrKit.hcByAssetBand(m, ctx, Compute.fyStartDay(ctx) - 1, `Headcount at FY start (${fmtDMY(Compute.fyStartDay(ctx) - 1)} close) by asset and management band`)
});

defineMetric({
  key: 'attr_hc_asof', label: 'Headcount as-of (permanent)', tab: 'attrition', access: 'core',
  group: 'Attrition — year to date', unit: '', decimals: 0, direction: null,
  formulaText: 'Active permanent employees at the as-of date\n= Date of Joining ≤ as-of and no exit on or before as-of',
  inputs: [{ dataset: 'employee_master', columns: ['Employee ID', 'Asset', 'Employee Class', 'Date of Joining'] }],
  caveat: 'Same definition as the Overview closing headcount (exits netted off when exits.csv is loaded); the closing leg of the absolute-attrition denominator (D6).',
  compute: (m, ctx) => AttrKit.hcAsOf(m, ctx),
  drill: (m, ctx) => AttrKit.hcByAssetBand(m, ctx, ctx.asOfDay, `Headcount as-of ${fmtDMY(ctx.asOfDay)} by asset and management band`)
});

defineMetric({
  key: 'attr_abs_ytd', label: 'Absolute attrition — fiscal YTD', tab: 'attrition', access: 'core',
  group: 'Attrition — year to date', unit: '%', decimals: 2, direction: 'lower',
  formulaText: `Separations fiscal YTD ÷ ((headcount at FY start + headcount as-of) ÷ 2) × 100\n(not annualised; separations = Voluntary + Involuntary since ${FY_START_LABEL};\n Exit Type = Retirement excluded; permanent roll)`,
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date', 'Exit Type'] },
           { dataset: 'employee_master', columns: AttrKit.EMP_IN }],
  caveat: 'Decision D6: the denominator is the simple average of the opening and as-of headcount — confirm with the business before hand-off. It grows through the year; the annualised figure is the comparable one across periods.',
  compute: (m, ctx) => AttrKit.absYtd(m, ctx),
  drill: (m, ctx) => AttrKit.absByAsset(m, ctx)
});

defineMetric({
  key: 'attr_retire_ytd', label: 'Retirements — fiscal YTD', tab: 'attrition', access: 'core',
  group: 'Attrition — year to date', unit: '', decimals: 0, direction: null,
  formulaText: `Count of exits with Exit Type = Retirement and Exit Date from ${FY_START_LABEL} to the as-of date\n(permanent roll; counted separately — never part of any attrition rate)`,
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date', 'Exit Type'] },
           { dataset: 'employee_master', columns: AttrKit.EMP_IN }],
  caveat: 'Superannuation is planned turnover: the Outlook glidepath projects it; the attrition figures exclude it (D6).',
  compute: (m, ctx) => AttrKit.retYtd(m, ctx).length,
  drill: (m, ctx) => {
    const xs = AttrKit.retYtd(m, ctx);
    return { title: `Retirements — fiscal YTD ${AttrKit.ytdLabel(ctx)} (${xs.length})`, columns: AttrKit.DETAIL_COLUMNS, rows: AttrKit.detailRows(m, xs) };
  }
});

/* =================== Attrition by type =================== */

defineMetric({
  key: 'attr_involuntary', label: 'Involuntary attrition (annualised)', tab: 'attrition', access: 'core',
  group: 'Attrition rates', unit: '%', direction: 'lower',
  formulaText: '(Involuntary exits in period ÷ average headcount) × (12 ÷ months in period) × 100\nVoluntary + Involuntary = total annualised attrition\n(Exit Type = Retirement excluded)',
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date', 'Exit Type'] },
           { dataset: 'employee_master', columns: AttrKit.EMP_IN }],
  caveat: 'Managed / employer-initiated exits (performance, disciplinary, absconding). Read against the performance cycle rather than retention levers.',
  compute: (m, ctx) => Compute.annualisedAttritionWhere(m, ctx, (x) => x.exit_type === 'Involuntary'),
  spark: (m, ctx) => Compute.monthlySeries(m, ctx, (mi) =>
    Compute.monthAttritionRateWhere(m, ctx, mi, (x) => x.exit_type === 'Involuntary'))
});

/* =================== Attrition rate by dimension =================== */

for (const dim of AttrKit.DIMS) {
  const inputs = [
    { dataset: 'exits', columns: ['Employee ID', 'Exit Date', 'Exit Type'] },
    { dataset: 'employee_master', columns: [...new Set([...AttrKit.EMP_IN, ...dim.cols])] }
  ];
  if (dim.id === 'mc') inputs.push({ dataset: 'org_units', columns: ['Function Plant', 'MC Member'] });
  defineMetric({
    key: dim.key, label: `Attrition by ${dim.noun} — highest rate`, tab: 'attrition', access: 'core',
    group: 'Attrition by dimension', unit: '%', direction: 'lower',
    formulaText: `Per ${dim.noun}: (exits in period ÷ average month-end headcount) × (12 ÷ months in period) × 100\n` +
      `${dim.rule}\nValue = the highest rate among ${dim.plural} with average headcount ≥ ${AttrKit.MIN_BASE}\n` +
      '(all exit types for the value; the page toggle re-scopes the chart to Voluntary / Involuntary;\n Exit Type = Retirement excluded; permanent roll)',
    inputs,
    caveat: `Each person’s attributes as recorded in the employee master are used for both headcount and exits (no point-in-time history without employee_movements). Bases below ${AttrKit.MIN_BASE} average headcount are greyed and marked *; on persona-restricted views, cells with fewer than ${CONFIG.minCell} exits are suppressed.`,
    compute: (m, ctx) => AttrKit.peak(m, ctx, dim),
    quality: (m, ctx) => (dim.blank ? AttrKit.blankNote(m, ctx, dim.blank[0], dim.blank[1]) : AttrKit.unmatchedPlantNote(m)),
    drill: (m, ctx) => AttrKit.cutTable(m, ctx, dim)
  });
}

defineMetric({
  key: 'attr_reason_top', label: 'Top exit reason category — share of exits', tab: 'attrition', access: 'core',
  group: 'Attrition by dimension', unit: '%', direction: null,
  formulaText: 'Exits in period with the most frequent Exit Reason Category ÷ exits in period × 100\n(blank categories count in the denominator; Exit Type = Retirement excluded; permanent roll)',
  inputs: [{ dataset: 'exits', columns: ['Employee ID', 'Exit Date', 'Exit Type', 'Exit Reason Category'] },
           { dataset: 'employee_master', columns: AttrKit.EMP_IN }],
  caveat: 'Standardised categories keep “by reason” comparable across assets; the free-text reasons stay on the “Exits by stated reason” chart.',
  compute: (m, ctx) => {
    const { xs, rows } = AttrKit.reasonRows(m, ctx, 'All');
    const top = rows.filter((r) => r.key !== '(blank)').sort((a, b) => b.n - a.n)[0];
    return xs.length && top ? top.n / xs.length * 100 : null;
  },
  quality: (m, ctx) => {
    const { xs, rows } = AttrKit.reasonRows(m, ctx, 'All');
    const blank = rows.find((r) => r.key === '(blank)')?.n || 0;
    return xs.length && blank ? `${fmtPct(blank / xs.length * 100, 0)} of exits in the period have no reason category` : null;
  },
  drill: (m, ctx) => AttrKit.reasonTable(m, ctx)
});
