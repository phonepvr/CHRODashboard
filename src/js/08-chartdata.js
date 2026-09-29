/* Shared chart-data builders — bridge between Compute and Charts for the tab
   renderers. All honour the current asset/band/period context. */

const ChartData = (() => {

  function monthsAxis(ctx) {
    const out = [];
    for (let mi = ctx.histStart; mi <= ctx.endMonth; mi++) out.push(mi);
    return out;
  }

  // one line series per asset (+ Group), selected asset emphasised. Only the
  // persona's chart scopes are drawn — peer assets never reach a locked persona.
  function assetLines(ctx, valueAt /* (assetName|'Group', mi, day) -> v */) {
    const months = monthsAxis(ctx);
    const scopes = Access.chartScopes();
    const series = [];
    let ctxToggle = 0;
    for (const a of CONFIG.assets.filter((x) => scopes.includes(x))) {
      const role = a === ctx.asset ? 'focus' : (ctxToggle++ % 2 === 0 ? 'ctx1' : 'ctx2');
      series.push({ label: a, role, values: months.map((mi) => valueAt(a, mi, monthEndDay(mi))) });
    }
    if (scopes.includes('Group')) {
      series.push({ label: 'Group', role: ctx.asset === 'Group' ? 'focus' : 'group', values: months.map((mi) => valueAt('Group', mi, monthEndDay(mi))) });
    }
    return { months, series };
  }

  // horizontal bars: one per asset, current metric value; click cross-filters
  function assetBars(key, fmt) {
    const focus = Compute.ctxNow().asset;
    const scopes = Access.chartScopes();
    const items = CONFIG.assets.filter((a) => scopes.includes(a)).map((a) => {
      const res = Compute.metric(key, { asset: a });
      return {
        label: a,
        value: res.value,
        role: a === focus ? 'focus' : undefined,
        tip: `${a}: ${res.value == null ? 'no data' : (fmt || ((v) => fmtNum(v, 1)))(res.value)}${Access.canFocusAsset(a) ? '\nClick to focus ' + a : ''}`,
        setAsset: Access.lockedAsset() ? null : a
      };
    });
    if (scopes.includes('Group')) {
      const g = Compute.metric(key, { asset: 'Group' });
      const locked = !!Access.lockedAsset();
      items.push({ label: 'Group', value: g.value, role: focus === 'Group' ? 'focus' : undefined, setAsset: locked ? null : 'Group', tip: locked ? 'Group (benchmark)' : 'Group (all assets)\nClick to reset focus' });
    }
    return items;
  }

  function subCtx(ctx, asset) { return asset === 'Group' ? { ...ctx, asset: 'Group' } : { ...ctx, asset }; }

  function headcountAt(m, ctx) {
    return (asset, mi, day) => Compute.activesAt(m, subCtx(ctx, asset), 'Permanent', day).length;
  }

  function attritionAt(m, ctx) {
    return (asset, mi) => Compute.monthAttritionRate(m, subCtx(ctx, asset), mi);
  }

  return { monthsAxis, assetLines, assetBars, subCtx, headcountAt, attritionAt };
})();
