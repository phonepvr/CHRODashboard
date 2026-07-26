/* Executive summary — deterministic templating over computed metrics.
   No free text is invented: every sentence is a rule applied to registry values,
   comparing the selected asset to its own prior period AND to Group. */

const ExecSummary = (() => {

  function val(key, asset) { return Compute.metric(key, asset ? { asset } : undefined).value; }
  function prior(key, asset) {
    const c = Compute.ctxNow();
    return Compute.metric(key, { asset: asset || c.asset, endMonth: c.endMonth - c.periodMonths, periodMonths: c.periodMonths }).value;
  }
  function target(key) {
    const t = Compute.build().targets.get(key);
    return t ? t.value : null;
  }
  const pp = (v) => `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(v), 1)}pp`;

  /* Each rule returns null or {type: 'watch'|'good'|'neutral', text, key} */
  function rules(asset) {
    const isGroup = asset === 'Group';
    const R = [];

    // 1. attrition vs Group and vs prior
    R.push(() => {
      const v = val('attr_annualised', asset);
      if (v == null) return null;
      const g = val('attr_annualised', 'Group');
      const pr = prior('attr_annualised', asset);
      const move = pr != null ? v - pr : null;
      if (!isGroup && g != null && v - g > 1.5) {
        const early = val('attr_early_2y', asset);
        const conc = early != null && early > 25 ? ', concentrated in the ≤2-yr tenure cadre' : '';
        return { type: 'watch', key: 'attr_annualised', text: `Attrition at ${asset} runs ${fmtNum(v - g, 1)}pp above Group (${fmtPct(v, 1)} vs ${fmtPct(g, 1)})${conc}.` };
      }
      if (move != null && Math.abs(move) >= 1.5) {
        return { type: move > 0 ? 'watch' : 'good', key: 'attr_annualised', text: `Annualised attrition moved ${pp(move)} vs the prior period, to ${fmtPct(v, 1)}.` };
      }
      const t = target('attr_annualised');
      if (t != null && v <= t) return { type: 'good', key: 'attr_annualised', text: `Attrition holds at ${fmtPct(v, 1)}, inside the ${fmtPct(t, 0)} target.` };
      return null;
    });

    // 2. TT exits
    R.push(() => {
      const v = val('attr_tt_count', asset);
      if (v == null || v === 0) return null;
      return { type: v > (target('attr_tt_count') ?? 3) ? 'watch' : 'neutral', key: 'attr_tt_count', text: `${fmtInt(v)} Top Talent exit${v > 1 ? 's' : ''} this period — each one a named regret risk.` };
    });

    // 3. succession coverage vs target + vs prior
    R.push(() => {
      const v = val('succession_coverage', asset);
      if (v == null) return null;
      const t = target('succession_coverage');
      const g = val('succession_coverage', 'Group');
      if (t != null && v < t) {
        const gap = !isGroup && g != null ? ` (Group: ${fmtPct(g, 0)})` : '';
        return { type: 'watch', key: 'succession_coverage', text: `Succession coverage at ${fmtPct(v, 0)} sits below the ${fmtPct(t, 0)} target${gap}.` };
      }
      if (t != null) return { type: 'good', key: 'succession_coverage', text: `Succession coverage at ${fmtPct(v, 0)} meets the ${fmtPct(t, 0)} target.` };
      return null;
    });

    // 4. posting compliance
    R.push(() => {
      const v = val('posting_compliance', asset);
      if (v == null || v >= 95) return null;
      return { type: 'watch', key: 'posting_compliance', text: `Only ${fmtPct(v, 0)} of externally-filled, non-confidential roles were posted internally — the aim is 100%.` };
    });

    // 5. stalled internal applications
    R.push(() => {
      const v = val('mobility_ageing', asset);
      if (!v) return null;
      return { type: 'watch', key: 'mobility_ageing', text: `${fmtInt(v)} internal applications have had no action for over 15 days.` };
    });

    // 6. VP+ learning gap
    R.push(() => {
      const v = val('learning_coverage_vp', asset);
      const all = val('learning_coverage_all', asset);
      if (v == null || all == null || v >= all - 15) return null;
      return { type: 'watch', key: 'learning_coverage_vp', text: `VP+ learning coverage (${fmtPct(v, 0)}) trails the workforce average (${fmtPct(all, 0)}) — seniors are skipping development.` };
    });

    // 7. IDP implementation stuck low
    R.push(() => {
      const v = val('idp_band_low', asset);
      if (v == null || v < 55) return null;
      return { type: 'watch', key: 'idp_band_low', text: `${fmtPct(v, 0)} of TT development plans are at ≤25% implementation.` };
    });

    // 8. LTIFR
    R.push(() => {
      const v = val('ltifr', asset);
      if (v == null) return null;
      const t = target('ltifr');
      if (t != null && v > t) return { type: 'watch', key: 'ltifr', text: `LTIFR at ${fmtNum(v, 2)} exceeds the ${fmtNum(t, 2)} threshold (per 1,000,000 man-hours).` };
      return { type: 'good', key: 'ltifr', text: `LTIFR at ${fmtNum(v, 2)} stays under the ${t != null ? fmtNum(t, 2) : 'agreed'} threshold.` };
    });

    // 9. contract compliance
    R.push(() => {
      const v = val('contract_compliance_idx', asset);
      if (v == null) return null;
      const t = target('contract_compliance_idx') ?? 95;
      if (v < t) return { type: 'watch', key: 'contract_compliance_idx', text: `Composite contractor compliance at ${fmtPct(v, 1)} is below the ${fmtPct(t, 0)} bar [Aparajita].` };
      return null;
    });

    // 10. superannuation pressure
    R.push(() => {
      const v = val('near_retirement_pct', asset);
      if (v == null || v < 8) return null;
      return { type: 'neutral', key: 'near_retirement_pct', text: `${fmtPct(v, 1)} of the permanent roll retires within 5 years — see the glidepath on Outlook.` };
    });

    return R;
  }

  function forAsset(asset) {
    const points = [];
    for (const rule of rules(asset)) {
      const p = rule();
      if (p) points.push(p);
    }
    const watches = points.filter((p) => p.type === 'watch');
    const goods = points.filter((p) => p.type === 'good');
    // keep it scannable: max 6 points, watches first, always ≥1 good if one exists
    const chosen = [...watches.slice(0, 4), ...goods.slice(0, 2), ...points.filter((p) => p.type === 'neutral')].slice(0, 6);
    const verdict =
      watches.length === 0 ? `${asset}: steady period — no rule-based flags raised.` :
      watches.length <= 2 ? `${asset}: broadly stable, ${watches.length} area${watches.length > 1 ? 's' : ''} to watch.` :
      `${asset}: needs attention — ${watches.length} rule-based flags this period.`;
    return { verdict, points: chosen, watchCount: watches.length };
  }

  function bandHTML() {
    const asset = App.state.filters.asset;
    const s = forAsset(asset);
    return `<div class="exec-band">
      <p class="exec-verdict">${esc(s.verdict)}</p>
      <ul class="exec-points">
        ${s.points.map((p) => `<li class="${p.type === 'watch' ? 'is-watch' : p.type === 'good' ? 'is-good' : ''}">
          <button class="linklike" data-jump="${esc(p.key)}">${esc(p.text)}</button></li>`).join('')}
      </ul>
    </div>`;
  }

  return { forAsset, bandHTML };
})();
