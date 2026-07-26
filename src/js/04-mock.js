/* Deterministic synthetic-data generator ("Explore with mock data").
   - Seeded mulberry32 with per-domain streams: identical output every run, and
     adding a generator never reshuffles the other domains.
   - Emits CSV TEXT per schema and feeds it through the same parse/validate path
     as user uploads (guaranteeing parity — and exercising validation).
   - Deliberately seeded flaws (~9% blank exit reasons, stale IDP dates, a few
     duplicate IDs / bad dates) so the Data Quality tab has real content.
   All of it is synthetic: no real person, plant figure or company number. */

const Mock = (() => {

  const ASSET_PROFILE = {
    Hazira:   { code: 'HZ', perm: 4800, trainee: 300, attr: 0.082, female: 0.095, earlyBump: 1.0, ageShift: 0,  contract: 9500 },
    Paradeep: { code: 'PD', perm: 1500, trainee: 120, attr: 0.128, female: 0.110, earlyBump: 2.1, ageShift: -3, contract: 4200 },
    Vizag:    { code: 'VZ', perm: 1050, trainee: 80,  attr: 0.090, female: 0.130, earlyBump: 1.1, ageShift: -1, contract: 1900 },
    Kirandul: { code: 'KD', perm: 750,  trainee: 60,  attr: 0.070, female: 0.060, earlyBump: 0.8, ageShift: 4,  contract: 1600 }
  };

  const FUNCTIONS = [
    ['Operations', 0.34], ['Maintenance', 0.22], ['Projects', 0.09], ['Supply Chain', 0.07],
    ['Quality', 0.06], ['Finance', 0.05], ['Safety', 0.05], ['HR', 0.04], ['IT', 0.04], ['Sales & Marketing', 0.04]
  ];

  const EXIT_REASONS = [
    ['Better prospects', 0.34], ['Compensation', 0.16], ['Relocation / family', 0.14],
    ['Higher education', 0.08], ['Health', 0.05], ['Work environment', 0.08],
    ['Performance', 0.07], ['Absconding', 0.03], ['Career change', 0.05]
  ];

  const PROGRAMMES = [
    'Safety Leadership', 'First-time Manager', 'Advanced Metallurgy', 'Lean Six Sigma',
    'Digital & Analytics Basics', 'Finance for Non-Finance', 'Contract Management',
    'Leadership Pipeline', 'Technical Skills Refresher', 'Communication Skills'
  ];

  const SYL1 = ['A.', 'B.', 'D.', 'G.', 'H.', 'J.', 'K.', 'M.', 'N.', 'P.', 'R.', 'S.', 'T.', 'V.'];
  const SYL2 = ['Sharma', 'Patel', 'Rao', 'Singh', 'Iyer', 'Das', 'Mehta', 'Nair', 'Kulkarni', 'Reddy',
                'Behera', 'Mishra', 'Ghosh', 'Verma', 'Choudhury', 'Naidu', 'Sahu', 'Joshi', 'Prasad', 'Pillai'];

  /* ---- distribution helpers ---- */
  const pickW = (rng, pairs) => {
    let r = rng(), acc = 0;
    for (const [v, w] of pairs) { acc += w; if (r <= acc) return v; }
    return pairs[pairs.length - 1][0];
  };
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  const rint = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
  const gauss = (rng) => (rng() + rng() + rng() + rng() - 2) / 2; // ~N(0, .29), [-1,1]

  const W_START = AS_OF_MONTH - (CONFIG.historyMonths - 1); // first month of history window

  /* ================= employees & exits ================= */

  function genPeople() {
    const employees = [];
    const exits = [];
    let seq = 0;
    for (const asset of CONFIG.assets) {
      const P = ASSET_PROFILE[asset];
      const rng = rngFor('people:' + asset);
      // exited-during-window population ≈ perm * attr * window years * 1.15 (voluntary+invol)
      const exitedCount = Math.round(P.perm * P.attr * (CONFIG.historyMonths / 12) * 1.15);
      const total = P.perm + P.trainee + exitedCount;
      for (let i = 0; i < total; i++) {
        seq++;
        const isTrainee = i >= P.perm && i < P.perm + P.trainee;
        const isExited = i >= P.perm + P.trainee;
        const id = `AMNS-${P.code}-${String(seq).padStart(5, '0')}`;

        // band
        let band;
        if (isTrainee) band = 'Below AM';
        else {
          const r = rng();
          band = r < 0.78 ? 'Below AM' : r < 0.978 ? 'AM-GM' : 'VP & above';
        }

        // age at as-of
        let age;
        if (isTrainee) age = rint(rng, 21, 26);
        else if (band === 'VP & above') age = 42 + Math.round(8 + gauss(rng) * 8);
        else if (band === 'AM-GM') age = Math.round(44 + P.ageShift + gauss(rng) * 12);
        else age = Math.round(38 + P.ageShift + gauss(rng) * 14);
        age = Math.max(21, Math.min(58, age));
        const dob = AS_OF_DAY - Math.round(age * 365.25) - rint(rng, 0, 364);

        // tenure (years) — capped by working age; early-tenure heavy for exited @ high-earlyBump assets
        let tenure;
        if (isTrainee) tenure = rng() * 2;
        else {
          tenure = -Math.log(1 - rng()) * 8; // exp mean 8
          if (isExited && rng() < 0.22 * P.earlyBump) tenure = rng() * 2.2; // early-turnover cluster
          tenure = Math.min(tenure, age - 21);
        }
        let doj = AS_OF_DAY - Math.round(tenure * 365.25) - rint(rng, 0, 90);
        if (doj > AS_OF_DAY) doj = AS_OF_DAY - rint(rng, 10, 200);

        // exit simulation
        let exitDay = null;
        if (isExited) {
          exitDay = monthEndDay(W_START + Math.floor(rng() * CONFIG.historyMonths)) - rint(rng, 0, 27);
          if (exitDay <= doj) exitDay = doj + rint(rng, 60, 400);
          if (exitDay > AS_OF_DAY) exitDay = AS_OF_DAY - rint(rng, 5, 200);
        }

        // talent flags (senior bands only)
        const senior = band !== 'Below AM';
        const tt = senior && !isExited && rng() < (band === 'VP & above' ? 0.18 : 0.065);
        const ct = senior && !isExited && !tt && rng() < 0.045;
        const cp = senior && rng() < (band === 'VP & above' ? 0.5 : 0.028);

        // role history: stagnation cluster among TTs
        const roleYears = tt
          ? (rng() < 0.32 ? 3 + rng() * 4 : rng() * 3)
          : Math.min(tenure, rng() * 5);
        const roleStart = Math.max(doj, AS_OF_DAY - Math.round(roleYears * 365.25));
        const promoted = tenure > 2.5 && rng() < 0.62;
        const lastPromo = promoted ? Math.max(doj, AS_OF_DAY - Math.round((roleYears + (rng() < 0.55 ? 0 : 2.5 + rng() * 3)) * 365.25)) : null;

        const gender = rng() < P.female * (isTrainee ? 2.2 : band === 'Below AM' ? 0.95 : 1.0) ? 'Female' : 'Male';
        const nationality = rng() < 0.012 ? 'Japanese' : rng() < 0.004 ? 'Luxembourgish' : 'Indian';

        employees.push({
          id, asset, band, isTrainee, isExited, dob, doj, exitDay,
          grade: band === 'VP & above' ? pick(rng, ['VP', 'SVP', 'ED']) : band === 'AM-GM' ? pick(rng, ['AM', 'DM', 'M', 'SM', 'AGM', 'DGM', 'GM']) : pick(rng, ['S1', 'S2', 'S3', 'JO', 'O']),
          func: pickW(rng, FUNCTIONS),
          gender,
          tt, ct, cp,
          roleStart, lastPromo,
          nationality,
          disability: rng() < 0.007,
          name: pick(rng, SYL1) + ' ' + pick(rng, SYL2)
        });

        if (isExited) {
          const tenureAtExit = (exitDay - doj) / 365.25;
          const voluntary = rng() < 0.86;
          exits.push({
            id, exitDay,
            type: voluntary ? 'Voluntary' : 'Involuntary',
            regretted: voluntary && (tt || ct || rng() < 0.3),
            rehire: voluntary && rng() < 0.42,
            reason: rng() < 0.09 ? '' : (voluntary ? pickW(rng, EXIT_REASONS) : pick(rng, ['Performance', 'Disciplinary', 'Absconding'])),
            tenureAtExit
          });
        }
      }
    }
    // managers: VP&above + a slice of AM-GM manage people at their asset
    const mgrRng = rngFor('managers');
    const byAsset = {};
    for (const a of CONFIG.assets) byAsset[a] = { mgrs: [], all: [] };
    for (const e of employees) {
      if (e.isExited) continue;
      byAsset[e.asset].all.push(e);
      if (e.band === 'VP & above' || (e.band === 'AM-GM' && mgrRng() < 0.38)) byAsset[e.asset].mgrs.push(e);
    }
    for (const a of CONFIG.assets) {
      const { mgrs, all } = byAsset[a];
      for (const e of all) {
        if (mgrs.length && mgrRng() < 0.985) {
          const m = pick(mgrRng, mgrs);
          e.managerId = m.id === e.id ? '' : m.id;
        } else e.managerId = '';
      }
    }
    return { employees, exits };
  }

  /* ================= requisitions & applications ================= */

  function genHiring(employees, exits) {
    const rng = rngFor('hiring');
    const reqs = [];
    const apps = [];
    let reqSeq = 0, appSeq = 0;
    const activeSenior = employees.filter((e) => !e.isExited && !e.isTrainee);
    const exitById = new Map(exits.map((x) => [x.id, x]));

    // replacement reqs from senior exits + a stream of new positions
    const seniorExits = employees.filter((e) => e.isExited && e.band !== 'Below AM');
    const sources = [
      ...seniorExits.map((e) => ({ asset: e.asset, grade: e.grade, func: e.func, openDay: exitById.get(e.id).exitDay - rint(rng, 0, 30), type: 'Replacement' }))
    ];
    const newCount = Math.round(sources.length * 0.55);
    for (let i = 0; i < newCount; i++) {
      const e = pick(rng, activeSenior);
      sources.push({ asset: e.asset, grade: e.grade, func: e.func, openDay: monthEndDay(W_START + Math.floor(rng() * CONFIG.historyMonths)) - rint(rng, 0, 27), type: 'New' });
    }
    sources.sort((a, b) => a.openDay - b.openDay);

    for (const s of sources) {
      reqSeq++;
      const id = `REQ-${String(reqSeq).padStart(4, '0')}`;
      const confidential = rng() < 0.07;
      const posted = !confidential && rng() < 0.72; // deliberate posting-compliance gap
      const ttf = 35 + Math.round(rng() * 110 + (s.grade === 'GM' || s.grade === 'VP' ? 30 : 0));
      const closedDay = s.openDay + ttf;
      const closed = closedDay <= AS_OF_DAY - rint(rng, 0, 20);
      const mode = closed ? pickW(rng, [['Internal', 0.42], ['External', 0.44], ['Campus', 0.09], ['Boomerang', 0.05]]) : null;
      const hiredId = closed && mode !== 'External' && mode !== 'Campus' && rng() < 0.9
        ? pick(rng, activeSenior.filter((e) => e.asset === s.asset) || activeSenior).id
        : closed ? `AMNS-${ASSET_PROFILE[s.asset].code}-${String(9000 + reqSeq).padStart(5, '0')}` : '';
      reqs.push({ id, ...s, confidential, posted, closed, closedDay: closed ? closedDay : null, mode, hiredId });

      if (posted) {
        const nApps = rint(rng, 0, 6);
        for (let j = 0; j < nApps; j++) {
          appSeq++;
          const applicant = pick(rng, activeSenior);
          const appDay = s.openDay + rint(rng, 2, 25);
          const status = pickW(rng, [['Applied', 0.3], ['Shortlisted', 0.2], ['Interviewed', 0.2], ['Offered', 0.08], ['Rejected', 0.17], ['Withdrawn', 0.05]]);
          // ageing cluster: some 'Applied' rows with stale last-action dates
          const lastAction = status === 'Applied' && rng() < 0.35
            ? appDay
            : Math.min(AS_OF_DAY, appDay + rint(rng, 1, 40));
          apps.push({ id: `APP-${String(appSeq).padStart(5, '0')}`, reqId: id, empId: applicant.id, appDay, status, lastAction });
        }
      }
    }
    return { reqs, apps };
  }

  /* ================= learning / IDP / LMS / succession ================= */

  function genLearning(employees) {
    const rng = rngFor('learning');
    const events = [];
    for (const e of employees) {
      if (e.isExited) continue;
      // coverage propensity by cohort — VP+ deliberately low (mirrors a classic CHRO pain point)
      const p = e.tt ? 0.8 : e.isTrainee ? 0.9 : e.band === 'VP & above' ? 0.3 : e.band === 'AM-GM' ? 0.62 : 0.55;
      if (rng() < p) {
        const n = 1 + (rng() < 0.35 ? 1 : 0) + (e.tt && rng() < 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          events.push({
            empId: e.id,
            programme: pick(rng, PROGRAMMES),
            day: monthEndDay(W_START + Math.floor(rng() * CONFIG.historyMonths)) - rint(rng, 0, 27),
            days: pickW(rng, [[0.5, 0.25], [1, 0.35], [2, 0.25], [3, 0.1], [5, 0.05]]),
            mode: rng() < 0.55 ? 'Classroom' : 'E-learning'
          });
        }
      }
    }
    return events;
  }

  function genIdp(employees) {
    const rng = rngFor('idp');
    const rows = [];
    for (const e of employees) {
      if (e.isExited) continue;
      if (!(e.tt || e.band === 'VP & above')) continue;
      const has = rng() < 0.68;
      // implementation heavily skewed low — the "≤25%" band dominates
      const impl = has ? (rng() < 0.62 ? rint(rng, 0, 25) : rng() < 0.6 ? rint(rng, 26, 50) : rint(rng, 51, 90)) : null;
      const stale = rng() < 0.28; // seeded stale-date flaw for Data Quality
      const upd = has ? AS_OF_DAY - (stale ? rint(rng, 280, 600) : rint(rng, 5, 170)) : null;
      rows.push({ empId: e.id, has, impl, upd });
    }
    return rows;
  }

  function genLms(employees) {
    const rng = rngFor('lms');
    const rows = [];
    for (const e of employees) {
      if (e.isExited || e.isTrainee) continue;
      const licensed = e.band !== 'Below AM' || rng() < 0.18;
      if (!licensed) continue;
      const ever = rng() < 0.82;
      const recent = ever && rng() < 0.62;
      const login = !ever ? null : AS_OF_DAY - (recent ? rint(rng, 1, 175) : rint(rng, 200, 700));
      rows.push({ empId: e.id, login });
    }
    return rows;
  }

  function genSuccession(employees) {
    const rng = rngFor('succession');
    const rows = [];
    const actives = employees.filter((e) => !e.isExited);
    const ttPool = actives.filter((e) => e.tt);
    let n = 0;
    for (const asset of CONFIG.assets) {
      const P = ASSET_PROFILE[asset];
      const holders = actives.filter((e) => e.asset === asset && (e.cp || e.band === 'VP & above'));
      const posCount = Math.max(8, Math.round(P.perm * 0.028));
      for (let i = 0; i < posCount; i++) {
        n++;
        const level = rng() < 0.45 ? 'GM' : 'CP';
        const vacant = rng() < 0.16;
        const incumbent = vacant ? '' : (holders.length ? pick(rng, holders).id : '');
        const hasSucc = rng() < (asset === 'Hazira' ? 0.74 : 0.6); // Hazira's bench is deeper — story beat
        const succ = hasSucc && ttPool.length ? pick(rng, ttPool.filter((t) => t.asset === asset).concat(ttPool).slice(0, 50)) : null;
        rows.push({
          posId: `POS-${P.code}-${level}-${String(i + 1).padStart(3, '0')}`,
          level,
          incumbent,
          succId: succ ? succ.id : '',
          readiness: succ ? (rng() < 0.45 ? 'Ready Now' : '1-2 Years') : '',
          succIdp: succ ? rng() < 0.55 : null,
          vacantSinceDay: vacant ? AS_OF_DAY - rint(rng, 15, 260) : null
        });
      }
    }
    return rows;
  }

  /* ================= asset-month panels ================= */

  function genPanels(employees) {
    const rng = rngFor('panels');
    const prod = [];
    const cAtt = [];
    const cComp = [];
    const activePerm = {};
    for (const a of CONFIG.assets) activePerm[a] = employees.filter((e) => e.asset === a && !e.isExited && !e.isTrainee).length;

    for (const asset of CONFIG.assets) {
      const P = ASSET_PROFILE[asset];
      // per-asset steel intensity (t/employee/yr incl. context) — synthetic but steel-plausible
      const annualTonnesPerHead = asset === 'Kirandul' ? 0 : rint(rng, 950, 1350); // Kirandul = mines: no crude steel
      const contractors = [];
      const nCon = rint(rng, 4, 7);
      for (let c = 0; c < nCon; c++) contractors.push({ name: `CNT-${pick(rng, ['Alpha', 'Bharat', 'Coastal', 'Deccan', 'Eastern', 'Fortune', 'Ganga', 'Himal'])}-${c + 1}`, share: 0.5 + rng() });
      const shareSum = contractors.reduce((s, c) => s + c.share, 0);

      for (let mi = W_START; mi <= AS_OF_MONTH; mi++) {
        const season = 1 + 0.05 * Math.sin((mi % 12) / 12 * Math.PI * 2);
        const tonnes = annualTonnesPerHead ? Math.round(P.perm * annualTonnesPerHead / 12 * season * (0.93 + rng() * 0.14)) : '';
        const totalWorkforce = P.perm + P.trainee + P.contract;
        const manHours = Math.round(totalWorkforce * 205 * (0.96 + rng() * 0.08));
        const lti = rng() < 0.72 ? 0 : rng() < 0.85 ? 1 : 2;
        const irDays = rng() < 0.9 ? 0 : rint(rng, 40, 400);
        const empCost = Math.round(P.perm * rint(rng, 135000, 150000) * (1 + (mi - W_START) * 0.004));
        const revenue = annualTonnesPerHead ? Math.round(tonnes * rint(rng, 52000, 60000)) : Math.round(P.perm * 900000);
        prod.push({ asset, mi, tonnes, manHours, lti, irDays, empCost, revenue });

        for (const con of contractors) {
          const hc = Math.round(P.contract * con.share / shareSum * (0.92 + rng() * 0.16));
          const deployed = Math.round(hc * 26 * (0.95 + rng() * 0.05));
          const present = Math.round(deployed * (0.86 + rng() * 0.11));
          cAtt.push({ contractor: con.name, asset, mi, deployed, present, hc });
          cComp.push({
            contractor: con.name, asset, mi,
            pf: rng() < 0.93, wage: rng() < 0.9, lic: rng() < 0.965,
            induction: Math.min(100, Math.round(84 + rng() * 16))
          });
        }
      }
    }
    return { prod, cAtt, cComp };
  }

  /* ================= demo targets ================= */

  function genTargets() {
    // Demo targets only — in BYOF mode targets come from targets.csv.
    return [
      ['attr_annualised', 9, 'lower'], ['attr_tt_count', 4, 'lower'], ['attr_early_1y', 12, 'lower'],
      ['attr_regretted', 30, 'lower'],
      ['succession_coverage', 80, 'higher'], ['succ_ready_now', 45, 'higher'], ['internal_fill_rate', 60, 'higher'],
      ['tt_stagnation', 18, 'lower'], ['cp_occupancy', 55, 'higher'], ['cp_vacancy_3m', 4, 'lower'],
      ['learning_coverage_all', 75, 'higher'], ['learning_days_per_emp', 3, 'higher'],
      ['idp_coverage', 85, 'higher'], ['lms_adoption', 85, 'higher'], ['lms_active_6m', 60, 'higher'],
      ['posting_compliance', 100, 'higher'], ['mobility_ageing', 0, 'lower'],
      ['female_pct', 10, 'higher'], ['female_pct_trainees', 25, 'higher'],
      ['headcount_close', null, 'higher'],
      ['tonnes_per_emp', 1200, 'higher'], ['cost_per_tonne', 2600, 'lower'], ['ltifr', 0.3, 'lower'],
      ['contract_attendance_pct', 92, 'higher'], ['contract_compliance_idx', 95, 'higher'],
      ['ecost_pct_revenue', 4.5, 'lower'], ['span_of_control', 5.5, 'higher']
    ].filter((t) => t[1] != null);
  }

  /* ================= CSV emission (through SCHEMAS column order) ================= */

  const F = (b) => (b == null ? '' : b ? 'Y' : 'N');

  function toCSVs() {
    const { employees, exits } = genPeople();
    const { reqs, apps } = genHiring(employees, exits);
    const learning = genLearning(employees);
    const idp = genIdp(employees);
    const lms = genLms(employees);
    const succession = genSuccession(employees);
    const { prod, cAtt, cComp } = genPanels(employees);
    const flawRng = rngFor('flaws');

    const files = new Map();
    const emit = (schemaId, rows) => {
      const cols = SCHEMAS[schemaId].columns;
      files.set(schemaId, CSV.serialize(cols.map((c) => c.name), rows));
    };

    const empRows = employees.map((e) => [
      e.id, e.name, e.asset, e.band, e.grade, e.func, e.gender,
      fmtDMY(e.dob), fmtDMY(e.doj), e.isTrainee ? 'Trainee' : 'Permanent',
      F(e.tt), F(e.ct), F(e.cp), e.managerId || '', e.nationality, F(e.disability),
      fmtDMY(e.roleStart), e.lastPromo ? fmtDMY(e.lastPromo) : ''
    ]);
    // seeded flaws: 4 duplicated IDs + 3 bad DOB strings (caught by validation → Data Quality)
    for (let i = 0; i < 4; i++) {
      const src = empRows[Math.floor(flawRng() * empRows.length)];
      empRows.push([...src]);
    }
    for (let i = 0; i < 3; i++) {
      const r = empRows[Math.floor(flawRng() * empRows.length)];
      r[7] = pick(flawRng, ['31-02-1985', '1987-06-12', '00-00-1990']);
    }
    emit('employee_master', empRows);

    emit('exits', exits.map((x) => [x.id, fmtDMY(x.exitDay), x.type, F(x.regretted), F(x.rehire), x.reason]));

    emit('requisitions', reqs.map((r) => [
      r.id, r.asset, r.grade, r.func, fmtDMY(r.openDay), r.type,
      F(r.posted), F(r.confidential), r.closedDay ? fmtDMY(r.closedDay) : '', r.mode || '', r.hiredId || ''
    ]));

    emit('internal_applications', apps.map((a) => [
      a.id, a.reqId, a.empId, fmtDMY(a.appDay), a.status, fmtDMY(a.lastAction)
    ]));

    emit('learning_events', learning.map((l) => [l.empId, l.programme, fmtDMY(l.day), l.days, l.mode]));

    emit('idp_status', idp.map((r) => [r.empId, F(r.has), r.impl == null ? '' : r.impl, r.upd ? fmtDMY(r.upd) : '']));

    emit('succession', succession.map((s) => [s.posId, s.level, s.incumbent, s.succId, s.readiness, s.succIdp == null ? '' : F(s.succIdp)]));

    emit('lms_usage', lms.map((r) => [r.empId, 'Y', r.login ? fmtDMY(r.login) : '']));

    emit('targets', genTargets());

    emit('production_safety', prod.map((p) => [
      p.asset, monthIdxToMY(p.mi), p.tonnes, p.manHours, p.lti, p.irDays, p.empCost, p.revenue
    ]));

    emit('contract_attendance', cAtt.map((c) => [c.contractor, c.asset, monthIdxToMY(c.mi), c.deployed, c.present, c.hc]));

    emit('contract_compliance', cComp.map((c) => [
      c.contractor, c.asset, monthIdxToMY(c.mi), F(c.pf), F(c.wage), F(c.lic), c.induction
    ]));

    return files;
  }

  return { toCSVs };
})();
