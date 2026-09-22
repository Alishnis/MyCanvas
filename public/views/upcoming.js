import { esc, num, MS_DAY, daysFromToday, fmtDue, bucketOf, BUCKETS, statusOf, shortCode, isDone } from '../lib/util.js';
import { prefs, getCourses, flatten, loadAll } from '../lib/api.js';
import { view, chip, skeleton } from '../lib/ui.js';

// ---------------------------------------------------------------- view: upcoming

export async function viewUpcoming() {
  document.title = 'Upcoming · Canvas';
  view.innerHTML = `<h1>Upcoming</h1><p class="sub">Loading assignments…</p>${skeleton()}`;

  const { real, orgs } = await getCourses();
  const courses = prefs.showOrgs ? real.concat(orgs) : real;
  if (!courses.length) {
    view.innerHTML = `<h1>Upcoming</h1><div class="empty">No active courses found on this account.</div>`;
    return;
  }

  // Courses arrive at wildly different speeds — a notice board with dozens of
  // items can take seconds — so report progress instead of a frozen skeleton.
  const settled = await loadAll(courses, view.querySelector('.sub'));

  const failed = [];
  const items = [];
  const now = Date.now();

  settled.forEach((r, i) => {
    const course = courses[i];
    if (r.status === 'rejected') { failed.push(shortCode(course)); return; }
    for (const a of flatten(r.value)) {
      if (!a.due_at || a.published === false) continue;
      const due = new Date(a.due_at).getTime();
      // Keep everything ahead, plus recent overdue work that is still not handed in.
      if (due < now && (isDone(a) || now - due > 30 * MS_DAY)) continue;
      items.push({ a, course });
    }
  });

  items.sort((x, y) => new Date(x.a.due_at) - new Date(y.a.due_at));

  const groups = new Map(BUCKETS.map((b) => [b, []]));
  for (const it of items) groups.get(bucketOf(it.a.due_at)).push(it);

  const sections = BUCKETS.filter((b) => groups.get(b).length).map((b) => {
    const rows = groups.get(b).map(({ a, course }) => {
      const st = statusOf(a);
      const dueCls = b === 'Overdue' ? 'late' : daysFromToday(a.due_at) <= 1 ? 'soon' : '';
      return `
        <div class="row">
          ${chip(course)}
          <div class="row-main">
            <a class="row-title" href="#/course/${course.id}/a/${a.id}">${esc(a.name)}</a>
            <div class="row-meta">
              <span>${esc(course.name)}</span>
              ${a.points_possible ? `<span>${num(a.points_possible)} pts</span>` : ''}
            </div>
          </div>
          <div class="row-right">
            <div class="due ${dueCls}">${fmtDue(a.due_at)}</div>
            ${st ? `<span class="badge ${st.cls}">${esc(st.text)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
    return `
      <div class="group-head"><h2>${b}</h2><span class="count">${groups.get(b).length}</span></div>
      <div class="rows">${rows}</div>`;
  }).join('');

  view.innerHTML = `
    <h1>Upcoming</h1>
    <p class="sub">
      ${items.length} open ${items.length === 1 ? 'item' : 'items'} across ${courses.length} ${courses.length === 1 ? 'course' : 'courses'}.
      ${orgs.length ? `<a class="toggle" href="#" data-toggle-orgs>${prefs.showOrgs ? 'Hide' : 'Include'} ${orgs.length} admin ${orgs.length === 1 ? 'shell' : 'shells'}</a>` : ''}
    </p>
    ${failed.length ? `<div class="note">Could not load assignments for: ${esc(failed.join(', '))}.</div>` : ''}
    ${sections || '<div class="empty">Nothing due. Enjoy it.</div>'}`;
}
