import 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js';

const supabaseUrl = 'https://toglujtvmslqutjeqmrh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZ2x1anR2bXNscXV0amVxbXJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1ODg0OTUsImV4cCI6MjA4OTE2NDQ5NX0.uezhrVRl2FTtVRfgXBMAnxcwROUNc91ruVegsyMD38U';

const chatMessages       = document.getElementById('chat-messages');
const messageInput       = document.getElementById('message-input');
const sendButton         = document.getElementById('send-button');
const emojiButton        = document.getElementById('emoji-button');
const emojiPickerWrapper = document.getElementById('emoji-picker-wrapper');
const userSelect         = document.getElementById('user-select');
const loginUsername      = document.getElementById('login-username');
const loginPassword      = document.getElementById('login-password');
const loginButton        = document.getElementById('login-button');
const loginContainer     = document.getElementById('login-container');
const connectedUser      = document.getElementById('connected-user');
const connectedUsername  = document.getElementById('connected-username');
const logoutButton       = document.getElementById('logout-button');
const typingIndicator    = document.getElementById('typing-indicator');
const quickReplies       = document.getElementById('quick-replies');
const networkIndicator   = document.getElementById('network-indicator');

let users            = {};
let currentUserId    = null;
let refreshInterval  = null;
let typingTimeout    = null;
let isTyping         = false;
let currentMessages  = [];
let lastMessageCount = 0;
let emojiPickerOverlay  = null;
let sessionValidationInterval = null;

// Présence
let onlineUsers     = new Set();  // Set<userId>
let usersWithUnread = new Map();  // Map<userId, count>
let heartbeatInterval = null;
let presenceInterval  = null;

const SESSION_STORAGE_KEY       = 'persistent_session_v1';
const SESSION_DURATION_MS       = 1000 * 60 * 60 * 24 * 30;
const SESSION_CHECK_INTERVAL_MS = 1000 * 60 * 5;
const ONLINE_THRESHOLD_SECONDS  = 30;
const HEARTBEAT_INTERVAL_MS     = 15000;

// ===========================================================
// RÉSEAU
// ===========================================================
function updateNetworkIndicator() {
    if (!navigator.onLine) { networkIndicator.textContent = '🔴'; networkIndicator.title = 'Hors ligne'; return; }
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
        const t = conn.effectiveType;
        if      (t === '4g') { networkIndicator.textContent = '🟢'; networkIndicator.title = 'Réseau excellent'; }
        else if (t === '3g') { networkIndicator.textContent = '🟡'; networkIndicator.title = 'Réseau moyen'; }
        else                 { networkIndicator.textContent = '🔴'; networkIndicator.title = 'Réseau faible'; }
    } else { networkIndicator.textContent = '🟢'; networkIndicator.title = 'En ligne'; }
}
window.addEventListener('online',  updateNetworkIndicator);
window.addEventListener('offline', updateNetworkIndicator);
updateNetworkIndicator();

// ===========================================================
// SESSION
// ===========================================================
function generateRefreshToken() {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function loadSession()  { try { return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)); } catch { return null; } }
function saveSession(s) { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SESSION_STORAGE_KEY); }
function stopSessionValidation() { if (sessionValidationInterval) { clearInterval(sessionValidationInterval); sessionValidationInterval = null; } }

