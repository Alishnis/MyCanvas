import { esc, hueOf, shortCode, teacherLine } from '../lib/util.js';
import { getCourses, getGroups, analyse } from '../lib/api.js';
import { view, chip, skeleton, standingHtml } from '../lib/ui.js';

// ---------------------------------------------------------------- view: courses

export async function viewCourses() {
  document.title = 'Courses · Canvas';
  view.innerHTML = `<h1>Courses</h1><p class="sub">Loading…</p>${skeleton(4)}`;

  const { real, orgs } = await getCourses();
  if (!real.length && !orgs.length) {
    view.innerHTML = `<h1>Courses</h1><div class="empty">No active courses found on this account.</div>`;
    return;
  }

  const settled = await Promise.allSettled(real.map((c) => getGroups(c.id)));

  const cards = real.map((c, i) => {
    const a = settled[i].status === 'fulfilled' ? analyse(settled[i].value) : null;
    const s = a ? standingHtml(c, a) : { value: '—', small: '', label: 'could not load' };
    return `
      <a class="card" href="#/course/${c.id}">
        <div class="code" style="--h:${hueOf(c.id)}">${esc(shortCode(c))}</div>
        <div class="name">${esc(c.name)}</div>
        <div class="term">${esc(teacherLine(c, 2) || c.term?.name || '')}</div>
        <div class="grade">
          <span class="score">${s.value}${s.small ? `<span class="letter">${s.small}</span>` : ''}</span>
          <span class="score-label">${esc(s.label)}</span>
        </div>
        ${a?.totalCount ? `<div class="term" style="margin-top:8px">${a.gradedCount} of ${a.totalCount} assignments graded</div>` : ''}
      </a>`;
  }).join('');

  const orgList = orgs.map((c) => `
    <a class="row org-row" href="#/course/${c.id}">
      ${chip(c)}
      <div class="row-main"><span>${esc(c.name)}</span></div>
    </a>`).join('');

  view.innerHTML = `
    <h1>Courses</h1>
    <p class="sub">${real.length} ${real.length === 1 ? 'course' : 'courses'} this term. Standings are computed from your graded work — CityU hides Canvas's own running total.</p>
    <div class="cards">${cards}</div>
    ${orgs.length ? `
      <details class="orgs">
        <summary>${orgs.length} administrative shells — training modules, notice boards, announcements</summary>
        <div class="rows">${orgList}</div>
      </details>` : ''}`;
}
