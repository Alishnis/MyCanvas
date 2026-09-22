// Everything that talks to the local proxy, plus the derived course figures.

import { MS_DAY } from './util.js';

// ---------------------------------------------------------------- data layer

export const state = {
  config: null, profile: null, courses: null,
  groups: new Map(), docs: new Map(), pages: new Map(),
};
/** Cross-view switches: Refresh sets `fresh`, the orgs toggle sets `showOrgs`. */
export const prefs = {
  fresh: false,
  showOrgs: localStorage.getItem('showOrgs') === '1',
};

export async function api(path, { all = false } = {}) {
  const qs = new URLSearchParams();
  const [base, rawQuery] = path.split('?');
  if (rawQuery) for (const [k, v] of new URLSearchParams(rawQuery)) qs.append(k, v);
  if (all) qs.set('_all', '1');
  if (prefs.fresh) qs.set('_fresh', '1');

  const res = await fetch(`/api${base}?${qs.toString()}`);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.detail = body.detail;
    err.hint = body.hint;
    err.status = res.status;
    throw err;
  }
  return body;
}

/**
 * Active enrolments, split into real academic courses and the administrative
 * shells Canvas also enrols you in (safety training, scholarship notice boards,
 * department announcements). Academic terms have an end date; the catch-all
 * "Organizations" term does not — that is the only reliable signal Canvas gives.
 */
export async function getCourses() {
  if (state.courses && !prefs.fresh) return state.courses;
  const raw = await api(
    '/courses?enrollment_state=active&include[]=term&include[]=total_scores'
      + '&include[]=teachers&include[]=syllabus_body',
    { all: true },
  );
  const all = (Array.isArray(raw) ? raw : [])
    .filter((c) => c && c.id && !c.access_restricted_by_date)
    .sort((a, b) => (a.course_code || a.name || '').localeCompare(b.course_code || b.name || ''));

  state.courses = {
    all,
    real: all.filter((c) => c.term?.end_at),
    orgs: all.filter((c) => !c.term?.end_at),
  };
  return state.courses;
}

/**
 * One request per course serves every view: assignment groups carry their
 * weights, their assignments and your submission for each.
 */
export async function getGroups(courseId) {
  if (!prefs.fresh && state.groups.has(courseId)) return state.groups.get(courseId);
  const g = await api(
    `/courses/${courseId}/assignment_groups?include[]=assignments&include[]=submission`,
    { all: true },
  );
  const list = Array.isArray(g) ? g : [];
  state.groups.set(courseId, list);
  return list;
}

export const flatten = (groups) => groups.flatMap((g) => g.assignments || []);

/**
 * Per-group and overall standing, computed from graded submissions.
 *
 * CityU sets `hide_final_grades`, so Canvas never sends a computed total for
 * this account — but it does send every individual score, so the standing is
 * recomputed here. It reflects graded work only, not the eventual final grade.
 */
export function analyse(groups) {
  const rows = groups.map((grp) => {
    const list = grp.assignments || [];
    let earned = 0, possible = 0, totalPoints = 0, gradedCount = 0;
    for (const a of list) {
      totalPoints += a.points_possible || 0;
      const s = a.submission;
      if (s && !s.excused && s.workflow_state === 'graded' && s.score != null && a.points_possible) {
        earned += s.score;
        possible += a.points_possible;
        gradedCount++;
      }
    }
    return {
      grp, list, weight: grp.group_weight ?? 0,
      earned, possible, totalPoints, gradedCount,
      ratio: possible ? (earned / possible) * 100 : null,
    };
  });

  const weightSum = rows.reduce((t, r) => t + r.weight, 0);
  const weighted = weightSum > 0;
  const scored = rows.filter((r) => r.possible > 0);

  let score = null;
  let countedItems = 0;
  // How much of the final grade has actually been decided. Zero-weight groups
  // (practice sets) are excluded — they move no part of the course.
  const counted = weighted ? scored.filter((r) => r.weight > 0) : scored;
  const coveredWeight = counted.reduce((t, r) => t + r.weight, 0);

  if (counted.length) {
    countedItems = counted.reduce((t, r) => t + r.gradedCount, 0);
    if (weighted && coveredWeight > 0) {
      // Re-normalise over the groups that actually have marks back.
      score = (counted.reduce((t, r) => t + r.weight * (r.earned / r.possible), 0) / coveredWeight) * 100;
    } else {
      const e = counted.reduce((t, r) => t + r.earned, 0);
      const p = counted.reduce((t, r) => t + r.possible, 0);
      score = p ? (e / p) * 100 : null;
    }
  }

  return {
    rows, weighted, weightSum, score, countedItems,
    // Share of the course the standing is based on, normalised if weights ≠ 100.
    coverage: weighted && weightSum > 0 ? (coveredWeight / weightSum) * 100 : null,
    gradedCount: rows.reduce((t, r) => t + r.gradedCount, 0),
    totalCount: rows.reduce((t, r) => t + r.list.length, 0),
    earned: rows.reduce((t, r) => t + r.earned, 0),
    possible: rows.reduce((t, r) => t + r.possible, 0),
  };
}

/** Canvas's own figure when the institution publishes it, otherwise ours. */
export function officialGrade(course) {
  const e = (course.enrollments || []).find((x) => x.computed_current_score != null);
  return e ? { score: e.computed_current_score, letter: e.computed_current_grade ?? null } : null;
}


/** Load every course's groups at once, reporting progress into a node. */
export async function loadAll(courses, node, verb = 'Loading assignments') {
  let done = 0;
  return Promise.allSettled(courses.map((c) =>
    getGroups(c.id).finally(() => {
      done++;
      if (node) node.textContent = `${verb}… ${done} of ${courses.length} courses`;
    })));
}

