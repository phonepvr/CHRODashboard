/* Shared chart-data builders — bridge between Compute and Charts for the tab
   renderers. All honour the current asset/band/period context. */

const ChartData = (() => {

  function monthsAxis(ctx) {
    const out = [];
    for (let mi = ctx.histStart; mi <= ctx.endMonth; mi++) out.push(mi);
    return out;
  }

  // one line series per asset (+ Group), selected asset emphasised
  function assetLines(ctx, valueAt /* (assetName|'Group', mi, day) -> v */) {
    const months = monthsAxis(ctx);
    const series = [];
    let ctxToggle = 0;
    for (const a of CONFIG.assets) {
      const role = a === ctx.asset ? 'focus' : (ctxToggle++ % 2 === 0 ? 'ctx1' : 'ctx2');
      series.push({ label: a, role, values: months.map((mi) => valueAt(a, mi, monthEndDay(mi))) });
    }
    series.push({ label: 'Group', role: ctx.asset === 'Group' ? 'focus' : 'group', values: months.map((mi) => valueAt('Group', mi, monthEndDay(mi))) });
    return { months, series };
  }

  // horizontal bars: one per asset, current metric value; click cross-filters
  function assetBars(key, fmt) {
    const items = CONFIG.assets.map((a) => {
      const res = Compute.metric(key, { asset: a });
      return {
        label: a,
        value: res.value,
        role: a === App.state.filters.asset ? 'focus' : undefined,
        tip: `${a}: ${res.value == null ? 'no data' : (fmt || ((v) => fmtNum(v, 1)))(res.value)}\nClick to focus ${a}`,
        setAsset: a
      };
    });
    const g = Compute.metric(key, { asset: 'Group' });
    items.push({ label: 'Group', value: g.value, role: App.state.filters.asset === 'Group' ? 'focus' : undefined, setAsset: 'Group', tip: 'Group (all assets)\nClick to reset focus' });
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
