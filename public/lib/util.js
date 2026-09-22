// Pure helpers: escaping, numbers, dates, teaching weeks, HTML sanitising.

// ---------------------------------------------------------------- helpers

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Deterministic hue per course, so a course keeps its colour between reloads. */
export function hueOf(id) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export const num = (n) => (n == null ? '—' : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
export const pct = (n) => (n == null ? '—' : `${Math.round(n * 10) / 10}%`);

export const MS_DAY = 86_400_000;
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const daysFromToday = (d) => Math.round((startOfDay(d) - startOfDay(new Date())) / MS_DAY);

export function fmtDue(iso) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const diff = daysFromToday(d);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Tomorrow, ${time}`;
  if (diff === -1) return `Yesterday, ${time}`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString([], { weekday: 'short' })}, ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time}`;
}

export function bucketOf(iso) {
  const diff = daysFromToday(iso);
  if (new Date(iso) < new Date()) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff <= 7) return 'This week';
  return 'Later';
}

export const BUCKETS = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later'];

/** Turn one assignment into a status badge, or null when there is nothing to say. */
export function statusOf(a, { withScore = true } = {}) {
  const s = a.submission;
  if (s?.excused) return { text: 'Excused', cls: '' };
  if (s?.workflow_state === 'graded' && s.score != null) {
    return { text: withScore ? `${num(s.score)} / ${num(a.points_possible)}` : 'Graded', cls: 'graded' };
  }
  if (s?.submitted_at) return { text: 'Submitted', cls: 'ok' };
  if (s?.missing) return { text: 'Missing', cls: 'miss' };
  if (a.due_at && new Date(a.due_at) < new Date()) return { text: 'Not submitted', cls: 'miss' };
  return null;
}

/**
 * CityU prefixes course codes with the term ("202609CS1302A"), which is the
 * part that gets truncated in a chip. Drop it — the term is shown elsewhere.
 */
export const shortCode = (c) => (c.course_code || c.name || '').replace(/^\d{6}/, '') || '—';

/** Teaching staff, capped — one first-year course here lists eleven of them. */
export const teacherLine = (c, max = 3) => {
  const names = (c.teachers || []).map((t) => t.display_name);
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max} more` : names.join(', ');
};

export const isDone = (a) => Boolean(a.submission?.submitted_at || a.submission?.excused || a.submission?.workflow_state === 'graded');

/**
 * CityU teaching weeks. Canvas only exposes the term's administrative start
 * (10 Aug), which is not when teaching begins, so Week 1 is anchored by hand:
 * Semester A 2026/27 has Week 1 = Mon 31 Aug (classes from Tue 1 Sep), and
 * every week runs Monday to Sunday from there.
 */
export const WEEK1_MONDAY = new Date(2026, 7, 31);

export function weekOf(iso) {
  const n = Math.floor((startOfDay(iso) - WEEK1_MONDAY) / (7 * MS_DAY)) + 1;
  return n >= 1 && n <= 20 ? n : null;
}

/** Day and time kept apart, so a narrow screen can stack them. */
export const fmtFull = (iso) => {
  const d = new Date(iso);
  return `<span class="d">${esc(d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</span>` +
    `<span class="t">${esc(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }))}</span>`;
};

export const monthOf = (iso) => new Date(iso).toLocaleDateString([], { month: 'long', year: 'numeric' });

export const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });

/** Earliest and latest due date in a list, rendered as one "when" cell. */
export function spanOf(list) {
  const dates = list.filter((a) => a.due_at).map((a) => a.due_at).sort();
  if (!dates.length) return '';
  const first = fmtDay(dates[0]);
  const last = fmtDay(dates[dates.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

// ------------------------------------------------- course documents (HTML)

// Teachers write syllabus pages in Canvas's rich editor, so the HTML carries
// whatever it carries — LTI iframes, inline styles, tracking pixels. Keep the
// structure, drop everything that can execute, load or restyle.
export const KEEP = new Set(['P', 'BR', 'HR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUP', 'SUB', 'SMALL',
  'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION',
  'A', 'IMG', 'BLOCKQUOTE', 'CODE', 'PRE', 'SPAN', 'DIV']);
export const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO',
  'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'SVG', 'CANVAS']);

/**
 * Canvas serves course images and attachments from URLs that need the token,
 * so they would come back blank in an <img>. The local proxy streams them at
 * /file/:id instead — same bytes, no credentials in the page.
 */
const CANVAS_FILE = /\/(?:courses\/\d+\/)?files\/(\d+)\b/;
const localFile = (u) => {
  const m = CANVAS_FILE.exec(u || '');
  return m ? `/file/${m[1]}` : null;
};

/**
 * Course HTML is full of links back into Canvas — the next page of a module,
 * the assignment it is talking about. Point them at the same thing here, so a
 * module can be read end to end without leaving.
 */
const INTERNAL = [
  [/\/courses\/(\d+)\/pages\/([^/?#]+)/, (id, slug) => `#/course/${id}/page/${slug}`],
  [/\/courses\/(\d+)\/assignments\/(\d+)/, (id, aid) => `#/course/${id}/a/${aid}`],
  [/\/courses\/(\d+)(?:\/)?$/, (id) => `#/course/${id}`],
];
const localRoute = (u) => {
  for (const [re, build] of INTERNAL) {
    const m = re.exec(u || '');
    if (m) return build(...m.slice(1));
  }
  return null;
};

export function sanitize(html, base) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');

  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (!el.isConnected) continue;
    if (DROP.has(el.tagName)) { el.remove(); continue; }
    if (!KEEP.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }

    const href = el.tagName === 'A' ? el.getAttribute('href') : null;
    const src = el.tagName === 'IMG' ? el.getAttribute('src') : null;
    const alt = el.getAttribute('alt');
    const span = { colspan: el.getAttribute('colspan'), rowspan: el.getAttribute('rowspan') };
    for (const { name } of [...el.attributes]) el.removeAttribute(name);

    const abs = (u) => {
      try {
        const url = new URL(u, base || location.origin);
        return /^https?:$/.test(url.protocol) ? url.href : null;
      } catch { return null; }
    };
    if (href && abs(href)) {
      const inApp = localRoute(abs(href));
      el.setAttribute('href', inApp || localFile(abs(href)) || abs(href));
      if (!inApp) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
      }
    }
    if (src && abs(src)) {
      el.setAttribute('src', localFile(abs(src)) || abs(src));
      el.setAttribute('loading', 'lazy');
    }
    if (src && !abs(src)) el.remove();
    if (alt) el.setAttribute('alt', alt);
    if (span.colspan) el.setAttribute('colspan', span.colspan);
    if (span.rowspan) el.setAttribute('rowspan', span.rowspan);
  }
  return doc.body.innerHTML;
}

/**
 * The lines of a course document that mention a percentage. On this account
 * only one course sets real weights in Canvas, so for everything else the
 * split lives in prose — this pulls it out verbatim rather than guessing.
 */
export function policyLines(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const out = [];
  for (const el of doc.querySelectorAll('li, p, td, h2, h3, h4')) {
    if (el.querySelector('li, p, td')) continue; // innermost block only
    const t = el.textContent.replace(/\s+/g, ' ').trim();
    if (t.length > 220 || !/\d\s*%/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 8);
}
