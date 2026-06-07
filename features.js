/**
 * features.js — Fonctionnalités étendues de la messagerie
 * Sidebar, réponses, réactions, sondages, statuts, PWA, etc.
 */

const MESSAGE_REACTIONS = ['👍', '❤️', '😂'];
const REMINDER_MS = 60 * 60 * 1000;
const REMINDER_CHECK_MS = 5 * 60 * 1000;
const PINNED_KEY = 'pinned_messages_v1';
const NOTIF_SOUND_KEY = 'notif_sound_enabled';

let _ctx = null;
let conversations = [];
let replyToMessage = null;
let recordingChannel = null;
let globalMsgChannel = null;
let reminderInterval = null;
let pendingReminders = new Map();
let sidebarEl = null;
let replyBarEl = null;
let pinnedBarEl = null;
let statusPanelEl = null;
let notifAudio = null;

// ============================================================
// INIT
// ============================================================
export function initFeatures(ctx) {
    _ctx = ctx;
    injectSidebar();
    injectReplyBar();
    injectPinnedBar();
    injectStatusUI();
    injectPollButton();
    initNotificationSound();
    registerPWA();
    setupSwipeGestures();
    startReminderChecker();
    window.addEventListener('message', onSWMessage);
    navigator.serviceWorker?.addEventListener('message', onSWMessage);
}

export function onUserLoggedIn() {
    loadConversationList();
    subscribeToGlobalMessages();
    subscribeToRecordingIndicator();
    savePushSubscription();
    pollIncomingCalls();
    loadUserStatuses();
}

export function onUserLoggedOut() {
    if (globalMsgChannel) { _ctx.supabase.removeChannel(globalMsgChannel); globalMsgChannel = null; }
    if (recordingChannel) { _ctx.supabase.removeChannel(recordingChannel); recordingChannel = null; }
    clearInterval(reminderInterval);
    pendingReminders.clear();
    conversations = [];
    renderSidebar();
}

export function onConversationChanged() {
    renderSidebar();
    renderPinnedMessage();
    clearReply();
    subscribeToRecordingIndicator();
}

export function onMessagesLoaded() {
    renderSidebar();
    renderPinnedMessage();
    scheduleRemindersForSentMessages();
}

export function onMessageSent(message) {
    scheduleReminder(message);
    loadConversationList();
}

export function onNewMessageReceived(msg) {
    loadConversationList();
    playNotifSoundIfHidden();
}

export function enhanceMessageElement(msgEl, rowEl, message, isMine) {
    addMessageActions(msgEl, rowEl, message, isMine);
    renderReplyQuote(msgEl, message);
    renderReactionsBar(msgEl, message);
    renderPollUI(msgEl, message);
    setupSwipeOnRow(rowEl, message, isMine);
}

export function getReplyPayload() {
    return replyToMessage ? { reply_to_id: replyToMessage.id } : {};
}

export function wrapContentForSend(content) {
    if (!replyToMessage) return content;
    const ref = replyToMessage;
    clearReply();
    return content;
}

export function clearReplyAfterSend() {
    clearReply();
}

export async function compressImageIfNeeded(file) {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    let maxDim = 1920, quality = 0.82;
    const t = conn?.effectiveType;
    if (t === '3g') { maxDim = 1280; quality = 0.56; }
    else if (t === '2g' || t === 'slow-2g') { maxDim = 800; quality = 0.4; }
    if (file.size < 300000 && (!t || t === '4g')) return file;

    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width <= maxDim && height <= maxDim && file.size < 500000) { resolve(file); return; }
            const ratio = Math.min(maxDim / width, maxDim / height, 1);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => {
                if (!blob) { resolve(file); return; }
                resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
            }, 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}

export async function notifyPeerPush(recipientId, title, body, extra = {}) {
    try {
        await _ctx.supabase.functions.invoke('send-push', {
            body: { recipientId, title, body, ...extra }
        });
    } catch { /* push optionnel */ }
}

export async function persistIncomingCall(calleeId, callerId, callId, offer) {
    try {
        await _ctx.supabase.from('incoming_call_signals').insert({
            callee_id: calleeId, caller_id: callerId, call_id: callId, offer
        });
        const callerName = _ctx.users[callerId]?.username || 'Quelqu\'un';
        await notifyPeerPush(calleeId, '📞 Appel entrant', `${callerName} vous appelle`, {
            tag: 'call', requireInteraction: true, data: { type: 'call', callId, callerId }
        });
    } catch { /* table peut ne pas exister */ }
}

