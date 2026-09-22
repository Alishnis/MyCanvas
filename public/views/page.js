import { esc, sanitize, shortCode } from '../lib/util.js';
import { state, getCourses, getPage } from '../lib/api.js';
import { view, skeleton } from '../lib/ui.js';

/** One Canvas page, rendered here instead of in Canvas. */
export async function viewPage(courseId, slug) {
  view.innerHTML = `<a class="back" href="#/course/${courseId}/modules">← Modules</a>${skeleton(3)}`;

  const [{ all }, page] = await Promise.all([getCourses(), getPage(courseId, slug)]);
  const course = all.find((c) => String(c.id) === String(courseId));
  const base = state.config?.base || '';
  document.title = `${page.title} · Canvas`;

  view.innerHTML = `
    <a class="back" href="#/course/${courseId}/modules">← ${esc(course ? shortCode(course) : 'Course')} modules</a>
    <h1>${esc(page.title)}</h1>
    <p class="sub">${course ? esc(course.name) : ''}${page.updated_at ? ` · updated ${esc(new Date(page.updated_at).toLocaleDateString())}` : ''}</p>
    ${page.body ? `<div class="prose wide">${sanitize(page.body, base)}</div>` : '<div class="empty">This page is empty.</div>'}
    <p class="sub disclaimer">
      <a href="${esc(base)}/courses/${courseId}/pages/${encodeURIComponent(slug)}" target="_blank" rel="noopener">Open in Canvas ↗</a>
    </p>`;
}
