/* ── Marked + highlight.js 설정 ─────────────────────────── */
const renderer = new marked.Renderer();

renderer.code = function (code, language) {
  const lang = (language || 'plaintext').toLowerCase();
  let highlighted = escapeHtml(code);
  try {
    if (hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code, { language: lang }).value;
    } else {
      highlighted = hljs.highlightAuto(code).value;
    }
  } catch (_) { /* fallback to escaped text */ }

  return `
    <div class="code-wrapper">
      <div class="code-header">
        <span class="code-lang">${lang}</span>
        <button class="code-copy" onclick="copyCode(this)">복사</button>
      </div>
      <pre><code class="hljs language-${lang}">${highlighted}</code></pre>
    </div>`;
};

marked.use({ renderer, breaks: true, gfm: true });

/* ── State ──────────────────────────────────────────────── */
let conversations = (() => {
  try { return JSON.parse(localStorage.getItem('ai_conversations') || '[]'); }
  catch { return []; }
})();

let currentId = null;      // active conversation id
let currentMsgs = [];      // current message list [{role, content}]
let isGenerating = false;

/* ── DOM ────────────────────────────────────────────────── */
const messagesArea  = document.getElementById('messagesArea');
const messageInput  = document.getElementById('messageInput');
const sendBtn       = document.getElementById('sendBtn');
const welcomeScreen = document.getElementById('welcomeScreen');
const newChatBtn    = document.getElementById('newChatBtn');
const clearChatBtn  = document.getElementById('clearChatBtn');
const menuToggle    = document.getElementById('menuToggle');
const sidebar       = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const historyList   = document.getElementById('historyList');

/* ── Init ───────────────────────────────────────────────── */
renderHistory();
startNewChat();

/* ── Event listeners ────────────────────────────────────── */
messageInput.addEventListener('input', onInputChange);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); trySend(); }
});
sendBtn.addEventListener('click', trySend);
newChatBtn.addEventListener('click', startNewChat);
clearChatBtn.addEventListener('click', clearCurrentChat);
menuToggle.addEventListener('click', toggleSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

document.querySelectorAll('.chip').forEach(chip =>
  chip.addEventListener('click', () => {
    messageInput.value = chip.dataset.text;
    resizeTextarea();
    updateSendBtn();
    trySend();
  })
);

/* ── Input helpers ──────────────────────────────────────── */
function onInputChange() { resizeTextarea(); updateSendBtn(); }

function resizeTextarea() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 190) + 'px';
}

function updateSendBtn() {
  sendBtn.disabled = messageInput.value.trim() === '' || isGenerating;
}

function trySend() {
  if (!sendBtn.disabled) sendMessage();
}

/* ── Sidebar ────────────────────────────────────────────── */
function toggleSidebar() {
  sidebar.classList.toggle('open');
  sidebarOverlay.classList.toggle('active');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('active');
}

/* ── Chat management ────────────────────────────────────── */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function startNewChat() {
  currentId = genId();
  currentMsgs = [];
  clearMsgElements();
  welcomeScreen.style.display = 'flex';
  renderHistory();
  messageInput.focus();
}

function clearCurrentChat() {
  if (currentMsgs.length === 0) return;
  if (confirm('현재 대화를 초기화할까요?')) startNewChat();
}

function clearMsgElements() {
  messagesArea.querySelectorAll('.msg-group').forEach(el => el.remove());
}

function saveConversation() {
  if (currentMsgs.length === 0) return;
  const firstUser = currentMsgs.find(m => m.role === 'user');
  const title = firstUser
    ? firstUser.content.slice(0, 45) + (firstUser.content.length > 45 ? '…' : '')
    : '새 대화';

  const idx = conversations.findIndex(c => c.id === currentId);
  const item = { id: currentId, title, messages: currentMsgs, updatedAt: Date.now() };

  if (idx !== -1) conversations[idx] = item;
  else conversations.unshift(item);

  if (conversations.length > 60) conversations = conversations.slice(0, 60);
  localStorage.setItem('ai_conversations', JSON.stringify(conversations));
  renderHistory();
}

function loadConversation(id) {
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;

  currentId = id;
  currentMsgs = [...conv.messages];
  clearMsgElements();
  welcomeScreen.style.display = 'none';

  currentMsgs.forEach(m => appendMessage(m.role, m.content, false));
  renderHistory();
  closeSidebar();
  scrollDown();
}

