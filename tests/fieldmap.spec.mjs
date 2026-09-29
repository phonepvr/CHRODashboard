import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { ARTIFACT, root, confirmMapping } from './helpers.mjs';

const tmp = join(root, 'test-results', 'fieldmap');
mkdirSync(tmp, { recursive: true });
const write = (name, lines) => { const p = join(tmp, name); writeFileSync(p, lines.join('\n')); return p; };

// an HRMS extract with its own header names: synonyms, one fuzzy, one extra column
const RENAMED = [
  'Emp Code,Employee Name,Location,Grade Group,Grade,Department,Sex,Date of Birth,Joining Date,Employee Class Code,Canteen Code',
  'R-001,A. One,Hazira,AM-GM,DGM,Operations,Female,10-05-1980,01-04-2010,Permanent,C1',
  'R-002,B. Two,Hazira,Below AM,S1,Operations,Male,15-08-1990,01-06-2018,Permanent,C2',
  'R-003,C. Three,Paradeep,AM-GM,GM,Finance,Male,20-01-1975,15-03-2005,Permanent,C3'
];

function tripwire(page) {
  const net = [];
  page.on('request', (req) => { if (!/^(file|data|about|blob):/.test(req.url())) net.push(req.url()); });
  return net;
}

async function download(page, trigger) {
  const [d] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: d.suggestedFilename(), text: readFileSync(await d.path(), 'utf8') };
}

const row = (page, key) => page.locator(`#map-step tr[data-ms-key="${key}"]`);

