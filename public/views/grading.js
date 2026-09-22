import { esc, hueOf, num, pct, shortCode, teacherLine, spanOf, sanitize, policyLines } from '../lib/util.js';
import { state, getCourses, analyse, loadAll, getCourseDoc } from '../lib/api.js';
import { view, skeleton, standingHtml, weightsNote } from '../lib/ui.js';

// ---------------------------------------------------------------- view: grading

export async function viewGrading() {
  document.title = 'Grading · Canvas';
  view.innerHTML = `<h1>Grading</h1><p class="sub">Loading assignments…</p>${skeleton(4)}`;

  const { real } = await getCourses();
  if (!real.length) {
    view.innerHTML = `<h1>Grading</h1><div class="empty">No active courses found on this account.</div>`;
    return;
  }

  const settled = await loadAll(real, view.querySelector('.sub'));
  const docs = await Promise.all(real.map((c) => getCourseDoc(c).catch(() => null)));
  const base = state.config?.base || '';
  const analyses = settled.map((r) => (r.status === 'fulfilled' ? analyse(r.value) : null));

  const sections = real.map((course, i) => {
    const a = analyses[i];
    const doc = docs[i];
    const teachers = teacherLine(course, 3);
    const s = a ? standingHtml(course, a) : { value: '—', small: '', label: 'could not load' };
    const lines = doc ? policyLines(doc.html) : [];

    const shown = a ? a.rows.filter((r) => r.list.length || r.weight > 0) : [];
    const table = shown.length ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Component</th><th class="num">${a.weighted ? 'Weight' : 'Points'}</th><th class="num">Items</th><th>When</th><th class="num">Your score</th></tr>
          </thead>
          <tbody>
            ${shown.map((r) => `
              <tr${r.gradedCount ? '' : ' class="dim"'}>
                <td>${esc(r.grp.name)}</td>
                <td class="num">${a.weighted ? pct(r.weight) : num(r.totalPoints)}</td>
                <td class="num">${r.list.length}</td>
                <td class="soft nowrap">${esc(spanOf(r.list)) || '—'}</td>
                <td class="num">${r.possible ? `${num(r.earned)} / ${num(r.possible)} · ${pct(r.ratio)}` : '—'}</td>
              </tr>`).join('')}
          </tbody>
          ${a.weighted ? `<tfoot><tr><td>Total</td><td class="num">${pct(a.weightSum)}</td><td class="num">${a.totalCount}</td><td></td><td class="num">${a.possible ? `${num(a.earned)} / ${num(a.possible)}` : '—'}</td></tr></tfoot>` : ''}
        </table>
      </div>` : '';

    const verdict = a && a.weighted
      ? (Math.round(a.weightSum) === 100 ? '' : `<div class="note">The weights Canvas holds add up to ${num(a.weightSum)}%, not 100%.</div>`)
      : lines.length
        ? `<div class="note">No weights in Canvas — the breakdown below is quoted from the ${esc((doc?.source || 'course document').toLowerCase())}.</div>`
        : doc
          ? `<div class="note">No percentages anywhere: Canvas holds none, and the course document names none either. Whatever it does require is in the full text below.</div>`
          : `<div class="note">No weights in Canvas and no syllabus published — nothing on Canvas says how this course is marked.</div>`;

    return `
      <section class="gr" id="gr-${course.id}">
        <div class="gr-head">
          <div class="code" style="--h:${hueOf(course.id)}">${esc(shortCode(course))}</div>
          <div class="gr-title">
            <h2><a href="#/course/${course.id}">${esc(course.name)}</a></h2>
            <div class="row-meta">
              ${teachers ? `<span>${esc(teachers)}</span>` : ''}
              ${doc ? `<span><a href="${esc(base + doc.url)}" target="_blank" rel="noopener">${esc(doc.source)} ↗</a></span>` : '<span>no syllabus published</span>'}
            </div>
          </div>
          <div class="gr-score">
            <div class="big-score">${s.value}${s.small ? `<small>${s.small}</small>` : ''}</div>
            <div class="score-label">${esc(s.label)}</div>
          </div>
        </div>
        ${verdict}
        ${table}
        ${lines.length ? `
          <h3>What the course document says</h3>
          <ul class="quotes">${lines.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${doc ? `
          <details class="doc">
            <summary>Full course document — ${esc(doc.source)}</summary>
            <div class="prose">${sanitize(doc.html, base)}</div>
          </details>` : `<div class="empty small">No syllabus or front page published on Canvas for this course.</div>`}
      </section>`;
  }).join('');

  view.innerHTML = `
    <h1>Grading</h1>
    <p class="sub">What each course says its marks are made of — the weights Canvas holds, and the ones it does not.</p>
    ${weightsNote(analyses)}
    <nav class="jump">${real.map((c) => `<a href="#gr-${c.id}" style="--h:${hueOf(c.id)}">${esc(shortCode(c))}</a>`).join('')}</nav>
    ${sections}
    <p class="sub disclaimer">Quoted verbatim from the syllabus pages your lecturers wrote. Where a course says nothing, Canvas really does hold nothing — check the course site or ask.</p>`;
}
