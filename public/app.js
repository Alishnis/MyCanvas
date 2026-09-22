// Canvas dashboard — router and shell.
// Every Canvas call goes through the local proxy at /api, which adds the token.

import { api, prefs, state } from './lib/api.js';
import { renderError, renderSetup, view } from './lib/ui.js';
import { viewUpcoming } from './views/upcoming.js';
import { viewSemester } from './views/semester.js';
import { viewGrading } from './views/grading.js';
import { viewCourses } from './views/courses.js';
import { viewCourse } from './views/course.js';
import { viewAssignment } from './views/assignment.js';
import { viewPage } from './views/page.js';
import { viewDiscussion } from './views/discussion.js';
import { viewInbox, viewThread } from './views/inbox.js';

/** hash → [view, tab to underline]. First match wins, so order matters. */
const ROUTES = [
  [/^#\/course\/(\w[\w-]*)\/a\/(\w[\w-]*)$/, viewAssignment, 'courses'],
  [/^#\/course\/(\w[\w-]*)\/page\/([^/]+)$/, viewPage, 'courses'],
  [/^#\/course\/(\w[\w-]*)\/d\/(\w[\w-]*)$/, viewDiscussion, 'courses'],
  [/^#\/course\/(\w[\w-]*)(?:\/(modules|files|announcements|discussions))?$/, viewCourse, 'courses'],
  [/^#\/inbox\/(\w[\w-]*)$/, viewThread, 'inbox'],
  [/^#\/inbox$/, viewInbox, 'inbox'],
  [/^#\/semester$/, viewSemester, 'semester'],
  [/^#\/grading$/, viewGrading, 'grading'],
  [/^#\/courses$/, viewCourses, 'courses'],
  [/^#\/upcoming$/, viewUpcoming, 'upcoming'],
];

function setActiveTab(name) {
  for (const el of document.querySelectorAll('#tabs a')) {
    el.classList.toggle('active', el.dataset.view === name);
  }
}

async function route() {
  const hash = location.hash || '#/upcoming';
  // Jump links inside a view (#gr-123) are not routes — let the browser scroll.
  if (!hash.startsWith('#/')) return;

  const btn = document.getElementById('refresh');
  btn.disabled = true;
  window.scrollTo(0, 0);

  try {
    if (!state.config) state.config = await api('/_config');
    if (!state.config.hasToken) { setActiveTab(null); renderSetup(); return; }

    // The inbox needs to know who you are before it can render a thread, so
    // this comes ahead of the view rather than after it.
    if (!state.profile) {
      state.profile = await api('/users/self/profile').catch(() => null);
      if (state.profile) document.getElementById('who').textContent = state.profile.short_name || state.profile.name || '';
    }

    const hit = ROUTES.map(([re, fn, tab]) => [hash.match(re), fn, tab]).find(([m]) => m);
    if (hit) {
      const [m, fn, tab] = hit;
      setActiveTab(tab);
      await fn(...m.slice(1).map((x) => (x == null ? x : decodeURIComponent(x))));
    } else {
      setActiveTab('upcoming');
      await viewUpcoming();
    }

    document.getElementById('foot-note').textContent =
      `Read-only, straight from ${state.config.base}. Responses are cached for 60s — hit Refresh to re-fetch.`;
  } catch (err) {
    renderError(err);
  } finally {
    prefs.fresh = false;
    btn.disabled = false;
  }
}

document.getElementById('refresh').addEventListener('click', () => {
  prefs.fresh = true;
  state.courses = null;
  state.groups.clear();
  state.docs.clear();
  state.pages.clear();
  route();
});

view.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle-orgs]');
  if (!toggle) return;
  e.preventDefault();
  prefs.showOrgs = !prefs.showOrgs;
  localStorage.setItem('showOrgs', prefs.showOrgs ? '1' : '0');
  route();
});

window.addEventListener('hashchange', route);
route();
