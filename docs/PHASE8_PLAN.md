# Phase 8 — Requirements cross-check, TA/SSC incorporation, Field Mapping, Personas

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done. Update this file as work lands —
it is the restart point for a fresh session (see `docs/HANDOFF_PROMPT.md`).

## Inputs (session-only — never committed, no figures/names reused)
- `Dashboard_Requirement.docx` (10 asks + 4 screenshots: Employee Demographics, Hiring,
  Attrition, Manager Demographics of an existing internal BI dashboard — structure only).
- TA Command Centre repo (`phonepvr/TAdashboard`) — req-level TA metrics + the
  "Map your columns" step.
- SSC MIS repo (`phonepvr/SSCDashboard`) — service-centre MIS metrics.

## Invariants (unchanged from Phases 1–7)
Single self-contained file · zero runtime network requests · CSP `connect-src 'none'` ·
no browser storage · BYOF + seeded mock · ONE formula registry drives tiles, "i",
templates, data dictionary, methodology, scorecard · no real data in repo.

## Decisions (changeable; each documented in Methodology)
| # | Topic | Decision |
|---|---|---|
| D1 | Field mapping | Mandatory **mapping step after every load** (TA-style state machine: gate → map → dashboard; mock = one-click confirm) **plus** a persistent **Field Mapping** tab (first in nav, landing stays Overview). Memory-only; export/import `field_map.csv`. Not persona-restricted (it is part of loading). |
| D2 | Auto-match | Header-name matching ported from TA: normalise → equal 1.00 / equal-without-spaces 0.97 / substring 0.86 / token-Jaccard×0.8; threshold 0.6; greedy 1:1 by score. Per-field synonym lists in `SCHEMAS[..].columns[].aka`. |
| D3 | Recruitment model | Keep req-level `requisitions` (+ TA lifecycle columns) and add candidate-level `candidate_pipeline` for the stage funnel. **TTF = Joining − Open** (fallback Closed − Open). TA ageing buckets 0–30/31–60/61–90/91–180/181–365/365+; aged = open > 180 d; worklist > 90 d. |
| D4 | As-of | Fixed `CONFIG.asOf` (deterministic). "Headcount yesterday" → "Headcount as-of". As-of month selector = P2. |
| D5 | Year basis | Fiscal year, `CONFIG.fyStartMonth = 4` (set 1 for calendar year). YTD everywhere uses it. |
| D6 | Attrition | Annualised stays canonical. Add **absolute YTD attrition** = separations YTD ÷ avg(start-of-FY HC, as-of HC). Exit Type gains `Retirement`; retirements are counted separately and excluded from attrition rates. |
| D7 | Segment | Global **Business: All / Operations / Projects** filter on every tab. Employee segment = employee column → `org_units` by Function Plant → `Unassigned` (only under All). Panel datasets use an optional Segment column; absent ⇒ tile note "segment not available in source". |
| D8 | Personas | 8 personas (below), one policy table + `Access.levelFor(persona, entry)` → `full`/`agg`/`hidden`, fail-closed. Enforced at tiles, charts, popovers, drill-downs, exports, print, exec summary, scorecard, search. Persona chosen on the gate and switchable in the header; banner "Mockup — not a security control". Asset/segment/function-locked personas lock those selectors. |
| D9 | PII | Detail tables (employee/manager/hiring/attrition/movement) show Employee ID + name only at PII level `identified`; `masked` → stable pseudonym (e.g. `EMP-7F3A`); `none` → table hidden, counts only. Small-cell suppression `CONFIG.minCell = 5` on persona-restricted cuts. |
| D10 | SSC scope | Incorporate HC vs approved budget, vacancy/fill, contract-to-on-roll ratio, contract-labour cost per manday, statutory compliance. CSR and admin cost are out (non-HR); documented. |
| D11 | Deferred | Line-manager & MC-member personas, TA forecast set (overlaps Outlook), TA per-HR-head review mode, grade_ladder template, as-of month selector (P2). |

