import { esc, hueOf, num, pct, fmtDue, statusOf, shortCode, teacherLine, isDone, sanitize, policyLines } from '../lib/util.js';
import {
  state, getGroups, analyse, getAnnouncements, getCourseDoc,
  getCourseDetail, getStandards, getModules, getFiles, getDiscussions,
} from '../lib/api.js';
import { view, skeleton, standingHtml } from '../lib/ui.js';

// ---------------------------------------------------------------- view: one course

export async function viewCourse(id, tab = 'overview') {
  view.innerHTML = `<a class="back" href="#/courses">← Courses</a>${skeleton(5)}`;

  const [course, groups, standards] = await Promise.all([
    getCourseDetail(id),
    getGroups(id),
    getStandards(id),
  ]);

  const [doc, news, mods, docs, disc] = await Promise.all([
    getCourseDoc(course).catch(() => null),
    getAnnouncements([course], 120).catch(() => []),
    getModules(id),
    getFiles(id),
    getDiscussions(id),
  ]);
  const { list: modules } = mods, { list: files } = docs, { list: topics } = disc;

  /** Same wording everywhere a course has switched a section off. */
  const emptyFor = (what, error) => `<div class="empty">${
    error === 'hidden' ? `This course does not let students see its ${what}.`
      : error ? `Canvas would not hand over the ${what} for this course.`
        : `No ${what} on this course.`}</div>`;

  document.title = `${shortCode(course)} · Canvas`;
  const a = analyse(groups);
  const s = standingHtml(course, a);
  const base = state.config?.base || '';
  const hue = hueOf(course.id);
  // Weights can be declared in the groups while Canvas is still told not to use
  // them for its own total — the weights are the real syllabus breakdown either way.
  const canvasApplies = course.apply_assignment_group_weights === true;

  // --- grading breakdown -------------------------------------------------
  const breakdown = a.rows.length ? `
    <h2>Grading breakdown</h2>
    ${a.weighted && !canvasApplies
      ? `<div class="note">These are the weights set on the course's assignment groups. Canvas is not configured to apply them to its own total, so treat the percentages as the syllabus breakdown rather than a live calculation.</div>`
      : ''}
    ${a.weighted && Math.round(a.weightSum) !== 100
      ? `<div class="note">Weights add up to ${num(a.weightSum)}%, not 100%.</div>`
      : ''}
    ${!a.weighted
      ? `<div class="note">No group weights are set on this course — the grade is the plain sum of points across all assignments.</div>`
      : ''}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Group</th>
            <th class="num">${a.weighted ? 'Weight' : 'Points'}</th>
            <th class="num">Graded</th>
            <th class="num">Your score</th>
            <th class="spark"></th>
          </tr>
        </thead>
        <tbody>
          ${a.rows.map((r) => `
            <tr${r.gradedCount ? '' : ' class="dim"'}>
              <td>${esc(r.grp.name)}</td>
              <td class="num">${a.weighted ? pct(r.weight) : num(r.totalPoints)}</td>
              <td class="num">${r.gradedCount} / ${r.list.length}</td>
              <td class="num">${r.possible ? `${num(r.earned)} / ${num(r.possible)} · ${pct(r.ratio)}` : '—'}</td>
              <td class="spark">${r.ratio != null ? `<div class="bar"><span style="width:${Math.max(0, Math.min(100, r.ratio))}%"></span></div>` : ''}</td>
            </tr>`).join('')}
        </tbody>
        ${a.weighted ? `<tfoot><tr><td>Total</td><td class="num">${pct(a.weightSum)}</td><td class="num">${a.gradedCount} / ${a.totalCount}</td><td class="num">${a.possible ? `${num(a.earned)} / ${num(a.possible)}` : '—'}</td><td></td></tr></tfoot>` : ''}
      </table>
    </div>` : '';

  // --- letter grade scheme ----------------------------------------------
  // Canvas hands students dozens of near-identical copies of the account's
  // schemes and points `grading_standard_id` at an account-level record they
  // cannot read — so dedupe by the actual cut-offs and show what is there.
  const seen = new Map();
  for (const st of Array.isArray(standards) ? standards : []) {
    const scheme = st.grading_scheme || [];
    if (!scheme.length) continue;
    const key = JSON.stringify(scheme);
    if (!seen.has(key)) {
      seen.set(key, { title: st.title || 'Scheme', scheme: scheme.slice().sort((x, y) => y.value - x.value) });
    }
  }
  const schemes = [...seen.values()];
  const letterIn = (scheme) => (a.score != null ? scheme.find((x) => a.score / 100 >= x.value - 1e-9)?.name : null);

  const schemeBlock = schemes.length ? `
    <h2>Grading scheme${schemes.length > 1 ? 's' : ''}</h2>
    ${schemes.length > 1
      ? `<div class="note">Canvas exposes ${schemes.length} different schemes on this course and does not say which one is in force — check the syllabus.</div>`
      : a.score != null && letterIn(schemes[0].scheme)
        ? `<div class="note">Your standing on graded work so far (${pct(a.score)}) falls in <strong>${esc(letterIn(schemes[0].scheme))}</strong>. This is not your course grade.</div>`
        : ''}
    <div class="schemes">
      ${schemes.map(({ title, scheme }) => {
        const current = letterIn(scheme);
        return `
          <div class="scheme">
            ${schemes.length > 1 ? `<h3>${esc(title)}</h3>` : ''}
            <table>
              <thead><tr><th>Grade</th><th class="num">Min score</th></tr></thead>
              <tbody>
                ${scheme.map((x) => `
                  <tr${x.name === current ? ' class="current"' : ''}>
                    <td>${esc(x.name)}</td>
                    <td class="num">${pct(x.value * 100)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      }).join('')}
    </div>` : '';

  // --- announcements, in full: no reason to open Canvas to read one -------
  const newsBlock = news.length ? `
    <div class="posts">
      ${news.map(({ a: n }) => `
        <article class="post">
          <h2>${esc(n.title)}</h2>
          <div class="row-meta">
            <span>${esc(fmtDue(n.posted_at))}</span>
            ${n.user_name ? `<span>${esc(n.user_name)}</span>` : ''}
          </div>
          ${n.message ? `<div class="prose">${sanitize(n.message, base)}</div>` : ''}
        </article>`).join('')}
    </div>` : '<div class="empty">No announcements in the last four months.</div>';

  // --- the course's own structure ----------------------------------------
  const itemLink = (it) => {
    if (it.type === 'Page' && it.page_url) return `#/course/${course.id}/page/${encodeURIComponent(it.page_url)}`;
    if (it.type === 'Assignment' && it.content_id) return `#/course/${course.id}/a/${it.content_id}`;
    if (it.type === 'File' && it.content_id) return `/file/${it.content_id}`;
    return it.html_url || '';
  };
  const external = (it) => !['Page', 'Assignment'].includes(it.type);

  const moduleBlock = modules.length ? `
    <div class="modules">
      ${modules.map((m) => {
        const items = m.items || [];
        return `
          <section class="module">
            <div class="module-head">
              <h2>${esc(m.name)}</h2>
              <span class="count">${items.length} ${items.length === 1 ? 'item' : 'items'}</span>
            </div>
            ${items.length ? `<div class="rows">${items.map((it) => {
              if (it.type === 'SubHeader') return `<div class="row sub-head">${esc(it.title)}</div>`;
              const href = itemLink(it);
              const done = it.completion_requirement?.completed;
              const d = it.content_details || {};
              return `
                <a class="row mod-row" href="${esc(href)}"${external(it) ? ' target="_blank" rel="noopener"' : ''} style="--indent:${it.indent || 0}">
                  <span class="kind">${esc(it.type === 'ExternalTool' ? 'Tool' : it.type === 'ExternalUrl' ? 'Link' : it.type)}</span>
                  <div class="row-main">
                    <div class="row-title">${esc(it.title)}</div>
                    ${d.due_at || d.points_possible ? `<div class="row-meta">
                      ${d.due_at ? `<span>due ${esc(fmtDue(d.due_at))}</span>` : ''}
                      ${d.points_possible ? `<span>${num(d.points_possible)} pts</span>` : ''}
                    </div>` : ''}
                  </div>
                  <div class="row-right">${done ? '<span class="badge ok">Done</span>' : ''}</div>
                </a>`;
            }).join('')}</div>` : ''}
          </section>`;
      }).join('')}
    </div>` : emptyFor('modules', mods.error);

  // --- discussions -------------------------------------------------------
  const discussionBlock = topics.length ? `
    <div class="rows">
      ${topics.map((t) => `
        <a class="row plain" href="#/course/${course.id}/d/${t.id}">
          <div class="row-main">
            <div class="row-title">${esc(t.title)}</div>
            <div class="row-meta">
              <span>${esc(t.user_name || 'Course staff')}</span>
              ${t.posted_at ? `<span>${esc(fmtDue(t.posted_at))}</span>` : ''}
              ${t.locked ? '<span>closed</span>' : ''}
            </div>
          </div>
          <div class="row-right"><span class="badge">${t.discussion_subentry_count || 0} ${t.discussion_subentry_count === 1 ? 'reply' : 'replies'}</span></div>
        </a>`).join('')}
    </div>` : emptyFor('discussions', disc.error);

  // --- files, newest first: lecture notes without the round trip ---------
  const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const fileBlock = files.length ? `
    <p class="sub">Served through the local proxy, so they open here rather than in Canvas.</p>
    <div class="rows">
      ${files.map((f) => `
        <a class="row file-row" href="/file/${f.id}" target="_blank" rel="noopener">
          <span class="kind">${esc((f.display_name.split('.').pop() || '?').slice(0, 4).toUpperCase())}</span>
          <div class="row-main">
            <div class="row-title">${esc(f.display_name)}</div>
            <div class="row-meta">
              ${f.folder ? `<span>${esc(f.folder)}</span>` : ''}
              <span>${esc(new Date(f.updated_at).toLocaleDateString())}</span>
            </div>
          </div>
          <div class="row-right"><span class="badge">${esc(kb(f.size || 0))}</span></div>
        </a>`).join('')}
    </div>` : emptyFor('files', docs.error);

  // --- what the course says about itself ---------------------------------
  const lines = doc ? policyLines(doc.html) : [];
  const docBlock = doc ? `
    <h2>Course document</h2>
    ${lines.length ? `
      <p class="sub">Every line of it that mentions a percentage:</p>
      <ul class="quotes">${lines.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <details class="doc">
      <summary>Full text — ${esc(doc.source)}</summary>
      <div class="prose">${sanitize(doc.html, base)}</div>
    </details>` : '';

  // --- every assignment --------------------------------------------------
  const assignmentBlock = a.totalCount ? `
    <h2>Assignments</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Assignment</th><th class="num">Due</th><th class="num">Score</th><th class="num">Status</th></tr>
        </thead>
        <tbody>
          ${a.rows.map((r) => {
            const list = r.list.slice().sort((x, y) => {
              if (!x.due_at) return 1;
              if (!y.due_at) return -1;
              return new Date(x.due_at) - new Date(y.due_at);
            });
            if (!list.length) return '';
            return `
              <tr class="dim"><td colspan="4" class="group-row"><strong>${esc(r.grp.name)}</strong>${a.weighted ? ` · ${pct(r.weight)}` : ''}</td></tr>
              ${list.map((x) => {
                const st = statusOf(x, { withScore: false });
                const late = x.due_at && new Date(x.due_at) < new Date() && !isDone(x);
                return `
                  <tr>
                    <td class="title"><a href="#/course/${course.id}/a/${x.id}">${esc(x.name)}</a></td>
                    <td class="num"><span class="due ${late ? 'late' : ''}">${x.due_at ? fmtDue(x.due_at) : '—'}</span></td>
                    <td class="num">${x.submission?.score != null ? `${num(x.submission.score)} / ${num(x.points_possible)}` : `— / ${num(x.points_possible)}`}</td>
                    <td class="num">${st ? `<span class="badge ${st.cls}">${esc(st.text)}</span>` : ''}</td>
                  </tr>`;
              }).join('')}`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '<div class="empty">This course has no assignments yet.</div>';

  view.innerHTML = `
    <a class="back" href="#/courses">← Courses</a>
    <div class="course-head">
      <div class="code" style="--h:${hue}">${esc(shortCode(course))}</div>
      <div class="headline">
        <div>
          <h1>${esc(course.name)}</h1>
          <div class="sub" style="margin:0">${esc(course.term?.name || '')}${
            (course.teachers || []).length ? ` · ${esc(teacherLine(course, 3))}` : ''}</div>
          <div class="links">
            <a href="${esc(base)}/courses/${course.id}" target="_blank" rel="noopener">Open in Canvas ↗</a>
            ${course.syllabus_body ? `<a href="${esc(base)}/courses/${course.id}/assignments/syllabus" target="_blank" rel="noopener">Syllabus ↗</a>` : ''}
            <a href="${esc(base)}/courses/${course.id}/grades" target="_blank" rel="noopener">Gradebook ↗</a>
          </div>
        </div>
        <div>
          <div class="big-score">${s.value}${s.small ? `<small>${s.small}</small>` : ''}</div>
          <div class="score-label">${esc(s.label)}</div>
        </div>
      </div>
    </div>
    <nav class="subtabs">
      ${[['overview', 'Overview', a.totalCount], ['modules', 'Modules', modules.length],
         ['files', 'Files', files.length], ['announcements', 'Announcements', news.length],
         ['discussions', 'Discussions', topics.length]]
        .map(([key, label, n]) => `
          <a href="#/course/${course.id}${key === 'overview' ? '' : '/' + key}" class="${tab === key ? 'active' : ''}">
            ${label}${n ? ` <span class="count">${n}</span>` : ''}
          </a>`).join('')}
    </nav>
    ${tab === 'modules' ? moduleBlock
      : tab === 'files' ? fileBlock
      : tab === 'announcements' ? newsBlock
      : tab === 'discussions' ? discussionBlock
      : `${breakdown}${schemeBlock}${assignmentBlock}${docBlock}`}`;
}
