import { esc, num, pct, fmtDue, hueOf, shortCode, sanitize, statusOf, isDone } from '../lib/util.js';
import { state, getCourses, getAssignment } from '../lib/api.js';
import { view, skeleton } from '../lib/ui.js';

/** Things Canvas will not let a read-only client do, and what they are called. */
const NEEDS_CANVAS = {
  online_quiz: 'Taking this quiz',
  online_upload: 'Uploading a file',
  online_text_entry: 'Typing an answer',
  online_url: 'Submitting a link',
  discussion_topic: 'Posting to the discussion',
  media_recording: 'Recording media',
  external_tool: 'Working through this tool (WebWork and the like)',
};

export async function viewAssignment(courseId, id) {
  view.innerHTML = `<a class="back" href="#/course/${courseId}">← Course</a>${skeleton(4)}`;

  const [{ all }, { assignment: a, submission: sub }] = await Promise.all([
    getCourses(),
    getAssignment(courseId, id),
  ]);
  const course = all.find((c) => String(c.id) === String(courseId));
  const base = state.config?.base || '';
  document.title = `${a.name} · Canvas`;

  const st = statusOf({ ...a, submission: sub });
  const late = a.due_at && new Date(a.due_at) < new Date() && !isDone({ submission: sub });

  // --- what you got back -------------------------------------------------
  const score = sub?.score != null ? `${num(sub.score)} / ${num(a.points_possible)}` : null;
  const ratio = sub?.score != null && a.points_possible ? (sub.score / a.points_possible) * 100 : null;

  // --- the rubric, with your marks against it when they exist ------------
  const marks = new Map(Object.entries(sub?.rubric_assessment || {}));
  const rubric = Array.isArray(a.rubric) && a.rubric.length ? `
    <h2>Rubric</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Criterion</th><th class="num">Out of</th>${marks.size ? '<th class="num">You</th>' : ''}</tr></thead>
        <tbody>
          ${a.rubric.map((c) => {
            const mine = marks.get(c.id);
            return `
              <tr>
                <td>
                  <div>${esc(c.description || '')}</div>
                  ${c.long_description ? `<div class="row-meta"><span>${esc(c.long_description.replace(/<[^>]+>/g, ' ').slice(0, 200))}</span></div>` : ''}
                  ${mine?.comments ? `<div class="comment-inline">${esc(mine.comments)}</div>` : ''}
                </td>
                <td class="num">${num(c.points)}</td>
                ${marks.size ? `<td class="num">${mine?.points != null ? num(mine.points) : '—'}</td>` : ''}
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '';

  // --- teacher feedback --------------------------------------------------
  const comments = (sub?.submission_comments || []).filter((c) => c.comment);
  const commentBlock = comments.length ? `
    <h2>Feedback</h2>
    <div class="rows">
      ${comments.map((c) => `
        <div class="row comment">
          <div class="row-main">
            <div class="row-title">${esc(c.author_name || 'Comment')}</div>
            <div class="comment-body">${esc(c.comment)}</div>
            <div class="row-meta"><span>${esc(fmtDue(c.created_at))}</span></div>
          </div>
        </div>`).join('')}
    </div>` : '';

  // --- your own submission ----------------------------------------------
  const files = sub?.attachments || [];
  const handIn = sub?.submitted_at ? `
    <h2>Your submission</h2>
    <div class="facts">
      <div><span class="k">Handed in</span><span class="v">${esc(fmtDue(sub.submitted_at))}</span></div>
      <div><span class="k">Attempt</span><span class="v">${sub.attempt || 1}</span></div>
      ${sub.late ? `<div><span class="k">Late by</span><span class="v">${Math.round((sub.seconds_late || 0) / 3600)} h</span></div>` : ''}
    </div>
    ${sub.body ? `<div class="prose">${sanitize(sub.body, base)}</div>` : ''}
    ${sub.url ? `<p class="sub"><a href="${esc(sub.url)}" target="_blank" rel="noopener">${esc(sub.url)}</a></p>` : ''}
    ${files.length ? `<div class="rows">${files.map((f) => `
      <a class="row file-row" href="/file/${f.id}" target="_blank" rel="noopener">
        <span class="kind">${esc((f.display_name.split('.').pop() || '?').slice(0, 4).toUpperCase())}</span>
        <div class="row-main"><div class="row-title">${esc(f.display_name)}</div></div>
        <div class="row-right"><span class="badge">${Math.max(1, Math.round((f.size || 0) / 1024))} KB</span></div>
      </a>`).join('')}</div>` : ''}` : '';

  // --- the one thing that still needs Canvas ----------------------------
  const doable = (a.submission_types || []).map((t) => NEEDS_CANVAS[t]).filter(Boolean);
  const canvasNote = doable.length && !isDone({ submission: sub }) ? `
    <div class="note">
      ${esc(doable[0])} has to happen in Canvas itself — the API cannot do it for you.
      <a href="${esc(base)}/courses/${courseId}/assignments/${a.id}" target="_blank" rel="noopener">Open it there ↗</a>
    </div>` : '';

  view.innerHTML = `
    <a class="back" href="#/course/${courseId}">← ${esc(course ? shortCode(course) : 'Course')}</a>
    <div class="course-head">
      <div class="headline">
        <div>
          <h1>${esc(a.name)}</h1>
          <div class="row-meta" style="margin-top:6px">
            ${course ? `<span><a href="#/course/${course.id}">${esc(course.name)}</a></span>` : ''}
            ${a.points_possible ? `<span>${num(a.points_possible)} pts</span>` : ''}
            ${a.due_at ? `<span class="${late ? 'due late' : ''}">Due ${esc(fmtDue(a.due_at))}</span>` : '<span>no due date</span>'}
            ${a.lock_at ? `<span>closes ${esc(fmtDue(a.lock_at))}</span>` : ''}
          </div>
        </div>
        <div>
          <div class="big-score">${score || (st ? esc(st.text) : '—')}</div>
          <div class="score-label">${score && ratio != null ? pct(ratio) : st ? '' : 'not graded yet'}</div>
        </div>
      </div>
    </div>
    ${canvasNote}
    ${a.description ? `<div class="prose wide">${sanitize(a.description, base)}</div>`
      : '<div class="empty small">No instructions posted on Canvas.</div>'}
    ${rubric}
    ${commentBlock}
    ${handIn}
    <p class="sub disclaimer">
      <a href="${esc(base)}/courses/${courseId}/assignments/${a.id}" target="_blank" rel="noopener">Open in Canvas ↗</a>
    </p>`;
}
