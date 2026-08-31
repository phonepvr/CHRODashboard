/* Tile-grid tab renderers with their charts: Talent, L&D, Mobility, Attrition,
   Diversity, Contract — registry-driven, grouped into sections. */

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
      'Performance management': 'current cycle · records on system, not conversations',
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
  fillSlot('talent', 'Performance management', [
    Charts.card({
      title: 'Goal-setting completion by asset', sub: 'click a bar to focus', infoKey: 'goal_setting_pct',
      body: needData(['pms_status', 'employee_master'], () => Charts.barH({
        items: ChartData.assetBars('goal_setting_pct', (v) => fmtPct(v, 0)), fmt: (v) => fmtPct(v, 0),
        target: Compute.metric('goal_setting_pct').target?.value ?? null
      }))
    }),
    Charts.card({
      title: 'Mid-year review completion by asset', infoKey: 'midyear_review_pct',
      body: needData(['pms_status', 'employee_master'], () => Charts.barH({
        items: ChartData.assetBars('midyear_review_pct', (v) => fmtPct(v, 0)), fmt: (v) => fmtPct(v, 0),
        target: Compute.metric('midyear_review_pct').target?.value ?? null
      }))
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
      title: 'Classroom vs e-learning person-days', sub: 'trailing 12 months, all cohorts',
      body: needData(['learning_events'], () => {
        const from = monthEndDay(ctx.endMonth - 12) + 1;
        let cls = 0, el = 0;
        for (const l of m.learning) {
          if (l.start_date == null || l.start_date < from || l.start_date > ctx.asOfDay) continue;
          const e = m.empById.get(l.employee_id);
          if (e && !Compute.empMatch(e, ctx)) continue;
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
            if (e && !Compute.empMatch(e, ctx)) continue;
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
          if (e && !Compute.empMatch(e, ctx)) continue;
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

/* ---------------- Attrition ---------------- */

TabRenderers.attrition = (panel) => {
  renderTilesByGroup(panel, 'attrition', {
    leadHTML: `<div class="section-head"><h2>Headline</h2>
        <span class="sub">annualised; superannuation excluded</span></div>
      <div class="tile-grid">${UI.tileHTML('attr_annualised')}</div>
      <div class="chart-slot card-grid" id="charts-attrition-headline" style="margin-top:10px"></div>`
  });
  const m = Compute.build(), ctx = Compute.ctxNow();
  fillSlot('attrition', 'headline', [
    Charts.card({
      title: 'Monthly attrition by asset (annualised)', sub: 'selected asset in red · Group in black · direct-labelled', infoKey: 'attr_annualised',
      body: needData(['exits', 'employee_master'], () => {
        const { months, series } = ChartData.assetLines(ctx, ChartData.attritionAt(m, ctx));
        return Charts.line({ months, series, yFmt: (v) => fmtPct(v, 0), target: Compute.metric('attr_annualised').target?.value ?? null });
      })
    }),
    Charts.card({
      title: 'Total vs voluntary attrition', sub: 'monthly annualised — the gap is involuntary/managed exits', infoKey: 'attr_voluntary',
      body: needData(['exits', 'employee_master'], () => {
        const months = ChartData.monthsAxis(ctx);
        return Charts.line({
          months,
          series: [
            { label: 'Total', role: 'group', values: months.map((mi) => Compute.monthAttritionRate(m, ctx, mi)) },
            { label: 'Voluntary', role: 'focus', values: months.map((mi) => Compute.monthAttritionRateWhere(m, ctx, mi, (x) => x.exit_type === 'Voluntary')) }
          ],
          yFmt: (v) => fmtPct(v, 0)
        });
      })
    })
  ].join(''));
  fillSlot('attrition', 'Exit quality', Charts.card({
    title: 'Exits by stated reason', sub: 'period; blank reasons surfaced, not hidden', infoKey: 'attr_regretted',
    body: needData(['exits', 'employee_master'], () => {
      const counts = new Map();
      for (const x of Compute.exitsInPeriod(m, ctx, null)) {
        const k = x.exit_reason || '(blank)';
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9)
        .map(([label, value]) => ({ label, value, role: label === '(blank)' ? 'focus' : undefined, tip: `${label}: ${fmtInt(value)} exits` }));
      return items.length ? Charts.barH({ items, fmt: (v) => fmtInt(v) }) : '<div class="chart-empty">No exits in the selected period.</div>';
    })
  }));
  fillSlot('attrition', 'Early turnover', Charts.card({
    title: 'Early turnover (≤1 yr) by asset', sub: 'click a bar to focus that asset', infoKey: 'attr_early_1y',
    body: needData(['exits', 'employee_master'], () => Charts.barH({
      items: ChartData.assetBars('attr_early_1y', (v) => fmtPct(v, 1)), fmt: (v) => fmtPct(v, 0),
      target: Compute.metric('attr_early_1y').target?.value ?? null
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
      title: 'Female share by asset', sub: 'click a bar to focus that asset',
      body: needData(['employee_master'], () => Charts.barH({
        items: ChartData.assetBars('female_pct', (v) => fmtPct(v, 1)), fmt: (v) => fmtPct(v, 1),
        target: Compute.metric('female_pct').target?.value ?? null
      }))
    })
  ].join(''));
};

/* ---------------- Contract ---------------- */

TabRenderers.contract = (panel) => {
  renderTilesByGroup(panel, 'contract', {
    leadHTML: `<div class="empty-note" style="margin-bottom:10px">
      <strong>Separate population.</strong> Only deployment/attendance
      <span class="tile-src">[SCRUM]</span> and statutory compliance
      <span class="tile-src">[Aparajita]</span> apply to the contract workforce —
      talent, L&amp;D and succession metrics deliberately do not. The grade-band
      filter does not apply here.</div>`
  });
  const m = Compute.build(), ctx = Compute.ctxNow();
  fillSlot('contract', 'Deployment', [
    Charts.card({
      title: 'Daily attendance trend', sub: '[SCRUM] man-days present ÷ deployed, monthly', infoKey: 'contract_attendance_pct',
      body: needData(['contract_attendance'], () => {
        const { months, series } = ChartData.assetLines(ctx, (asset, mi) => {
          const c = ChartData.subCtx(ctx, asset);
          const rows = m.cAtt.filter((r) => r.month === mi && Compute.inAsset(c, r.asset));
          const dep = rows.reduce((s, r) => s + (r.mandays_deployed || 0), 0);
          return dep ? rows.reduce((s, r) => s + (r.mandays_present || 0), 0) / dep * 100 : null;
        });
        return Charts.line({ months, series, yFmt: (v) => fmtPct(v, 0), target: Compute.metric('contract_attendance_pct').target?.value ?? null });
      })
    }),
    Charts.card({
      title: 'Contract headcount by contractor', sub: '[SCRUM] latest month, top 10', infoKey: 'contract_hc',
      body: needData(['contract_attendance'], () => {
        const latest = Compute.latestPanelMonth(m.cAtt, ctx);
        if (latest == null) return '<div class="chart-empty">No contractor rows in the period.</div>';
        const rows = m.cAtt.filter((r) => r.month === latest && Compute.inAsset(ctx, r.asset))
          .sort((a, b) => (b.contract_headcount || 0) - (a.contract_headcount || 0)).slice(0, 10);
        return Charts.barH({
          items: rows.map((r) => ({
            label: r.contractor, value: r.contract_headcount, sub: r.asset,
            tip: `${r.contractor} @ ${r.asset}: ${fmtInt(r.contract_headcount)} workers\nAttendance ${r.mandays_deployed ? fmtPct(r.mandays_present / r.mandays_deployed * 100, 1) : '—'}`
          })), fmt: (v) => fmtInt(v)
        });
      })
    })
  ].join(''));
  fillSlot('contract', 'Statutory compliance', Charts.card({
    title: 'Compliance indices', sub: '[Aparajita] period averages vs the composite bar', infoKey: 'contract_compliance_idx',
    body: needData(['contract_compliance'], () => Charts.barH({
      items: [
        ['PF/ESI remittance', 'c_pf_esi'], ['Wage timeliness', 'c_wage'],
        ['Licence validity', 'c_licence'], ['Safety induction', 'c_induction'],
        ['Composite', 'contract_compliance_idx']
      ].map(([label, key]) => {
        const v = Compute.metric(key).value;
        return { label, value: v, role: label === 'Composite' ? 'focus' : undefined, tip: `${label}: ${v == null ? '—' : fmtPct(v, 1)}` };
      }),
      fmt: (v) => fmtPct(v, 1),
      target: Compute.metric('contract_compliance_idx').target?.value ?? null
    }))
  }));
};