/** Recent announcements across courses — where postponements get announced. */
export async function getAnnouncements(courses, days = 60) {
  if (!courses.length) return [];
  const ctx = courses.map((c) => `context_codes[]=course_${c.id}`).join('&');
  // Canvas needs both ends of the window: given only a start it quietly answers
  // for the fortnight after it, which for a back-dated start is always empty.
  const day = (offset) => new Date(Date.now() + offset * MS_DAY).toISOString().slice(0, 10);
  const raw = await api(`/announcements?${ctx}&start_date=${day(-days)}&end_date=${day(7)}&per_page=50`, { all: true })
    .catch(() => []);
  const byCode = new Map(courses.map((c) => [`course_${c.id}`, c]));
  return (Array.isArray(raw) ? raw : [])
    .map((a) => ({ a, course: byCode.get(a.context_code) }))
    .filter((x) => x.course && x.a.posted_at)
    .sort((x, y) => new Date(y.a.posted_at) - new Date(x.a.posted_at));
}

/**
 * The document a course actually describes itself in. Most courses use the
 * syllabus page; a few leave it empty and put everything on the front page.
 */
export async function getCourseDoc(course) {
  if (state.docs.has(course.id)) return state.docs.get(course.id);
  let doc = null;
  if (course.syllabus_body && course.syllabus_body.trim()) {
    doc = { html: course.syllabus_body, source: 'Syllabus', url: `/courses/${course.id}/assignments/syllabus` };
  } else {
    const page = await api(`/courses/${course.id}/front_page`).catch(() => null);
    if (page?.body && page.body.trim()) {
      doc = { html: page.body, source: page.title || 'Front page', url: `/courses/${course.id}` };
    }
  }
  state.docs.set(course.id, doc);
  return doc;
}

// ---------------------------------------------------------------- course content

/** Cache anything that is expensive and never changes mid-session. */
async function cached(key, load) {
  if (!prefs.fresh && state.pages.has(key)) return state.pages.get(key);
  const value = await load();
  state.pages.set(key, value);
  return value;
}

/**
 * Courses can switch whole sections off for students, and Canvas answers 403
 * or 404 rather than an empty list. Keep the difference — "nothing here" and
 * "you are not allowed to see this" are different things to tell someone.
 */
const safeList = (load) => load()
  .then((l) => ({ list: Array.isArray(l) ? l : [], error: null }))
  .catch((err) => ({ list: [], error: [403, 404].includes(err?.status) ? 'hidden' : 'failed' }));

/** The course's own structure: modules in order, each with its items. */
export const getModules = (courseId) =>
  cached(`modules:${courseId}`, () => safeList(() =>
    api(`/courses/${courseId}/modules?include[]=items&include[]=content_details`, { all: true })));

/** Every file in the course, newest first, with the folder it sits in. */
export const getFiles = (courseId) =>
  cached(`files:${courseId}`, async () => {
    const [files, folders] = await Promise.all([
      safeList(() => api(`/courses/${courseId}/files?sort=updated_at&order=desc`, { all: true })),
      safeList(() => api(`/courses/${courseId}/folders`, { all: true })),
    ]);
    const names = new Map(folders.list.map((f) => [f.id, (f.full_name || '').replace(/^course files\/?/, '')]));
    return {
      error: files.error,
      list: files.list.map((f) => ({ ...f, folder: names.get(f.folder_id) || '' })),
    };
  });

/** The course record itself, with the syllabus and the term attached. */
export const getCourseDetail = (id) =>
  cached(`course:${id}`, () => api(`/courses/${id}?include[]=syllabus_body&include[]=term&include[]=total_scores&include[]=teachers`));

export const getStandards = (id) =>
  cached(`standards:${id}`, () => api(`/courses/${id}/grading_standards`).catch(() => []));

export const getPage = (courseId, slug) =>
  cached(`page:${courseId}:${slug}`, () => api(`/courses/${courseId}/pages/${encodeURIComponent(slug)}`));

/** One assignment with its description, rubric and your own submission. */
export const getAssignment = (courseId, id) =>
  cached(`assignment:${courseId}:${id}`, async () => {
    const [assignment, submission] = await Promise.all([
      api(`/courses/${courseId}/assignments/${id}?include[]=submission`),
      api(`/courses/${courseId}/assignments/${id}/submissions/self`
        + '?include[]=submission_comments&include[]=rubric_assessment&include[]=submission_history')
        .catch(() => null),
    ]);
    return { assignment, submission: submission || assignment.submission || null };
  });

/** Discussion topics, minus announcements — Canvas keeps those separate. */
export const getDiscussions = (courseId) =>
  cached(`discussions:${courseId}`, () => safeList(() =>
    api(`/courses/${courseId}/discussion_topics`, { all: true })));

/** One topic plus its replies, threaded as Canvas nests them. */
export const getDiscussion = (courseId, topicId) =>
  cached(`discussion:${courseId}:${topicId}`, async () => {
    const [topic, thread] = await Promise.all([
      api(`/courses/${courseId}/discussion_topics/${topicId}`),
      api(`/courses/${courseId}/discussion_topics/${topicId}/view`).catch(() => null),
    ]);
    return { topic, thread };
  });

// ---------------------------------------------------------------- inbox

export const getConversations = () =>
  cached('conversations', () =>
    api('/conversations?per_page=50', { all: true }).then((c) => (Array.isArray(c) ? c : [])));

/**
 * One thread with every message in it. `auto_mark_as_read=false` keeps this
 * client read-only — opening a thread here does not clear its unread flag.
 */
export const getConversation = (id) =>
  cached(`conversation:${id}`, () => api(`/conversations/${id}?auto_mark_as_read=false`));