async function validateSession(session) {
    if (!session?.userId || !session?.expiresAt) return false;
    if (Date.now() > session.expiresAt) return false;
    try {
        const r = await fetch(
            `${supabaseUrl}/rest/v1/users?select=id,username,password&id=eq.${session.userId}`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const data = await r.json();
        if (!r.ok || !data.length) return false;
        if (data[0].password !== session.plainPassword) return false;
        session.username = data[0].username;
        session.lastValidatedAt = Date.now();
        saveSession(session);
        return true;
    } catch { return true; }
}

function startSessionValidation() {
    stopSessionValidation();
    sessionValidationInterval = setInterval(async () => {
        if (!await validateSession(loadSession()))
            logout({ silent: false, reason: 'Session expirée, veuillez vous reconnecter.' });
    }, SESSION_CHECK_INTERVAL_MS);
}

async function restoreSession() {
    const session = loadSession();
    if (!session) return false;
    if (!await validateSession(session)) { clearSession(); return false; }
    currentUserId = session.userId;
    users[session.userId] = { id: session.userId, username: session.username };
    loginContainer.style.display  = 'none';
    connectedUser.style.display   = 'flex';
    connectedUsername.textContent  = session.username;
    await requestNotificationPermission();
    getMessages();
    refreshMessages();
    startSessionValidation();
    startPresence();
    return true;
}

// ===========================================================
// PRÉSENCE — table user_presence
// ===========================================================
async function sendHeartbeat() {
    if (!currentUserId) return;
    const now = new Date().toISOString();
    try {
        // Vérifier si une ligne existe déjà
        const check = await fetch(
            `${supabaseUrl}/rest/v1/user_presence?user_id=eq.${currentUserId}&select=user_id`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const rows = await check.json();
        if (rows.length > 0) {
            await fetch(`${supabaseUrl}/rest/v1/user_presence?user_id=eq.${currentUserId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=minimal' },
                body: JSON.stringify({ last_seen: now })
            });
        } else {
            await fetch(`${supabaseUrl}/rest/v1/user_presence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=minimal' },
                body: JSON.stringify({ user_id: currentUserId, last_seen: now })
            });
        }
    } catch { /* silencieux */ }
}

async function fetchOnlineUsers() {
    try {
        const since = new Date(Date.now() - ONLINE_THRESHOLD_SECONDS * 1000).toISOString();
        const r = await fetch(
            `${supabaseUrl}/rest/v1/user_presence?select=user_id&last_seen=gte.${since}`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const data = await r.json();
        if (!r.ok) return;
        onlineUsers = new Set(data.map(row => row.user_id));
    } catch { /* silencieux */ }
}

async function fetchUnreadByUser() {
    if (!currentUserId) return;
    try {
        const r = await fetch(
            `${supabaseUrl}/rest/v1/messages?select=id_sent&id_received=eq.${currentUserId}&read_at=is.null`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const data = await r.json();
        if (!r.ok) return;
        const map = new Map();
        data.forEach(msg => {
            // Ne pas compter la conversation déjà ouverte (sera marquée lue immédiatement)
            if (msg.id_sent === userSelect.value) return;
            map.set(msg.id_sent, (map.get(msg.id_sent) || 0) + 1);
        });
        usersWithUnread = map;
    } catch { /* silencieux */ }
}

function updatePresenceUI_display() {
    // Mettre à jour le texte de chaque option avec préfixe emoji
    Array.from(userSelect.options).forEach(opt => {
        const uid  = opt.value;
        const user = users[uid];
        if (!user) return;
        if      (usersWithUnread.has(uid)) opt.textContent = `🔴 ${user.username}`;
        else if (onlineUsers.has(uid))     opt.textContent = `🟢 ${user.username}`;
        else                               opt.textContent = user.username;
    });

    // Pastille à côté du select pour l'utilisateur sélectionné
    const wrapper = document.querySelector('.user-selection');
    if (wrapper) {
        wrapper.querySelectorAll('.status-pill').forEach(el => el.remove());
        const selId = userSelect.value;
        if (selId) {
            const pill = document.createElement('span');
            pill.className = 'status-pill';
            if (usersWithUnread.has(selId)) {
                pill.textContent    = usersWithUnread.get(selId);
                pill.dataset.status = 'unread';
                pill.title = `${usersWithUnread.get(selId)} message(s) non lu(s)`;
                wrapper.appendChild(pill);
            } else if (onlineUsers.has(selId)) {
                pill.dataset.status = 'online';
                pill.title = 'En ligne';
                wrapper.appendChild(pill);
            }
            // Pas de pastille si hors ligne
        }
    }

    // Badge total non lus devant le select
    document.querySelectorAll('.unread-total-badge').forEach(el => el.remove());
    const total = [...usersWithUnread.values()].reduce((a, b) => a + b, 0);
    if (total > 0) {
        const badge = document.createElement('span');
        badge.className   = 'unread-total-badge';
        badge.textContent = total > 99 ? '99+' : total;
        badge.title       = `${total} message(s) non lu(s)`;
        userSelect.insertAdjacentElement('beforebegin', badge);
    }
}

async function refreshPresence() {
    await fetchOnlineUsers();
    await fetchUnreadByUser();
    updatePresenceUI_display();
}

function startPresence() {
    stopPresence();
    sendHeartbeat();
    heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    refreshPresence();
    presenceInterval  = setInterval(refreshPresence, 5000);
}

function stopPresence() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    if (presenceInterval)  { clearInterval(presenceInterval);  presenceInterval  = null; }
}

function clearPresenceUI() {
    Array.from(userSelect.options).forEach(opt => {
        if (opt.value && users[opt.value]) opt.textContent = users[opt.value].username;
    });
    document.querySelectorAll('.status-pill, .unread-total-badge').forEach(el => el.remove());
    onlineUsers     = new Set();
    usersWithUnread = new Map();
}

// ===========================================================
// EMOJI PICKER
// ===========================================================
function initEmojiPicker() {
    const picker = document.querySelector('emoji-picker');
    if (!picker) return;
    picker.addEventListener('emoji-click', e => {
        const pos = messageInput.selectionStart ?? messageInput.value.length;
        messageInput.value = messageInput.value.substring(0, pos) + e.detail.unicode + messageInput.value.substring(pos);
        const np = pos + e.detail.unicode.length;
        messageInput.setSelectionRange(np, np);
        messageInput.focus();
    });
}
function openEmojiPicker() {
    if (!emojiPickerOverlay) {
        emojiPickerOverlay = document.createElement('div');
        emojiPickerOverlay.className = 'emoji-picker-overlay';
        emojiPickerOverlay.addEventListener('click', closeEmojiPicker);
        document.body.appendChild(emojiPickerOverlay);
    }
    emojiPickerWrapper.style.display = 'block';
    emojiPickerWrapper.classList.remove('hiding');
    emojiButton.classList.add('active');
}
function closeEmojiPicker() {
    emojiPickerWrapper.classList.add('hiding');
    emojiButton.classList.remove('active');
    setTimeout(() => { emojiPickerWrapper.style.display = 'none'; emojiPickerWrapper.classList.remove('hiding'); }, 200);
    if (emojiPickerOverlay?.parentNode) { emojiPickerOverlay.parentNode.removeChild(emojiPickerOverlay); emojiPickerOverlay = null; }
}
function toggleEmojiPicker() { emojiPickerWrapper.style.display !== 'none' ? closeEmojiPicker() : openEmojiPicker(); }

document.addEventListener('DOMContentLoaded', initEmojiPicker);
emojiButton.addEventListener('click', e => { e.stopPropagation(); toggleEmojiPicker(); });
document.addEventListener('click', e => {
    if (!emojiPickerWrapper.contains(e.target) && e.target !== emojiButton)
        if (emojiPickerWrapper.style.display !== 'none') closeEmojiPicker();
});

// ===========================================================
// NOTIFICATIONS PUSH
// ===========================================================
async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission !== 'denied') return (await Notification.requestPermission()) === 'granted';
    return false;
}
function showNotification(title, body) {
    if (Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(title, { body, tag: 'msg', requireInteraction: false, silent: false });
        n.onclick = () => { window.focus(); n.close(); };
        setTimeout(() => n.close(), 5000);
    }
}

