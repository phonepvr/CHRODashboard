# HR Dashboard @AM/NS

A privacy-first, fully offline, browser-only CHRO dashboard **mockup** for ArcelorMittal
Nippon Steel India (Hazira · Paradeep · Vizag · Kirandul), published on GitHub Pages as a
**single self-contained HTML file**.

> **No data lives in this repository.** The repo contains only logic, formulas, UI, a
> seeded synthetic-data generator and branding. Data is either generated in-browser
> (illustrative mode) or loaded by the user from local CSV files that are parsed entirely
> in the browser and never uploaded anywhere.

## Privacy & offline guarantees

- One self-contained `index.html`; opens from `file://` — no server needed.
- **Zero network requests at runtime** (CI fails if Playwright observes any).
- CSP: `default-src 'self' 'unsafe-inline' data:; connect-src 'none'`.
- No `localStorage` / `sessionStorage` / IndexedDB / cookies — state is in memory only
  and cleared on reload.
- Exports, upload templates and print output are local Blob downloads / `window.print()`.

## How it works

The page opens at a **load gate** with three actions:

1. **Load your data** — bring your own CSV files (per the downloadable templates);
   parsed and computed entirely in your browser.
2. **Download upload templates** — blank CSV templates + a data dictionary, generated at
   runtime from the same formula registry that powers every tile.
3. **Explore with mock data** — deterministic seeded synthetic data (identical numbers
   every run), clearly labelled *Illustrative data* on screen and in print.

Every load — mock included — then passes a **Map your columns** step: each file is matched
to a template by its header names (synonyms and fuzzy matches allowed), every template
field shows the source header it will be read from, and missing required fields block
the dashboard until they are mapped. The **Field Mapping** tab keeps the resulting map
(memory only) and exports / imports it as `field_map.csv` — the integration spec for IT.

Every tile and chart exposes an "i" affordance with its exact formula, input columns,
caveats and data-quality notes, all driven by **one formula registry** which also
generates the Methodology appendix, the upload templates and the data dictionary.

## Features

- **Field mapping** — the mapping step above runs after every load (header matching by
  synonyms, whole-word and token similarity, one-to-one); the **Field Mapping** tab (first in
  the bar) shows the confirmed map per template and exports / imports `field_map.csv` with
  the source system per template.
- **Grouped navigation, 20 tabs** — Setup: Field Mapping · Executive: Overview, CHRO
  Scorecard, Outlook · Workforce: **Managers**, **Positions & Budget**, **Movement**,
  **Absenteeism** · Talent: Talent Management, **Performance**, L&D, Internal Mobility ·
  Acquisition & Retention: **TA Pipeline**, **New Joining**, Attrition, Diversity ·
  Operations: Contract & Compliance · Governance: Data Quality, Methodology, **Access Matrix**.
  Overview adds employee demographics (headcount as-of / last year / FY start, YoY and YTD,
  domicile, superannuation) and a budget-vs-actual matrix (Asset → Function → Function Plant);
  Attrition adds a fiscal-YTD strip, an exit-type toggle and rate cuts; Contract & Compliance
  adds the statutory register, manning mix and contract-labour cost per man-day.
- **Business segment filter** — All · Operations · Projects on every tab, next to the asset,
  grade-band and period selectors (the fiscal year starts in April; set
  `CONFIG.fyStartMonth` to change it).
- **Personas + Access Matrix** — eight HR personas chosen on the gate or in the header;
  one policy decides, per metric class, Full · Aggregate only · Restricted, and every
  surface (tiles, charts, "i", drill-downs, exports, print pack, executive summary,
  scorecard, search) follows it. Identifiers are shown, pseudonymised or withheld by
  persona; small cells below 5 are suppressed on restricted views. The Access Matrix tab
  (CHRO only) is generated from the same policy and exports `access_matrix.csv`. It is a
  mockup of the rules, **not a security control** — production must enforce them
  server/data-side.

  | Persona | Data scope | Tabs | Aggregate only · Restricted | Identifiers |
  |---|---|---|---|---|
  | CHRO (Group) | all | every tab | — | shown |
  | Asset HR Head | own asset (Group as benchmark) | all but Access Matrix | cost, wellbeing · — | shown |
  | Business HR Head | own segment | Overview, the Workforce and Talent groups, TA Pipeline, New Joining, Attrition | ops · cost, wellbeing | shown |
  | TA & Mobility COE | all | Overview, TA Pipeline, New Joining, Mobility, Positions, Attrition | learning, attendance, ops · talent, performance, cost, wellbeing | pseudonymised |
  | Talent & L&D COE | all | Talent, Performance, L&D, Mobility, Movement, Diversity | attendance, ops, cost · wellbeing | shown |
  | C&B / HR Finance | all | Overview, Positions & Budget, Scorecard, Outlook | core, performance, hiring, learning, attendance, ops · talent, wellbeing | none (counts only) |
  | HR Ops & IR | all | Contract & Compliance, Absenteeism, Movement, Data Quality | hiring, learning, cost, wellbeing · talent, performance | pseudonymised |
  | HRBP | own asset + line function | Overview, Talent, Performance, L&D, Attrition, Absenteeism, Managers | talent, hiring · cost, ops, wellbeing | pseudonymised |

  Field Mapping and Methodology are open to every persona.
- **22 upload templates** — the original fifteen plus `org_units`, `hc_budget`, `positions`,
  `employee_movements`, `candidate_pipeline`, `absence_monthly` and `statutory_compliance`
  (with extended columns on employee master, exits, requisitions, performance status and the
  contract / safety / wellbeing panels). Each template names its source system (HRMS, ATS,
  LMS, Attendance, Finance/Budget master, SCRUM, Aparajita).
- **Print pack** — cover, a Group page and one page per asset (summary, curated tiles, a
  workforce & talent tile row, two charts, watch list), data quality and the methodology
  appendix; scoped to the persona, each unit page sized to one A4 sheet.
- **Executive summary** — rule-based sentences over registry values only, each against a
  target, the approved budget, a due date or a defined ageing threshold; rules about metrics
  a persona cannot see are dropped.

## Live site

Deployed by GitHub Actions to GitHub Pages:
`https://phonepvr.github.io/CHRODashboard/`

> First-time setup: the workflow's deploy job needs Pages enabled once —
> **Settings → Pages → Build and deployment → Source: GitHub Actions**. The
> `GITHUB_TOKEN` cannot create the Pages site itself; every push deploys
> automatically after that one click. The built single file is also attached to
> every workflow run as the `dashboard-single-file` artifact — download it and
> open it straight from disk (`file://`) if you prefer.

## Build & deploy

Zero-build by design: the CI "build" step only concatenates the source parts and inlines
the subset Albert Sans font into `dist/index.html` (`build/assemble.mjs`), verifies the
artifact with Playwright (including the zero-network assertion), then deploys to GitHub
Pages. Locally: `npm run build && npx playwright test`.

Albert Sans is used under the SIL Open Font License 1.1 (see `assets/OFL-AlbertSans.txt`).

## Disclaimer

This is an illustrative mockup. All numbers shown in mock mode are synthetic and
generated by a seeded PRNG; they do not describe any real workforce.
