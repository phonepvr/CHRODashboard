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
  mockSeed: 987654321
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

const AS_OF_DAY = parseDMY(CONFIG.asOf);
const AS_OF_MONTH = dayToMonthIdx(AS_OF_DAY);

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