## Personas (mockup)
| id | Label | Data scope | Sees | Restricted |
|---|---|---|---|---|
| `chro` | CHRO (Group) | all | everything | — |
| `asset_head` | Asset HR Head | own asset (locked) | all tabs except Access admin detail | cost drill, wellbeing detail; Group shown as benchmark only |
| `segment_head` | Business HR Head (Ops / Projects) | own segment (locked) | workforce, talent, TA, attrition, positions, absence | cost, wellbeing |
| `coe_ta` | TA & Mobility COE | all | Overview, TA Pipeline, New Joining, Mobility, Positions, Attrition | talent pools/performance/cost/wellbeing hidden; PII masked |
| `coe_talent` | Talent & L&D COE | all | Talent, Performance, L&D, Mobility, Movement, Diversity | cost aggregate; wellbeing hidden |
| `coe_cnb` | C&B / HR Finance | all | Overview, Positions & Budget, Scorecard (financial), Outlook cost | PII none; talent pools hidden |
| `hrops` | HR Ops, IR & Shared Services | all | Contract & Compliance, Absenteeism, Movement, Data Quality, Field Mapping | performance/talent hidden; PII masked |
| `hrbp` | HR Business Partner | own asset + own function (locked) | Overview, Talent, Performance, L&D, Attrition, Absence, Managers | cost/ops/wellbeing hidden; PII masked |

In-app **Access Matrix** tab (generated from the same policy): persona × tab × metric group ×
PII level, plus the IT requirement: *production must enforce scope server/data-side; this
mockup only demonstrates the rules*. Exportable `access_matrix.csv`.

## Data contract (all new columns OPTIONAL unless starred; keys in `snake_case`)
**CONFIG** additions: `fyStartMonth:4`, `segments:['Operations','Projects']`,
`companies` (generic mock names), `assetHomeState {Hazira:Gujarat, Paradeep:Odisha,
Vizag:Andhra Pradesh, Kirandul:Chhattisgarh}`, `mgmtBands ['SM','MM','JM','Blue Collar']`,
`levels` ladder `M-2…M-11, GET`, `scopeBuckets [1–2,3–5,6–10,11–20,21+]`,
`tenureBuckets`, `superannBuckets [<3M,3–6M,6–12M,1–2Y,2–3Y]`, `generations`
(Boomer ≤1964, Gen X 1965–80, Millennial 1981–96, Gen Z 1997+), `taAgeingBuckets`, `minCell:5`.

**Extended templates**
- `employee_master` +: Company, Function Plant, Business Segment (Operations|Projects),
  Level, Management Band (SM|MM|JM|Blue Collar), Domicile State, Hire Type
  (Lateral|Campus|GET|Rehire), Position ID. `Function` gains alias "Function 1".
- `exits` +: Exit Type adds `Retirement`; Exit Reason Category (enum).
- `requisitions` +: Company, Function Plant, Business Segment, Level, Recruiter, Req Status
  (Open|On Hold|Dropped|Offered|TBO|Closed), Offer Date, Offer Accepted Date, Joining Date,
  Hire Source, Drop Reason, Ageing Reason.
- `pms_status` +: Annual Review Complete Flag, Goal Setting Status, Mid-Year Status,
  Annual Review Status.
- `contract_attendance` +: Contract Labour Cost, Business Segment. `production_safety`,
  `contract_compliance`, `wellbeing` +: Business Segment.

