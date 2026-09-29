/* Tile-grid tab renderers with their charts: Talent, L&D, Mobility, Diversity —
   registry-driven, grouped into sections. The shared helpers below
   (renderTilesByGroup, fillSlot, needData) are also used by tabs/attrition.js
   and tabs/contract.js; renderers run only after every file has loaded. */

function renderTilesByGroup(panel, tabId, opts = {}) {
  const entries = REGISTRY.filter((e) => e.tab === tabId);
  const groups = [...new Set(entries.map((e) => e.group))];
  panel.innerHTML =
    (opts.leadHTML || '') +
    groups.map((g) => `
      <div class="section-head"><h2>${esc(g)}</h2>${opts.groupSubs?.[g] ? `<span class="sub">${esc(opts.groupSubs[g])}</span>` : ''}</div>
      <div class="tile-grid">
        ${entries.filter((e) => e.group === g).map((e) => UI.tileHTML(e.key)).join('')}
      </div>
      <div class="chart-slot card-grid" id="charts-${tabId}-${g.replace(/\W+/g, '-').toLowerCase()}" style="margin-top:10px"></div>`).join('') +
    (opts.tailHTML || '');
}

function fillSlot(tabId, group, html) {
  const el = document.getElementById(`charts-${tabId}-${group.replace(/\W+/g, '-').toLowerCase()}`);
  if (el) el.innerHTML = html;
}

const needData = (ids, builder) =>
  ids.every((id) => App.state.datasets.has(id))
    ? builder()
    : `<div class="chart-empty">No data loaded for this chart — needs ${ids.map((i) => i + '.csv').join(', ')}.</div>`;

/* ---------------- Talent ---------------- */

TabRenderers.talent = (panel) => {
  renderTilesByGroup(panel, 'talent', {
    groupSubs: {
      'Hiring': 'feeds the CHRO Scorecard',
      'Recognition': 'trailing 12 months · unique coverage, not volume'
    }
  });
  fillSlot('talent', 'Succession', [
    Charts.card({
      title: 'Succession coverage by asset', sub: 'click a bar to focus that asset', infoKey: 'succession_coverage',
      body: needData(['succession'], () => Charts.barH({ items: ChartData.assetBars('succession_coverage', (v) => fmtPct(v, 0)), fmt: (v) => fmtPct(v, 0), target: Compute.metric('succession_coverage').target?.value ?? null }))
    }),
    Charts.card({
      title: 'Ready-now index by asset', infoKey: 'succ_ready_now',
      body: needData(['succession'], () => Charts.barH({ items: ChartData.assetBars('succ_ready_now', (v) => fmtPct(v, 0)), fmt: (v) => fmtPct(v, 0), target: Compute.metric('succ_ready_now').target?.value ?? null }))
    })
  ].join(''));
  fillSlot('talent', 'Recognition', Charts.card({
    title: 'Recognition coverage by asset', sub: 'unique employees recognised, trailing 12 m', infoKey: 'recognition_coverage',
    body: needData(['recognition', 'employee_master'], () => Charts.barH({
      items: ChartData.assetBars('recognition_coverage', (v) => fmtPct(v, 0)), fmt: (v) => fmtPct(v, 0),
      target: Compute.metric('recognition_coverage').target?.value ?? null
    }))
  }));
};

/* ---------------- L&D ---------------- */

