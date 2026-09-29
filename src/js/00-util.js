/* Utilities + global configuration. No storage APIs, no network — ever. */

const CONFIG = {
  // The one place the illustrative as-of date lives (DD-MM-YYYY).
  asOf: '30-06-2025',
  periodLabel: 'FY-Q1 (illustrative)',
  retirementAge: 58,          // configurable superannuation age
  historyMonths: 30,          // months of monthly history in mock data
  assets: ['Hazira', 'Paradeep', 'Vizag', 'Kirandul'],
  gradeBands: ['Below AM', 'AM-GM', 'VP & above'],
  bandLabels: { 'Below AM': 'Below AM', 'AM-GM': 'AM–GM', 'VP & above': 'VP & above' },
  mockSeed: 987654321,

  fyStartMonth: 4,            // fiscal year starts in April; set 1 for calendar year
  segments: ['Operations', 'Projects'],
  companies: ['Company A', 'Company B', 'Company C'],   // generic legal-entity placeholders
  assetHomeState: { Hazira: 'Gujarat', Paradeep: 'Odisha', Vizag: 'Andhra Pradesh', Kirandul: 'Chhattisgarh' },
  mgmtBands: ['SM', 'MM', 'JM', 'Blue Collar'],
  mgmtBandLabels: { SM: 'Senior management', MM: 'Middle management', JM: 'Junior management', 'Blue Collar': 'Blue collar' },
  // grade ladder, senior → junior; GET = graduate engineer trainee
  levels: ['M-2', 'M-3', 'M-4', 'M-5', 'M-6', 'M-7', 'M-8', 'M-9', 'M-10', 'M-11', 'GET'],
  // buckets are [label, lo, hi) — lo inclusive, hi exclusive
  scopeBuckets: [['1–2', 1, 3], ['3–5', 3, 6], ['6–10', 6, 11], ['11–20', 11, 21], ['21+', 21, Infinity]],
  tenureBuckets: [['0–6M', 0, 0.5], ['6–12M', 0.5, 1], ['1–2Y', 1, 2], ['2–3Y', 2, 3], ['3–5Y', 3, 5], ['5–10Y', 5, 10], ['10Y+', 10, Infinity]],
  superannBuckets: [['<3M', 0, 3], ['3–6M', 3, 6], ['6–12M', 6, 12], ['1–2Y', 12, 24], ['2–3Y', 24, 36]], // months to superannuation
  generations: [['Boomer', -Infinity, 1965], ['Gen X', 1965, 1981], ['Millennial', 1981, 1997], ['Gen Z', 1997, Infinity]], // birth year
  taAgeingBuckets: [['0–30', 0, 31], ['31–60', 31, 61], ['61–90', 61, 91], ['91–180', 91, 181], ['181–365', 181, 366], ['365+', 366, Infinity]], // days open
  minCell: 5                  // small-cell suppression threshold for persona-restricted cuts
};

/* ---------- strings & formatting ---------- */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Indian digit grouping (12,34,567) — the audience reads lakh/crore grouping.
function fmtInt(n) {
  if (n == null || !isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-IN');
}

function fmtNum(n, decimals = 1) {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n, decimals = 1) {
  if (n == null || !isFinite(n)) return '—';
  return fmtNum(n, decimals) + '%';
}

// Compact rupee formatting: 1.2 Cr / 34 L / 12k
function fmtINR(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + fmtNum(n / 1e7, 1) + ' Cr';
  if (a >= 1e5) return '₹' + fmtNum(n / 1e5, 1) + ' L';
  if (a >= 1e3) return '₹' + fmtNum(n / 1e3, 0) + 'k';
  return '₹' + fmtNum(n, 0);
}

/* ---------- dates: epoch days + month keys ---------- */

const MS_DAY = 86400000;

// strict DD-MM-YYYY -> days since 1970-01-01 UTC, or null
function parseDMY(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || y < 1900 || y > 2100) return null;
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1) return null; // rejects 31-02-…
  return Math.floor(t / MS_DAY);
}

// strict MM-YYYY -> month index (y*12 + m0), or null
function parseMY(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mo = +m[1], y = +m[2];
  if (mo < 1 || mo > 12 || y < 1900 || y > 2100) return null;
  return y * 12 + (mo - 1);
}

function dayToDate(day) { return new Date(day * MS_DAY); }
function fmtDMY(day) {
  if (day == null) return '—';
  const d = dayToDate(day);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}
function makeDay(y, m0, d) { return Math.floor(Date.UTC(y, m0, d) / MS_DAY); }
function dayToMonthIdx(day) {
  const d = dayToDate(day);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}
function monthIdxToLabel(mi) {
  const y = Math.floor(mi / 12), m0 = mi % 12;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m0]} '${String(y % 100).padStart(2, '0')}`;
}
function monthIdxToMY(mi) {
  const y = Math.floor(mi / 12), m0 = mi % 12;
  return `${String(m0 + 1).padStart(2, '0')}-${y}`;
}
function monthEndDay(mi) {
  const y = Math.floor(mi / 12), m0 = mi % 12;
  return makeDay(y, m0 + 1, 1) - 1;
}
function yearsBetween(d1, d2) { return (d2 - d1) / 365.25; }
// Month index in which an employee reaches `age` — exact calendar arithmetic on
// the birthday, so leap-year spans never shift a month-end birthday by a day.
function retireMonthIdx(dobDay, age) {
  const d = dayToDate(dobDay);
  return (d.getUTCFullYear() + age) * 12 + d.getUTCMonth();
}

const AS_OF_DAY = parseDMY(CONFIG.asOf);
const AS_OF_MONTH = dayToMonthIdx(AS_OF_DAY);

// month index of the first month of the fiscal year containing monthIdx
function fyStartMonthIdx(monthIdx) {
  const s0 = CONFIG.fyStartMonth - 1;
  const y = Math.floor(monthIdx / 12), m0 = monthIdx % 12;
  return (m0 >= s0 ? y : y - 1) * 12 + s0;
}

// label of the [label, lo, hi) bucket holding value, or null
function bucketOf(value, buckets) {
  if (value == null || Number.isNaN(value)) return null;
  for (const [label, lo, hi] of buckets) if (value >= lo && value < hi) return label;
  return null;
}

function generationOf(dobDay) {
  if (dobDay == null) return null;
  return bucketOf(dayToDate(dobDay).getUTCFullYear(), CONFIG.generations);
}

/* ---------- PRNG: mulberry32 + string hash ---------- */

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Domain-scoped stream: adding a new generator never reshuffles the others.
function rngFor(domain) { return mulberry32(hash32(CONFIG.mockSeed + ':' + domain)); }

/* ---------- small stats ---------- */

function mean(arr) {
  const v = arr.filter((x) => x != null && isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function median(arr) {
  const v = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
function stdev(arr) {
  const v = arr.filter((x) => x != null && isFinite(x));
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1));
}

/* ---------- local downloads (never a network request) ---------- */

function downloadBlob(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