**New templates**
- `org_units`: Function Plant*, Function*, Business Segment*, Company, Asset, MC Member (placeholder labels only).
- `hc_budget`: Month*, Asset*, Business Segment, Company, Function*, Function Plant*, Level, Budget Headcount*.
- `positions`: Position ID*, Position Title, Asset*, Company, Business Segment, Function, Function Plant, Level, Position Status* (Filled|Vacant|Frozen|On Hold), Budgeted Flag*, Critical Position Flag, Incumbent Employee ID, Vacant Since, Requisition ID.
- `employee_movements`: Employee ID*, Effective Date*, Movement Type* (Promotion|Transfer – Location|Transfer – Function|Transfer – Company|Re-designation|Segment Change), From/To Asset, From/To Function, From/To Level, From/To Company, From/To Segment.
- `candidate_pipeline`: Candidate ID* (pseudonymous), Requisition ID*, Source*, Gender, Applied Date*, Screened Date, Interview Date, Offer Date, Offer Accepted Date, Joined Date, Current Stage*, Drop Reason, Recruiter.
- `absence_monthly`: Employee ID*, Month*, Scheduled Days*, Days Present*, Planned Leave Days, Unplanned Absence Days*, Absence Spells.
- `statutory_compliance`: Asset*, Business Segment, Month*, Compliance Item*, Due Date*, Completed Date, Status* (On time|Late|Pending|Not applicable).

## Navigation (grouped tab bar; landing = Overview after mapping, or the persona’s own landing tab)
Setup: **Field Mapping** · Executive: Overview · CHRO Scorecard · Outlook ·
Workforce: **Managers** · **Positions & Budget** · **Movement** · **Absenteeism** ·
Talent: Talent Management · **Performance** · L&D · Internal Mobility ·
Acquisition & Retention: **TA Pipeline** · **New Joining** · Attrition · Diversity ·
Operations: Contract & Compliance · Governance: Data Quality · Methodology · **Access Matrix**.
Grade-band filter applies to employee-keyed tabs; segment filter applies everywhere.

## Feature scope (requirements → deliverables)
- R1 Overview demographics: HC as-of (A), HC same month last year (B), HC at FY start (C),
  %YoY (A−B)/B, %YTD (A−C)/C, women HC & %; HC trend 13 m; HC by Company / Asset / Function
  Plant / Function / Band / Level; superannuation buckets; gender donut; employee details
  table (persona-masked). **R1a** state-wise domicile chart + local-domicile % (domicile =
  asset home state). **R1b** Budget vs Actual HC matrix, expandable Asset → Function →
  Function Plant (Budget, Actual, Variance, Var %, Vacant positions).
- R2 New Joining tab: hires YTD, women hires YTD, lateral, campus; MoM trend; by Company /
  Asset / Level / Function Plant / MC member / Band / Generation / Hire type; gender donut;
  hiring details table.
- R3 Movement tab: promotions / transfers / re-designations / inter-company counts & rates,
  asset-to-asset flow matrix, trend, by band/level, **Employee history lookup** (timeline:
  join → movements → exit; PII-gated).
- R4 TA Pipeline tab (TA dashboard metrics): reqs, open, % open, on hold, dropped, TBO, median
  TTF, offer acceptance, aged >180 d, SLA breach % (TTF>90 d); funnel with stage yields;
  stage dwell + bottleneck; TTF histogram & by level; ageing buckets + ageing-reason Pareto +
  aged worklist; TBO buckets; source mix & effectiveness; representation across funnel;
  recruiter productivity (masked, n<5 guard); drop analysis.
- R5 Attrition additions: KPI strip (separated YTD, annualised %, FY-start HC, as-of HC,
  absolute %); attrition RATE by Tenure / Company / Asset / Function Plant / MC member / Band
  / Level / Generation / Gender; type split; Voluntary/Involuntary/All page toggle;
  attrition details table.
- R6 Performance tab: goal setting, mid-year, annual completion — by asset/function/band/
  level, status funnel, laggard functions.
- R7 Managers tab: total line managers, avg span, manager-same-level-as-report count, women
  managers; managers by Asset/Band/Level/Function Plant; span by same; same-level by level;
  gender; scope-bucket filter; manager details table.
- R8 Positions & Budget tab: total/filled/vacant/frozen positions, vacancy %, vacant >90 d,
  vacant without open requisition, budget vs filled by asset/function, vacancy ageing,
  positions table.