TabRenderers.lnd = (panel) => {
  renderTilesByGroup(panel, 'lnd', { groupSubs: { 'Learning coverage': 'trailing 12 months, by cohort' } });
  const m = Compute.build(), ctx = Compute.ctxNow();
  fillSlot('lnd', 'Learning coverage', Charts.card({
    title: 'Learning coverage by cohort', sub: 'share with ≥1 intervention, trailing 12 months', infoKey: 'learning_coverage_all',
    body: needData(['learning_events', 'employee_master'], () => Charts.barH({
      items: [['All', 'all'], ['TT', 'tt'], ['Trainees', 'trainees'], ['VP+', 'vp'], ['AM–GM', 'amgm']].map(([label, ck]) => {
        const v = Compute.metric('learning_coverage_' + ck).value;
        return { label, value: v, role: ck === 'vp' && v != null && v < 40 ? 'focus' : undefined, tip: `${label}: ${v == null ? '—' : fmtPct(v, 1)}` };
      }),
      fmt: (v) => fmtPct(v, 0),
      target: Compute.metric('learning_coverage_all').target?.value ?? null
    }))
  }));
  fillSlot('lnd', 'Learning intensity', [
    Charts.card({
      title: 'Classroom vs e-learning person-days', sub: 'trailing 12 months, all cohorts', access: 'learning',
      body: needData(['learning_events'], () => {
        const from = monthEndDay(ctx.endMonth - 12) + 1;
        let cls = 0, el = 0;
        for (const l of m.learning) {
          if (l.start_date == null || l.start_date < from || l.start_date > ctx.asOfDay) continue;
          const e = m.empById.get(l.employee_id);
          if (e ? !Compute.empMatch(e, ctx) : !Compute.isUnscoped(ctx)) continue;
          if (l.mode === 'E-learning') el += l.person_days || 0; else cls += l.person_days || 0;
        }
        return Charts.donut({ items: [{ label: 'Classroom', value: Math.round(cls) }, { label: 'E-learning', value: Math.round(el) }], centerLabel: 'person-days' });
      })
    }),
    Charts.card({
      title: 'Learning days per employee — annualised, monthly', sub: 'each month’s person-days × 12 ÷ headcount, vs target', infoKey: 'learning_days_all',
      body: needData(['learning_events', 'employee_master'], () => {
        const months = ChartData.monthsAxis(ctx);
        const values = months.map((mi) => {
          const hc = Compute.activesAt(m, ctx, null, monthEndDay(mi)).length;
          if (!hc) return null;
          let days = 0;
          for (const l of m.learning) {
            if (l.start_date == null || dayToMonthIdx(l.start_date) !== mi) continue;
            const e = m.empById.get(l.employee_id);
            if (e ? !Compute.empMatch(e, ctx) : !Compute.isUnscoped(ctx)) continue;
            days += l.person_days || 0;
          }
          return days * 12 / hc;
        });
        return Charts.line({
          months,
          series: [{ label: 'Learning days', role: 'focus', values }],
          yFmt: (v) => fmtNum(v, 1),
          target: Compute.metric('learning_days_all').target?.value ?? null
        });
      })
    }),
    Charts.card({
      title: 'Trainings by category', sub: 'events in the trailing 12 months (optional Category column)', infoKey: 'safety_learning_days',
      body: needData(['learning_events'], () => {
        const from = monthEndDay(ctx.endMonth - 12) + 1;
        const counts = new Map();
        for (const l of m.learning) {
          if (l.start_date == null || l.start_date < from || l.start_date > ctx.asOfDay) continue;
          const e = m.empById.get(l.employee_id);
          if (e ? !Compute.empMatch(e, ctx) : !Compute.isUnscoped(ctx)) continue;
          const k = l.category || '(uncategorised)';
          counts.set(k, (counts.get(k) || 0) + 1);
        }
        const items = [...counts.entries()].sort((a, b) => b[1] - a[1])
          .map(([label, value]) => ({ label, value, role: label === 'HSE' ? 'focus' : undefined, tip: `${label}: ${fmtInt(value)} events` }));
        return items.length ? Charts.barH({ items, fmt: (v) => fmtInt(v) }) : '<div class="chart-empty">No categorised events in the window.</div>';
      })
    })
  ].join(''));
};

/* ---------------- Mobility ---------------- */

TabRenderers.mobility = (panel) => {
  renderTilesByGroup(panel, 'mobility', { groupSubs: { 'Portal funnel': 'openings → postings → applications → outcomes (period)' } });
  fillSlot('mobility', 'Portal funnel', Charts.card({
    title: 'Internal mobility funnel', sub: 'period totals with stage-to-stage conversion', infoKey: 'mob_openings',
    body: needData(['requisitions', 'internal_applications'], () => Charts.funnel({
      stages: [
        ['New openings', 'mob_openings'], ['Posted internally', 'mob_postings'],
        ['Postings with applications', 'mob_postings_with_apps'], ['Internal applications', 'mob_apps'],
        ['Interviewed', 'mob_interviewed'], ['Offers', 'mob_offers']
      ].map(([label, key]) => ({ label, value: Compute.metric(key).value }))
    }))
  }));
  fillSlot('mobility', 'Process discipline', Charts.card({
    title: 'Stalled applications by asset', sub: '>15 days without action — click a bar to focus', infoKey: 'mobility_ageing',
    body: needData(['internal_applications'], () => Charts.barH({
      items: ChartData.assetBars('mobility_ageing', (v) => fmtInt(v)), fmt: (v) => fmtInt(v)
    }))
  }));
};

/* ---------------- Diversity ---------------- */

TabRenderers.diversity = (panel) => {
  renderTilesByGroup(panel, 'diversity', {
    leadHTML: `<div class="section-head"><h2>Overall</h2></div>
      <div class="tile-grid">${UI.tileHTML('female_pct')}</div>
      <div class="chart-slot card-grid" id="charts-diversity-headline" style="margin-top:10px"></div>`
  });
  const m = Compute.build(), ctx = Compute.ctxNow();
  fillSlot('diversity', 'headline', [
    Charts.card({
      title: 'Female share by grade band', sub: 'counts on hover — small bases flagged on tiles', infoKey: 'female_pct',
      body: needData(['employee_master'], () => Charts.barH({
        items: CONFIG.gradeBands.map((b) => {
          const pop = Compute.actives(m, { ...ctx, band: b }, 'Permanent');
          const f = pop.filter((e) => e.gender === 'Female').length;
          return {
            label: CONFIG.bandLabels[b], value: pop.length ? f / pop.length * 100 : null,
            sub: `${fmtInt(f)}/${fmtInt(pop.length)}`,
            tip: `${CONFIG.bandLabels[b]}: ${fmtInt(f)} of ${fmtInt(pop.length)}`
          };
        }), fmt: (v) => fmtPct(v, 1)
      }))
    }),
    Charts.card({
      title: 'Female share by asset', sub: 'click a bar to focus that asset', infoKey: 'female_pct',
      body: needData(['employee_master'], () => Charts.barH({
        items: ChartData.assetBars('female_pct', (v) => fmtPct(v, 1)), fmt: (v) => fmtPct(v, 1),
        target: Compute.metric('female_pct').target?.value ?? null
      }))
    })
  ].join(''));
};
