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
  // {t, off} against the loaded target (its own direction wins), or null when
  // no target exists — a rule without one says nothing
  function vsTarget(key, v) {
    const t = Compute.build().targets.get(key);
    if (!t || t.value == null || v == null) return null;
    const dir = t.direction || REG_BY_KEY.get(key)?.direction || 'higher';
    return { t: t.value, off: dir === 'lower' ? v > t.value : v < t.value };
  }
  // [value, target] as percentages; the value gains decimals until a figure
  // just past its target no longer prints equal to it
  function pctPair(v, t, d) {
    let k = d;
    while (k < d + 2 && v !== t && fmtNum(v, k) === fmtNum(t, k)) k++;
    return [fmtPct(v, k), fmtPct(t, d)];
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

    // 3b. position vacancy rate vs target
    R.push(() => {
      const v = val('pb_vacancy_pct', asset);
      const c = vsTarget('pb_vacancy_pct', v);
      if (!c) return null;
      const [vs, ts] = pctPair(v, c.t, 1);
      if (c.off) {
        const aged = val('pb_vacant_90d', asset);
        return { type: 'watch', key: 'pb_vacancy_pct', text: `Vacancy rate at ${vs} is above the ${ts} target${aged ? ` — ${fmtInt(aged)} position${aged > 1 ? 's' : ''} vacant over 90 days` : ''}.` };
      }
      return { type: 'good', key: 'pb_vacancy_pct', text: `Vacancy rate at ${vs} is within the ${ts} target.` };
    });

    // 3c. requisitions aged beyond 180 days (D3 ageing threshold)
    R.push(() => {
      const n = val('ta_aged_180', asset);
      if (!n) return null;
      const pct = val('ta_aged_180_pct', asset);
      const c = vsTarget('ta_aged_180_pct', pct);
      const [ps, ts] = c ? pctPair(pct, c.t, 0) : [pct == null ? '' : fmtPct(pct, 0), ''];
      const share = pct == null ? '' : ` (${ps} of open${c ? `; target ≤ ${ts}` : ''})`;
      return { type: c && c.off ? 'watch' : 'neutral', key: 'ta_aged_180', text: `${fmtInt(n)} open requisition${n > 1 ? 's have' : ' has'} been open over 180 days${share}.` };
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
      return { type: 'watch', key: 'mobility_ageing', text: `${fmtInt(v)} internal application${v > 1 ? 's have' : ' has'} had no action for over 15 days.` };
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

    // 8. LTIFR — only make a threshold claim when a target actually exists
    // (no invented benchmarks).
    R.push(() => {
      const v = val('ltifr', asset);
      if (v == null) return null;
      const t = target('ltifr');
      if (t == null) return { type: 'neutral', key: 'ltifr', text: `LTIFR is ${fmtNum(v, 2)} per 1,000,000 man-hours (no target set).` };
      if (v > t) return { type: 'watch', key: 'ltifr', text: `LTIFR at ${fmtNum(v, 2)} exceeds the ${fmtNum(t, 2)} threshold (per 1,000,000 man-hours).` };
      return { type: 'good', key: 'ltifr', text: `LTIFR at ${fmtNum(v, 2)} stays under the ${fmtNum(t, 2)} threshold.` };
    });

    // 9. contract compliance
    R.push(() => {
      const v = val('contract_compliance_idx', asset);
      if (v == null) return null;
      const t = target('contract_compliance_idx') ?? 95;
      if (v < t) return { type: 'watch', key: 'contract_compliance_idx', text: `Composite contractor compliance at ${fmtPct(v, 1)} is below the ${fmtPct(t, 0)} bar [Aparajita].` };
      return null;
    });

    // 9a. statutory items past their due date — the due date is the threshold
    R.push(() => {
      const n = val('stat_pending_overdue', asset);
      if (!n) return null;
      const age = val('stat_overdue_age_avg', asset);
      return { type: 'watch', key: 'stat_pending_overdue', text: `${fmtInt(n)} statutory item${n > 1 ? 's are' : ' is'} pending past the due date${age != null ? `, ${fmtInt(age)} days overdue on average` : ''} [Aparajita].` };
    });

    // 9a'. critical licences / consents past due — operating risk, named separately
    R.push(() => {
      const n = val('stat_critical_open', asset);
      if (!n) return null;
      return { type: 'watch', key: 'stat_critical_open', text: `${fmtInt(n)} critical statutory item${n > 1 ? 's' : ''} (licences / consents) ${n > 1 ? 'are' : 'is'} past due [Aparajita].` };
    });

    // 9b. absenteeism vs target
    R.push(() => {
      const v = val('absenteeism_pct', asset);
      const c = vsTarget('absenteeism_pct', v);
      if (!c || !c.off) return null;
      const g = isGroup ? null : val('absenteeism_pct', 'Group');
      const [vs, ts] = pctPair(v, c.t, 1);
      return { type: 'watch', key: 'absenteeism_pct', text: `Absenteeism at ${vs} runs above the ${ts} target${g != null ? ` (Group: ${fmtPct(g, 1)})` : ''}.` };
    });

    // 9c. performance-cycle discipline
    R.push(() => {
      const v = val('midyear_review_pct', asset);
      if (v == null) return null;
      const t = target('midyear_review_pct');
      if (t != null && v < t - 5) {
        const g = val('midyear_review_pct', 'Group');
        const gap = !isGroup && g != null ? ` (Group: ${fmtPct(g, 0)})` : '';
        return { type: 'watch', key: 'midyear_review_pct', text: `Mid-year reviews stand at ${fmtPct(v, 0)} against the ${fmtPct(t, 0)} bar${gap} — the cycle is slipping.` };
      }
      return null;
    });

    // 9d. headcount vs approved budget — the budget is the threshold
    R.push(() => {
      const v = val('bva_variance', asset), pct = val('bva_variance_pct', asset);
      if (v == null || pct == null) return null;
      if (v > 0) return { type: 'watch', key: 'bva_variance', text: `Permanent headcount is ${fmtInt(v)} over the approved budget (+${fmtPct(pct, 1)}).` };
      if (v < 0) return { type: 'neutral', key: 'bva_variance', text: `Permanent headcount runs ${fmtInt(-v)} (${fmtPct(-pct, 1)}) below the approved budget — budgeted roles not yet filled.` };
      return { type: 'good', key: 'bva_variance', text: 'Permanent headcount matches the approved budget.' };
    });

    // 9e. local domicile — only against a loaded target (no benchmark is assumed)
    R.push(() => {
      const v = val('demo_local_domicile_pct', asset);
      const c = vsTarget('demo_local_domicile_pct', v);
      if (!c) return null;
      const [vs, ts] = pctPair(v, c.t, 1);
      return c.off
        ? { type: 'watch', key: 'demo_local_domicile_pct', text: `Local domicile at ${vs} is short of the ${ts} target.` }
        : { type: 'good', key: 'demo_local_domicile_pct', text: `Local domicile at ${vs} meets the ${ts} target.` };
    });

    // 10. superannuation pressure
    R.push(() => {
      const v = val('near_retirement_pct', asset);
      if (v == null || v < 8) return null;
      return { type: 'neutral', key: 'near_retirement_pct', text: `${fmtPct(v, 1)} of the permanent roll retires within 5 years — see the glidepath on Outlook.` };
    });

    return R;
  }

  // A rule about a metric the persona may not see is skipped outright (its
  // values are already withheld by Compute.metric; this keeps the text honest).
  function forAsset(asset) {
    const points = [];
    for (const rule of rules(asset)) {
      const p = rule();
      if (p && Access.canSee(p.key)) points.push(p);
    }
    const watches = points.filter((p) => p.type === 'watch');
    const goods = points.filter((p) => p.type === 'good');
    // keep it scannable: max 6 points, watches first, always ≥1 good if one exists
    const chosen = [...watches.slice(0, 4), ...goods.slice(0, 2), ...points.filter((p) => p.type === 'neutral')].slice(0, 6);
    // name the whole scope the figures cover (a function-bound HRBP is not the asset)
    const c = Compute.ctxNow();
    const name = [asset, c.segment !== 'All' && c.segment, c.fn !== 'All' && c.fn].filter(Boolean).join(' · ');
    const verdict =
      watches.length === 0 ? `${name}: steady period — no rule-based flags raised.` :
      watches.length <= 2 ? `${name}: broadly stable, ${watches.length} area${watches.length > 1 ? 's' : ''} to watch.` :
      `${name}: needs attention — ${watches.length} rule-based flags this period.`;
    return { verdict, points: chosen, watchCount: watches.length };
  }

  function bandHTML() {
    const asset = Compute.ctxNow().asset;
    const s = forAsset(asset);
    const withheld = REGISTRY.filter((e) => !Access.canSee(e)).length;
    return `<div class="exec-band">
      <p class="exec-verdict">${esc(s.verdict)}</p>
      <ul class="exec-points">
        ${s.points.map((p) => `<li class="${p.type === 'watch' ? 'is-watch' : p.type === 'good' ? 'is-good' : ''}">
          ${Access.canSeeTab(REG_BY_KEY.get(p.key)?.tab)
            ? `<button class="linklike" data-jump="${esc(p.key)}">${esc(p.text)}</button>`
            : esc(p.text)}</li>`).join('')}
      </ul>
      ${Access.isDefault() ? '' : `<p class="exec-foot">Built only from metrics visible to ${esc(Access.label())}${withheld ? ` (${withheld} withheld)` : ''}.</p>`}
    </div>`;
  }

  return { forAsset, bandHTML };
})();