// ============================================================
// SIDEBAR — Liste de conversations
// ============================================================
function injectSidebar() {
    const layout = document.getElementById('app-layout');
    if (!layout || sidebarEl) return;
    sidebarEl = document.createElement('aside');
    sidebarEl.id = 'conversation-sidebar';
    sidebarEl.className = 'conversation-sidebar';
    sidebarEl.innerHTML = `
        <div class="sidebar-header">
            <h2>💬 Conversations</h2>
            <button id="sidebar-status-btn" class="sidebar-status-btn" title="Mon statut">🟢</button>
        </div>
        <div class="sidebar-mode">
            <button type="button" class="sidebar-mode-btn active" data-mode="direct">Privé</button>
            <button type="button" class="sidebar-mode-btn" data-mode="group">Groupes</button>
            <button type="button" id="sidebar-create-group" class="sidebar-create-group" title="Créer un groupe">＋</button>
        </div>
        <div class="sidebar-search-wrap">
            <input type="search" id="sidebar-search" placeholder="Rechercher…" class="sidebar-search">
        </div>
        <div id="conversation-list" class="conversation-list"></div>
    `;
    layout.insertBefore(sidebarEl, layout.firstChild);
    document.getElementById('sidebar-search')?.addEventListener('input', e => renderSidebar(e.target.value));
    document.getElementById('sidebar-status-btn')?.addEventListener('click', openStatusPanel);
    document.getElementById('sidebar-create-group')?.addEventListener('click', () => _ctx.createGroupFlow?.());
    sidebarEl.querySelectorAll('.sidebar-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _ctx.switchTargetMode(btn.dataset.mode);
            sidebarEl.querySelectorAll('.sidebar-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
            loadConversationList();
        });
    });
}

async function loadConversationList() {
    const uid = _ctx.getCurrentUserId();
    if (!uid) return;
    const { data, error } = await _ctx.supabase.from('messages')
        .select('id, id_sent, id_received, content, created_at, read_at, group_id, logical_id')
        .or(`id_sent.eq.${uid},id_received.eq.${uid}`)
        .order('created_at', { ascending: false })
        .limit(300);
    if (error) { console.warn('loadConversationList:', error); return; }

    const groupMode = _ctx.isGroupMode();
    const map = new Map();
    for (const msg of data || []) {
        if (groupMode && !msg.group_id) continue;
        if (!groupMode && msg.group_id) continue;
        let key, label, type;
        if (msg.group_id) {
            key = `g:${msg.group_id}`;
            type = 'group';
            const g = _ctx.getGroups().find(x => String(x.id) === String(msg.group_id));
            label = g?.name || 'Groupe';
        } else {
            const peer = String(msg.id_sent) === String(uid) ? msg.id_received : msg.id_sent;
            key = `d:${peer}`;
            type = 'direct';
            label = _ctx.users[peer]?.username || 'Utilisateur';
        }
        if (!map.has(key)) {
            const unread = (String(msg.id_received) === String(uid) && !msg.read_at) ? 1 : 0;
            map.set(key, { key, type, peerId: type === 'direct' ? key.slice(2) : null, groupId: type === 'group' ? key.slice(2) : null, label, preview: formatPreview(msg.content), time: msg.created_at, unread });
        } else if (String(msg.id_received) === String(uid) && !msg.read_at) {
            map.get(key).unread++;
        }
    }
    conversations = [...map.values()].sort((a, b) => new Date(b.time) - new Date(a.time));
    renderSidebar();
}

function formatPreview(content) {
    if (!content) return '';
    if (content.startsWith('{"type":"__voice__"')) return '🎙️ Message vocal';
    if (content.startsWith('{"type":"__file__"')) { try { return '📎 ' + JSON.parse(content).name; } catch { return '📎 Fichier'; } }
    if (content.startsWith('{"type":"__poll__"')) { try { return '📊 ' + JSON.parse(content).question; } catch { return '📊 Sondage'; } }
    if (content.startsWith('{"type":"__group_call__"')) return '📞 Appel de groupe';
    return content.substring(0, 50);
}

