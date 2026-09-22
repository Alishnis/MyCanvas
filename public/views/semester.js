import { esc, num, pct, fmtDue, statusOf, shortCode, teacherLine, isDone, weekOf, fmtFull, monthOf, fmtDay } from '../lib/util.js';
import { prefs, getCourses, loadAll, getAnnouncements } from '../lib/api.js';
import { view, chip, skeleton } from '../lib/ui.js';

// ---------------------------------------------------------------- view: semester

export async function viewSemester() {
  document.title = 'Semester · Canvas';
  view.innerHTML = `<h1>Semester</h1><p class="sub">Loading assignments…</p>${skeleton()}`;

  const { real, orgs } = await getCourses();
  const courses = prefs.showOrgs ? real.concat(orgs) : real;
  if (!courses.length) {
    view.innerHTML = `<h1>Semester</h1><div class="empty">No active courses found on this account.</div>`;
    return;
  }

  const settled = await loadAll(courses, view.querySelector('.sub'));
  const termName = real[0]?.term?.name || 'This term';

  const dated = [];
  const undated = new Map();   // course -> assignments with no date
  const silent = [];           // courses that publish nothing at all
  const failed = [];

  settled.forEach((r, i) => {
    const course = courses[i];
    if (r.status === 'rejected') { failed.push(shortCode(course)); return; }
    let count = 0;
    for (const grp of r.value) {
      for (const a of grp.assignments || []) {
        if (a.published === false) continue;
        count++;
        if (a.due_at) dated.push({ a, course, grp });
        else {
          if (!undated.has(course)) undated.set(course, []);
          undated.get(course).push({ a, grp });
        }
      }
    }
    if (!count) silent.push(course);
  });

  dated.sort((x, y) => new Date(x.a.due_at) - new Date(y.a.due_at));

  const now = Date.now();
  const done = dated.filter(({ a }) => isDone(a)).length;
  const ahead = dated.filter(({ a }) => new Date(a.due_at).getTime() >= now);
  const thisWeek = weekOf(new Date());

  // --- one chronological table, split by month ---------------------------
  let month = null;
  const rows = dated.map(({ a, course, grp }) => {
    const head = monthOf(a.due_at) !== month
      ? (month = monthOf(a.due_at), `<tr class="month"><td colspan="7">${esc(month)}</td></tr>`)
      : '';
    const st = statusOf(a);
    const past = new Date(a.due_at).getTime() < now;
    const late = past && !isDone(a);
    const wk = weekOf(a.due_at);
    return `${head}
      <tr class="${past && !late ? 'dim' : ''}">
        <td class="nowrap"><span class="due ${late ? 'late' : ''}">${fmtFull(a.due_at)}</span></td>
        <td class="num wk">${wk ? `W${wk}` : ''}</td>
        <td>${chip(course)}</td>
        <td class="title"><a href="#/course/${course.id}/a/${a.id}">${esc(a.name)}</a></td>
        <td class="soft counts">${esc(grp.name)}${grp.group_weight ? ` · ${pct(grp.group_weight)}` : ''}</td>
        <td class="num pts">${a.points_possible ? num(a.points_possible) : ''}</td>
        <td class="num status">${st ? `<span class="badge ${st.cls}">${esc(st.text)}</span>` : ''}</td>
      </tr>`;
  }).join('');

  // --- what Canvas has no date for ---------------------------------------
  const undatedBlock = undated.size ? `
    <h2>Dated nowhere on Canvas</h2>
    <p class="sub">Published work with no due date set. The deadline usually exists — in a slide deck, an announcement or the lecturer's own site.</p>
    <div class="rows">
      ${[...undated].map(([course, list]) => `
        <div class="row">
          ${chip(course)}
          <div class="row-main">
            <div class="row-title">${esc(course.name)}</div>
            <div class="row-meta"><span>${list.map(({ a }) => esc(a.name)).join(', ')}</span></div>
          </div>
          <div class="row-right"><span class="badge">${list.length}</span></div>
        </div>`).join('')}
    </div>` : '';

  const silentBlock = silent.length ? `
    <h2>Nothing published on Canvas</h2>
    <p class="sub">These courses have no assignments in Canvas at all — coursework is handed in elsewhere, or has not been set up yet.</p>
    <div class="rows">
      ${silent.map((c) => `
        <div class="row">
          ${chip(c)}
          <div class="row-main"><div class="row-title">${esc(c.name)}</div>
          <div class="row-meta"><span>${esc(teacherLine(c, 3) || 'no teacher listed')}</span></div></div>
        </div>`).join('')}
    </div>` : '';

  // --- announcements: the only place a moved deadline shows up ------------
  const news = await getAnnouncements(courses);
  const newsBlock = news.length ? `
    <h2>Recent announcements</h2>
    <p class="sub">Schedule changes land here first — Canvas does not move the due date for you.</p>
    <div class="rows">
      ${news.slice(0, 8).map(({ a, course }) => `
        <div class="row">
          ${chip(course)}
          <div class="row-main">
            <a class="row-title" href="#/course/${course.id}/announcements">${esc(a.title)}</a>
            <div class="row-meta"><span>${esc(fmtDue(a.posted_at))}</span></div>
          </div>
        </div>`).join('')}
    </div>` : '';

  view.innerHTML = `
    <h1>${esc(termName)}</h1>
    <p class="sub">
      Every dated item across ${courses.length} ${courses.length === 1 ? 'course' : 'courses'}, straight from Canvas${thisWeek ? ` · today is teaching week ${thisWeek}` : ''}.
      ${orgs.length ? `<a class="toggle" href="#" data-toggle-orgs>${prefs.showOrgs ? 'Hide' : 'Include'} ${orgs.length} admin ${orgs.length === 1 ? 'shell' : 'shells'}</a>` : ''}
    </p>
    ${failed.length ? `<div class="note">Could not load: ${esc(failed.join(', '))}.</div>` : ''}
    <div class="stats">
      <div class="stat"><span class="v">${dated.length}</span><span class="k">dated items</span></div>
      <div class="stat"><span class="v">${done}</span><span class="k">handed in or graded</span></div>
      <div class="stat"><span class="v">${ahead.length}</span><span class="k">still ahead</span></div>
      <div class="stat"><span class="v">${ahead.length ? esc(fmtDay(ahead[0].a.due_at)) : '—'}</span><span class="k">${ahead.length ? esc(shortCode(ahead[0].course)) + ' next' : 'nothing due'}</span></div>
    </div>
    ${dated.length ? `
      <div class="table-wrap">
        <table class="sem">
          <thead><tr><th>Due</th><th class="num wk">Wk</th><th>Course</th><th>Item</th><th class="counts">Counts toward</th><th class="num pts">Pts</th><th class="num status">Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<div class="empty">No dated work anywhere this term.</div>'}
    ${undatedBlock}
    ${silentBlock}
    ${newsBlock}
    <p class="sub disclaimer">Live from Canvas, so it is only as complete as your lecturers made it. Anything set outside Canvas — Moodle quizzes, exam timetables from ARRO, dates given in a lecture — is not here.</p>`;
}
