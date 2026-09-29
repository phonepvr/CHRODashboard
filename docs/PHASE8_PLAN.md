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

## Navigation (grouped tab bar; landing = Overview after mapping)
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

## Execution plan (workflows)
1. `[ ]` **Core-A (data)** — schemas, CONFIG, mock generator for every new column/template
   (deterministic, per-domain streams), assemble.mjs loads all `src/css/*.css`, compute
   segment filter + memo key + generic `rateBy/countBy` helpers, exits Retirement handling.
2. `[ ]` **Core-B (platform)** — grouped nav with all tab ids (stubs), segment selector,
   persona framework (`02z-access.js`) + gate/header switcher + enforcement + Access Matrix
   tab, attrition & contract renderers moved to own files.
3. `[ ]` **Core-C (field mapping)** — mapping engine, mapping step, Field Mapping tab,
   field_map.csv export/import.
4. `[ ]` **Feature fan-out** (git worktrees, each agent owns only NEW files + one tab file):
   overview-demographics, joining, movement, ta-pipeline, attrition, performance, managers,
   positions, absence, compliance.
5. `[ ]` **Integrate** — merge, print pack (persona-scoped, key tiles for new areas), exec
   summary rules, methodology decisions list, full suite green.
6. `[ ]` **Adversarial review** — privacy/PII, persona consistency (every surface), metric
   correctness, requirement coverage vs this file → fix loop.
7. `[ ]` **Deploy** — push, CI green, Pages live; screenshots; update this file.
