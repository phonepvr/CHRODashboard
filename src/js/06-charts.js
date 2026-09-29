/* SVG chart helpers — string-returning, dependency-free, viewBox-responsive.
   Encoding rules for this monochrome brand (see Methodology):
   - emphasis carries meaning: the selected asset / headline series is Smart Red,
     Group is Strong Black, context series are lightness-separated greys;
   - identity is always carried by DIRECT LABELS at line ends / on bars,
     never by colour alone (colour-vision safe by construction);
   - one axis per chart, thin marks, recessive grid, tabular figures;
   - secondary colours appear only as status accents, never as fills.
   Interactivity: marks carry data-tip for the shared hover tooltip; bars can
   carry data-setasset (cross-filter) or data-drill — keyboard buttons too
   (markAttrs; Enter / Space in 99-main). */

const Charts = (() => {

  const SERIES_COLOR = {
    focus: 'var(--series-focus)',
    group: 'var(--series-group)',
    ctx1: 'var(--series-ctx-1)',
    ctx2: 'var(--series-ctx-2)',
    projected: 'var(--projected)'
  };
  // direct labels carry identity, so every label is AA text (--ink-55 or darker)
  // even where its context line is lighter
  const LABEL_COLOR = { focus: 'var(--series-focus)', group: 'var(--series-group)' };
  const labelColor = (role) => LABEL_COLOR[role] || 'var(--ink-55)';

  // attributes of a bar / row mark: tooltip, and — for a drill (full table) or a
  // cross-filter (focus an asset) — a keyboard button with a spoken name
  function markAttrs(it, name) {
    const act = it.setAsset ? `focus ${it.setAsset}` : it.drill ? 'open the full table' : null;
    return [
      it.tip ? `data-tip="${esc(it.tip)}"` : '',
      it.setAsset ? `data-setasset="${esc(it.setAsset)}"` : '',
      it.drill ? `data-drill="${esc(it.drill)}"` : '',
      act ? `style="cursor:pointer" tabindex="0" role="button" aria-label="${esc(`${name} — ${act}`)}"` : ''
    ].join(' ');
  }
  const svgRole = (items) => (items.some((it) => it.drill || it.setAsset) ? 'group' : 'img');

  function niceTicks(min, max, n = 4) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step = Math.pow(10, Math.floor(Math.log10(span / n)));
    const err = span / n / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = mult * step;
    const lo = Math.floor(min / s) * s;
    const hi = Math.ceil(max / s) * s;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += s) ticks.push(v);
    return ticks;
  }

  /* ---------- sparkline (tiles) ---------- */

  function spark(points, { w = 110, h = 30 } = {}) {
    const v = (points || []).filter((p) => p != null && isFinite(p));
    if (v.length < 2) return '';
    const min = Math.min(...v), max = Math.max(...v);
    const span = max - min || 1;
    const step = w / (points.length - 1);
    const d = points.map((p, i) => {
      if (p == null || !isFinite(p)) return null;
      const x = (i * step).toFixed(1);
      const y = (h - 3 - (p - min) / span * (h - 6)).toFixed(1);
      return `${x},${y}`;
    }).filter(Boolean).join(' ');
    const last = v[v.length - 1];
    const ly = (h - 3 - (last - min) / span * (h - 6)).toFixed(1);
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true">
      <polyline points="${d}" fill="none" stroke="var(--ink-55)" stroke-width="1.5"/>
      <circle cx="${w - 1.5}" cy="${ly}" r="2.4" fill="var(--red)"/>
    </svg>`;
  }

  /* ---------- multi-series line ----------
     { months: [monthIdx…], series: [{label, values, role, dashed}],
       yFmt, target, band: {upper, lower, label}, title } */
  function line({ months, series, yFmt = (v) => fmtNum(v, 1), target = null, band = null, title = '', h = 220, w = 640 }) {
    const padL = 46, padR = 86, padT = 12, padB = 24;
    const iw = w - padL - padR, ih = h - padT - padB;
    const all = series.flatMap((s) => s.values).concat(target != null ? [target] : [])
      .concat(band ? band.upper.concat(band.lower) : [])
      .filter((v) => v != null && isFinite(v));
    if (!all.length || months.length < 2) {
      return `<div class="chart-empty">Series too short to draw — need at least two months of data.</div>`;
    }
    // trend lines don't need a zero baseline; only anchor at 0 when the data
    // already lives near it (avoids squashing e.g. an 85–100% attendance band)
    const dMin = Math.min(...all), dMax = Math.max(...all);
    const anchorZero = dMin >= 0 && dMin <= (dMax - dMin) * 0.6;
    const ticks = niceTicks(anchorZero ? 0 : dMin, dMax);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1] || 1;
    const X = (i) => padL + i / (months.length - 1) * iw;
    const Y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * ih;

    const grid = ticks.map((t) =>
      `<line x1="${padL}" y1="${Y(t)}" x2="${padL + iw}" y2="${Y(t)}" stroke="var(--ink-10)" stroke-width="1"/>
       <text x="${padL - 6}" y="${Y(t) + 3.5}" text-anchor="end" class="ax">${esc(yFmt(t))}</text>`).join('');

    const xStep = Math.max(1, Math.ceil(months.length / Math.max(3, Math.floor(iw / 64))));
    const xLabels = months.map((mi, i) => i % xStep === 0
      ? `<text x="${X(i)}" y="${h - 6}" text-anchor="middle" class="ax">${esc(monthIdxToLabel(mi))}</text>` : '').join('');

    const bandPoly = band ? (() => {
      const up = band.upper.map((v, i) => v == null ? null : `${X(i)},${Y(v)}`).filter(Boolean);
      const dn = band.lower.map((v, i) => v == null ? null : `${X(i)},${Y(v)}`).filter(Boolean).reverse();
      return `<polygon points="${up.join(' ')} ${dn.join(' ')}" fill="var(--red-10)" stroke="none" opacity="0.9"/>`;
    })() : '';

    const targetLine = target != null
      ? `<line x1="${padL}" y1="${Y(target)}" x2="${padL + iw}" y2="${Y(target)}" stroke="var(--ink-70)" stroke-width="1" stroke-dasharray="2 4"/>
         <text x="${padL + 4}" y="${Y(target) - 4}" class="ax">target ${esc(yFmt(target))}</text>`
      : '';

    // draw context first so focus/group sit on top
    const order = { ctx1: 0, ctx2: 0, projected: 1, group: 2, focus: 3 };
    const sorted = [...series].sort((a, b) => (order[a.role] ?? 1) - (order[b.role] ?? 1));
    // direct labels at line ends, pushed apart so they never collide
    const labels = sorted.map((s) => {
      const lastIdx = s.values.map((v, i) => v != null && isFinite(v) ? i : null).filter((v) => v != null).pop();
      return lastIdx == null ? null : { s, y: Y(s.values[lastIdx]) };
    }).filter(Boolean).sort((a, b) => a.y - b.y);
    // down from the top, then — when the lowest passes the floor — back up from
    // the floor, so two labels never share a line
    const GAP = 13, floor = h - padB - 2;
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].y - labels[i - 1].y < GAP) labels[i].y = labels[i - 1].y + GAP;
    }
    if (labels.length && labels[labels.length - 1].y > floor) {
      labels[labels.length - 1].y = floor;
      for (let i = labels.length - 2; i >= 0; i--) {
        if (labels[i + 1].y - labels[i].y < GAP) labels[i].y = labels[i + 1].y - GAP;
      }
    }
    const labelSvg = labels.map(({ s, y }) =>
      `<text x="${padL + iw + 6}" y="${y.toFixed(1)}" class="series-label"
        fill="${labelColor(s.role)}">${esc(s.label)}</text>`).join('');
    const paths = sorted.map((s) => {
      const pts = s.values.map((v, i) => v == null || !isFinite(v) ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
      const col = SERIES_COLOR[s.role] || SERIES_COLOR.ctx1;
      const width = s.role === 'focus' ? 2.4 : s.role === 'group' ? 2 : 1.6;
      return `<polyline points="${pts.filter(Boolean).join(' ')}" fill="none" stroke="${col}"
        stroke-width="${width}" ${s.dashed ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('') + labelSvg;

    // hover layer: one strip per month with a composed tooltip
    const strips = months.map((mi, i) => {
      const tip = [monthIdxToLabel(mi), ...series.map((s) =>
        s.values[i] != null && isFinite(s.values[i]) ? `${s.label}: ${yFmt(s.values[i])}` : null).filter(Boolean)].join('\n');
      const x0 = i === 0 ? padL : (X(i - 1) + X(i)) / 2;
      const x1 = i === months.length - 1 ? padL + iw : (X(i) + X(i + 1)) / 2;
      return `<rect x="${x0}" y="${padT}" width="${Math.max(0, x1 - x0)}" height="${ih}" fill="transparent" data-tip="${esc(tip)}"/>`;
    }).join('');

    return `<svg viewBox="0 0 ${w} ${h}" role="img" preserveAspectRatio="xMidYMid meet">
      ${title ? `<title>${esc(title)}</title>` : ''}
      ${grid}${bandPoly}${targetLine}${paths}${xLabels}${strips}
    </svg>`;
  }

  /* ---------- horizontal bars ----------
     { items: [{label, value, sub, tip, setAsset, drill, role}], fmt, target } */
  // estimated rendered width (viewBox units) of a bar's value label: .bar-value
  // 11.5px bold, its sub-label .ax 10px
  const valueWidth = (text, sub) => String(text).length * 7.1 + (sub ? 4 + String(sub).length * 5.7 : 0);

  function barH({ items, fmt = (v) => fmtNum(v, 1), target = null, h = null, w = 640 }) {
    const rowH = 26, padT = 6, padL = 120, padR = 70;
    const height = h || padT * 2 + items.length * rowH;
    const vals = items.map((i) => i.value).filter((v) => v != null && isFinite(v));
    if (!vals.length) return `<div class="chart-empty">No data for this chart.</div>`;
    const max = Math.max(...vals, target ?? 0, 0) || 1;
    const iw = w - padL - padR;
    const text = (it) => (it.value == null ? '—' : fmt(it.value));
    // the longest bar may not push its value label past the right edge
    let k = iw / max;
    for (const it of items) {
      if (it.value > 0) k = Math.min(k, (w - padL - 10 - valueWidth(text(it), it.sub)) / it.value);
    }
    const X = (v) => Math.max(0, v * k);
    const bars = items.map((it, r) => {
      const y = padT + r * rowH;
      const bw = it.value == null ? 0 : X(it.value);
      const col = it.role === 'focus' ? 'var(--red)' : it.role === 'ctx' ? 'var(--ink-30)' : 'var(--ink-80)';
      return `<g ${markAttrs(it, `${it.label}: ${text(it)}${it.sub ? ' ' + it.sub : ''}`)}>
        <text x="${padL - 8}" y="${y + rowH / 2 + 3.5}" text-anchor="end" class="bar-label">${esc(it.label)}</text>
        <rect x="${padL}" y="${y + 4}" width="${bw.toFixed(1)}" height="${rowH - 10}" fill="${col}" rx="0"/>
        <text x="${(padL + bw + 6).toFixed(1)}" y="${y + rowH / 2 + 3.5}" class="bar-value">${esc(text(it))}${it.sub ? ` <tspan class="ax">${esc(it.sub)}</tspan>` : ''}</text>
      </g>`;
    }).join('');
    // the target's label sits in the 12-unit band above the first bar
    const targetLine = target != null
      ? `<line x1="${padL + X(target)}" y1="${padT - 4}" x2="${padL + X(target)}" y2="${height - padT}"
          stroke="var(--ink-70)" stroke-width="1" stroke-dasharray="2 4"/>
         <text x="${padL + X(target)}" y="${padT - 8}" text-anchor="middle" class="ax">target ${esc(fmt(target))}</text>` : '';
    return `<svg viewBox="0 0 ${w} ${height + (target != null ? 12 : 0)}" role="${svgRole(items)}" preserveAspectRatio="xMidYMid meet">${target != null ? `<g transform="translate(0,12)">${bars}${targetLine}</g>` : bars + targetLine}</svg>`;
  }

  /* ---------- funnel (counts, stage-to-stage conversion) ---------- */
  function funnel({ stages, w = 640 }) {
    const rowH = 30, padT = 4, padL = 210, padR = 90;
    const height = padT * 2 + stages.length * rowH;
    const max = Math.max(...stages.map((s) => s.value ?? 0), 1);
    const iw = w - padL - padR;
    const conv = (s, i) => (i > 0 && stages[i - 1].value ? ` ${fmtPct((s.value ?? 0) / stages[i - 1].value * 100, 0)} of prior` : '');
    // as barH: the longest bar may not push its label past the right edge
    let k = iw / max;
    stages.forEach((s, i) => { if (s.value > 0) k = Math.min(k, (w - padL - 10 - valueWidth(fmtInt(s.value), conv(s, i))) / s.value); });
    const rows = stages.map((s, i) => {
      const y = padT + i * rowH;
      const bw = (s.value ?? 0) * k;
      const cv = conv(s, i);
      return `<g data-tip="${esc(s.label + ': ' + fmtInt(s.value ?? 0) + cv)}">
        <text x="${padL - 8}" y="${y + rowH / 2 + 3.5}" text-anchor="end" class="bar-label">${esc(s.label)}</text>
        <rect x="${padL}" y="${y + 5}" width="${Math.max(1.5, bw).toFixed(1)}" height="${rowH - 12}"
          fill="${i === 0 ? 'var(--black)' : i === stages.length - 1 ? 'var(--red)' : 'var(--ink-70)'}"/>
        <text x="${padL + Math.max(1.5, bw) + 6}" y="${y + rowH / 2 + 3.5}" class="bar-value">${fmtInt(s.value ?? 0)}<tspan class="ax">${esc(cv)}</tspan></text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${height}" role="img" preserveAspectRatio="xMidYMid meet">${rows}</svg>`;
  }

  /* ---------- donut (two-to-four segments, labelled, never colour-alone) ----------
     shares: false drops the percentages (a withheld segment would make them 100%) */
  function donut({ items, centerLabel = '', h = 190, shares = true, w = 640 }) {
    const cy = h / 2, R = Math.min(h / 2 - 14, 74), r = R - 22, cx = Math.min(160, R + 30 + (w - 420) / 4);
    const total = items.reduce((s, i) => s + (i.value || 0), 0);
    if (!total) return `<div class="chart-empty">No data for this chart.</div>`;
    const cols = ['var(--red)', 'var(--ink-80)', 'var(--ink-40)', 'var(--ink-20)'];
    let a0 = -Math.PI / 2;
    const segs = items.map((it, i) => {
      const frac = (it.value || 0) / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const p = (a, rad) => `${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`;
      // a lone 100% segment has start = end, which an SVG arc draws as nothing:
      // close that ring in two halves (even-odd fill keeps the hole)
      const d = frac >= 1 - 1e-9
        ? `M ${p(a0, R)} A ${R} ${R} 0 1 1 ${p(a0 + Math.PI, R)} A ${R} ${R} 0 1 1 ${p(a0, R)} Z M ${p(a0, r)} A ${r} ${r} 0 1 0 ${p(a0 + Math.PI, r)} A ${r} ${r} 0 1 0 ${p(a0, r)} Z`
        : `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
      a0 = a1;
      return `<path d="${d}" fill-rule="evenodd" fill="${cols[i % cols.length]}" stroke="var(--white)" stroke-width="2"
        data-tip="${esc(`${it.label}: ${fmtInt(it.value)}${shares ? ` (${fmtPct(frac * 100, 1)})` : ''}`)}"/>`;
    }).join('');
    const legend = items.map((it, i) => `
      <g transform="translate(${cx + R + 66}, ${cy - items.length * 11 + i * 22})">
        <rect width="11" height="11" y="-9" fill="${cols[i % cols.length]}"/>
        <text x="17" class="bar-label">${esc(it.label)} — ${fmtInt(it.value)}${shares ? ` (${fmtPct((it.value || 0) / total * 100, 1)})` : ''}</text>
      </g>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" preserveAspectRatio="xMidYMid meet">
      ${segs}
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" class="donut-center">${esc(centerLabel)}</text>
      ${legend}
    </svg>`;
  }

  /* ---------- chart card wrapper ----------
     Persona choke point for charts: the card's access class is `access` (an
     ACCESS_CLASSES id) or else its infoKey's class; a card with neither is
     fail-closed. A restricted card drops its body, so no mark, tooltip or PNG
     of it ever reaches the page. */
  function card({ title, sub = '', body, note = '', infoKey = null, access = null }) {
    const shown = Access.cardLevel(infoKey, access) !== 'hidden';
    const cls = access || (infoKey && Access.classOf(infoKey)) || '';
    return `<div class="card${shown ? '' : ' is-restricted'}" data-access="${esc(cls || 'unclassified')}">
      <div class="card-title">${esc(title)}${infoKey ? `<button class="i-btn" data-info="${esc(infoKey)}" aria-expanded="false" aria-label="About ${esc(title)}">i</button>` : ''}</div>
      ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
      ${shown ? body : Access.restrictedChartHTML(ACCESS_CLASSES[cls]?.label)}
      ${shown && note ? `<div class="chart-note">${esc(note)}</div>` : ''}
    </div>`;
  }

  /* ---------- fit to the card ----------
     A chart is drawn for a 640-unit viewBox and scaled to its card, so in a 2-
     to 4-up card its text would render at 5–8 px. Each chart keeps its
     arguments (memory only); once in the page, one scaled below FIT is redrawn
     for a narrower viewBox (never below its layout minimum), so text keeps at
     least FIT of its size. Hidden charts (width 0, e.g. the print pack) keep 640. */
  const FIT = 0.9;
  const drawn = new Map();          // id -> {fn, args, minW}
  let seq = 0;
  const tag = (out, id, w) => out.replace('<svg ', `<svg data-chart="${id}" data-w="${w}" `);
  function fitted(fn, args, minW) {
    const out = fn(args);
    if (!out.startsWith('<svg')) return out;
    drawn.set(++seq, { fn, args, minW });
    return tag(out, seq, args.w || 640);
  }
  function refit() {
    const live = new Set();
    const todo = [];
    for (const svg of document.querySelectorAll('svg[data-chart]')) {
      const id = +svg.dataset.chart, d = drawn.get(id);
      live.add(id);
      const px = svg.getBoundingClientRect().width;
      if (!d || !px) continue;
      const want = Math.round(Math.max(d.minW, Math.min(640, px / FIT)));
      if (Math.abs(want - +svg.dataset.w) >= 12) todo.push([svg, id, d, want]);
    }
    for (const id of drawn.keys()) if (!live.has(id)) drawn.delete(id);
    for (const [svg, id, d, want] of todo) svg.outerHTML = tag(d.fn({ ...d.args, w: want }), id, want);
  }
  // redraw after any render into `root` and on resize
  function observe(root) {
    let queued = false;
    const run = () => { queued = false; refit(); };
    new MutationObserver((recs) => {
      if (queued || !recs.some((r) => r.addedNodes.length)) return;
      queued = true;
      queueMicrotask(run);
    }).observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', debounce(refit, 150));
  }

  return {
    spark, niceTicks, card, markAttrs, fitted, refit, observe,
    line: (a) => fitted(line, a, 340), barH: (a) => fitted(barH, a, 380),
    funnel: (a) => fitted(funnel, a, 480), donut: (a) => fitted(donut, a, 420)
  };
})();