- R9 Absenteeism tab: absenteeism % (unplanned ÷ scheduled), planned-leave %, attendance %,
  trend, by asset/function/band/segment, frequent-absence cohort COUNT (≥3 spells, counts only).
- R10 Segment filter everywhere (D7).
- R11 Field mapping (D1, D2) + `field_map.csv` with Source System per template
  (HRMS, ATS, LMS, Attendance, Finance/Budget master, SCRUM, Aparajita — editable).
- R12 Personas + Access Matrix (D8, D9).
- SSC: contract-to-on-roll ratio, contract cost per manday, statutory compliance on-time %
  + pending/critical items (Contract & Compliance tab).

## Delivered (R1–R12)
- **R1 Overview demographics** — 9-tile strip (A, B, C, % YoY, % YTD, women D and D/A,
  local domicile %, superannuation ≤ 3 y) on the on-roll (Permanent + Trainee); 13-month trend
  tagged A/B/C; gender donut; HC by Company / Asset / Segment / Function / Function Plant /
  Band / Level; superannuation buckets; paged employee table masked per persona (CSV).
  **R1a** state-wise domicile + local-domicile % (home state per asset). **R1b** budget vs
  actual: 5 tiles + Asset → Function → Function Plant tree (Budget, Actual, Variance, Var %,
  Vacant), keyboard toggles, Expand all, CSV.
- **R2 New Joining** — 7 tiles (hires YTD, women YTD and %, lateral, campus, GET, trailing
  12 m); hire = DOJ in fiscal YTD, every class, later leavers included; 13-month trend;
  cuts by type / company / asset / plant / MC / level / band / generation; masked details.
- **R3 Movement** — 9 tiles (all, promotions, location / function / company transfers,
  re-designations, segment changes, promotion rate, internal rate); a move counts for From
  and To; monthly trend; asset→asset and level→level flow tables (< 5 shown as "<5"); by
  band / level; employee history lookup gated by PII level; masked details.
- **R4 TA Pipeline** — 20 hiring metrics: snapshot (book as-of) and delivery (period) bases;
  status / ageing / TBO bars, TTF histogram and by level, asset / function scorecards,
  ageing-reason Pareto, aged worklist, funnel yields, stage dwell + bottleneck, female share
  by stage, source mix and effectiveness, recruiter productivity (masked, n < 5 guard), drops.
- **R5 Attrition** — fiscal-YTD strip (separated, annualised, FY-start HC, as-of HC,
  absolute % per D6, retirements); All / Voluntary / Involuntary toggle; rate cuts by tenure,
  gender, generation, band, level, company, asset, MC member, plant; reason categories;
  masked details (CSV).
- **R6 Performance** — goal setting → mid-year → annual: 5 tiles, phase strip, status funnel
  per phase, completion by asset / segment / function / level / band, laggard functions,
  top line managers awaiting action; flags and statuses only.
- **R7 Managers** — total line managers, manager-to-employee ratio, same-level managers,
  women managers and share; counts and ratios by asset / band / level / plant; scope-bucket
  filter; same-level by level; gender; manager table (CSV), masked for HRBP.
- **R8 Positions & Budget** — 11 tiles (total, filled, vacant, frozen / on hold, vacancy %,
  vacant > 90 d, vacant without open req, critical vacant, budgeted unfilled, budget fill %,
  incumbents without position ID); vacancy % by asset / function / level, ageing, req cover,
  budget vs filled by asset and function; position register.
- **R9 Absenteeism** — absenteeism %, attendance %, planned-leave %, spells per employee,
  frequent-absence cohort (≥ 3 spells / 3 months, COUNT ONLY), days lost; trend, day mix,
  cuts by function / level / band / segment, asset × month heat table; day counts only.