// ===========================================================
// UTILISATEURS
// ===========================================================
async function getUsers() {
    const r = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
    });
    const data = await r.json();
    if (!r.ok) { console.error('getUsers:', data); return; }
    userSelect.innerHTML = '';
    data.forEach(user => {
        users[user.id] = user;
        const opt = document.createElement('option');
        opt.value = user.id;
        opt.textContent = user.username;
        userSelect.appendChild(opt);
    });
    if (currentUserId) refreshPresence();
}

// ===========================================================
// GÉOLOCALISATION
// ===========================================================
function getGeolocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('Non supporté')); return; }
        navigator.geolocation.getCurrentPosition(p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }), reject);
    });
}
async function getCityFromCoordinates(lat, lon) {
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
        const d = await r.json();
        return d.address?.city || d.address?.town || d.address?.village || null;
    } catch { return null; }
}

// ===========================================================
// TYPING INDICATOR
// ===========================================================
async function updateTypingStatus(isTypingNow) {
    if (!currentUserId || !userSelect.value) return;
    try {
        const check = await fetch(
            `${supabaseUrl}/rest/v1/typing_status?user_id=eq.${currentUserId}&recipient_id=eq.${userSelect.value}`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const existing = await check.json();
        const body = JSON.stringify({ is_typing: isTypingNow, updated_at: new Date().toISOString() });
        if (existing.length > 0) {
            await fetch(`${supabaseUrl}/rest/v1/typing_status?user_id=eq.${currentUserId}&recipient_id=eq.${userSelect.value}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
                body
            });
        } else {
            await fetch(`${supabaseUrl}/rest/v1/typing_status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=minimal' },
                body: JSON.stringify({ user_id: currentUserId, recipient_id: userSelect.value, is_typing: isTypingNow, updated_at: new Date().toISOString() })
            });
        }
    } catch (e) { console.error('updateTypingStatus:', e); }
}

