/* Deterministic synthetic-data generator ("Explore with mock data").
   - Seeded mulberry32 with per-domain streams: identical output every run, and
     adding a generator never reshuffles the other domains.
   - Emits CSV TEXT per schema and feeds it through the same parse/validate path
     as user uploads (guaranteeing parity — and exercising validation).
   - Deliberately seeded flaws (~9% blank exit reasons, stale IDP dates, a few
     duplicate IDs / bad dates, a Function Plant missing from org_units) so the
     Data Quality tab has real content; ~1% of incumbents carry no Position ID
     (the "incumbents without a position" case).
   - Phase-8 columns/templates draw ONLY from new domains (…-ext, retirees,
     positions, budget, movements, candidates, absence, statutory, …) so the
     pre-existing columns keep their exact values.
   All of it is synthetic: no real person, plant figure or company number. */

const Mock = (() => {

  const ASSET_PROFILE = {
    Hazira:   { code: 'HZ', perm: 4800, trainee: 300, attr: 0.082, female: 0.095, earlyBump: 1.0, ageShift: 0,  contract: 9500 },
    Paradeep: { code: 'PD', perm: 1500, trainee: 120, attr: 0.128, female: 0.110, earlyBump: 2.1, ageShift: -3, contract: 4200 },
    Vizag:    { code: 'VZ', perm: 1050, trainee: 80,  attr: 0.090, female: 0.130, earlyBump: 1.1, ageShift: -1, contract: 1900 },
    Kirandul: { code: 'KD', perm: 750,  trainee: 60,  attr: 0.070, female: 0.060, earlyBump: 0.8, ageShift: 4,  contract: 1600 }
  };

  const FUNCTIONS = [
    ['Operations', 0.34], ['Maintenance', 0.22], ['Project Engineering', 0.09], ['Supply Chain', 0.07],
    ['Quality', 0.06], ['Finance', 0.05], ['Safety', 0.05], ['HR', 0.04], ['IT', 0.04], ['Sales & Marketing', 0.04]
  ];

  // voluntary exits only: Performance / Disciplinary / Absconding are the
  // involuntary reasons (attr_involuntary), drawn separately
  const EXIT_REASONS = [
    ['Better prospects', 0.38], ['Compensation', 0.18], ['Relocation / family', 0.15],
    ['Higher education', 0.09], ['Health', 0.05], ['Work environment', 0.09],
    ['Career change', 0.06]
  ];

  // [programme, category] — categories drive the HSE / compliance coverage metrics
  const PROGRAMMES = [
    ['Safety Leadership', 'HSE'], ['First-time Manager', 'Behavioural'],
    ['Advanced Metallurgy', 'Technical/Functional'], ['Lean Six Sigma', 'Technical/Functional'],
    ['Digital & Analytics Basics', 'Technical/Functional'], ['Finance for Non-Finance', 'Technical/Functional'],
    ['Contract Management', 'Technical/Functional'], ['Leadership Pipeline', 'Behavioural'],
    ['Technical Skills Refresher', 'Technical/Functional'], ['Communication Skills', 'Behavioural'],
    ['Working at Height & Confined Spaces', 'HSE'], ['Emergency Response', 'HSE'],
    ['Code of Conduct', 'Compliance'], ['Ethics Awareness', 'Compliance'], ['POSH Awareness', 'Compliance'],
    ['New Joiner Induction', 'Induction']
  ];

  const AWARD_NAMES = ['Spot Award', 'Quarterly Excellence', 'Safety Champion', 'Value Champion', 'Team of the Month', 'Long Service'];

  // [function plant, function, segment, weight within function, fixed company, fixed asset]
  // Generic unit names only. 'Central Services' (below) is deliberately absent
  // from org_units — a seeded Data Quality flaw that resolves to 'Unassigned'.
  const ORG = [
    ['Iron Making', 'Operations', 'Operations', 0.22], ['Steel Making', 'Operations', 'Operations', 0.22],
    ['Hot Rolling', 'Operations', 'Operations', 0.18], ['Cold Rolling', 'Operations', 'Operations', 0.14],
    ['Pellet Plant', 'Operations', 'Operations', 0.12], ['Coke & Sinter', 'Operations', 'Operations', 0.12],
    ['Mine Operations', 'Operations', 'Operations', 0.6, null, 'Kirandul'],
    ['Beneficiation Plant', 'Operations', 'Operations', 0.4, null, 'Kirandul'],
    ['Mechanical Maintenance', 'Maintenance', 'Operations', 0.36], ['Electrical Maintenance', 'Maintenance', 'Operations', 0.28],
    ['Central Workshop', 'Maintenance', 'Operations', 0.12], ['Utilities & Power', 'Maintenance', 'Operations', 0.12],
    ['Project Commissioning', 'Maintenance', 'Projects', 0.12],
    ['Capex Projects', 'Project Engineering', 'Projects', 0.35], ['Expansion Projects', 'Project Engineering', 'Projects', 0.3],
    ['Project Planning & Control', 'Project Engineering', 'Projects', 0.15], ['Construction Management', 'Project Engineering', 'Projects', 0.2],
    ['Procurement', 'Supply Chain', 'Operations', 0.35], ['Logistics', 'Supply Chain', 'Operations', 0.3],
    ['Stores', 'Supply Chain', 'Operations', 0.2], ['Project Procurement', 'Supply Chain', 'Projects', 0.15],
    ['Quality Assurance', 'Quality', 'Operations', 0.6], ['R&D Lab', 'Quality', 'Operations', 0.2], ['Project QA/QC', 'Quality', 'Projects', 0.2],
    ['Finance & Accounts', 'Finance', 'Operations', 0.7], ['Finance Shared Services', 'Finance', 'Operations', 0.3, 'Company C', 'Hazira'],
    ['Plant Safety', 'Safety', 'Operations', 0.55], ['Fire & Emergency', 'Safety', 'Operations', 0.25], ['Project Safety', 'Safety', 'Projects', 0.2],
    ['HR & Admin', 'HR', 'Operations', 0.55], ['Industrial Relations', 'HR', 'Operations', 0.2],
    ['HR Shared Services', 'HR', 'Operations', 0.25, 'Company C', 'Hazira'],
    ['IT Infrastructure', 'IT', 'Operations', 0.4], ['Digital & Automation', 'IT', 'Operations', 0.35],
    ['IT Service Desk', 'IT', 'Operations', 0.25, 'Company C', 'Hazira'],
    ['Domestic Sales', 'Sales & Marketing', 'Operations', 0.5], ['Export Sales', 'Sales & Marketing', 'Operations', 0.2],
    ['Customer Service', 'Sales & Marketing', 'Operations', 0.3]
  ].map(([plant, func, seg, w, company, asset]) => ({ plant, func, seg, w, company: company || '', asset: asset || '' }));
  const ORG_BY_PLANT = new Map(ORG.map((o) => [o.plant, o]));
  const UNMAPPED_PLANT = 'Central Services';
  const PROJ_TILT = { Hazira: 2.0, Paradeep: 1.0, Vizag: 0.8, Kirandul: 0.6 }; // Hazira carries the expansion
  const MC_BY_FUNC = {
    Operations: 'MC-01', Maintenance: 'MC-02', 'Project Engineering': 'MC-03', 'Supply Chain': 'MC-04',
    Quality: 'MC-05', Safety: 'MC-05', Finance: 'MC-06', IT: 'MC-06', HR: 'MC-07', 'Sales & Marketing': 'MC-08'
  };

  const GRADE_LEVEL = {
    ED: 'M-2', SVP: 'M-3', VP: 'M-4', GM: 'M-5', DGM: 'M-6', AGM: 'M-6', SM: 'M-7', M: 'M-7',
    DM: 'M-8', AM: 'M-8', O: 'M-9', JO: 'M-9', S3: 'M-10', S2: 'M-10', S1: 'M-11'
  };
  const LEVEL_BAND = {
    'M-2': 'SM', 'M-3': 'SM', 'M-4': 'SM', 'M-5': 'SM', 'M-6': 'MM', 'M-7': 'MM',
    'M-8': 'JM', 'M-9': 'JM', 'M-10': 'Blue Collar', 'M-11': 'Blue Collar', GET: 'JM'
  };
  const GRADE_TITLE = {
    ED: 'Executive Director', SVP: 'Senior Vice President', VP: 'Vice President', GM: 'General Manager',
    DGM: 'Deputy General Manager', AGM: 'Assistant General Manager', SM: 'Senior Manager', M: 'Manager',
    DM: 'Deputy Manager', AM: 'Assistant Manager', O: 'Officer', JO: 'Junior Officer',
    S3: 'Senior Technician', S2: 'Technician', S1: 'Operator'
  };

  const STATES = ['Gujarat', 'Maharashtra', 'Rajasthan', 'Madhya Pradesh', 'Uttar Pradesh', 'Bihar', 'Jharkhand',
    'West Bengal', 'Odisha', 'Chhattisgarh', 'Andhra Pradesh', 'Telangana', 'Tamil Nadu', 'Karnataka', 'Kerala'];
  const NEAR_STATES = {
    Hazira: ['Maharashtra', 'Rajasthan', 'Madhya Pradesh', 'Uttar Pradesh'],
    Paradeep: ['West Bengal', 'Jharkhand', 'Bihar', 'Andhra Pradesh'],
    Vizag: ['Odisha', 'Telangana', 'Tamil Nadu', 'Karnataka'],
    Kirandul: ['Odisha', 'Andhra Pradesh', 'Madhya Pradesh', 'Jharkhand']
  };
  const LOCAL_P = { Hazira: 0.78, Paradeep: 0.88, Vizag: 0.83, Kirandul: 0.9 };

  const EXIT_CATEGORY = {
    'Better prospects': 'Career growth', 'Career change': 'Career growth', Compensation: 'Compensation',
    'Relocation / family': 'Relocation', 'Higher education': 'Further studies', Health: 'Health',
    'Work environment': 'Work environment', Performance: 'Performance', Disciplinary: 'Termination / disciplinary',
    Absconding: 'Absconding', Superannuation: 'Retirement'
  };

  const RECRUITERS = {
    Hazira: ['REC-01', 'REC-02', 'REC-03', 'REC-04', 'REC-05'], Paradeep: ['REC-06', 'REC-07', 'REC-08'],
    Vizag: ['REC-09', 'REC-10'], Kirandul: ['REC-11', 'REC-12']
  };
  const EXT_SOURCES = [['Job Portal', 0.3], ['Consultant', 0.26], ['Employee Referral', 0.24], ['Careers Site', 0.1], ['RPO', 0.1]];
  const CAND_SOURCES = [['Job Portal', 0.34], ['Consultant', 0.2], ['Employee Referral', 0.18], ['Careers Site', 0.1],
    ['RPO', 0.1], ['Internal Job Posting', 0.05], ['Campus', 0.03]];
  const AGEING_REASONS = ['Niche skill', 'Salary expectation gap', 'Candidate backed out', 'Awaiting approval',
    'Relocation constraint', 'Interviews pending', 'Business on hold'];
  const DROP_REASONS = ['Position cancelled', 'Budget withdrawn', 'Internal redeployment', 'Role redesigned'];

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
      // exited-during-window population ≈ perm * attr * window years
      const exitedCount = Math.round(P.perm * P.attr * (CONFIG.historyMonths / 12));
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
        // legacy-plant reality: a visible cohort within 5–8 years of superannuation
        if (!isTrainee && rng() < 0.13) age = rint(rng, 50, 57);
        age = Math.max(21, Math.min(58, age));
        const dob = AS_OF_DAY - Math.round(age * 365.25) - rint(rng, 0, 364);

        // exit month first (uniform over the window — keeps monthly rates honest),
        // then tenure, then DOJ derived backwards for exited employees
        let exitDay = null;
        if (isExited) {
          exitDay = monthEndDay(W_START + Math.floor(rng() * CONFIG.historyMonths)) - rint(rng, 0, 27);
          if (exitDay > AS_OF_DAY) exitDay = AS_OF_DAY - rint(rng, 5, 90);
        }

        let tenure;
        if (isTrainee) tenure = rng() * 2;
        else {
          tenure = -Math.log(1 - rng()) * 8; // exp mean 8
          if (isExited && rng() < 0.22 * P.earlyBump) tenure = rng() * 2.2; // early-turnover cluster
          tenure = Math.min(tenure, age - 21);
        }
        let doj;
        if (isExited) {
          doj = exitDay - Math.round(tenure * 365.25) - rint(rng, 0, 30);
        } else {
          // tenure is already a continuous draw — no extra jitter, or the most
          // recent weeks develop an artificial joins dead-zone in the trend
          doj = AS_OF_DAY - Math.round(tenure * 365.25);
        }
        if (doj > AS_OF_DAY) doj = AS_OF_DAY - rint(rng, 10, 200);

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
      ...seniorExits.map((e) => ({ asset: e.asset, grade: e.grade, func: e.func, openDay: exitById.get(e.id).exitDay - rint(rng, 0, 30), type: 'Replacement', src: e }))
    ];
    const newCount = Math.round(sources.length * 0.55);
    for (let i = 0; i < newCount; i++) {
      const e = pick(rng, activeSenior);
      sources.push({ asset: e.asset, grade: e.grade, func: e.func, openDay: monthEndDay(W_START + Math.floor(rng() * CONFIG.historyMonths)) - rint(rng, 0, 27), type: 'New', src: e });
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
      reqs.push({ id, ...s, confidential, posted, closed, closedDay: closed ? closedDay : null, mode, hiredId, ttf });

      if (posted) {
        const nApps = rint(rng, 0, 6);
        for (let j = 0; j < nApps; j++) {
          appSeq++;
          const applicant = pick(rng, activeSenior);
          const appDay = s.openDay + rint(rng, 2, 25);
          // applications older than ~4 months are almost always resolved; the
          // ageing cluster (>15 days no action) comes from recent stragglers
          const status = appDay < AS_OF_DAY - 120
            ? pickW(rng, [['Rejected', 0.52], ['Withdrawn', 0.13], ['Interviewed', 0.25], ['Offered', 0.1]])
            : pickW(rng, [['Applied', 0.3], ['Shortlisted', 0.2], ['Interviewed', 0.2], ['Offered', 0.08], ['Rejected', 0.17], ['Withdrawn', 0.05]]);
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
      // mandatory-programme layer (trailing 12 months): the annual safety
      // refresher and the compliance e-module run at near-universal scale in a
      // real plant — modelled separately from elective programmes. Seniors are
      // deliberately worse at showing up (the VP+ gap the exec summary flags).
      const mand = e.band === 'VP & above' ? 0.5 : 1;
      if (rng() < 0.62 * mand) {
        events.push({
          empId: e.id, programme: 'General Safety Awareness', category: 'HSE',
          day: monthEndDay(AS_OF_MONTH - Math.floor(rng() * 12)) - rint(rng, 0, 27),
          days: pickW(rng, [[1, 0.6], [2, 0.4]]), mode: 'Classroom',
          completed: true, feedback: rng() < 0.4 ? Math.round((3.6 + rng() * 1.2) * 10) / 10 : null,
          cost: rint(rng, 400, 900)
        });
      }
      if (rng() < 0.55 * mand) {
        events.push({
          empId: e.id, programme: pick(rng, ['Code of Conduct', 'Ethics Awareness', 'POSH Awareness']),
          category: 'Compliance',
          day: monthEndDay(AS_OF_MONTH - Math.floor(rng() * 12)) - rint(rng, 0, 27),
          days: 0.25, mode: 'E-learning',
          completed: rng() < 0.93, feedback: null, cost: 300
        });
      }
      if (rng() < p) {
        const n = 1 + (rng() < 0.35 ? 1 : 0) + (e.tt && rng() < 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const [programme, category] = pick(rng, PROGRAMMES);
          const days = pickW(rng, [[0.5, 0.25], [1, 0.35], [2, 0.25], [3, 0.1], [5, 0.05]]);
          const completed = rng() < 0.86;
          events.push({
            empId: e.id,
            programme, category,
            day: monthEndDay(W_START + Math.floor(rng() * CONFIG.historyMonths)) - rint(rng, 0, 27),
            days,
            mode: category === 'Compliance' ? 'E-learning' : (rng() < 0.55 ? 'Classroom' : 'E-learning'),
            completed,
            // feedback only exists for completed programmes; ~15% never file it
            feedback: completed && rng() < 0.85 ? Math.round((3.4 + rng() * 1.5) * 10) / 10 : null,
            cost: Math.round(days * (category === 'Compliance' ? 300 : rint(rng, 1200, 4500)))
          });
        }
      }
    }
    return events;
  }

  /* ---- performance-management cycle status (goal setting + mid-year review) ---- */
  function genPms(employees) {
    const rng = rngFor('pms');
    // story beat: goal setting is a solved habit; the mid-year review drags,
    // unevenly by asset — one asset clearly behind the pack
    const goalP = { Hazira: 0.985, Paradeep: 0.97, Vizag: 0.98, Kirandul: 0.90 };
    const midP = { Hazira: 0.62, Paradeep: 0.38, Vizag: 0.55, Kirandul: 0.33 };
    const rows = [];
    for (const e of employees) {
      if (e.isExited || e.isTrainee) continue;
      const goal = rng() < (goalP[e.asset] ?? 0.95);
      rows.push({ empId: e.id, goal, mid: goal && rng() < (midP[e.asset] ?? 0.5), e });
    }
    return rows;
  }

  /* ---- recognition awards (counts; unique coverage ~55–65% trailing 12m) ---- */
  function genRecognition(employees) {
    const rng = rngFor('recognition');
    const rows = [];
    for (const e of employees) {
      if (e.isExited) continue;
      if (rng() < 0.58) {
        const n = 1 + (rng() < 0.4 ? 1 : 0) + (rng() < 0.15 ? 2 : 0);
        for (let i = 0; i < n; i++) {
          rows.push({
            empId: e.id,
            day: monthEndDay(AS_OF_MONTH - Math.floor(rng() * 12)) - rint(rng, 0, 27),
            name: pick(rng, AWARD_NAMES)
          });
        }
      }
    }
    return rows;
  }

  /* ---- wellbeing: asset-month AGGREGATES only (no individual rows by design) ---- */
  function genWellbeing() {
    const rng = rngFor('wellbeing');
    const rows = [];
    for (const asset of CONFIG.assets) {
      const P = ASSET_PROFILE[asset];
      for (let mi = W_START; mi <= AS_OF_MONTH; mi++) {
        const sessions = Math.max(0, Math.round(P.perm * 0.007 * (0.6 + rng() * 0.9)));
        rows.push({
          asset, mi,
          sessions,
          unique: Math.max(0, Math.round(sessions * (0.55 + rng() * 0.25))),
          distress: rng() < 0.07 ? 1 : 0,
          attendees: rng() < 0.55 ? rint(rng, 20, Math.max(30, Math.round(P.perm * 0.05))) : 0
        });
      }
    }
    return rows;
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
        const lti = rng() < 0.5 ? 0 : rng() < 0.8 ? 1 : 2;
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

  /* ================= Phase 8: org attributes & retirees ================= */

  const companyOf = (asset, plant) => (ORG_BY_PLANT.get(plant)?.company) || (asset === 'Kirandul' ? 'Company B' : 'Company A');
  const segOfPlant = (plant) => ORG_BY_PLANT.get(plant)?.seg || '';
  const mcOf = (o) => (o.asset === 'Kirandul' ? 'MC-09' : MC_BY_FUNC[o.func] || '');
  const hireSource = (rng, mode) => (mode === 'Internal' ? 'Internal Job Posting' : mode === 'Boomerang' ? 'Alumni / Rehire'
    : mode === 'Campus' ? 'Campus' : pickW(rng, EXT_SOURCES));

  const PLANT_PAIRS = new Map();
  function plantPairs(asset, func) {
    const k = asset + '|' + func;
    if (!PLANT_PAIRS.has(k)) {
      // Kirandul is a mining asset: its Operations units are its own
      const list = ORG.filter((o) => o.func === func &&
        (o.asset ? o.asset === asset : !(func === 'Operations' && asset === 'Kirandul')));
      const w = list.map((o) => o.w * (o.seg === 'Projects' ? PROJ_TILT[asset] : 1));
      const tot = w.reduce((a, b) => a + b, 0);
      PLANT_PAIRS.set(k, list.map((o, i) => [o.plant, w[i] / tot]));
    }
    return PLANT_PAIRS.get(k);
  }

  // The base generator dates role starts / promotions from the as-of date even
  // for leavers; pull a leaver's history back before the exit (order and gaps
  // kept) so the history lookup never shows a promotion after the exit.
  function alignLeaverHistory(employees) {
    for (const e of employees) {
      if (!e.isExited) continue;
      const latest = Math.max(e.roleStart, e.lastPromo ?? -Infinity);
      if (latest <= e.exitDay) continue;
      const shift = latest - e.exitDay + 30;
      e.roleStart = Math.max(e.doj, e.roleStart - shift);
      if (e.lastPromo != null) e.lastPromo = Math.max(e.doj, e.lastPromo - shift);
    }
  }

  // Realism pass (own stream 'entry-age'): campus and GET hires join at 21–25,
  // so the permanent roll carries a young (Gen Z) cohort that also exits. VP+
  // and recent AM–GM joiners keep their drawn age; nobody passes superannuation.
  function entryAges(employees) {
    const rng = rngFor('entry-age');
    for (const e of employees) {
      if (e.isTrainee || (e.hireType !== 'Campus' && e.hireType !== 'GET')) continue;
      const atJoin = 21 + rng() * 4;
      const tenure = yearsBetween(e.doj, e.exitDay ?? AS_OF_DAY);
      if (e.band === 'VP & above' || (e.band === 'AM-GM' && tenure < 6)) continue;
      const dob = e.doj - Math.round(atJoin * 365.25);
      if (yearsBetween(dob, e.exitDay ?? AS_OF_DAY) < CONFIG.retirementAge - 0.5) e.dob = dob;
    }
  }

  // The master's Last Promotion Date always names a Promotion row, or is blank:
  // a date on the joining day is the joining grade, and at the entry rung (or an
  // unknown level) genMovements records the step as a re-designation.
  function alignMasterPromotions(allEmps) {
    const entry = CONFIG.levels.length - 2;
    for (const e of allEmps) {
      const i = CONFIG.levels.indexOf(e.level);
      if (e.lastPromo != null && (e.lastPromo <= e.doj || i < 0 || i >= entry)) e.lastPromo = null;
    }
  }

  function genExt(list, prefix) {
    const streams = new Map(CONFIG.assets.map((a) => [a, rngFor(prefix + a)]));
    const others = new Map(CONFIG.assets.map((a) => [a, STATES.filter((s) => s !== CONFIG.assetHomeState[a])]));
    for (const e of list) {
      const rng = streams.get(e.asset);
      e.plant = rng() < 0.004 ? UNMAPPED_PLANT : pickW(rng, plantPairs(e.asset, e.func));
      e.seg = segOfPlant(e.plant);                         // resolved segment ('' when unmapped)
      e.segCol = e.seg && rng() < 0.93 ? e.seg : '';       // the column itself; blanks resolve via org_units
      e.company = companyOf(e.asset, e.plant);
      e.level = e.isTrainee ? 'GET' : (GRADE_LEVEL[e.grade] || '');
      e.mband = LEVEL_BAND[e.level] || '';
      const localP = Math.min(0.97, LOCAL_P[e.asset] *
        (e.band === 'VP & above' ? 0.55 : e.band === 'AM-GM' ? 0.85 : e.isTrainee ? 0.8 : 1.04));
      e.domicile = rng() < localP ? CONFIG.assetHomeState[e.asset]
        : rng() < 0.65 ? pick(rng, NEAR_STATES[e.asset]) : pick(rng, others.get(e.asset));
      e.hireType = e.isTrainee ? 'GET'
        : e.band === 'VP & above' ? pickW(rng, [['Lateral', 0.85], ['GET', 0.1], ['Rehire', 0.05]])
        : e.band === 'AM-GM' ? pickW(rng, [['Lateral', 0.6], ['GET', 0.25], ['Campus', 0.1], ['Rehire', 0.05]])
        : pickW(rng, [['Lateral', 0.62], ['Campus', 0.3], ['GET', 0.03], ['Rehire', 0.05]]);
      e.positionId = '';
    }
  }

  // superannuation exits during the window (Exit Type = Retirement)
  function genRetirees() {
    const employees = [];
    const exits = [];
    let n = 0;
    for (const asset of CONFIG.assets) {
      const P = ASSET_PROFILE[asset];
      const rng = rngFor('retirees:' + asset);
      const count = Math.round(P.perm * 0.016 * (CONFIG.historyMonths / 12));
      for (let i = 0; i < count; i++) {
        n++;
        const mi = W_START + Math.floor(rng() * CONFIG.historyMonths);
        const dob = makeDay(Math.floor(mi / 12) - CONFIG.retirementAge, mi % 12, rint(rng, 1, 28));
        const exitDay = monthEndDay(mi); // last day of the month the retirement age is reached
        const r = rng();
        const band = r < 0.7 ? 'Below AM' : r < 0.95 ? 'AM-GM' : 'VP & above';
        const grade = band === 'VP & above' ? pick(rng, ['VP', 'SVP', 'ED'])
          : band === 'AM-GM' ? pick(rng, ['AM', 'DM', 'M', 'SM', 'AGM', 'DGM', 'GM']) : pick(rng, ['S1', 'S2', 'S3', 'JO', 'O']);
        const doj = exitDay - Math.round((14 + rng() * 22) * 365.25);
        const roleStart = exitDay - Math.round((1 + rng() * 6) * 365.25);
        const id = `AMNS-${P.code}-${60000 + n}`;
        employees.push({
          id, asset, band, isTrainee: false, isExited: true, dob, doj, exitDay, grade,
          func: pickW(rng, FUNCTIONS),
          gender: rng() < P.female * 0.8 ? 'Female' : 'Male',
          tt: false, ct: false, cp: band === 'VP & above' && rng() < 0.4,
          roleStart, lastPromo: rng() < 0.55 ? roleStart : null,
          nationality: 'Indian', disability: rng() < 0.007,
          name: pick(rng, SYL1) + ' ' + pick(rng, SYL2), managerId: ''
        });
        exits.push({ id, exitDay, type: 'Retirement', regretted: false, rehire: rng() < 0.25, reason: 'Superannuation' });
      }
    }
    return { employees, exits };
  }

  /* ================= Phase 8: requisition lifecycle & candidates ================= */

  function extendReqs(reqs, employees) {
    const rng = rngFor('hiring-ext');
    for (const r of reqs) {
      r.plant = r.src.plant;
      r.company = companyOf(r.asset, r.plant);
      r.seg = segOfPlant(r.plant);
      r.segCol = r.seg && rng() < 0.9 ? r.seg : '';
      r.level = GRADE_LEVEL[r.grade] || '';
      r.recruiter = rng() < 0.02 ? 'REC-13' : pick(rng, RECRUITERS[r.asset]); // REC-13: a thin central desk (n<5 guard)
      r.offerDay = null; r.accDay = null; r.joinDay = null;
      r.source = ''; r.dropReason = ''; r.ageingReason = '';
      if (r.closed) {
        r.status = 'Closed';
        r.joinDay = Math.max(r.openDay + 20, r.closedDay - rint(rng, 0, 10));
        const notice = r.mode === 'Internal' ? rint(rng, 10, 30) : r.mode === 'Campus' ? rint(rng, 20, 60) : rint(rng, 30, 75);
        r.accDay = Math.max(r.openDay + 10, r.joinDay - notice);
        r.offerDay = Math.max(r.openDay + 7, r.accDay - rint(rng, 1, 8));
        r.source = hireSource(rng, r.mode);
        continue;
      }
      const offer = Math.max(r.openDay + 7, r.openDay + r.ttf - rint(rng, 30, 75));
      const acc = offer + rint(rng, 1, 8);
      const u = rng();
      if (u < 0.08) { r.status = 'Dropped'; r.dropReason = pick(rng, DROP_REASONS); r.dropDay = Math.min(AS_OF_DAY, r.openDay + rint(rng, 15, 90)); }
      else if (u < 0.18) r.status = 'On Hold';
      else if (acc <= AS_OF_DAY) { r.status = 'TBO'; r.offerDay = offer; r.accDay = acc; }
      else if (offer <= AS_OF_DAY) { r.status = 'Offered'; r.offerDay = offer; }
      else r.status = 'Open';
      if (r.offerDay != null) r.source = hireSource(rng, rng() < 0.3 ? 'Internal' : 'External');
      if (r.status !== 'Dropped' && r.status !== 'TBO' && AS_OF_DAY - r.openDay > 60 && rng() < 0.7) {
        r.ageingReason = r.status === 'On Hold' ? 'Business on hold' : pick(rng, AGEING_REASONS.slice(0, -1));
      }
    }
    // extra requisitions from their own streams: a thin tail of long-stuck ones
    // (the TA ">180 days" worklist) and requisitions dropped across the window
    const pool = employees.filter((e) => !e.isExited && !e.isTrainee && e.band !== 'Below AM');
    let seq = reqs.length;
    const extra = (rng, openDay, status) => {
      const e = pick(rng, pool);
      seq++;
      const r = {
        id: `REQ-${String(seq).padStart(4, '0')}`, asset: e.asset, grade: e.grade, func: e.func,
        openDay, type: rng() < 0.5 ? 'New' : 'Replacement', src: e,
        confidential: false, posted: rng() < 0.6, closed: false, closedDay: null, mode: null, hiredId: '', ttf: null,
        plant: e.plant, company: companyOf(e.asset, e.plant), seg: segOfPlant(e.plant), segCol: segOfPlant(e.plant),
        level: GRADE_LEVEL[e.grade] || '', recruiter: pick(rng, RECRUITERS[e.asset]),
        status, offerDay: null, accDay: null, joinDay: null, source: '', dropReason: '', ageingReason: ''
      };
      reqs.push(r);
      return r;
    };
    const aged = rngFor('hiring-aged');
    const nAged = Math.round(reqs.length * 0.03);
    for (let i = 0; i < nAged; i++) {
      const r = extra(aged, AS_OF_DAY - rint(aged, 185, 460), aged() < 0.45 ? 'On Hold' : 'Open');
      r.ageingReason = r.status === 'On Hold' ? 'Business on hold' : pick(aged, AGEING_REASONS.slice(0, -1));
    }
    const dropped = rngFor('hiring-dropped');
    const nDropped = Math.round(reqs.length * 0.06);
    for (let i = 0; i < nDropped; i++) {
      const r = extra(dropped, monthEndDay(W_START + Math.floor(dropped() * (CONFIG.historyMonths - 1))) - rint(dropped, 0, 27), 'Dropped');
      r.dropReason = pick(dropped, DROP_REASONS);
      r.dropDay = Math.min(AS_OF_DAY, r.openDay + rint(dropped, 20, 120));
    }
  }

  // dropped at the transition INTO the keyed stage
  const CAND_DROP = {
    Screened: ['Not shortlisted', 'Not shortlisted', 'Candidate not reachable'],
    Interview: ['Not shortlisted for interview', 'Withdrew before interview'],
    Offered: ['Rejected in interview', 'Rejected in interview', 'Candidate withdrew'],
    'Offer Accepted': ['Offer declined – compensation', 'Offer declined – counter offer', 'Offer declined – location']
  };

  function genCandidates(reqs) {
    const rng = rngFor('candidates');
    const rows = [];
    let seq = 0;
    for (const r of reqs) {
      const n = ['VP', 'SVP', 'ED'].includes(r.grade) ? rint(rng, 5, 12) : rint(rng, 5, 30);
      const selected = r.status === 'Closed' || r.status === 'TBO' || r.status === 'Offered';
      const latest = r.closed ? r.closedDay : r.dropDay ?? AS_OF_DAY;
      for (let i = 0; i < n; i++) {
        seq++;
        const c = {
          id: `CND-${String(seq).padStart(6, '0')}`, reqId: r.id, recruiter: r.recruiter, source: '',
          gender: rng() < 0.16 ? 'Female' : 'Male',
          applied: null, screened: null, interview: null, offer: null, acc: null, joined: null, stage: 'Applied', drop: ''
        };
        if (i === 0 && selected) {
          // the selected candidate mirrors the requisition's own lifecycle dates
          c.source = r.source || pickW(rng, CAND_SOURCES);
          c.offer = r.offerDay; c.acc = r.accDay; c.joined = r.status === 'Closed' ? r.joinDay : null;
          const span = c.offer - r.openDay;
          c.applied = r.openDay + Math.min(span - 2, rint(rng, 1, Math.max(1, Math.floor(span * 0.4))));
          c.screened = Math.min(c.offer - 1, c.applied + rint(rng, 2, 8));
          c.interview = Math.min(c.offer - 1, c.screened + rint(rng, 3, 15));
          c.stage = r.status === 'Closed' ? 'Joined' : r.status === 'TBO' ? 'Offer Accepted' : 'Offered';
        } else {
          c.source = r.mode === 'Campus' && rng() < 0.8 ? 'Campus' : pickW(rng, CAND_SOURCES);
          c.applied = r.openDay + rint(rng, 0, Math.max(1, Math.min(90, latest - r.openDay)));
          let day = c.applied;
          // only closed requisitions carry declined / reneged offers to other candidates
          const steps = [['screened', 'Screened', 0.55, 2, 10], ['interview', 'Interview', c.gender === 'Female' ? 0.41 : 0.45, 5, 20]];
          if (r.closed) steps.push(['offer', 'Offered', 0.2, 5, 25], ['acc', 'Offer Accepted', 0.45, 1, 8]);
          for (const [key, label, p, lo, hi] of steps) {
            const next = day + rint(rng, lo, hi);
            if (next > latest) {
              if (r.closed || r.status === 'Dropped') { c.stage = 'Dropped'; c.drop = r.closed ? 'Position filled' : 'Requisition dropped'; }
              break;
            }
            if (rng() >= p) { c.stage = 'Dropped'; c.drop = pick(rng, CAND_DROP[label]); break; }
            c[key] = next; c.stage = label; day = next;
          }
          if (c.stage === 'Offer Accepted') { c.stage = 'Dropped'; c.drop = 'No-show at joining'; }
          else if (c.stage !== 'Dropped' && r.status === 'Dropped') { c.stage = 'Dropped'; c.drop = 'Requisition dropped'; }
        }
        rows.push(c);
      }
    }
    // ATS exports often leave gender blank: ~4% Unknown, drawn from their own
    // stream so every draw above keeps its value (the TA tab shows Unknown explicitly)
    const genderRng = rngFor('candidates-gender');
    for (const c of rows) if (genderRng() < 0.04) c.gender = '';
    return rows;
  }

  /* ================= Phase 8: positions, HC budget, movements ================= */

  function genPositions(employees, reqs) {
    const rng = rngFor('positions');
    const unitRng = rngFor('positions-units');
    const nbRate = new Map(); // asset|plant -> share of incumbents outside the budget
    const seqBy = {};
    const nextId = (asset) => {
      seqBy[asset] = (seqBy[asset] || 0) + 1;
      return `POS-${ASSET_PROFILE[asset].code}-${String(seqBy[asset]).padStart(5, '0')}`;
    };
    const rows = [];
    const add = (asset, func, plant, grade, level, status, budgeted, cp, incumbent, vacantSince, reqId) => {
      const seg = segOfPlant(plant);
      const id = nextId(asset);
      rows.push({
        id, title: `${GRADE_TITLE[grade] || 'Position'} – ${plant}`, asset, company: companyOf(asset, plant),
        segCol: seg && rng() < 0.95 ? seg : '', func, plant, level, status, budgeted, cp, incumbent, vacantSince, reqId
      });
      return id;
    };
    const perm = employees.filter((e) => !e.isExited && !e.isTrainee);
    for (const e of perm) {
      if (rng() < 0.012) continue; // seeded: incumbent without a Position ID
      const k = e.asset + '|' + e.plant;
      if (!nbRate.has(k)) { const u = unitRng(); nbRate.set(k, u < 0.7 ? 0.01 : u < 0.9 ? 0.05 : 0.12); }
      e.positionId = add(e.asset, e.func, e.plant, e.grade, e.level, 'Filled', rng() >= nbRate.get(k), e.cp, e.id, null, '');
    }
    const openReqs = reqs.filter((r) => !r.closed && r.status !== 'Dropped');
    for (const r of openReqs) {
      const since = r.type === 'Replacement' && r.src.exitDay != null ? r.src.exitDay + 1 : r.openDay - rint(rng, 0, 20);
      add(r.asset, r.func, r.plant, r.grade, r.level, 'Vacant', rng() < 0.96, rng() < 0.03, '', since, r.id);
    }
    // vacancies without a requisition, sampled in proportion to unit size
    const holders = perm.filter((e) => e.positionId);
    const target = Math.round(perm.length * 0.064);
    for (let i = openReqs.length; i < target; i++) {
      const e = pick(rng, holders);
      const age = rng() < 0.5 ? rint(rng, 5, 60) : rng() < 0.7 ? rint(rng, 61, 180) : rint(rng, 181, 540);
      add(e.asset, e.func, e.plant, e.grade, e.level, 'Vacant', rng() < 0.96, rng() < 0.03, '', AS_OF_DAY - age, '');
    }
    const nHold = Math.round(perm.length * 0.004);
    const nFrozen = Math.round(perm.length * 0.01);
    for (let i = 0; i < nHold + nFrozen; i++) {
      const e = pick(rng, holders);
      const frozen = i >= nHold;
      add(e.asset, e.func, e.plant, e.grade, e.level, frozen ? 'Frozen' : 'On Hold', !frozen || rng() < 0.7, false, '',
        AS_OF_DAY - (frozen ? rint(rng, 120, 700) : rint(rng, 60, 300)), '');
    }
    return rows;
  }

  // Budget = budgeted, non-frozen positions this FY; last FY's budget sits a
  // little above/below that year's actual — so the matrix shows real variance.
  function genBudget(allEmps, positions) {
    const rng = rngFor('budget');
    const units = new Map();
    const unitOf = (asset, func, plant) => {
      const k = asset + '|' + func + '|' + plant;
      if (!units.has(k)) units.set(k, { asset, func, plant, members: [], now: 0 });
      return units.get(k);
    };
    for (const p of positions) {
      const u = unitOf(p.asset, p.func, p.plant);
      if (p.budgeted && p.status !== 'Frozen') u.now++;
    }
    for (const e of allEmps) {
      const u = units.get(e.asset + '|' + e.func + '|' + e.plant);
      if (u && !e.isTrainee) u.members.push(e);
    }
    const fyStart = fyStartMonthIdx(AS_OF_MONTH);
    const refDay = monthEndDay(fyStart - 4);
    const rows = [];
    for (const u of units.values()) {
      const actualRef = u.members.filter((e) => e.doj <= refDay && (e.exitDay == null || e.exitDay > refDay)).length;
      const v = rng() < 0.8 ? rng() * 0.09 : -rng() * 0.07;
      const prev = Math.max(0, Math.round(actualRef * (1 + v)));
      for (let mi = AS_OF_MONTH - 11; mi <= AS_OF_MONTH; mi++) {
        rows.push({ mi, asset: u.asset, seg: segOfPlant(u.plant), company: companyOf(u.asset, u.plant),
          func: u.func, plant: u.plant, budget: mi >= fyStart ? u.now : prev });
      }
    }
    return rows;
  }

  // Movements unwind backwards from the CURRENT master state, so the latest
  // "To" always equals the employee master and every earlier "To" equals the
  // next movement's "From". Realism rules (own stream 'movements-v2'):
  //  - a Promotion is always a one-rung step up the level ladder. At the entry
  //    rung (M-11) nothing sits below, so the master's Last Promotion Date there
  //    is an in-level grade step, recorded as a Re-designation (level
  //    unchanged); an earlier promotion is drawn only while a rung is left.
  //  - entities follow sites: Company B is the Kirandul entity and Company C the
  //    Hazira shared-services units. Location transfers run between Company A
  //    sites; a company transfer either crosses to/from Kirandul (the asset
  //    changes too) or moves in/out of Hazira shared services (same site).
  //  - origin sites are weighted by site size; a function transfer carries a
  //    segment the origin function can hold; a segment change needs a function
  //    with units in both segments.
  function genMovements(allEmps) {
    const rng = rngFor('movements-v2');
    const rows = [];
    const winStart = monthEndDay(W_START - 1) + 1;
    const TYPES = [['Transfer – Location', 1.4], ['Transfer – Function', 1.8], ['Transfer – Company', 0.5], ['Re-designation', 1.0], ['Segment Change', 1.6]];
    const annualP = TYPES.reduce((s, [, w]) => s + w, 0) / 100;
    const typePairs = TYPES.map(([t, w]) => [t, w / (annualP * 100)]);
    const funcs = FUNCTIONS.map(([f]) => f);
    const ENTRY = CONFIG.levels.length - 2;   // index of M-11; GET (trainee) sits outside the promotion ladder
    const rungBelow = (lv) => {
      const i = CONFIG.levels.indexOf(lv);
      return i >= 0 && i < ENTRY ? CONFIG.levels[i + 1] : null;
    };
    const A_SITES = CONFIG.assets.filter((a) => a !== 'Kirandul');
    const bySize = (list) => {
      const tot = list.reduce((s, a) => s + ASSET_PROFILE[a].perm, 0);
      return list.map((a) => [a, ASSET_PROFILE[a].perm / tot]);
    };
    const SS_FUNCS = [...new Set(ORG.filter((o) => o.company === 'Company C').map((o) => o.func))];
    const segsOf = new Map(funcs.map((f) => [f, [...new Set(ORG.filter((o) => o.func === f).map((o) => o.seg))]]));
    for (const e of allEmps) {
      const endDay = e.exitDay ?? AS_OF_DAY;
      const events = [];
      // a Last Promotion Date on the joining day is the joining grade, not a movement
      if (e.lastPromo != null && e.lastPromo > e.doj && e.lastPromo <= endDay) {
        events.push({ day: e.lastPromo, type: 'Promotion', master: true });
        if (e.lastPromo - e.doj > 4 * 365 && rng() < 0.5) {
          events.push({ day: e.doj + rint(rng, 730, e.lastPromo - e.doj - 365), type: 'Promotion' });
        }
      }
      const from = Math.max(winStart, e.doj + 180);
      if (!e.isTrainee && from < endDay && rng() < annualP * (endDay - from) / 365.25) {
        events.push({ day: rint(rng, from, endDay - 1), type: pickW(rng, typePairs) });
      }
      if (!events.length) continue;
      events.sort((a, b) => b.day - a.day);
      // one event per day, so the chain has an unambiguous order
      for (let k = 1; k < events.length; k++) if (events[k].day >= events[k - 1].day) events[k].day = events[k - 1].day - 1;
      let st = { asset: e.asset, func: e.func, level: e.level, company: e.company, seg: e.seg };
      for (const ev of events) {
        const fr = { ...st };
        let type = ev.type;
        if (type === 'Promotion') {
          const below = rungBelow(st.level);
          if (below) fr.level = below;
          else if (ev.master) type = 'Re-designation';
          else continue;
        } else if (type === 'Transfer – Location' && (st.company !== 'Company A' || !A_SITES.includes(st.asset))) {
          type = 'Transfer – Company';   // Kirandul / shared-services staff arrive by inter-company transfer
        }
        if (type === 'Transfer – Location') {
          fr.asset = pickW(rng, bySize(A_SITES.filter((a) => a !== st.asset)));
        } else if (type === 'Transfer – Function') {
          const pool = st.company === 'Company C' ? SS_FUNCS : funcs;
          fr.func = pick(rng, pool.filter((f) => f !== st.func));
          const segs = segsOf.get(fr.func) || [];
          if (st.seg && segs.length && !segs.includes(st.seg)) fr.seg = segs[0];
        } else if (type === 'Transfer – Company') {
          if (st.company === 'Company B') { fr.company = 'Company A'; fr.asset = pickW(rng, bySize(A_SITES)); }
          else if (st.company === 'Company C') fr.company = 'Company A';
          else if (st.asset === 'Hazira' && SS_FUNCS.includes(st.func) && rng() < 0.5) fr.company = 'Company C';
          else { fr.company = 'Company B'; fr.asset = 'Kirandul'; }
        } else if (type === 'Segment Change') {
          if (!st.seg || (segsOf.get(st.func) || []).length < 2) continue;
          fr.seg = st.seg === 'Projects' ? 'Operations' : 'Projects';
        }
        rows.push({ empId: e.id, day: ev.day, type, from: fr, to: st });
        st = fr;
      }
    }
    return rows;
  }

  /* ================= Phase 8: absence & statutory compliance ================= */

  // Months of absence history. 12 covers every period option; the whole mock
  // load measured ~1.3–1.7 s click-to-paint in Chromium with it (budget ~2.5 s).
  // Drop to 6 if the population or the Overview grows past that budget.
  const ABSENCE_MONTHS = 12;

  // Realism (R9): unplanned absence is heavily skewed — most people are rarely
  // absent, a small chronic tail drives the frequent-absence cohort (≥3 spells in
  // 3 months: a few % of the roll, concentrated in blue collar). Spells are
  // mostly 1–2 days with a long tail; rates rise with the monsoon and festive
  // months, at the remote/older assets and on project sites, and in the months
  // before a resignation. Planned leave clusters in May and the festive quarter
  // and runs higher for senior staff (earned-leave balances). Day counts only.
  function genAbsence(allEmps) {
    const rng = rngFor('absence-v2');
    const HOLIDAYS = [1, 0, 1, 0, 1, 0, 0, 1, 0, 2, 1, 0];
    const SEASON = [1, 0.95, 1.05, 0.95, 1.05, 1.1, 1.25, 1.25, 1.15, 1.15, 1.15, 1];   // monsoon + festive peaks
    const LEAVE = [0.9, 0.8, 0.9, 0.9, 1.4, 1.2, 0.8, 0.8, 0.9, 1.3, 1.4, 1.3];
    const ASSET_ABS = { Hazira: 0.88, Paradeep: 1.28, Vizag: 1.0, Kirandul: 1.18 };
    // slow drift across the 12 months (per month, multiplicative) — Paradeep worsening, Hazira easing
    const ASSET_DRIFT = { Hazira: -0.006, Paradeep: 0.012, Vizag: 0, Kirandul: 0.004 };
    const SEG_ABS = { Operations: 1, Projects: 1.14 };
    // unplanned spells per scheduled day at personal factor 1
    const BAND_SPELL = { SM: 0.0032, MM: 0.005, JM: 0.0077, 'Blue Collar': 0.0113 };
    const LEAVE_BAND = { SM: 1.25, MM: 1.15, JM: 1, 'Blue Collar': 0.9 };
    const SPELL_LEN = [[1, 0.42], [2, 0.27], [3, 0.13], [4, 0.07], [5, 0.05], [7, 0.04], [10, 0.02]];
    const months = [];
    for (let mi = AS_OF_MONTH - ABSENCE_MONTHS + 1; mi <= AS_OF_MONTH; mi++) {
      const start = monthEndDay(mi - 1) + 1, end = monthEndDay(mi);
      let sundays = 0;
      for (let d = start; d <= end; d++) if (dayToDate(d).getUTCDay() === 0) sundays++;
      months.push({ my: monthIdxToMY(mi), k: mi - AS_OF_MONTH + ABSENCE_MONTHS - 1, m0: mi % 12, start, end, days: end - start + 1, work: end - start + 1 - sundays - HOLIDAYS[mi % 12] });
    }
    const poisson = (lambda) => {
      let n = 0, q = Math.exp(-lambda), acc = q;
      const r = rng();
      while (r > acc && n < 12) { n++; q *= lambda / n; acc += q; }
      return n;
    };
    const rows = [];
    for (const e of allEmps) {
      if (e.isTrainee || e.doj > AS_OF_DAY) continue;
      const exitDay = e.exitDay ?? Infinity;
      if (exitDay <= months[0].end) continue;
      const u = rng();
      // 70% low · 22% moderate · 6% elevated · 2% chronic
      const personal = u < 0.02 ? 3.5 + rng() * 2.5 : u < 0.08 ? 1.8 + rng() * 1.7 : u < 0.30 ? 0.8 + rng() * 1.0 : 0.25 + rng() * 0.55;
      const base = (BAND_SPELL[e.mband] || 0.008) * ASSET_ABS[e.asset] * (SEG_ABS[e.seg] || 1) * personal;
      const leaveP = 0.42 * (LEAVE_BAND[e.mband] || 1);
      // resignations/terminations (not superannuation) show more absence in their final months
      const leaver = exitDay !== Infinity && e.dob != null && yearsBetween(e.dob, exitDay) < CONFIG.retirementAge - 0.5;
      for (const s of months) {
        if (e.doj > s.end || exitDay <= s.end) continue; // on the roll at month end
        const scheduled = e.doj > s.start ? Math.max(1, Math.round(s.work * (s.end - e.doj + 1) / s.days)) : s.work;
        const planned = rng() < leaveP * LEAVE[s.m0] ? Math.min(scheduled, rng() < 0.88 ? rint(rng, 1, 4) : rint(rng, 5, 12)) : 0;
        const preExit = leaver && exitDay - s.end < 75 ? 1.6 : 1;
        const lambda = scheduled * base * SEASON[s.m0] * (1 + ASSET_DRIFT[e.asset] * s.k) * preExit;
        const spells = poisson(lambda);
        let unplanned = 0;
        for (let k = 0; k < spells; k++) unplanned += pickW(rng, SPELL_LEN);
        unplanned = Math.min(unplanned, scheduled - planned);
        rows.push([e.id, s.my, scheduled, scheduled - planned - unplanned, planned, unplanned, Math.min(spells, unplanned)]);
      }
    }
    return rows;
  }

  function genStatutory() {
    const rng = rngFor('statutory');
    const nextMonthDay = (mi, d) => (d ? monthEndDay(mi) + d : monthEndDay(mi + 1));
    // [item, segment, due: day of the following month (0 = its last day)]
    const MONTHLY = [
      ['PF remittance', 'Operations', 15], ['ESIC remittance', 'Operations', 15], ['Professional tax', 'Operations', 0],
      ['TDS on salaries', 'Operations', 7], ['Minimum wages register', 'Operations', 10],
      ['Contract labour (CLRA) register', 'Operations', 10], ['BOCW welfare cess', 'Projects', 15]
    ];
    // [item, calendar months (0-based) it falls in, due: following-month day or null = same month end]
    const PERIODIC = [
      ['Factory licence renewal', [11], null], ['Pollution control consent renewal', [2], null],
      ['Fire NOC renewal', [8], null], ['Boiler inspection certificate', [5], null],
      ['Labour welfare fund return', [5, 11], 15], ['Contract labour half-yearly return', [5, 11], 0],
      ['Bonus Act annual return', [0], null], ['Gratuity & maternity benefit returns', [0], null]
    ];
    const ON_TIME = { Hazira: 0.95, Paradeep: 0.86, Vizag: 0.92, Kirandul: 0.89 };
    const rows = [];
    for (const asset of CONFIG.assets) {
      for (let mi = AS_OF_MONTH - 11; mi <= AS_OF_MONTH; mi++) {
        const items = MONTHLY.map(([item, seg, d]) => [item, seg, nextMonthDay(mi, d)]);
        for (const [item, m0s, d] of PERIODIC) {
          if (m0s.includes(mi % 12)) items.push([item, 'Operations', d == null ? monthEndDay(mi) : nextMonthDay(mi, d)]);
        }
        for (const [item, seg, due] of items) {
          let status, done = null;
          if (item === 'Boiler inspection certificate' && asset === 'Kirandul') status = 'Not applicable';
          else if (due > AS_OF_DAY) {
            if (rng() < 0.3) { status = 'On time'; done = Math.min(AS_OF_DAY, due - rint(rng, 1, 10)); }
            else status = 'Pending';
          } else if (rng() < ON_TIME[asset] * (seg === 'Projects' ? 0.88 : 1)) {
            status = 'On time'; done = due - rint(rng, 0, 12);
          } else {
            const lateBy = rint(rng, 1, 30);
            if (due + lateBy <= AS_OF_DAY) { status = 'Late'; done = due + lateBy; }
            else status = 'Pending'; // overdue and still open at as-of
          }
          rows.push({ asset, seg, mi, item, due, done, status });
        }
      }
    }
    return extendStatutory(rows);
  }

  // Realism pass on the statutory register — NEW streams only, so the rows above
  // keep their values. (1) Projects (capex construction) sites keep their own
  // contract-labour and minimum-wage registers. (2) A few misses stay open well
  // past due — renewals, returns and project cess only (remittances clear within
  // the month), less often the older they are — so the ageing view has a tail.
  function extendStatutory(rows) {
    const rng = rngFor('statutory-projects');
    const ON_TIME = { Hazira: 0.9, Paradeep: 0.78, Vizag: 0.86, Kirandul: 0.82 };
    for (const asset of CONFIG.assets) {
      for (let mi = AS_OF_MONTH - 11; mi <= AS_OF_MONTH; mi++) {
        for (const item of ['Contract labour (CLRA) register', 'Minimum wages register']) {
          const due = monthEndDay(mi) + 10;
          let status, done = null;
          if (due > AS_OF_DAY) {
            if (rng() < 0.25) { status = 'On time'; done = Math.min(AS_OF_DAY, due - rint(rng, 1, 8)); }
            else status = 'Pending';
          } else if (rng() < ON_TIME[asset]) {
            status = 'On time'; done = due - rint(rng, 0, 9);
          } else {
            const lateBy = rint(rng, 2, 40);
            if (due + lateBy <= AS_OF_DAY) { status = 'Late'; done = due + lateBy; }
            else status = 'Pending';
          }
          rows.push({ asset, seg: 'Projects', mi, item, due, done, status });
        }
      }
    }
    const stuck = rngFor('statutory-ageing');
    const RENEWAL = /licence|consent|NOC|certificate|return|cess/i;   // remittances clear within the month
    for (const r of rows) {
      if (r.status !== 'Late' || r.due >= AS_OF_DAY - 20 || !RENEWAL.test(r.item)) continue;
      const p = 0.55 * Math.exp(-(AS_OF_DAY - r.due) / 160);
      if (stuck() < p) { r.status = 'Pending'; r.done = null; }
    }
    return rows;
  }

  /* ================= Phase 8: panel extensions ================= */

  // on-roll Projects share per asset — drives the panel splits
  function projectShare(employees) {
    const out = {};
    for (const a of CONFIG.assets) {
      const act = employees.filter((e) => e.asset === a && !e.isExited && !e.isTrainee);
      out[a] = act.length ? act.filter((e) => e.seg === 'Projects').length / act.length : 0;
    }
    return out;
  }

  function extendContract(cAtt, cComp) {
    const rng = rngFor('panels-ext');
    const P_PROJ = { Hazira: 0.4, Paradeep: 0.2, Vizag: 0.15, Kirandul: 0.15 };
    const info = new Map(); // asset|contractor -> {seg, rate}
    for (const asset of CONFIG.assets) {
      const names = [...new Set(cAtt.filter((c) => c.asset === asset).map((c) => c.contractor))];
      const segs = names.map(() => (rng() < P_PROJ[asset] ? 'Projects' : 'Operations'));
      if (!segs.includes('Projects')) segs[segs.length - 1] = 'Projects';
      if (!segs.includes('Operations')) segs[0] = 'Operations';
      names.forEach((n, i) => info.set(asset + '|' + n, { seg: segs[i], rate: rint(rng, 720, 1050) * (segs[i] === 'Projects' ? 1.08 : 1) }));
    }
    // contract-labour rates step up with the half-yearly variable-DA revisions
    // (April and October) rather than drifting every month
    const vda = (mi) => {
      let n = 0;
      for (let x = W_START + 1; x <= mi; x++) if (x % 12 === 3 || x % 12 === 9) n++;
      return 1 + 0.025 * n;
    };
    for (const c of cAtt) {
      const k = info.get(c.asset + '|' + c.contractor);
      c.seg = k.seg;
      c.cost = Math.round(c.present * k.rate * vda(c.mi) * (0.97 + rng() * 0.06));
    }
    for (const c of cComp) c.seg = info.get(c.asset + '|' + c.contractor).seg;
  }

  function splitProduction(prod, share) {
    const rng = rngFor('prod-split');
    const out = [];
    for (const p of prod) {
      const sh = Math.min(0.6, share[p.asset] * 1.5 * (0.85 + rng() * 0.3));   // construction is contract-heavy
      const sc = share[p.asset] * (0.97 + rng() * 0.06);
      let ltiP = 0;
      for (let k = 0; k < p.lti; k++) if (rng() < Math.min(0.9, sh * 1.8)) ltiP++;
      const irP = p.irDays && rng() < 0.1 ? Math.round(p.irDays / 2) : 0;
      const hrsP = Math.round(p.manHours * sh), costP = Math.round(p.empCost * sc);
      out.push({ ...p, seg: 'Operations', manHours: p.manHours - hrsP, lti: p.lti - ltiP, irDays: p.irDays - irP, empCost: p.empCost - costP });
      out.push({ asset: p.asset, mi: p.mi, seg: 'Projects', tonnes: '', manHours: hrsP, lti: ltiP, irDays: irP, empCost: costP, revenue: '' });
    }
    return out;
  }

  function splitWellbeing(well, share) {
    const rng = rngFor('wellbeing-split');
    const out = [];
    for (const w of well) {
      const s = share[w.asset] * (0.8 + rng() * 0.4);
      const sessP = Math.round(w.sessions * s);
      const uniqP = Math.min(sessP, Math.round(w.unique * s));
      const distP = w.distress && rng() < s ? w.distress : 0;
      const attP = Math.round(w.attendees * s);
      out.push({ ...w, seg: 'Operations', sessions: w.sessions - sessP, unique: Math.min(w.unique - uniqP, w.sessions - sessP),
        distress: w.distress - distP, attendees: w.attendees - attP });
      out.push({ asset: w.asset, mi: w.mi, seg: 'Projects', sessions: sessP, unique: uniqP, distress: distP, attendees: attP });
    }
    return out;
  }

  function extendPms(pms) {
    const rng = rngFor('pms-ext');
    const ANNUAL = { Hazira: 0.94, Paradeep: 0.83, Vizag: 0.9, Kirandul: 0.8 };
    // the annual review closes last FY's cycle; joiners of its final quarter are out of scope
    const cutoff = monthEndDay(fyStartMonthIdx(AS_OF_MONTH) - 4) + 1;
    for (const r of pms) {
      r.goalStatus = r.goal ? 'Approved' : pickW(rng, [['Not started', 0.4], ['Draft', 0.35], ['Submitted', 0.25]]);
      r.midStatus = r.mid ? 'Completed' : !r.goal ? 'Not started'
        : pickW(rng, [['Not started', 0.45], ['Self-review done', 0.35], ['Manager review done', 0.2]]);
      if (r.e.doj >= cutoff) { r.annual = null; r.annualStatus = ''; continue; }
      r.annual = rng() < ANNUAL[r.e.asset];
      r.annualStatus = r.annual ? 'Completed' : pickW(rng, [['Not started', 0.25], ['Self-appraisal done', 0.4], ['Manager review done', 0.35]]);
    }
  }

  /* ================= demo targets ================= */

  function genTargets() {
    // Demo targets only — in BYOF mode targets come from targets.csv.
    // Keys must match registry keys; a few metrics are deliberately left
    // without targets to exercise the "Target not set" state.
    return [
      ['attr_annualised', 9, 'lower'], ['attr_tt_count', 0, 'lower'], ['attr_early_1y', 12, 'lower'],
      ['attr_regretted', 30, 'lower'],
      ['succession_coverage', 80, 'higher'], ['succ_ready_now', 45, 'higher'], ['internal_fill_rate', 60, 'higher'],
      // counts carry zero targets only: a count target would depend on scope size
      ['tt_stagnation', 18, 'lower'], ['tt_3yr_nopromo', 0, 'lower'],
      ['cp_occupancy', 55, 'higher'], ['cp_vacancy', 0, 'lower'], ['req_open_90d', 0, 'lower'],
      ['learning_coverage_all', 75, 'higher'], ['learning_days_all', 3, 'higher'],
      ['idp_coverage', 85, 'higher'], ['lms_adoption', 85, 'higher'], ['lms_active_6m', 60, 'higher'],
      ['posting_compliance', 100, 'higher'], ['mobility_ageing', 0, 'lower'],
      ['female_pct', 10, 'higher'], ['female_trainees', 25, 'higher'],
      ['time_to_fill_median', 75, 'lower'], ['promo_coverage_2y', 40, 'higher'], ['promo_recency_median', 3, 'lower'],
      ['tonnes_per_emp', 350, 'higher'], ['cost_per_tonne', 2600, 'lower'], ['ltifr', 0.3, 'lower'],
      ['contract_attendance_pct', 92, 'higher'], ['contract_compliance_idx', 95, 'higher'],
      ['ecost_pct_revenue', 4.5, 'lower'],
      ['goal_setting_pct', 100, 'higher'], ['midyear_review_pct', 90, 'higher'],
      ['learning_feedback_avg', 4.2, 'higher'], ['lnd_cost_per_emp', 4000, 'lower'],
      ['safety_learning_days', 1.2, 'higher'], ['compliance_coverage', 90, 'higher'],
      ['recognition_coverage', 60, 'higher'], ['attr_voluntary', 8, 'lower'],
      // Phase 8 demo targets: rates, medians and zero targets only, so each
      // holds at every scope (no count target that depends on scope size).
      ['demo_women_pct', 11, 'higher'], ['join_women_pct', 15, 'higher'], ['mgr_women_pct', 12, 'higher'],
      ['attr_ytd', 9, 'lower'], ['attr_involuntary', 2, 'lower'],
      ['ta_ttf_median', 75, 'lower'], ['ta_sla_breach', 35, 'lower'], ['ta_offer_accept', 85, 'higher'],
      ['ta_aged_180_pct', 20, 'lower'], ['ta_drop_rate', 5, 'lower'],
      ['annual_review_pct', 95, 'higher'],
      ['pb_vacancy_pct', 5, 'lower'], ['pb_cp_vacant', 0, 'lower'], ['pb_no_position_id', 0, 'lower'],
      ['absenteeism_pct', 2.5, 'lower'], ['abs_attendance_pct', 92, 'higher'],
      ['stat_ontime_pct', 95, 'higher']
    ];
  }

  /* ================= CSV emission (through SCHEMAS column order) ================= */

  const F = (b) => (b == null ? '' : b ? 'Y' : 'N');

  function toCSVs() {
    const { employees, exits } = genPeople();
    alignLeaverHistory(employees);
    const retired = genRetirees();
    genExt(employees, 'people-ext:');
    genExt(retired.employees, 'retirees-ext:');
    entryAges(employees);
    const allEmps = employees.concat(retired.employees);
    const { reqs, apps } = genHiring(employees, exits);
    extendReqs(reqs, employees);
    const candidates = genCandidates(reqs);
    const positions = genPositions(employees, reqs);
    const budget = genBudget(allEmps, positions);
    const movements = genMovements(allEmps);
    alignMasterPromotions(allEmps);
    const absence = genAbsence(allEmps);
    const statutory = genStatutory();
    const learning = genLearning(employees);
    const idp = genIdp(employees);
    const lms = genLms(employees);
    const succession = genSuccession(employees);
    const { prod, cAtt, cComp } = genPanels(employees);
    const share = projectShare(employees);
    extendContract(cAtt, cComp);
    const pms = genPms(employees);
    extendPms(pms);
    const recognition = genRecognition(employees);
    const wellbeing = splitWellbeing(genWellbeing(), share);
    const flawRng = rngFor('flaws');

    const files = new Map();
    const emit = (schemaId, rows) => {
      const cols = SCHEMAS[schemaId].columns;
      files.set(schemaId, CSV.serialize(cols.map((c) => c.name), rows));
    };
    const D = (day) => (day == null ? '' : fmtDMY(day));

    const empRow = (e) => [
      e.id, e.name, e.asset, e.band, e.grade, e.func, e.gender,
      fmtDMY(e.dob), fmtDMY(e.doj), e.isTrainee ? 'Trainee' : 'Permanent',
      F(e.tt), F(e.ct), F(e.cp), e.managerId || '', e.nationality, F(e.disability),
      fmtDMY(e.roleStart), e.lastPromo ? fmtDMY(e.lastPromo) : '',
      e.company, e.plant, e.segCol, e.level, e.mband, e.domicile, e.hireType, e.positionId
    ];
    const empRows = employees.map(empRow);
    // seeded flaws: 4 duplicated IDs + 3 bad DOB strings (caught by validation → Data Quality)
    for (let i = 0; i < 4; i++) {
      const src = empRows[Math.floor(flawRng() * empRows.length)];
      empRows.push([...src]);
    }
    for (let i = 0; i < 3; i++) {
      const r = empRows[Math.floor(flawRng() * empRows.length)];
      r[7] = pick(flawRng, ['31-02-1985', '1987-06-12', '00-00-1990']);
    }
    // retirees are appended after the flaw draws so those keep their targets
    for (const e of retired.employees) empRows.push(empRow(e));
    emit('employee_master', empRows);

    const category = (reason) => (reason ? EXIT_CATEGORY[reason] || 'Other' : '');
    emit('exits', exits.concat(retired.exits).map((x) => [
      x.id, fmtDMY(x.exitDay), x.type, F(x.regretted), F(x.rehire), x.reason, category(x.reason)
    ]));

    emit('requisitions', reqs.map((r) => [
      r.id, r.asset, r.grade, r.func, fmtDMY(r.openDay), r.type,
      F(r.posted), F(r.confidential), r.closedDay ? fmtDMY(r.closedDay) : '', r.mode || '', r.hiredId || '',
      r.company, r.plant, r.segCol, r.level, r.recruiter, r.status,
      D(r.offerDay), D(r.accDay), D(r.joinDay), r.source, r.dropReason, r.ageingReason
    ]));

    emit('internal_applications', apps.map((a) => [
      a.id, a.reqId, a.empId, fmtDMY(a.appDay), a.status, fmtDMY(a.lastAction)
    ]));

    emit('learning_events', learning.map((l) => [
      l.empId, l.programme, fmtDMY(l.day), l.days, l.mode,
      l.category, l.completed ? 'Completed' : 'In Progress',
      l.feedback == null ? '' : l.feedback, l.cost
    ]));

    emit('pms_status', pms.map((r) => [r.empId, F(r.goal), F(r.mid), F(r.annual), r.goalStatus, r.midStatus, r.annualStatus]));

    emit('recognition', recognition.map((r) => [r.empId, fmtDMY(r.day), r.name]));

    emit('wellbeing', wellbeing.map((r) => [r.asset, monthIdxToMY(r.mi), r.sessions, r.unique, r.distress, r.attendees, r.seg]));

    emit('idp_status', idp.map((r) => [r.empId, F(r.has), r.impl == null ? '' : r.impl, r.upd ? fmtDMY(r.upd) : '']));

    emit('succession', succession.map((s) => [s.posId, s.level, s.incumbent, s.succId, s.readiness, s.succIdp == null ? '' : F(s.succIdp)]));

    emit('lms_usage', lms.map((r) => [r.empId, 'Y', r.login ? fmtDMY(r.login) : '']));

    emit('targets', genTargets());

    emit('production_safety', splitProduction(prod, share).map((p) => [
      p.asset, monthIdxToMY(p.mi), p.tonnes, p.manHours, p.lti, p.irDays, p.empCost, p.revenue, p.seg
    ]));

    emit('contract_attendance', cAtt.map((c) => [c.contractor, c.asset, monthIdxToMY(c.mi), c.deployed, c.present, c.hc, c.cost, c.seg]));

    emit('contract_compliance', cComp.map((c) => [
      c.contractor, c.asset, monthIdxToMY(c.mi), F(c.pf), F(c.wage), F(c.lic), c.induction, c.seg
    ]));

    // the seeded unmapped plant is deliberately left out of org_units
    emit('org_units', ORG.map((o) => [o.plant, o.func, o.seg, o.company, o.asset, mcOf(o)]));

    emit('hc_budget', budget.map((b) => [monthIdxToMY(b.mi), b.asset, b.seg, b.company, b.func, b.plant, '', b.budget]));

    emit('positions', positions.map((p) => [
      p.id, p.title, p.asset, p.company, p.segCol, p.func, p.plant, p.level, p.status,
      F(p.budgeted), F(p.cp), p.incumbent, D(p.vacantSince), p.reqId
    ]));

    emit('employee_movements', movements.map((mv) => [
      mv.empId, fmtDMY(mv.day), mv.type, mv.from.asset, mv.to.asset, mv.from.func, mv.to.func,
      mv.from.level, mv.to.level, mv.from.company, mv.to.company, mv.from.seg, mv.to.seg
    ]));

    emit('candidate_pipeline', candidates.map((c) => [
      c.id, c.reqId, c.source, c.gender, D(c.applied), D(c.screened), D(c.interview),
      D(c.offer), D(c.acc), D(c.joined), c.stage, c.drop, c.recruiter
    ]));

    emit('absence_monthly', absence);

    const critical = (item) => CONFIG.criticalComplianceItems.some((c) => item.toLowerCase().includes(c.toLowerCase()));
    emit('statutory_compliance', statutory.map((s) => [
      s.asset, s.seg, monthIdxToMY(s.mi), s.item, fmtDMY(s.due), D(s.done), s.status, F(critical(s.item))
    ]));

    return files;
  }

  return { toCSVs };
})();