function renderSidebar(filter = '') {
    const list = document.getElementById('conversation-list');
    if (!list) return;
    const q = filter.toLowerCase().trim();
    const items = conversations.filter(c => !q || c.label.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q));
    list.innerHTML = '';
    if (!items.length) {
        list.innerHTML = '<p class="sidebar-empty">Aucune conversation</p>';
        return;
    }
    const uid = _ctx.getCurrentUserId();
    const activePeer = _ctx.userSelect?.value;
    const activeGroup = _ctx.isGroupMode() ? _ctx.getActiveGroup()?.id : null;

    items.forEach(conv => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'conv-item';
        const isActive = conv.type === 'group'
            ? (_ctx.isGroupMode() && String(activeGroup) === String(conv.groupId))
            : (!_ctx.isGroupMode() && String(activePeer) === String(conv.peerId));
        if (isActive) el.classList.add('active');
        if (conv.unread > 0) el.classList.add('has-unread');

        const avatar = conv.type === 'group' ? '👥' : (_ctx.users[conv.peerId]?.username || '?').charAt(0).toUpperCase();
        const status = conv.type === 'direct' ? getStatusEmoji(_ctx.users[conv.peerId]?.status_type) : '';
        const time = new Date(conv.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

        el.innerHTML = `
            <div class="conv-avatar">${avatar}</div>
            <div class="conv-body">
                <div class="conv-top"><span class="conv-name">${esc(conv.label)} ${status}</span><span class="conv-time">${time}</span></div>
                <div class="conv-preview">${esc(conv.preview)}</div>
            </div>
            ${conv.unread > 0 ? `<span class="conv-unread">${conv.unread > 9 ? '9+' : conv.unread}</span>` : ''}
        `;
        el.addEventListener('click', () => selectConversation(conv));
        list.appendChild(el);
    });
}

async function selectConversation(conv) {
    if (conv.type === 'group') {
        if (_ctx.targetModeSelect) _ctx.targetModeSelect.value = 'group';
        _ctx.switchTargetMode('group');
        if (_ctx.groupSelect) _ctx.groupSelect.value = conv.groupId;
        _ctx.setActiveGroupId?.(conv.groupId);
    } else {
        if (_ctx.targetModeSelect) _ctx.targetModeSelect.value = 'direct';
        _ctx.switchTargetMode('direct');
        if (_ctx.userSelect) _ctx.userSelect.value = conv.peerId;
    }
    _ctx.refreshTargetModeUI();
    if (_ctx.getCurrentUserId()) {
        _ctx.subscribeToConversation();
        _ctx.subscribeToTyping();
        await _ctx.loadInitialMessages();
        _ctx.updatePresenceUI();
        _ctx.updateCallButtonState();
    }
    onConversationChanged();
}

function esc(s) { const d = document.createElement('span'); d.textContent = s; return d.innerHTML; }

// ============================================================
// RÉPONDRE À UN MESSAGE
// ============================================================
function injectReplyBar() {
    const chatInput = document.querySelector('.chat-input');
    if (!chatInput || replyBarEl) return;
    replyBarEl = document.createElement('div');
    replyBarEl.id = 'reply-bar';
    replyBarEl.className = 'reply-bar';
    replyBarEl.style.display = 'none';
    replyBarEl.innerHTML = `<div class="reply-bar-content"><span class="reply-bar-label">Réponse à</span><span class="reply-bar-text" id="reply-bar-text"></span></div><button type="button" class="reply-bar-close" id="reply-bar-close">✕</button>`;
    chatInput.parentNode.insertBefore(replyBarEl, chatInput);
    document.getElementById('reply-bar-close')?.addEventListener('click', clearReply);
}

function setReply(message) {
    replyToMessage = message;
    if (!replyBarEl) return;
    const preview = formatPreview(message.content) || message.content?.substring(0, 60) || '…';
    const sender = _ctx.users[message.id_sent]?.username || 'Message';
    document.getElementById('reply-bar-text').textContent = `${sender}: ${preview}`;
    replyBarEl.style.display = 'flex';
    _ctx.messageInput?.focus();
}

function clearReply() {
    replyToMessage = null;
    if (replyBarEl) replyBarEl.style.display = 'none';
}

function renderReplyQuote(msgEl, message) {
    if (!message.reply_to_id) return;
    const ref = _ctx.getCurrentMessages().find(m => m.id === message.reply_to_id);
    if (!ref) return;
    const quote = document.createElement('div');
    quote.className = 'msg-reply-quote';
    const sender = _ctx.users[ref.id_sent]?.username || '?';
    quote.innerHTML = `<span class="msg-reply-sender">${esc(sender)}</span><span class="msg-reply-text">${esc(formatPreview(ref.content) || ref.content?.substring(0, 80) || '')}</span>`;
    msgEl.insertBefore(quote, msgEl.firstChild);
}

