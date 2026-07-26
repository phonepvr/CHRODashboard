/* SVG chart helpers — string-returning, dependency-free.
   Encoding rule for this monochrome brand: emphasis (Smart Red) + context
   (lightness-separated inks); identity is always carried by direct labels,
   never by colour alone. Expanded in the charts phase; sparkline lives here
   from the start because tiles use it. */

const Charts = (() => {

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

  return { spark };
})();