- **R10 Segment filter** — `#sel-seg` on every tab; employee → org_units → Unassigned; panel
  datasets carry an optional segment column; chips in header, footer and print footers.
- **R11 Field mapping** — mapping step after every load + Field Mapping tab; D2 matcher;
  `field_map.csv` export / import with the source system per template.
- **R12 Personas + Access Matrix** — 8 personas, one policy (`02z-access.js`), enforced on
  every surface incl. print and exec summary; PII identified / masked / none; minCell 5;
  Access Matrix tab + `access_matrix.csv` with the IT hand-off requirements.
- **SSC (D10)** — Contract & Compliance: contract-to-on-roll ratio, cost per man-day and period
  cost, statutory on-time %, late, pending past due, average days past due, item × asset
  board, worklist.

## Execution plan (workflows)
1. `[x]` **Core-A (data)** — schemas, CONFIG, mock generator for every new column/template
   (deterministic, per-domain streams), assemble.mjs loads all `src/css/*.css`, compute
   segment filter + memo key + generic `rateBy/countBy` helpers, exits Retirement handling.
   *Landed:* 22 templates, every column has `aka` + `ex`, every schema a `source`. Levels run
   senior→junior (`M-2` top … `M-11`, `GET`); mock maps grade→level→band. Model gains
   `orgUnits/orgByPlant, hcBudget, positionRows, movements, candidates, absence, statutory`;
   rows carry `__seg`. Compute: `ctx.segment/fn`, `inSeg/inFn/orgMatch/reqMatch/panelMatch/
   isUnscoped/segOf/orgOf/reqOpen`, `countBy`, `rateBy(m, ctx, (e, day) => key, {klass, pred, order})`,
   `fyStartDay`; `exitsInPeriod(…, includeRetirements)` defaults to excluding retirements.
   Mock absence = 12 months (whole mock load measured ~1.3–1.7 s click-to-paint).
2. `[x]` **Core-B (platform)** — grouped nav with all tab ids (stubs), segment selector,
   persona framework (`02z-access.js`) + gate/header switcher + enforcement + Access Matrix
   tab, attrition & contract renderers moved to own files.
   *Landed:* `TAB_GROUPS` → flat `TABS` (ids: fieldmap, overview, scorecard, outlook, managers,
   positions, movement, absence, talent, performance, lnd, mobility, ta, joining, attrition,
   diversity, contract, quality, methodology, access); each new feature tab has its own stub file
   `src/js/tabs/<id>.js` calling `UI.placeholder` — the feature agent replaces that file.
   `#sel-seg` (Business) drives `filters.segment`; chips `#scope-chip`/`#ft-scope` + print footers.
   Policy: `ACCESS_CLASSES` (core, talent, perf, hiring, learning, org, attendance, ops, cost,
   wellbeing; group → class, an entry's `access:'<class>'` wins — **new metrics must set it**,
   the personas spec fails on unclassified keys), `PERSONAS` (8; scope all|asset|segment|
   asset+function, tabs, levels, pii), `ALWAYS_TABS` = fieldmap + methodology; Access tab = CHRO
   only. Choke points: `Compute.metric` (res.restricted 'hidden'|'scope'|'grain', res.level,
   res.suppressed via `suppress:true`), `Charts.card({infoKey|access})`, `Outlook panel({access})`,
   `openDrill` + `Access.maskDrill`; feature detail tables use `Access.maskTable(cols, rows)`
   (null ⇒ withhold) and `Access.cellText(n)` for small cells. Orphan rows (ID not in master) now
   count only when `Compute.isUnscoped(ctx)` (idp/lms/internal apps/L&D charts).