// ============================================================
// RÉACTIONS
// ============================================================
function addMessageActions(msgEl, rowEl, message, isMine) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.innerHTML = `<button type="button" class="msg-action-btn" title="Répondre">↩</button><button type="button" class="msg-action-btn" title="Épingler">📌</button>${isMine ? '<button type="button" class="msg-action-btn" title="Supprimer">🗑</button>' : ''}`;
    actions.querySelector('[title="Répondre"]')?.addEventListener('click', e => { e.stopPropagation(); setReply(message); });
    actions.querySelector('[title="Épingler"]')?.addEventListener('click', e => { e.stopPropagation(); pinMessage(message); });
    if (isMine) actions.querySelector('[title="Supprimer"]')?.addEventListener('click', e => { e.stopPropagation(); msgEl.querySelector('.delete-button')?.click(); });
    rowEl.appendChild(actions);

    msgEl.addEventListener('dblclick', e => { e.stopPropagation(); toggleReaction(message, '❤️'); });
    let pressTimer = null;
    msgEl.addEventListener('touchstart', e => {
        pressTimer = setTimeout(() => showReactionPicker(msgEl, message), 500);
    }, { passive: true });
    msgEl.addEventListener('touchend', () => clearTimeout(pressTimer));
    msgEl.addEventListener('touchmove', () => clearTimeout(pressTimer));
}

function showReactionPicker(msgEl, message) {
    document.querySelector('.reaction-picker-popup')?.remove();
    const pop = document.createElement('div');
    pop.className = 'reaction-picker-popup';
    MESSAGE_REACTIONS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.textContent = emoji;
        btn.addEventListener('click', () => { toggleReaction(message, emoji); pop.remove(); });
        pop.appendChild(btn);
    });
    msgEl.appendChild(pop);
    setTimeout(() => document.addEventListener('click', function close() { pop.remove(); document.removeEventListener('click', close); }), 0);
}

async function toggleReaction(message, emoji) {
    const uid = _ctx.getCurrentUserId();
    if (!uid) return;
    const reactions = { ...(message.reactions || {}) };
    if (reactions[uid] === emoji) delete reactions[uid];
    else reactions[uid] = emoji;
    message.reactions = reactions;
    const { error } = await _ctx.supabase.from('messages').update({ reactions }).eq('id', message.id);
    if (error) {
        message.reactions = message.reactions || {};
        console.warn('toggleReaction:', error);
        return;
    }
    const idx = _ctx.getCurrentMessages().findIndex(m => m.id === message.id);
    if (idx !== -1) _ctx.getCurrentMessages()[idx].reactions = reactions;
    const msgEl = document.querySelector(`[data-msg-id="${message.id}"]`);
    if (msgEl) {
        msgEl.querySelector('.msg-reactions')?.remove();
        renderReactionsBar(msgEl, message);
    }
}

function renderReactionsBar(msgEl, message) {
    const reactions = message.reactions;
    if (!reactions || !Object.keys(reactions).length) return;
    const counts = {};
    Object.values(reactions).forEach(e => { counts[e] = (counts[e] || 0) + 1; });
    const bar = document.createElement('div');
    bar.className = 'msg-reactions';
    Object.entries(counts).forEach(([emoji, count]) => {
        const span = document.createElement('span');
        span.className = 'msg-reaction-chip';
        span.textContent = count > 1 ? `${emoji} ${count}` : emoji;
        bar.appendChild(span);
    });
    msgEl.appendChild(bar);
}

// ============================================================
// ÉPINGLER
// ============================================================
function injectPinnedBar() {
    const chatMessages = _ctx.chatMessages;
    if (!chatMessages || pinnedBarEl) return;
    pinnedBarEl = document.createElement('div');
    pinnedBarEl.id = 'pinned-bar';
    pinnedBarEl.className = 'pinned-bar';
    pinnedBarEl.style.display = 'none';
    chatMessages.parentNode.insertBefore(pinnedBarEl, chatMessages);
}

function getThreadKey() {
    if (_ctx.isGroupMode()) return `g:${_ctx.getActiveGroup()?.id}`;
    return `d:${_ctx.userSelect?.value}`;
}

function pinMessage(message) {
    const key = getThreadKey();
    if (!key || key.includes('undefined')) return;
    const pinned = loadPinned();
    pinned[key] = message.id;
    localStorage.setItem(PINNED_KEY, JSON.stringify(pinned));
    if (_ctx.isGroupMode() && _ctx.getActiveGroup()?.id) {
        _ctx.supabase.from('chat_groups').update({ pinned_message_id: message.id }).eq('id', _ctx.getActiveGroup().id).catch(() => {});
    }
    renderPinnedMessage();
}