async function checkTypingStatus() {
    if (!currentUserId || !userSelect.value) { typingIndicator.style.display = 'none'; return; }
    try {
        const r = await fetch(
            `${supabaseUrl}/rest/v1/typing_status?user_id=eq.${userSelect.value}&recipient_id=eq.${currentUserId}&select=*`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const data = await r.json();
        if (data.length > 0 && data[0].is_typing && (Date.now() - new Date(data[0].updated_at)) / 1000 < 3) {
            const name = users[userSelect.value]?.username || 'L\'utilisateur';
            typingIndicator.innerHTML = `<span>${name} est en train d'écrire</span><span class="typing-dots"><span></span><span></span><span></span></span>`;
            typingIndicator.style.display = 'flex';
        } else {
            typingIndicator.style.display = 'none';
        }
    } catch (e) { console.error('checkTypingStatus:', e); }
}

messageInput.addEventListener('input', () => {
    if (!isTyping) { isTyping = true; updateTypingStatus(true); }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { isTyping = false; updateTypingStatus(false); }, 2000);
});

// ===========================================================
// RÉPONSES RAPIDES
// ===========================================================
function generateQuickReplies(lastMessage) {
    if (!lastMessage || lastMessage.id_sent === currentUserId) { quickReplies.style.display = 'none'; return; }
    const content = lastMessage.content.toLowerCase().trim();
    if (content.length < 3) { quickReplies.style.display = 'none'; return; }
    const patterns = {
        greeting:     { kw: ['bonjour','salut','hello','coucou','bonsoir'],      r: ['👋 Bonjour !','Salut !','Hello !','Ça va ?'] },
        thanks:       { kw: ['merci','thanks','thx'],                            r: ['De rien !','Avec plaisir !','😊','Pas de souci !'] },
        howareyou:    { kw: ['comment vas','ça va','tu vas'],                    r: ['Très bien merci !','Ça va et toi ?','Super !'] },
        agreement:    { kw: ['ok','oui','yes',"d'accord"],                       r: ['Parfait !','👍','Super !','Génial !'] },
        disagreement: { kw: ['non','no',"pas d'accord"],                         r: ["D'accord",'Pas de souci','Compris'] },
        apology:      { kw: ['désolé','sorry','pardon'],                         r: ['Pas grave !',"T'inquiète pas",'Aucun souci'] },
        laugh:        { kw: ['haha','lol','mdr'],                                r: ['😂','Haha oui','Trop marrant'] },
        planning:     { kw: ['demain','ce soir','weekend','plan','rendez-vous'], r: ['Avec plaisir','Super idée','Je suis partant'] },
        tired:        { kw: ['occupé','fatigue','dormir','pas le temps'],        r: ['Pas grave','À plus tard','Dors bien !'] },
        help:         { kw: ['aide','help','besoin'],                            r: ['Bien sûr !','Avec plaisir','Je suis là'] },
        default:      { kw: [],                                                  r: ['👍','❤️','😊','🔥','Cool','Oui'] }
    };
    const kwMap = {};
    Object.entries(patterns).forEach(([cat, p]) => p.kw.forEach(k => { kwMap[k] = cat; }));
    const matched = new Set();
    content.split(/\s+/).forEach(w => { if (kwMap[w]) matched.add(kwMap[w]); });
    if (!matched.size) matched.add('default');
    const selected = [];
    for (const cat of matched) {
        for (const reply of patterns[cat].r) {
            if (selected.length >= 4) break;
            if (!selected.includes(reply)) selected.push(reply);
        }
        if (selected.length >= 4) break;
    }
    if (!selected.length) { quickReplies.style.display = 'none'; return; }
    quickReplies.innerHTML = '';
    selected.forEach(reply => {
        const btn = document.createElement('button');
        btn.className = 'quick-reply-btn';
        btn.textContent = reply;
        btn.addEventListener('click', () => { messageInput.value = reply; handleSend(); quickReplies.style.display = 'none'; });
        quickReplies.appendChild(btn);
    });
    quickReplies.style.display = 'flex';
}

