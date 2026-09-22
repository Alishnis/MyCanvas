// Fragments and screens shared by every view.

import { esc, hueOf, shortCode, num, pct } from './util.js';
import { state, officialGrade } from './api.js';

export const view = document.getElementById('view');

// ---------------------------------------------------------------- shared fragments

export const chip = (course) =>
  `<a class="chip" style="--h:${hueOf(course.id)}" href="#/course/${course.id}">${esc(shortCode(course))}</a>`;

export const skeleton = (n = 6) => `<div class="rows">${'<div class="skeleton"></div>'.repeat(n)}</div>`;

export function renderError(err) {
  view.innerHTML = `
    <div class="error">
      <h3>Could not load data from Canvas</h3>
      <p>${esc(err.message)}</p>
      ${err.hint ? `<p>${esc(err.hint)}</p>` : ''}
      ${err.detail ? `<pre>${esc(JSON.stringify(err.detail, null, 2)).slice(0, 900)}</pre>` : ''}
    </div>`;
}

export function renderSetup() {
  const base = state.config?.base || 'https://canvas.cityu.edu.hk';
  view.innerHTML = `
    <div class="setup">
      <h1>Add your access token</h1>
      <p class="sub">The server needs a Canvas token to read your courses. It stays on this machine.</p>
      <ol>
        <li>Open <a href="${esc(base)}/profile/settings" target="_blank" rel="noopener">${esc(base)}/profile/settings</a> and click <strong>+ New Access Token</strong>. Copy it — Canvas shows it only once.</li>
        <li>Copy <code>.env.example</code> to <code>.env</code> in the project folder and paste the token:
          <pre>CANVAS_BASE=${esc(base)}
CANVAS_TOKEN=1839~your-token-here</pre></li>
        <li>Restart the server: <code>node server.js</code>, then reload this page.</li>
      </ol>
    </div>`;
}

/** Shared "graded so far" figure with an honest label. */
export function standingHtml(course, a) {
  const official = officialGrade(course);
  if (official) {
    return {
      value: pct(official.score),
      small: official.letter ? esc(official.letter) : '',
      label: 'current grade',
    };
  }
  if (a.score != null) {
    // Say how much of the course this figure rests on, not just how many items.
    const label = a.coverage != null
      ? `on ${pct(a.coverage)} of the course`
      : `on ${num(a.earned)} / ${num(a.possible)} graded pts`;
    return { value: pct(a.score), small: '', label };
  }
  return { value: '—', small: '', label: 'nothing graded yet' };
}

/**
 * Canvas weights are opt-in and almost nobody here sets them, which is exactly
 * why the Grades page total is meaningless. Say so once, with the real count.
 */
export function weightsNote(analyses) {
  const withWeights = analyses.filter((a) => a && a.weighted).length;
  const total = analyses.filter(Boolean).length;
  if (!total || withWeights === total) return '';
  return `<div class="note">
    ${withWeights === 0 ? 'None' : `Only ${withWeights}`} of ${total} courses set assignment-group
    weights in Canvas — the rest leave every group at 0%, which is why the total on the Canvas
    Grades page means nothing. Where a course states its split in the syllabus, it is quoted below.
  </div>`;
}