function loadPinned() {
    try { return JSON.parse(localStorage.getItem(PINNED_KEY)) || {}; } catch { return {}; }
}

function renderPinnedMessage() {
    if (!pinnedBarEl) return;
    const key = getThreadKey();
    const pinned = loadPinned();
    const msgId = pinned[key];
    if (!msgId) { pinnedBarEl.style.display = 'none'; return; }
    const msg = _ctx.getCurrentMessages().find(m => m.id === msgId);
    if (!msg) { pinnedBarEl.style.display = 'none'; return; }
    pinnedBarEl.style.display = 'flex';
    pinnedBarEl.innerHTML = `<span class="pinned-icon">📌</span><span class="pinned-text">${esc(formatPreview(msg.content) || msg.content?.substring(0, 80) || '')}</span><button type="button" class="pinned-unpin" title="Désépingler">✕</button>`;
    pinnedBarEl.querySelector('.pinned-unpin')?.addEventListener('click', () => {
        const p = loadPinned(); delete p[key]; localStorage.setItem(PINNED_KEY, JSON.stringify(p));
        pinnedBarEl.style.display = 'none';
    });
    pinnedBarEl.onclick = () => {
        const el = document.querySelector(`[data-msg-id="${msgId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
}

// ============================================================
// SONDAGES
// ============================================================
function injectPollButton() {
    const chatInput = document.querySelector('.chat-input');
    const sendBtn = document.getElementById('send-button');
    if (!chatInput || !sendBtn || document.getElementById('poll-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'poll-btn'; btn.type = 'button'; btn.className = 'icon-button poll-btn';
    btn.title = 'Créer un sondage'; btn.textContent = '📊';
    btn.addEventListener('click', createPollFlow);
    chatInput.insertBefore(btn, sendBtn);
}

function createPollFlow() {
    const question = prompt('Question du sondage :');
    if (!question?.trim()) return;
    const opt1 = prompt('Option 1 :'); if (!opt1?.trim()) return;
    const opt2 = prompt('Option 2 :'); if (!opt2?.trim()) return;
    const opt3 = prompt('Option 3 (optionnel, laisser vide pour ignorer) :');
    const options = [opt1.trim(), opt2.trim()];
    if (opt3?.trim()) options.push(opt3.trim());
    const payload = JSON.stringify({ type: '__poll__', question: question.trim(), options, votes: {} });
    _ctx.sendMessage(_ctx.getCurrentUserId(), payload);
}

function parsePoll(content) {
    if (!content?.startsWith('{"type":"__poll__"')) return null;
    try { const o = JSON.parse(content); return o.type === '__poll__' ? o : null; } catch { return null; }
}

export function parsePollMessage(content) { return parsePoll(content); }

function renderPollUI(msgEl, message) {
    const poll = parsePoll(message.content);
    if (!poll) return;
    const uid = _ctx.getCurrentUserId();
    const wrap = document.createElement('div');
    wrap.className = 'poll-wrap';
    wrap.innerHTML = `<div class="poll-question">📊 ${esc(poll.question)}</div>`;
    const total = Object.keys(poll.votes || {}).length;
    poll.options.forEach((opt, i) => {
        const votes = Object.values(poll.votes || {}).filter(v => v === i).length;
        const pct = total ? Math.round(votes / total * 100) : 0;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'poll-option' + (poll.votes?.[uid] === i ? ' voted' : '');
        btn.innerHTML = `<span class="poll-opt-label">${esc(opt)}</span><span class="poll-opt-bar"><span class="poll-opt-fill" style="width:${pct}%"></span></span><span class="poll-opt-pct">${pct}%</span>`;
        btn.addEventListener('click', () => votePoll(message, i));
        wrap.appendChild(btn);
    });
    msgEl.querySelector('.msg-meta')?.before(wrap);
    const textNode = [...msgEl.childNodes].find(n => n.nodeType === 3);
    if (textNode) textNode.remove();
}

async function votePoll(message, optionIndex) {
    const poll = parsePoll(message.content);
    if (!poll) return;
    const uid = _ctx.getCurrentUserId();
    poll.votes = poll.votes || {};
    poll.votes[uid] = poll.votes[uid] === optionIndex ? undefined : optionIndex;
    if (poll.votes[uid] === undefined) delete poll.votes[uid];
    const newContent = JSON.stringify(poll);
    const { error } = await _ctx.supabase.from('messages').update({ content: newContent }).eq('id', message.id);
    if (error) { console.warn('votePoll:', error); return; }
    message.content = newContent;
    const idx = _ctx.getCurrentMessages().findIndex(m => m.id === message.id);
    if (idx !== -1) _ctx.getCurrentMessages()[idx].content = newContent;
    const msgEl = document.querySelector(`[data-msg-id="${message.id}"]`);
    if (msgEl) {
        msgEl.querySelector('.poll-wrap')?.remove();
        renderPollUI(msgEl, message);
    }
}

// ============================================================
// STATUT PERSONNALISÉ
// ============================================================
function injectStatusUI() {
    if (statusPanelEl) return;
    statusPanelEl = document.createElement('div');
    statusPanelEl.id = 'status-panel';
    statusPanelEl.className = 'status-panel';
    statusPanelEl.style.display = 'none';
    statusPanelEl.innerHTML = `
        <div class="status-panel-card">
            <h3>Mon statut</h3>
            <div class="status-options">
                <button data-status="available" class="status-opt">🟢 Disponible</button>
                <button data-status="busy" class="status-opt">🔴 Occupé</button>
                <button data-status="away" class="status-opt">🟡 Absent</button>
            </div>
            <input type="text" id="status-custom-text" placeholder="Texte libre (optionnel)" maxlength="60">
            <div class="status-panel-actions">
                <button id="status-save-btn" class="status-save-btn">Enregistrer</button>
                <button id="status-close-btn" class="status-close-btn">Fermer</button>
            </div>
        </div>`;
    document.body.appendChild(statusPanelEl);
    statusPanelEl.querySelectorAll('.status-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            statusPanelEl.dataset.selected = btn.dataset.status;
            statusPanelEl.querySelectorAll('.status-opt').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
    document.getElementById('status-save-btn')?.addEventListener('click', saveStatus);
    document.getElementById('status-close-btn')?.addEventListener('click', () => { statusPanelEl.style.display = 'none'; });
    statusPanelEl.addEventListener('click', e => { if (e.target === statusPanelEl) statusPanelEl.style.display = 'none'; });
}

function openStatusPanel() {
    if (!statusPanelEl) return;
    statusPanelEl.style.display = 'flex';
    const uid = _ctx.getCurrentUserId();
    const me = _ctx.users[uid];
    if (me?.status_type) {
        statusPanelEl.dataset.selected = me.status_type;
        statusPanelEl.querySelector(`[data-status="${me.status_type}"]`)?.classList.add('active');
    }
    document.getElementById('status-custom-text').value = me?.status_text || '';
}

async function saveStatus() {
    const uid = _ctx.getCurrentUserId();
    if (!uid) return;
    const status_type = statusPanelEl.dataset.selected || 'available';
    const status_text = document.getElementById('status-custom-text')?.value?.trim() || null;
    const { error } = await _ctx.supabase.from('users').update({ status_type, status_text }).eq('id', uid);
    if (error) { alert('Impossible de sauvegarder le statut. Exécute la migration SQL.'); return; }
    _ctx.users[uid].status_type = status_type;
    _ctx.users[uid].status_text = status_text;
    statusPanelEl.style.display = 'none';
    updateMyStatusButton();
    _ctx.broadcastMyStatus?.();
}

function updateMyStatusButton() {
    const btn = document.getElementById('sidebar-status-btn');
    const uid = _ctx.getCurrentUserId();
    if (!btn || !uid) return;
    btn.textContent = getStatusEmoji(_ctx.users[uid]?.status_type);
    btn.title = _ctx.users[uid]?.status_text || 'Mon statut';
}

async function loadUserStatuses() {
    const { data } = await _ctx.supabase.from('users').select('id, username, status_type, status_text, avatar_url');
    (data || []).forEach(u => {
        if (_ctx.users[u.id]) Object.assign(_ctx.users[u.id], u);
        else _ctx.users[u.id] = u;
    });
    updateMyStatusButton();
    renderSidebar();
}

function getStatusEmoji(type) {
    return { available: '🟢', busy: '🔴', away: '🟡', custom: '💬' }[type] || '🟢';
}

// ============================================================
// INDICATEUR ENREGISTREMENT VOCAL
// ============================================================
function subscribeToRecordingIndicator() {
    if (recordingChannel) { _ctx.supabase.removeChannel(recordingChannel); recordingChannel = null; }
    const uid = _ctx.getCurrentUserId();
    const peer = _ctx.userSelect?.value;
    if (!uid || !peer || _ctx.isGroupMode()) return;
    const channelName = `recording:${[uid, peer].sort().join(':')}`;
    recordingChannel = _ctx.supabase.channel(channelName)
        .on('broadcast', { event: 'recording' }, ({ payload }) => {
            if (payload.user_id === uid) return;
            const ind = _ctx.typingIndicator;
            if (!ind) return;
            if (payload.is_recording) {
                const name = _ctx.users[payload.user_id]?.username || 'U';
                ind.innerHTML = `<div class="typing-avatar">${name.charAt(0).toUpperCase()}</div><div class="typing-body"><span class="recording-label">🎙️ Enregistre un vocal…</span></div>`;
                ind.style.display = 'flex';
            } else if (!payload.is_typing) {
                ind.style.display = 'none';
            }
        })
        .subscribe();
}

export async function broadcastRecording(isRecording) {
    if (!recordingChannel || !_ctx.getCurrentUserId() || _ctx.isGroupMode()) return;
    try {
        await recordingChannel.send({ type: 'broadcast', event: 'recording', payload: { user_id: _ctx.getCurrentUserId(), is_recording: isRecording } });
    } catch {}
}

// ============================================================
// SON DE NOTIFICATION
// ============================================================
function initNotificationSound() {
    try { window.__notifAudioCtx = new AudioContext(); } catch {}
}

export function playNotifSoundIfHidden() {
    if (!document.hidden) return;
    if (localStorage.getItem(NOTIF_SOUND_KEY) === '0') return;
    try {
        const ctx = window.__notifAudioCtx || new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(); osc.stop(ctx.currentTime + 0.3);
    } catch {}
}

// ============================================================
// RAPPELS AUTOMATIQUES
// ============================================================
function startReminderChecker() {
    setInterval(checkReminders, REMINDER_CHECK_MS);
}

function scheduleRemindersForSentMessages() {
    pendingReminders.forEach(t => clearTimeout(t));
    pendingReminders.clear();
    const uid = _ctx.getCurrentUserId();
    if (!uid) return;
    const msgs = _ctx.getCurrentMessages().filter(m => String(m.id_sent) === String(uid) && !m.read_at);
    msgs.forEach(m => scheduleReminder(m));
}

function scheduleReminder(message) {
    if (!message?.id || message.read_at) return;
    const uid = _ctx.getCurrentUserId();
    if (String(message.id_sent) !== String(uid)) return;
    if (pendingReminders.has(message.id)) return;
    const elapsed = Date.now() - new Date(message.created_at).getTime();
    const delay = Math.max(0, REMINDER_MS - elapsed);
    const t = setTimeout(() => fireReminder(message.id), delay);
    pendingReminders.set(message.id, t);
}

function fireReminder(messageId) {
    pendingReminders.delete(messageId);
    const msg = _ctx.getCurrentMessages().find(m => m.id === messageId);
    if (!msg || msg.read_at) return;
    const peer = _ctx.users[msg.id_received]?.username || 'votre contact';
    _ctx.showNotification('⏰ Pas de réponse', `Message à ${peer} sans réponse depuis 1 h`);
    playNotifSoundIfHidden();
    const badge = document.querySelector('.conv-item.active .conv-unread') || document.createElement('span');
    badge.className = 'reminder-badge';
    badge.textContent = '⏰';
    document.getElementById('conversation-list')?.querySelector('.conv-item.active')?.appendChild(badge);
}

function checkReminders() {
    scheduleRemindersForSentMessages();
}

// ============================================================
// NOTIFICATIONS GLOBALES + PUSH
// ============================================================
function subscribeToGlobalMessages() {
    if (globalMsgChannel) { _ctx.supabase.removeChannel(globalMsgChannel); globalMsgChannel = null; }
    const uid = _ctx.getCurrentUserId();
    if (!uid) return;
    globalMsgChannel = _ctx.supabase.channel(`global-msgs-${uid}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `id_received=eq.${uid}` }, async (payload) => {
            const msg = payload.new;
            onNewMessageReceived(msg);
            await loadConversationList();
            const isCurrentConv = isMessageInCurrentConversation(msg);
            if (!isCurrentConv) {
                const from = _ctx.users[msg.id_sent]?.username || '?';
                const preview = formatPreview(msg.content);
                _ctx.showNotification(`Message de ${from}`, preview);
                playNotifSoundIfHidden();
                notifyViaPushIfNeeded(msg, from, preview);
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `id_sent=eq.${uid}` }, payload => {
            if (payload.new.read_at) {
                pendingReminders.delete(payload.new.id);
                if (payload.new.logical_id) {
                    _ctx.getCurrentMessages().filter(m => m.logical_id === payload.new.logical_id).forEach(m => pendingReminders.delete(m.id));
                }
            }
        })
        .subscribe();
}

function isMessageInCurrentConversation(msg) {
    if (!_ctx.hasActiveTarget()) return false;
    if (_ctx.isGroupMode()) return String(msg.group_id) === String(_ctx.getActiveGroup()?.id);
    const peer = _ctx.userSelect?.value;
    return !msg.group_id && (String(msg.id_sent) === String(peer) || String(msg.id_received) === String(peer));
}

async function notifyViaPushIfNeeded(msg, from, preview) {
    if (document.visibilityState === 'visible') return;
    await notifyPeerPush(_ctx.getCurrentUserId(), `Message de ${from}`, preview, { tag: 'msg-' + msg.id });
}

async function savePushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            const vapidKey = _ctx.VAPID_PUBLIC_KEY;
            if (!vapidKey) return;
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
        }
        const uid = _ctx.getCurrentUserId();
        if (!uid || !sub) return;
        await _ctx.supabase.from('push_subscriptions').upsert({
            user_id: uid,
            endpoint: sub.endpoint,
            subscription: sub.toJSON()
        }, { onConflict: 'user_id,endpoint' });
    } catch (e) { console.warn('Push subscription:', e); }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function pollIncomingCalls() {
    const uid = _ctx.getCurrentUserId();
    if (!uid) return;
    setInterval(async () => {
        if (_ctx.getCallState?.() !== 'idle') return;
        try {
            const { data } = await _ctx.supabase.from('incoming_call_signals')
                .select('*').eq('callee_id', uid).is('handled_at', null)
                .order('created_at', { ascending: false }).limit(1);
            if (data?.[0]) {
                const sig = data[0];
                await _ctx.supabase.from('incoming_call_signals').update({ handled_at: new Date().toISOString() }).eq('id', sig.id);
                _ctx.handleCallSignal?.({ type: 'incoming', callId: sig.call_id, callerId: sig.caller_id, offer: sig.offer });
            }
        } catch {}
    }, 4000);
}

