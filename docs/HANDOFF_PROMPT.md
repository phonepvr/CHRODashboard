# Hand-off prompt — paste into a new Claude Code session on `phonepvr/CHRODashboard`

Replace the `NEXT TASK` line at the bottom with what you want done, then paste everything
inside the fence.

```
You are continuing "HR Dashboard @AM/NS" — a privacy-first, fully offline, single-file CHRO
dashboard MOCKUP for ArcelorMittal Nippon Steel India (Group + Hazira, Paradeep, Vizag,
Kirandul), used to hand requirements to the IT team. Vanilla JS/CSS, zero runtime
dependencies. Public repo phonepvr/CHRODashboard; branch claude/amns-hr-dashboard-mockup-px8nux
(it is the default branch — work ONLY on it, commit with clear messages, push). Live on
GitHub Pages: https://phonepvr.github.io/CHRODashboard/ (Pages source = GitHub Actions).

CURRENT STATE: Phases 1–8 are complete and deployed. 142/142 Playwright tests pass locally
and in CI; the Pages deploy is green. Phase 8 delivered: field-mapping step + Field Mapping
tab (field_map.csv), 8 personas + Access Matrix tab (access_matrix.csv), Business segment
filter (All / Operations / Projects) on every page, and the tabs Overview demographics +
Budget-vs-Actual matrix, New Joining, Movement (employee history), TA Pipeline, Attrition
(reworked), Performance (goal setting → mid-year → annual), Managers (span of control),
Positions & Budget, Absenteeism, Contract & Compliance. 22 upload templates.

READ FIRST, in order: README.md; docs/PHASE8_PLAN.md (decisions D1–D11, persona table, data
contract, navigation, scope R1–R12, execution record); then src/js/00-util.js (CONFIG),
01-schemas.js (templates), 02-registry.js + one feature registry (e.g. 02r-reg-absence.js),
02z-access.js (personas), 03a-mapping.js, 05-compute.js, 07-ui.js, 09-print.js, 99-main.js,
one tab renderer (src/js/tabs/absence.js) and tests/helpers.mjs + tests/absence.spec.mjs.

ARCHITECTURE
- build/assemble.mjs concatenates src/ into ONE file, dist/index.html (one global script
  scope): JS sorted lexicographically with tabs/*.js placed before 99-main.js; CSS =
  tokens.css first, print.css last, the rest alphabetically. Artifact ≈ 960 KB.
- REGISTRY (defineMetric in src/js/02*-reg*.js) is the single source of truth: tiles, "i"
  popovers, templates, data dictionary, methodology, scorecard, print pack and the access
  matrix all read it. Every metric has formula, inputs and an access class.
- SCHEMAS (01-schemas.js) define every template; columns carry `aka` synonyms and `ex`
  examples; each schema names its source system.
- Mock data: seeded mulberry32 with per-domain rngFor streams (04-mock.js), serialised to
  CSV and fed through the same parser + mapping step as a real upload. Deterministic.
- Personas (02z-access.js): Access.levelFor(persona, entry) → full | agg | hidden, fail-closed.
  Classes: core, talent, perf, hiring, learning, org, attendance, ops, cost, wellbeing. PII:
  identified | masked (pseudonym EMP-XXXXXX) | none. Small cells < CONFIG.minCell (5) are
  suppressed. Every chart card declares data-access. The banner says "Persona view — mockup,
  not a security control"; production enforcement is an IT requirement (Access Matrix tab).
- Field mapping (03a-mapping.js + 07a-mapstep.js): auto-match (exact 1.00, no-space 0.97,
  whole-word 0.86, token-Jaccard×0.8, threshold 0.6, greedy 1:1); a mandatory "Map your
  columns" step after every load, mock included. Memory only.
- Definitions: FY starts April (CONFIG.fyStartMonth = 4); time-to-fill = joining − open;
  absolute YTD attrition = separations YTD ÷ avg(FY-start HC, as-of HC); retirements are
  excluded from attrition rates.

NON-NEGOTIABLES
- ZERO network requests at runtime (Playwright tripwire): no CDN, no remote fonts, no
  analytics, no fetch/XHR/WebSocket/sendBeacon. CSP meta exactly:
  default-src 'self' 'unsafe-inline' data:; connect-src 'none'.
- No localStorage/sessionStorage/IndexedDB/cookies — view state in memory only.
- Exports, templates and print are LOCAL downloads; nothing is ever POSTed.
- The repo contains NO real data — only logic, formulas, UI, the synthetic generator, the
  template generator, vendored assets and branding. Reference files, screenshots and the
  TA/SSC dashboards are session inputs only: copy structure, never values or names.
- Invent no external benchmarks. Every metric has a formula + inputs in the registry.

BUILD & TEST (this container: 4 CPUs → use 2 workers)
- npm install
- Optional font: pip install fonttools brotli; python build/fetch_subset_font.py --out build/font.b64
  (build/font.b64 may already exist; without it the build falls back to system fonts).
- node build/assemble.mjs --font build/font.b64 --out dist/index.html
- PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --workers=2
- CI installs the LATEST Playwright Chromium headless shell (v151 at last run), newer than the
  local 141. To get closer to CI, also run with
  PW_CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium_headless_shell-*/*/headless_shell).
  Lesson learned: requestIdleCallback was starved on v151 until user input — anything
  deferred must carry a deadline ({ timeout }).
- Playwright wipes test-results/ at the start of every run: write screenshots elsewhere (the
  session scratchpad), never into test-results/.
- Tests load data through tests/helpers.mjs (gate → #gate-mock → #map-step → #ms-confirm);
  print-pack polls use packPages(page), which reports PrintPack.lastError.
- CI = .github/workflows/pages.yml: build (font fetch/subset → assemble → size gate) →
  verify (Playwright, zero-network) → deploy-pages. After every push, check the run with the
  GitHub MCP actions tools (or curl the public Actions API) and fix until all three jobs are
  green; confirm the github-pages deployment for the pushed SHA reports success.

CONVENTIONS FOR NEW WORK
- New metric → defineMetric in the right 02x-reg file (key, label, formula, inputs, access
  class, drill if row-level) + a test that recomputes it independently from raw rows.
- New template column → SCHEMAS with aka/ex; mock generator emits it; template download and
  field_map.csv pick it up automatically.
- New tab → TAB_GROUPS in 07-ui.js, renderer in src/js/tabs/<id>.js, CSS in
  src/css/<id>.css, persona visibility in 02z-access.js, a spec in tests/<id>.spec.mjs
  covering: real numbers in mock mode, direct-labelled charts, CHRO / masked / none personas,
  asset-locked persona sees no peers, segment filter changes numbers, BYOF without the file.
- Record every decision in docs/PHASE8_PLAN.md (or a new docs/PHASE9_PLAN.md with the same
  shape) and in the Methodology tab; keep checkboxes current and commit them with each step.
- Finish with an adversarial review (privacy/PII, persona enforcement on every surface —
  tiles, charts, popovers, drills, exports, print pack, exec summary, scorecard, search —
  metric correctness, requirement coverage, UX/print), fix what is confirmed, push, confirm
  CI green + Pages deploy, and report with screenshots.

KNOWN BACKLOG (deferred in Phase 8, listed on the Methodology tab): line-manager and
MC-member personas; TA forecast set; TA per-HR-head review mode; grade_ladder template;
as-of month selector; CSR and admin cost; value-level (enum) mapping in the field-mapping
step; an "Edit mapping" button after confirm; Data Quality tab not persona-scoped.

NEXT TASK: <describe what you want done in this session>
```

## Context notes for the operator
- The requirement screenshots and the SSC/TA repos contain real internal data — never copy
  values or names; only structure.
- If the TA / SSC repos are needed again: `git clone --depth 1 https://github.com/phonepvr/tadashboard`
  (public) and add `phonepvr/SSCDashboard` via the session's add-repo tool (private).
- `phonepvr/SSCDashboard` has real personal and salary data committed in its xlsx files;
  remove them and purge the git history (e.g. `git filter-repo`) before anyone else gets access.