/* global so onclick="" in HTML can call it */
window.deleteConversation = function (id, e) {
  e.stopPropagation();
  conversations = conversations.filter(c => c.id !== id);
  localStorage.setItem('ai_conversations', JSON.stringify(conversations));
  if (currentId === id) startNewChat();
  else renderHistory();
};

function renderHistory() {
  if (conversations.length === 0) {
    historyList.innerHTML = '<p class="history-empty">아직 대화 기록이 없습니다</p>';
    return;
  }
  historyList.innerHTML = conversations.map(conv => `
    <div class="history-item ${conv.id === currentId ? 'active' : ''}"
         onclick="loadConversation('${conv.id}')">
      <span class="history-item-text">${escapeHtml(conv.title)}</span>
      <button class="history-del" onclick="deleteConversation('${conv.id}', event)" title="삭제">×</button>
    </div>
  `).join('');
}

window.loadConversation = loadConversation;

/* ── Render message ─────────────────────────────────────── */
function appendMessage(role, content, animate = true) {
  welcomeScreen.style.display = 'none';

  const group = document.createElement('div');
  group.className = `msg-group ${role}`;
  if (!animate) group.style.animation = 'none';

  if (role === 'assistant') {
    group.innerHTML = `
      <div class="msg-avatar">✦</div>
      <div class="msg-content">
        <div class="msg-bubble">
          ${content
            ? marked.parse(content)
            : '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>'}
        </div>
        ${content ? actionBar() : ''}
      </div>`;
  } else {
    group.innerHTML = `
      <div class="msg-content">
        <div class="msg-bubble">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
        ${actionBar()}
      </div>`;
  }

  messagesArea.appendChild(group);
  scrollDown();
  return group;
}

function actionBar() {
  return `
    <div class="msg-actions">
      <button class="act-btn" onclick="copyMsg(this)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        복사
      </button>
    </div>`;
}

/* ── Send message ───────────────────────────────────────── */
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isGenerating) return;

  currentMsgs.push({ role: 'user', content: text });
  appendMessage('user', text);

  messageInput.value = '';
  messageInput.style.height = 'auto';
  isGenerating = true;
  updateSendBtn();

  const assistantGroup = appendMessage('assistant', '');
  const bubble = assistantGroup.querySelector('.msg-bubble');
  let fullText = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: currentMsgs }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // keep incomplete chunk

      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        const raw = part.slice(6).trim();
        if (!raw) continue;

        try {
          const ev = JSON.parse(raw);
          if (ev.type === 'text') {
            fullText += ev.content;
            bubble.innerHTML = marked.parse(fullText);
            scrollDown();
          } else if (ev.type === 'error') {
            throw new Error(ev.message);
          }
        } catch (parseErr) {
          if (parseErr.message && parseErr.message !== 'Unexpected end of JSON input') {
            throw parseErr;
          }
        }
      }
    }

    // Finalise — add action bar if missing
    if (!assistantGroup.querySelector('.msg-actions')) {
      assistantGroup.querySelector('.msg-content').insertAdjacentHTML('beforeend', actionBar());
    }

    currentMsgs.push({ role: 'assistant', content: fullText });
    saveConversation();

  } catch (err) {
    console.error('[Chat Error]', err);
    bubble.innerHTML =
      `<span style="color:#ef4444">⚠️ 오류: ${escapeHtml(err.message || '알 수 없는 오류')}. 잠시 후 다시 시도해 주세요.</span>`;
    // Roll back user message on error
    currentMsgs.pop();
  } finally {
    isGenerating = false;
    updateSendBtn();
  }
}

/* ── Copy helpers ───────────────────────────────────────── */
window.copyMsg = function (btn) {
  const bubble = btn.closest('.msg-content').querySelector('.msg-bubble');
  navigator.clipboard.writeText(bubble.innerText).then(() => flash(btn, '✓ 복사됨', '복사'));
};

window.copyCode = function (btn) {
  const code = btn.closest('.code-wrapper').querySelector('code');
  navigator.clipboard.writeText(code.innerText).then(() => flash(btn, '✓', '복사'));
};

function flash(btn, on, off) {
  const orig = btn.innerHTML;
  btn.innerHTML = on;
  setTimeout(() => { btn.innerHTML = off || orig; }, 2000);
}

/* ── Utilities ──────────────────────────────────────────── */
function scrollDown() {
  messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: 'smooth' });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])
  );
}