function onSWMessage(e) {
    const data = e.data;
    if (!data || data.type !== 'notification-click') return;
    if (data.data?.type === 'call') {
        _ctx.handleCallSignal?.({ type: 'incoming', callId: data.data.callId, callerId: data.data.callerId, offer: data.data.offer });
    }
}

// ============================================================
// PWA
// ============================================================
async function registerPWA() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        if (reg.waiting) reg.waiting.postMessage({ type: 'skipWaiting' });
    } catch (e) { console.warn('SW registration:', e); }
}

// ============================================================
// SWIPE GESTURES
// ============================================================
function setupSwipeGestures() {
    /* delegated via setupSwipeOnRow */
}

function setupSwipeOnRow(rowEl, message, isMine) {
    let startX = 0, startY = 0, swiping = false;
    rowEl.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        swiping = true;
    }, { passive: true });
    rowEl.addEventListener('touchmove', e => {
        if (!swiping) return;
        const dx = e.touches[0].clientX - startX;
        const dy = Math.abs(e.touches[0].clientY - startY);
        if (dy > 30) { swiping = false; rowEl.style.transform = ''; return; }
        if (Math.abs(dx) > 10) rowEl.style.transform = `translateX(${dx * 0.4}px)`;
    }, { passive: true });
    rowEl.addEventListener('touchend', e => {
        if (!swiping) return;
        swiping = false;
        const dx = e.changedTouches[0].clientX - startX;
        rowEl.style.transform = '';
        if (dx > 80) setReply(message);
        else if (dx < -80 && isMine) {
            if (confirm('Supprimer ce message ?')) rowEl.querySelector('.delete-button')?.click();
        }
    }, { passive: true });
}

// ============================================================
// GROUP AVATAR / DESCRIPTION (UI dans createGroupFlow)
// ============================================================
export async function enrichGroupCreation(name, description, avatarDataUrl) {
    return { name, description: description || null, avatar_url: avatarDataUrl || null };
}

export function getGroupAvatar(group) {
    if (group?.avatar_url) return `<img src="${group.avatar_url}" class="group-avatar-img" alt="">`;
    return (group?.name || 'G').charAt(0).toUpperCase();
}