test.describe('Phase 8 — Core-C: field mapping step, auto-match, field_map.csv', () => {

  test('auto-match: exact, spaced, substring, token overlap, threshold, greedy 1:1, template detection', async ({ page }) => {
    await page.goto(ARTIFACT);
    const r = await page.evaluate(() => {
      const sim = Mapping.headerSimilarity;
      const a = Mapping.assign('employee_master', ['Emp Code', 'Joining Date', 'Date', 'Grade', 'Grade Group']).cols;
      const pick = (k) => a.get(k)?.header ?? null;
      const detected = {};
      for (const [id, text] of Mock.toCSVs()) detected[id] = Mapping.detect(CSV.parse(text).headers, 'upload.csv')?.schemaId;
      return {
        exact: [sim('employee_id', 'Employee ID'), sim('  EMPLOYEE ID ', 'employee id'), sim('Emp Code', 'Emp Code')],
        spaced: sim('EmployeeID', 'Employee ID'),
        substring: sim('Employee ID (HRMS)', 'Employee ID'),
        tokens: sim('Type Exit', 'Exit Type'),
        below: sim('Exit Reason Text', 'Exit Reason Category'),
        oneWord: [sim('Date', 'Exit Date'), sim('Attendance', 'TT'), sim('Function', 'CT')],
        threshold: Mapping.THRESHOLD,
        assigned: { id: pick('employee_id'), doj: pick('doj'), grade: pick('grade'), band: pick('grade_band') },
        dateUnused: ![...a.values()].some((v) => v.header === 'Date'),
        detected,
        none: Mapping.detect(['Foo', 'Bar', 'Baz'], 'x.csv'),
        byHeaders: Mapping.detect(['Asset', 'Month', 'Business Segment'], 'x.csv')?.schemaId,
        byName: Mapping.detect(['Asset', 'Month', 'Business Segment'], 'production_safety.csv')?.schemaId
      };
    });
    expect(r.exact).toEqual([1, 1, 1]);
    expect(r.spaced).toBeCloseTo(0.97, 6);
    expect(r.substring).toBeCloseTo(0.86, 6);
    expect(r.tokens).toBeCloseTo(0.8, 6);
    expect(r.below).toBeLessThan(r.threshold);
    for (const s of r.oneWord) expect(s).toBeLessThan(r.threshold);
    expect(r.threshold).toBe(0.6);
    expect(r.assigned).toEqual({ id: 'Emp Code', doj: 'Joining Date', grade: 'Grade', band: 'Grade Group' });
    expect(r.dateUnused).toBe(true);
    // every mock file routes to its own template from its headers alone
    for (const [id, got] of Object.entries(r.detected)) expect(got, id).toBe(id);
    expect(r.none).toBeNull();
    expect(r.byHeaders).toBe('wellbeing');
    expect(r.byName).toBe('production_safety');   // a file named after a template wins near-ties
  });

  test('HRMS detail-report headers (Code, Ename, Man Code, Function 1, DOJ) map without manual picks', async ({ page }) => {
    await page.goto(ARTIFACT);
    const r = await page.evaluate(() => {
      const headers = ['Code', 'Ename', 'Asset', 'Grade Band', 'Function 1', 'Gender', 'DOB', 'DOJ', 'Employee Class', 'Man Code', 'Cost Centre Code'];
      const a = Mapping.assign('employee_master', headers).cols;
      const exits = Mapping.assign('exits', ['Code', 'Exit Date', 'Exit Type']).cols;
      // a file with no ID column never takes another "… Code" header as the ID
      const noId = Mapping.assign('employee_master', ['Cost Centre Code', 'Asset']).cols;
      return {
        id: a.get('employee_id')?.header, name: a.get('name')?.header, mgr: a.get('manager_id')?.header,
        fn: a.get('function')?.header, doj: a.get('doj')?.header, missing: Mapping.missingRequired('employee_master', a).map((c) => c.name),
        exitId: exits.get('employee_id')?.header, noId: noId.get('employee_id')?.header ?? null
      };
    });
    expect(r).toEqual({ id: 'Code', name: 'Ename', mgr: 'Man Code', fn: 'Function 1', doj: 'DOJ', missing: [], exitId: 'Code', noId: null });
  });

  test('mock passes through the mapping step: every field exact, one-click confirm, Back returns to the gate', async ({ page }) => {
    const net = tripwire(page);
    await page.goto(ARTIFACT);
    await page.click('#gate-mock');
    const step = page.locator('#map-step');
    await expect(step).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('#load-gate')).toBeHidden();
    await expect(page.locator('#ms-title')).toHaveText('Map your columns');
    const n = await page.evaluate(() => ({ files: SCHEMA_IDS.length, cols: SCHEMA_IDS.reduce((s, id) => s + SCHEMAS[id].columns.length, 0), metrics: REGISTRY.length }));
    await expect(step.locator('.ms-card')).toHaveCount(n.files);
    await expect(page.locator('#ms-summary')).toContainText(`${n.cols} of ${n.cols} fields mapped`);
    await expect(page.locator('#ms-summary')).toContainText('0 unmapped headers');
    await expect(page.locator('#ms-summary')).toContainText(`feeds ${n.metrics} of ${n.metrics} metrics in full`);
    await expect(step.locator('.ms-state-ok')).toHaveCount(n.files);
    await expect(step.locator('.ms-chip-exact')).toHaveCount(n.cols);
    await expect(step).toContainText('Illustrative data');
    // Back: nothing loaded, the gate returns
    await page.click('[data-ms-back]');
    await expect(page.locator('#load-gate')).toBeVisible();
    expect(await page.evaluate(() => App.state.datasets.size)).toBe(0);
    // one click: Confirm has focus, Enter loads the dashboard on Overview
    await page.click('#gate-mock');
    await expect(page.locator('#ms-confirm')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#tab-overview')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-overview')).toBeFocused();   // focus is not dropped to <body>
    await expect(page.locator('[data-key="headcount_close"] .tile-value')).toHaveText(/^[\d,]+$/);
    expect(await page.evaluate(() => [...App.state.datasets.values()].every((d) => d.mapping && Object.keys(d.mapping.cols).length))).toBe(true);
    const storage = await page.evaluate(() => ({ l: localStorage.length, s: sessionStorage.length, c: document.cookie }));
    expect(storage).toEqual({ l: 0, s: 0, c: '' });
    expect(net).toEqual([]);
  });

  test('BYOF with renamed headers: synonyms + fuzzy map, unmapped headers shown, metrics compute', async ({ page }) => {
    await page.goto(ARTIFACT);
    await page.setInputFiles('#file-input', write('hr_extract.csv', RENAMED));
    const step = page.locator('#map-step');
    await expect(step).toBeVisible();
    const card = step.locator('.ms-card').first();
    await expect(card).toHaveAttribute('open', '');
    await expect(card.locator('[data-ms-template="0"]')).toHaveValue('employee_master');
    await expect(card).toContainText('10 of 26 fields mapped · 3 rows · 1 unmapped header');
    const sel = (key) => row(page, key).locator('select');
    const selected = async (key) => (await sel(key).locator('option:checked').textContent()).trim();
    expect(await selected('employee_id')).toBe('Emp Code');
    expect(await selected('doj')).toBe('Joining Date');
    expect(await selected('function')).toBe('Department');
    expect(await selected('grade_band')).toBe('Grade Group');
    expect(await selected('grade')).toBe('Grade');
    await expect(row(page, 'employee_id').locator('.ms-chip-exact')).toHaveText('exact');
    await expect(row(page, 'employee_id').locator('.ms-chip-pii')).toBeVisible();
    await expect(row(page, 'employee_class').locator('.ms-chip-fuzzy')).toHaveText('fuzzy 86%');
    await expect(row(page, 'employee_id').locator('.ms-samples')).toContainText('R-001');
    const used = await page.evaluate(() => Mapping.consumers('employee_master', 'Employee ID').length);
    await expect(row(page, 'employee_id').locator('.ms-used')).toHaveText(`used by ${used} metrics`);
    await expect(row(page, 'manager_id').locator('.ms-chip-missing')).toHaveText('missing');
    await expect(card.locator('.ms-note-unmapped .hdr-chip')).toHaveText(['Canteen Code']);
    await confirmMapping(page);
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('.modal')).toContainText('3 of 3 rows loaded');
    await expect(page.locator('.modal')).toContainText('Ignored unmapped columns: Canteen Code');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-key="headcount_close"] .tile-value')).toHaveText('3');
    await expect(page.locator('[data-key="female_pct"] .tile-value')).toContainText('33.3');
    // the Field Mapping tab shows where each field came from
    await page.click('#tab-fieldmap');
    const fm = page.locator('#panel-fieldmap');
    await expect(fm).toContainText('For IT:');
    await expect(fm).toContainText('integration spec');
    const empRow = fm.locator('#fm-employee_master tr', { hasText: 'employee_id' });
    await expect(empRow).toContainText('Emp Code');
    await expect(empRow).toContainText('Mapped');
    await expect(fm.locator('.fm-unmapped')).toContainText('Canteen Code');
  });

  test('a missing required field blocks Confirm until mapped; the manual choice carries to the next load', async ({ page }) => {
    await page.goto(ARTIFACT);
    const file = write('employee_master.csv', [
      'Employee ID,Name,Asset,Grade Band,Grade,Function,Gender,Birth Dt,Date of Joining,Employee Class',
      'B-1,A,Hazira,Below AM,S1,Operations,Male,01-01-1966,01-01-2015,Permanent',
      'B-2,B,Hazira,Below AM,S1,Operations,Female,01-01-1991,01-01-2016,Permanent'
    ]);
    await page.setInputFiles('#file-input', file);
    await expect(page.locator('#map-step')).toBeVisible();
    await expect(page.locator('#ms-confirm')).toBeDisabled();
    await expect(page.locator('#ms-confirm-bottom')).toBeDisabled();
    await expect(page.locator('#map-step .ms-note-bad')).toContainText('Required field not mapped: DOB');
    await expect(page.locator('#ms-status')).toContainText('1 file blocked');
    await expect(page.locator('#map-step .ms-card').first()).toHaveClass(/ms-bad/);
    // clicking the disabled button does nothing
    await page.locator('#ms-confirm').click({ force: true });
    await expect(page.locator('#app')).toBeHidden();
    // skipping the only file still leaves nothing to confirm
    await page.selectOption('[data-ms-template="0"]', '');
    await expect(page.locator('#ms-status')).toContainText('No file is assigned');
    await expect(page.locator('#ms-confirm')).toBeDisabled();
    await page.selectOption('[data-ms-template="0"]', 'employee_master');
    // map DOB by hand
    await row(page, 'dob').locator('select').selectOption({ label: 'Birth Dt' });
    await expect(row(page, 'dob').locator('.ms-chip-manual')).toHaveText('manual');
    await expect(row(page, 'dob').locator('select')).toBeFocused();
    await expect(page.locator('#map-step .ms-note-bad')).toHaveCount(0);
    await confirmMapping(page);
    await expect(page.locator('.modal')).toContainText('2 of 2 rows loaded');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Compute.metric('near_retirement_pct').value)).toBeCloseTo(50, 6);
    // the same file again (Load / add files): DOB is pre-mapped from this session
    await page.click('#btn-add');
    await page.setInputFiles('#file-input', file);
    await expect(page.locator('#map-step')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    await expect(row(page, 'dob').locator('.ms-chip-manual')).toHaveText('manual');
    await expect(page.locator('#ms-confirm')).toBeEnabled();
    // Back from an incremental add returns to the dashboard unchanged
    await page.click('[data-ms-back]');
    await expect(page.locator('#app')).toBeVisible();
    expect(await page.evaluate(() => [...App.state.datasets.keys()])).toEqual(['employee_master']);
  });

  test('keyboard: arrowing through a field\'s options never strips other fields; moving on commits the pick', async ({ page }) => {
    await page.goto(ARTIFACT);
    await page.setInputFiles('#file-input', write('employee_master.csv', [
      'Employee ID,Name,Asset,Grade Band,Grade,Function,Gender,Birth Dt,Date of Joining,Employee Class',
      'K-1,A,Hazira,Below AM,S1,Operations,Male,01-01-1966,01-01-2015,Permanent',
      'K-2,B,Hazira,Below AM,S1,Operations,Female,01-01-1991,01-01-2016,Permanent'
    ]));
    await expect(page.locator('#map-step')).toBeVisible();
    const sel = (key) => row(page, key).locator('select');
    await sel('dob').focus();
    // a closed <select> changes value (and fires change) on every arrow key:
    // this walks DOB past every other field's header, then back to "Birth Dt"
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
    await expect(sel('dob')).toBeFocused();
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowUp');
    await expect(sel('dob').locator('option:checked')).toHaveText('Birth Dt');
    await page.keyboard.press('Tab');
    for (const [k, h] of [['employee_id', 'Employee ID'], ['name', 'Name'], ['asset', 'Asset'], ['grade_band', 'Grade Band'],
      ['grade', 'Grade'], ['function', 'Function'], ['gender', 'Gender'], ['doj', 'Date of Joining'], ['employee_class', 'Employee Class']]) {
      await expect(sel(k).locator('option:checked'), k).toHaveText(h);
    }
    await expect(page.locator('#ms-confirm')).toBeEnabled();
    // a pick that takes another field's header is kept once focus moves on
    await sel('doj').selectOption({ label: 'Birth Dt' });
    await page.locator('#ms-title').focus();
    await expect(sel('dob').locator('option:checked')).toHaveText('— unmapped —');
    await expect(page.locator('#ms-confirm')).toBeDisabled();
    // browsing the template list and coming back keeps the manual picks
    await sel('dob').selectOption({ label: 'Date of Joining' });
    await page.locator('[data-ms-template="0"]').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-ms-template="0"]')).not.toHaveValue('employee_master');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[data-ms-template="0"]')).toHaveValue('employee_master');
    await expect(sel('dob').locator('option:checked')).toHaveText('Date of Joining');
    await expect(sel('doj').locator('option:checked')).toHaveText('Birth Dt');
  });

  test('a scope-locked persona sees no personal sample values on the mapping step', async ({ page }) => {
    await page.goto(ARTIFACT);
    await page.selectOption('#gate-persona', 'asset_head');
    await page.selectOption('#gate-persona-asset', 'Vizag');
    await page.click('#gate-mock');
    await expect(page.locator('#map-step')).toBeVisible();
    // rows are not scoped before mapping: IDs / names from other assets must not show
    for (const k of ['employee_id', 'name']) {
      await expect(page.locator(`[data-ms-file="0"] tr[data-ms-key="${k}"] .ms-samples`)).toHaveText('withheld (personal data)');
    }
    // ... nor any other raw value: peer-asset rows would show through otherwise
    await expect(page.locator('[data-ms-file="0"] tr[data-ms-key="asset"] .ms-samples')).toHaveText('withheld (rows not yet scoped)');
    expect(await page.locator('#map-step .ms-sample').count()).toBe(0);
    await confirmMapping(page);
    await expect(page.locator('#app')).toBeVisible();
  });

  test('an unscoped persona sees no samples of columns that feed only restricted metrics', async ({ page }) => {
    await page.goto(ARTIFACT);
    await page.selectOption('#gate-persona', 'coe_ta');
    await page.click('#gate-mock');
    await expect(page.locator('#map-step')).toBeVisible();
    const r = await page.evaluate(() => {
      const out = {};
      for (const card of document.querySelectorAll('#map-step details.ms-card')) {
        const id = SCHEMA_IDS.find((s) => card.querySelector('.ms-tpl').textContent.startsWith('→ ' + s + '.csv '));
        for (const tr of card.querySelectorAll('tr[data-ms-key]')) {
          const col = SCHEMAS[id].columns.find((c) => c.key === tr.dataset.msKey);
          const used = Mapping.consumers(id, col.name);
          out[id + '.' + col.key] = { shown: !!tr.querySelector('.ms-sample'), hidden: used.length > 0 && used.every((k) => Access.level(k) !== 'full') };
        }
      }
      return out;
    });
    // wellbeing and cost are hidden for TA COE: their values never reach the page
    for (const k of ['wellbeing.distress', 'production_safety.employee_cost']) expect(r[k], k).toEqual({ shown: false, hidden: true });
    for (const [k, v] of Object.entries(r)) if (v.hidden) expect(v.shown, k).toBe(false);
    expect(Object.values(r).some((v) => v.shown)).toBe(true);
  });

  test('a manual pick on the canonical mock does not seed later real loads', async ({ page }) => {
    await page.goto(ARTIFACT);
    await page.click('#gate-mock');
    await page.click('details.ms-card[data-ms-file="0"] summary');
    await row(page, 'name').locator('select').selectOption({ label: 'Grade' });
    await expect(row(page, 'name').locator('.ms-chip-manual')).toHaveText('manual');
    await confirmMapping(page);
    expect(await page.evaluate(() => Mapping.hasSeeds())).toBe(false);
  });

  test('field_map.csv export: spec headers, one row per template column, statuses and editable source system', async ({ page }) => {
    await page.goto(ARTIFACT);
    await page.setInputFiles('#file-input', write('hr_extract.csv', RENAMED));
    await confirmMapping(page);
    await page.keyboard.press('Escape');
    await page.click('#tab-fieldmap');
    const src = page.locator('[data-fm-source="employee_master"]');
    await expect(src).toHaveValue('HRMS');
    await src.fill('SAP HCM');
    await src.press('Tab');
    const csv = await download(page, () => page.click('[data-fm-export]'));
    expect(csv.name).toBe('field_map.csv');
    const lines = csv.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Template,Template Column,Source System,Source Field/Header,Required,Type,Status,Used by metrics');
    const total = await page.evaluate(() => SCHEMA_IDS.reduce((s, id) => s + SCHEMAS[id].columns.length, 0));
    expect(lines.length).toBe(total + 1);
    const find = (tpl, col) => lines.find((l) => l.startsWith(`${tpl},${col},`));
    expect(find('employee_master.csv', 'Employee ID')).toMatch(/^employee_master\.csv,Employee ID,SAP HCM,Emp Code,Yes,Identifier \(text\),Mapped,/);
    expect(find('employee_master.csv', 'Manager ID')).toContain(',Optional,');
    expect(find('exits.csv', 'Exit Type')).toMatch(/^exits\.csv,Exit Type,HRMS,,Yes,.*,Not loaded,attr_annualised/);
    expect(find('contract_attendance.csv', 'Contractor')).toContain(',SCRUM,');
  });

  test('field_map.csv import pre-seeds the next load (gate import, and a map dropped with the data)', async ({ page }) => {
    await page.goto(ARTIFACT);
    const map = write('field_map.csv', [
      'Template,Template Column,Source System,Source Field/Header,Required,Type,Status,Used by metrics',
      'employee_master.csv,Employee ID,SAP HCM,Staff Number,Yes,Identifier (text),Mapped,',
      'employee_master.csv,Date of Joining,SAP HCM,Hire Dt,Yes,Date (DD-MM-YYYY),Mapped,',
      'exits.csv,Exit Date,,Leaving On,Yes,Date,Not loaded,',
      'nonsense.csv,Whatever,,X,No,,,'
    ]);
    await page.setInputFiles('#fieldmap-input', map);
    await expect(page.locator('.modal')).toContainText('3 source headers for 2 templates');
    await expect(page.locator('.modal')).toContainText('1 source-system label');
    await expect(page.locator('.modal')).toContainText('1 row not recognised');
    await page.keyboard.press('Escape');
    const data = write('staff.csv', [
      'Staff Number,Name,Asset,Grade Band,Function,Gender,DOB,Hire Dt,Employee Class',
      'S-1,A,Vizag,Below AM,Operations,Female,01-01-1990,01-01-2015,Permanent',
      'S-2,B,Vizag,Below AM,Operations,Male,01-01-1991,01-01-2016,Permanent'
    ]);
    await page.setInputFiles('#file-input', data);
    await expect(page.locator('[data-ms-template="0"]')).toHaveValue('employee_master');
    await expect(row(page, 'employee_id').locator('.ms-chip-manual')).toHaveText('imported');
    await expect(row(page, 'doj').locator('.ms-chip-manual')).toHaveText('imported');
    await expect(page.locator('#map-step .ms-intro')).toContainText('imported field_map.csv');
    await confirmMapping(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-key="headcount_close"] .tile-value')).toHaveText('2');
    await page.click('#tab-fieldmap');
    await expect(page.locator('[data-fm-source="employee_master"]')).toHaveValue('SAP HCM');
    // exits is not loaded: the seeded header shows for the next load
    await expect(page.locator('#panel-fieldmap')).toContainText('next load:');
    // a field map dropped together with a data file seeds that same batch
    const exitsMap = write('field_map.csv', [
      'Template,Template Column,Source System,Source Field/Header',
      'exits.csv,Employee ID,HRMS,Leaver Code',
      'exits.csv,Exit Type,HRMS,Separation Kind'
    ]);
    const exitsData = write('leavers.csv', [
      'Leaver Code,Leaving On,Separation Kind',
      'S-2,15-05-2025,Voluntary'
    ]);
    await page.click('#btn-add');
    await page.setInputFiles('#file-input', [exitsMap, exitsData]);
    await expect(page.locator('#map-step .ms-card')).toHaveCount(1);
    await expect(page.locator('#map-step .ms-intro')).toContainText('field map imported');
    await expect(page.locator('[data-ms-template="0"]')).toHaveValue('exits');
    for (const k of ['employee_id', 'exit_date', 'exit_type']) await expect(row(page, k).locator('.ms-chip-manual')).toHaveText('imported');
    await confirmMapping(page);
    await expect(page.locator('.modal')).toContainText('1 of 1 rows loaded');
    expect(await page.evaluate(() => [...App.state.datasets.keys()].sort())).toEqual(['employee_master', 'exits']);
  });
});