// ===========================================================
// ACCUSÉS DE RÉCEPTION
// ===========================================================
async function markMessagesAsRead() {
    if (!currentUserId || !userSelect.value) return;
    try {
        await fetch(
            `${supabaseUrl}/rest/v1/messages?id_sent=eq.${userSelect.value}&id_received=eq.${currentUserId}&read_at=is.null`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=minimal' },
                body: JSON.stringify({ read_at: new Date().toISOString() })
            }
        );
        await fetchUnreadByUser();
        updatePresenceUI_display();
    } catch (e) { console.error('markMessagesAsRead:', e); }
}

// ===========================================================
// MESSAGES
// ===========================================================
async function deleteMessage(messageId) {
    const r = await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageId}`, {
        method: 'DELETE', headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
    });
    if (r.ok) getMessages();
    else console.error('deleteMessage:', await r.json());
}

async function getMessages() {
    if (!currentUserId || !userSelect.value) { chatMessages.innerHTML = ''; currentMessages = []; lastMessageCount = 0; return; }
    const query = `${supabaseUrl}/rest/v1/messages?select=*&order=created_at.asc` +
        `&or=(and(id_sent.eq.${currentUserId},id_received.eq.${userSelect.value}),` +
        `and(id_sent.eq.${userSelect.value},id_received.eq.${currentUserId}))`;
    const r = await fetch(query, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
    const data = await r.json();
    if (!r.ok) { console.error('getMessages:', data); return; }

    if (data.length > lastMessageCount && lastMessageCount > 0) {
        data.slice(lastMessageCount).forEach(msg => {
            if (msg.id_sent === userSelect.value && msg.id_received === currentUserId)
                showNotification(`Nouveau message de ${users[msg.id_sent]?.username || 'quelqu\'un'}`, msg.content.substring(0, 50));
        });
    }
    lastMessageCount = data.length;
    await markMessagesAsRead();

    const hasChanges = data.length !== currentMessages.length ||
        data.some((m, i) => m.id !== currentMessages[i]?.id || m.read_at !== currentMessages[i]?.read_at);
    if (!hasChanges) return;

    const wasAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;
    currentMessages = data;
    chatMessages.innerHTML = '';
    let lastDate = null;

    data.forEach(message => {
        const dateObj = new Date(message.created_at);
        const msgDate = dateObj.toLocaleDateString('fr-FR');
        const msgTime = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const isMine  = message.id_sent === currentUserId;
        const sender  = users[message.id_sent]?.username || 'Inconnu';

        if (msgDate !== lastDate) {
            const el = document.createElement('div');
            el.className = 'date'; el.textContent = msgDate;
            chatMessages.appendChild(el); lastDate = msgDate;
        }

        const msgEl = document.createElement('div');
        msgEl.classList.add('message', isMine ? 'sent' : 'received');

        const senderSpan = document.createElement('span');
        senderSpan.className = 'msg-sender'; senderSpan.textContent = sender;

        const metaSpan = document.createElement('span');
        metaSpan.className = 'msg-meta';
        let metaText = message.city ? `📍 ${message.city} · ${msgTime}` : msgTime;
        if (isMine) {
            if (message.read_at) { metaText += ' · 👁️ Lu'; metaSpan.classList.add('read'); }
            else                  { metaText += ' · ✓ Envoyé'; metaSpan.classList.add('sent-status'); }
        }
        metaSpan.textContent = metaText;

        msgEl.appendChild(senderSpan);
        msgEl.appendChild(document.createTextNode(message.content));
        msgEl.appendChild(metaSpan);

        if (isMine) {
            const del = document.createElement('span');
            del.textContent = '✖'; del.className = 'delete-button';
            del.addEventListener('click', () => deleteMessage(message.id));
            msgEl.appendChild(del);
        }
        chatMessages.appendChild(msgEl);
    });

    if (wasAtBottom) chatMessages.scrollTop = chatMessages.scrollHeight;
    if (data.length > 0) generateQuickReplies(data[data.length - 1]);
}

function refreshMessages() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => { getMessages(); checkTypingStatus(); }, 1000);
}

// ===========================================================
// ENVOI
// ===========================================================
async function sendMessage(userId, content) {
    let latitude = null, longitude = null, city = null;
    try { const g = await getGeolocation(); latitude = g.latitude; longitude = g.longitude; city = await getCityFromCoordinates(latitude, longitude); } catch {}
    isTyping = false; clearTimeout(typingTimeout); await updateTypingStatus(false);
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
            body: JSON.stringify({ id_sent: userId, content, created_at: new Date().toISOString(), id_received: userSelect.value, read_at: null, latitude, longitude, city })
        });
        if (r.ok) { getMessages(); return true; }
        else console.error('sendMessage:', await r.json());
    } catch (e) { console.error('sendMessage:', e); }
    return false;
}

async function handleSend() {
    if (!currentUserId) { alert('Veuillez vous connecter pour envoyer un message'); return; }
    const content = messageInput.value.trim();
    if (!content) return;
    messageInput.value = ''; messageInput.focus();
    quickReplies.style.display = 'none';
    await sendMessage(currentUserId, content);
}

sendButton.addEventListener('click', handleSend);
messageInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } });

// ===========================================================
// CONNEXION
// ===========================================================
async function completeLogin(user, plainPassword) {
    currentUserId = user.id;
    users[user.id] = { id: user.id, username: user.username };
    loginContainer.style.display  = 'none';
    connectedUser.style.display   = 'flex';
    connectedUsername.textContent  = user.username;
    saveSession({
        userId: user.id, username: user.username, plainPassword,
        refreshToken: generateRefreshToken(),
        issuedAt: Date.now(), expiresAt: Date.now() + SESSION_DURATION_MS, lastValidatedAt: Date.now()
    });
    await getUsers();
    getMessages();
    refreshMessages();
    startSessionValidation();
    startPresence();
}

async function login() {
    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username || !password) { alert('Veuillez remplir tous les champs'); return; }
    try {
        const r = await fetch(
            `${supabaseUrl}/rest/v1/users?select=id,username,password&username=eq.${encodeURIComponent(username)}`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const data = await r.json();
        if (!r.ok)        { alert('Erreur de connexion'); return; }
        if (!data.length) { alert('Utilisateur non trouvé'); return; }
        if (data[0].password !== password) { alert('Mot de passe incorrect'); return; }
        await requestNotificationPermission();
        await completeLogin(data[0], password);
    } catch (e) { console.error('login:', e); alert('Erreur de connexion'); }
}

// Connexion automatique après inscription
async function checkAutoLogin() {
    const raw = localStorage.getItem('pending_auto_login');
    if (!raw) return false;
    localStorage.removeItem('pending_auto_login');
    let pending;
    try { pending = JSON.parse(raw); } catch { return false; }
    if (!pending?.userId || !pending?.plainPassword) return false;
    try {
        const r = await fetch(
            `${supabaseUrl}/rest/v1/users?select=id,username,password&id=eq.${pending.userId}`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const data = await r.json();
        if (!r.ok || !data.length || data[0].password !== pending.plainPassword) return false;
        await requestNotificationPermission();
        await completeLogin(data[0], pending.plainPassword);
        return true;
    } catch { return false; }
}

// ===========================================================
// DÉCONNEXION
// ===========================================================
async function logout(options = {}) {
    const { silent = false, reason = '' } = options;
    if (isTyping) await updateTypingStatus(false);
    closeEmojiPicker();
    currentUserId = null; isTyping = false; clearTimeout(typingTimeout);
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    stopSessionValidation();
    stopPresence();
    clearSession();
    clearPresenceUI();
    loginContainer.style.display  = 'block';
    connectedUser.style.display   = 'none';
    chatMessages.innerHTML        = '';
    currentMessages = []; lastMessageCount = 0;
    typingIndicator.style.display = 'none';
    quickReplies.style.display    = 'none';
    if (!silent && reason) alert(reason);
}

loginButton.addEventListener('click', login);
logoutButton.addEventListener('click', () => logout());
loginPassword.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); login(); } });

// ===========================================================
// INIT
// ===========================================================
window.onload = async () => {
    await getUsers();
    const autoLogged = await checkAutoLogin();
    if (!autoLogged) {
        const restored = await restoreSession();
        if (!restored) getMessages();
    }
};

userSelect.addEventListener('change', () => {
    currentMessages = []; lastMessageCount = 0;
    typingIndicator.style.display = 'none';
    quickReplies.style.display    = 'none';
    if (currentUserId) updatePresenceUI_display();
    getMessages();
});

window.addEventListener('beforeunload', () => {
    if (isTyping && currentUserId) updateTypingStatus(false);
});