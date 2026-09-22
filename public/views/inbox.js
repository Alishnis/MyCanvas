import { esc, fmtDue, sanitize } from '../lib/util.js';
import { state, getConversations, getConversation } from '../lib/api.js';
import { view, skeleton } from '../lib/ui.js';

const others = (c) => (c.participants || [])
  .filter((p) => String(p.id) !== String(state.profile?.id))
  .map((p) => p.name)
  .join(', ');

export async function viewInbox() {
  document.title = 'Inbox · Canvas';
  view.innerHTML = `<h1>Inbox</h1><p class="sub">Loading messages…</p>${skeleton(5)}`;

  const list = await getConversations();
  const unread = list.filter((c) => c.workflow_state === 'unread').length;

  view.innerHTML = `
    <h1>Inbox</h1>
    <p class="sub">
      ${list.length} ${list.length === 1 ? 'thread' : 'threads'}${unread ? ` · ${unread} unread` : ''}.
      Reading one here leaves it unread in Canvas — this client never writes.
    </p>
    ${list.length ? `<div class="rows">${list.map((c) => `
      <a class="row conv ${c.workflow_state === 'unread' ? 'unread' : ''}" href="#/inbox/${c.id}">
        <div class="row-main">
          <div class="row-title">${esc(c.subject || '(no subject)')}</div>
          <div class="row-meta">
            <span>${esc(others(c) || 'you')}</span>
            ${c.message_count > 1 ? `<span>${c.message_count} messages</span>` : ''}
          </div>
          <div class="snippet">${esc((c.last_message || '').replace(/\s+/g, ' ').slice(0, 160))}</div>
        </div>
        <div class="row-right"><div class="due">${esc(fmtDue(c.last_message_at))}</div></div>
      </a>`).join('')}</div>` : '<div class="empty">No messages.</div>'}`;
}

export async function viewThread(id) {
  view.innerHTML = `<a class="back" href="#/inbox">← Inbox</a>${skeleton(4)}`;

  const c = await getConversation(id);
  const base = state.config?.base || '';
  const names = new Map((c.participants || []).map((p) => [String(p.id), p.name]));
  document.title = `${c.subject || 'Message'} · Canvas`;

  const messages = (c.messages || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  view.innerHTML = `
    <a class="back" href="#/inbox">← Inbox</a>
    <h1>${esc(c.subject || '(no subject)')}</h1>
    <p class="sub">${esc(others(c) || 'you')} · ${messages.length} ${messages.length === 1 ? 'message' : 'messages'}</p>
    <div class="thread">
      ${messages.map((m) => {
        const mine = String(m.author_id) === String(state.profile?.id);
        return `
          <div class="msg ${mine ? 'mine' : ''}">
            <div class="msg-head">
              <strong>${esc(mine ? 'You' : names.get(String(m.author_id)) || 'Unknown')}</strong>
              <span>${esc(fmtDue(m.created_at))}</span>
            </div>
            <div class="msg-body">${sanitize((m.body || '').replace(/\n/g, '<br>'), base)}</div>
            ${(m.attachments || []).map((f) => `
              <a class="msg-file" href="/file/${f.id}" target="_blank" rel="noopener">${esc(f.display_name)}</a>`).join('')}
          </div>`;
      }).join('')}
    </div>
    <p class="sub disclaimer">
      Replying needs Canvas — <a href="${esc(base)}/conversations/${c.id}" target="_blank" rel="noopener">open this thread there ↗</a>
    </p>`;
}