3. `[x]` **Core-C (field mapping)** — mapping engine, mapping step, Field Mapping tab,
   field_map.csv export/import.
   *Landed:* `03a-mapping.js` (`Mapping`: `normHdr`, `headerSimilarity`, `assign` greedy 1:1 ≥ 0.6,
   `detect` = best total score floored by required count, file named after a template wins
   near-ties; substring = whole words, never a one-word header; `CSV.matchSchema` delegates).
   A mapping renames headers to canonical names before `CSV.applySchema`; datasets carry
   `.mapping {fileName, cols, unmapped}` and `.headers` (source). `07a-mapstep.js` (`MapStep.open(files,
   {mode, notes, onConfirm})`, `#map-step`, `#ms-confirm`, `[data-ms-template]`, `[data-ms-col]`) sits
   between parse and dashboard for mock (hint = schema, no seeds), first load and Load / add files.
   Seeds (memory only): imported field_map.csv (`#fieldmap-input`, gate link, or a map dropped with
   the data) and manual picks this session. `tabs/fieldmap.js` + `css/fieldmap.css`. Tests go
   through `tests/helpers.mjs` (`loadMock`, `openMock`, `loadFiles`, `confirmMapping`).
4. `[x]` **Feature fan-out** (git worktrees, each agent owns only NEW files + one tab file):
   overview-demographics, joining, movement, ta-pipeline, attrition, performance, managers,
   positions, absence, compliance.
   *Landed:* ten branches merged; each feature = `src/js/02<x>-reg-<feature>.js` (registry +
   one `<Feature>Kit` namespace) + `src/js/tabs/<id>.js` + `src/css/<feature>.css` +
   `tests/<feature>.spec.mjs`. Mock changes stay on their own rng domains (`movements-v2`,
   `candidates-gender`, `absence-v2`, statutory registers); no placeholder tab remains.
5. `[x]` **Integrate** — merge, print pack (persona-scoped, key tiles for new areas), exec
   summary rules, methodology decisions list, full suite green.
   *Landed:* print unit pages gain a compact "Workforce & talent" row (`demo_hc_yoy_pct`,
   `bva_variance_pct`, `pb_vacancy_pct`, `join_hires_ytd`, `mv_promotion_rate`,
   `ta_ttf_median`, `absenteeism_pct`, `midyear_review_pct`; restricted tiles print locked);
   tiles run four-up and each unit page fits ONE A4 sheet — asserted with `page.pdf()` for
   CHRO and TA COE. Exec summary: vacancy vs target, requisitions aged > 180 d, statutory items
   past due, absenteeism vs target, headcount vs approved budget, local domicile (target only).
   Methodology: "Phase 8 decisions" (D1–D11) + "Feature definitions" tables; exclusions
   corrected (budget vs actual is in scope). Demo targets for rates / medians / zero targets
   only. Shared-file follow-ups applied: `PII_ID_COLUMNS` += `Employee Code`; pseudonyms get
   a murmur3 fmix32 avalanche; HRBP `org` = Full (masked manager list, per the persona table);
   a gate load opens on the persona's own landing tab; `fmtINR` prints full rupees below ₹1 L
   (cost per man-day is unit ₹); `CONFIG.minBase` (attrition small base); single-segment
   donut draws; goal / mid-year tiles drill (pending list); dead Talent performance slot and
   `levelBelow` removed; Overview "Span of control" relabelled "Individual contributors per
   manager"; Access Matrix notes per-cell (not complementary) suppression.
   *Open follow-ups (not blocking):* optional `Dropped Date` on requisitions (drops by period);
   `Charts.line({pointLabels})` / `Charts.column` to replace the local trend / column helpers in
   joining and overview.
6. `[x]` **Adversarial review** — privacy/PII, persona consistency (every surface), metric
   correctness, requirement coverage vs this file → fix loop.
   Review record: 5 lenses (privacy/PII, persona enforcement, metric correctness, requirement
   coverage, UX/print) → 44 findings → 33 confirmed by independent refuters → all 33 fixed
   (commits 4b2c80c, b7794db, 824d77e, d1fb6c4). Final gate: 142/142 tests, artifact 962 KB.
7. `[~]` **Deploy** — push, CI green, Pages live; screenshots; update this file.
