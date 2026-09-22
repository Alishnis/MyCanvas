import { esc, fmtDue, sanitize, shortCode } from '../lib/util.js';
import { state, getCourses, getDiscussion } from '../lib/api.js';
import { view, skeleton } from '../lib/ui.js';

/** Canvas nests replies inside replies; flatten them with their depth. */
function walk(entries, names, depth = 0, out = []) {
  for (const e of entries || []) {
    if (!e.deleted) out.push({ e, depth, who: names.get(String(e.user_id)) || 'Unknown' });
    if (e.replies) walk(e.replies, names, depth + 1, out);
  }
  return out;
}

export async function viewDiscussion(courseId, topicId) {
  view.innerHTML = `<a class="back" href="#/course/${courseId}/discussions">← Discussions</a>${skeleton(3)}`;

  const [{ all }, { topic, thread }] = await Promise.all([
    getCourses(),
    getDiscussion(courseId, topicId),
  ]);
  const course = all.find((c) => String(c.id) === String(courseId));
  const base = state.config?.base || '';
  document.title = `${topic.title} · Canvas`;

  const names = new Map((thread?.participants || []).map((p) => [String(p.id), p.display_name || p.name]));
  const entries = walk(thread?.view, names);

  view.innerHTML = `
    <a class="back" href="#/course/${courseId}/discussions">← ${esc(course ? shortCode(course) : 'Course')} discussions</a>
    <h1>${esc(topic.title)}</h1>
    <p class="sub">
      ${esc(topic.user_name || 'Course staff')}${topic.posted_at ? ` · ${esc(fmtDue(topic.posted_at))}` : ''}
      · ${entries.length} ${entries.length === 1 ? 'reply' : 'replies'}
    </p>
    ${topic.message ? `<div class="prose wide">${sanitize(topic.message, base)}</div>` : ''}
    ${entries.length ? `
      <h2>Replies</h2>
      <div class="thread">
        ${entries.map(({ e, depth, who }) => `
          <div class="msg ${String(e.user_id) === String(state.profile?.id) ? 'mine' : ''}" style="margin-left:${depth * 24}px">
            <div class="msg-head"><strong>${esc(who)}</strong><span>${esc(fmtDue(e.created_at))}</span></div>
            <div class="msg-body">${sanitize(e.message || '', base)}</div>
          </div>`).join('')}
      </div>` : ''}
    <p class="sub disclaimer">
      Posting a reply needs Canvas —
      <a href="${esc(base)}/courses/${courseId}/discussion_topics/${topic.id}" target="_blank" rel="noopener">open the thread there ↗</a>
    </p>`;
}
