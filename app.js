// Import de la bibliothèque emoji-picker
import 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js';

// ============================================================
// CONFIGURATION SUPABASE
// ============================================================
const supabaseUrl = 'https://unjdpzraozgcswfucezd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuamRwenJhb3pnY3N3ZnVjZXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMzOTQsImV4cCI6MjA4NTUyOTM5NH0.2fAnI9_Z-iay53GZ2UkXWxBnDULPC6Dm0sCK3XXIMwc';

// ============================================================
// RÉFÉRENCES DOM
// ============================================================
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

// ============================================================
// ÉTAT GLOBAL
// ============================================================
let users            = {};
let currentUserId    = null;
let refreshInterval  = null;
let typingTimeout    = null;
let isTyping         = false;
let currentMessages  = [];
let lastMessageCount = 0;
let emojiPickerInstance = null;
let emojiPickerOverlay  = null;

// ============================================================
// SESSION PERSISTANTE (localStorage)
// ============================================================
const SESSION_KEY         = 'chat_session_v1';
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 jours

function loadSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        localStorage.removeItem(SESSION_KEY);
        return null;
    }
}

function saveSession(userId, username) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
        userId,
        username,
        expiresAt: Date.now() + SESSION_DURATION_MS
    }));
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

async function restoreSession() {
    const session = loadSession();
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        clearSession();
        return false;
    }

    // Vérifier que l'utilisateur existe toujours en base
    try {
        const res = await fetch(
            `${supabaseUrl}/rest/v1/users?select=id,username&id=eq.${session.userId}`,
            { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const data = await res.json();
        if (!res.ok || data.length === 0) { clearSession(); return false; }

        currentUserId = session.userId;
        users[session.userId] = { id: session.userId, username: session.username };

        loginContainer.style.display  = 'none';
        connectedUser.style.display   = 'block';
        connectedUsername.textContent = session.username;

        await requestNotificationPermission();
        getMessages();
        refreshMessages();
        return true;
    } catch (e) {
        // Si réseau indisponible, on accepte quand même la session locale
        currentUserId = session.userId;
        users[session.userId] = { id: session.userId, username: session.username };
        loginContainer.style.display  = 'none';
        connectedUser.style.display   = 'block';
        connectedUsername.textContent = session.username;
        getMessages();
        refreshMessages();
        return true;
    }
}

// ============================================================
// EMOJI PICKER
// ============================================================
function initEmojiPicker() {
    emojiPickerInstance = document.querySelector('emoji-picker');
    if (!emojiPickerInstance) return;

    emojiPickerInstance.addEventListener('emoji-click', (event) => {
        const cursorPos  = messageInput.selectionStart ?? messageInput.value.length;
        const textBefore = messageInput.value.substring(0, cursorPos);
        const textAfter  = messageInput.value.substring(cursorPos);
        messageInput.value = textBefore + event.detail.unicode + textAfter;
        const newPos = cursorPos + event.detail.unicode.length;
        messageInput.setSelectionRange(newPos, newPos);
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
    setTimeout(() => {
        emojiPickerWrapper.style.display = 'none';
        emojiPickerWrapper.classList.remove('hiding');
    }, 200);
    if (emojiPickerOverlay?.parentNode) {
        emojiPickerOverlay.parentNode.removeChild(emojiPickerOverlay);
        emojiPickerOverlay = null;
    }
}

function toggleEmojiPicker() {
    emojiPickerWrapper.style.display !== 'none' ? closeEmojiPicker() : openEmojiPicker();
}

document.addEventListener('DOMContentLoaded', initEmojiPicker);

emojiButton.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEmojiPicker();
});

document.addEventListener('click', (e) => {
    if (!emojiPickerWrapper.contains(e.target) && e.target !== emojiButton) {
        if (emojiPickerWrapper.style.display !== 'none') closeEmojiPicker();
    }
});

// ============================================================
// NOTIFICATIONS PUSH
// ============================================================
async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        return perm === 'granted';
    }
    return false;
}

function showNotification(title, body) {
    if (Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(title, {
            body,
            tag: 'chat-notif',
            requireInteraction: false
        });
        n.onclick = () => { window.focus(); n.close(); };
        setTimeout(() => n.close(), 5000);
    }
}

// ============================================================
// GESTION DES UTILISATEURS
// ============================================================
async function getUsers() {
    const res = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const data = await res.json();
    if (!res.ok) { console.error('Erreur chargement utilisateurs:', data); return; }
    userSelect.innerHTML = '';
    data.forEach(user => {
        const opt = document.createElement('option');
        opt.value       = user.id;
        opt.textContent = user.username;
        userSelect.appendChild(opt);
        users[user.id]  = user;
    });
}

// ============================================================
// GÉOLOCALISATION
// ============================================================
function getGeolocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Non supporté'));
        navigator.geolocation.getCurrentPosition(
            pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            err => reject(err)
        );
    });
}

async function getCityFromCoordinates(lat, lon) {
    try {
        const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
        const data = await res.json();
        return data.address?.city || data.address?.town || data.address?.village || null;
    } catch (e) {
        return null;
    }
}

// ============================================================
// INDICATEUR "EN TRAIN D'ÉCRIRE"
// ============================================================
async function updateTypingStatus(isTypingNow) {
    if (!currentUserId || !userSelect.value) return;
    try {
        const checkRes = await fetch(
            `${supabaseUrl}/rest/v1/typing_status?user_id=eq.${currentUserId}&recipient_id=eq.${userSelect.value}`,
            { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const existing = await checkRes.json();

        if (existing.length > 0) {
            await fetch(
                `${supabaseUrl}/rest/v1/typing_status?user_id=eq.${currentUserId}&recipient_id=eq.${userSelect.value}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${supabaseKey}`
                    },
                    body: JSON.stringify({ is_typing: isTypingNow, updated_at: new Date().toISOString() })
                }
            );
        } else {
            await fetch(`${supabaseUrl}/rest/v1/typing_status`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    user_id:      currentUserId,
                    recipient_id: userSelect.value,
                    is_typing:    isTypingNow,
                    updated_at:   new Date().toISOString()
                })
            });
        }
    } catch (e) {
        console.error('Erreur statut de frappe:', e);
    }
}

async function checkTypingStatus() {
    if (!currentUserId || !userSelect.value) {
        typingIndicator.style.display = 'none';
        return;
    }
    try {
        const res  = await fetch(
            `${supabaseUrl}/rest/v1/typing_status?user_id=eq.${userSelect.value}&recipient_id=eq.${currentUserId}&select=*`,
            { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const data = await res.json();

        if (data.length > 0) {
            const status  = data[0];
            const seconds = (Date.now() - new Date(status.updated_at)) / 1000;
            if (status.is_typing && seconds < 3) {
                const name = users[userSelect.value]?.username || 'Utilisateur';
                // ✅ Points animés
                typingIndicator.innerHTML = `${name} est en train d'écrire\u00a0<span class="typing-dots"><span></span><span></span><span></span></span>`;
                typingIndicator.style.display = 'flex';
                return;
            }
        }
        typingIndicator.style.display = 'none';
    } catch (e) {
        console.error('Erreur vérification frappe:', e);
    }
}

// Écoute la saisie pour mettre à jour le statut de frappe
messageInput.addEventListener('input', () => {
    if (!isTyping) {
        isTyping = true;
        updateTypingStatus(true);
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
        updateTypingStatus(false);
    }, 2000);
});

// ============================================================
// ENVOI DE MESSAGES
// ============================================================
async function sendMessage(userId, content) {
    let latitude = null, longitude = null, city = null;
    try {
        const geo = await getGeolocation();
        latitude  = geo.latitude;
        longitude = geo.longitude;
        city      = await getCityFromCoordinates(latitude, longitude);
    } catch (e) {
        // géolocalisation refusée ou indisponible — pas grave
    }

    // Stopper l'indicateur de frappe
    isTyping = false;
    clearTimeout(typingTimeout);
    await updateTypingStatus(false);

    const res = await fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify({
            id_sent:     userId,
            content,
            created_at:  new Date().toISOString(),
            id_received: userSelect.value,
            read_at:     null,
            latitude,
            longitude,
            city
        })
    });
    if (!res.ok) {
        console.error('Erreur envoi message:', await res.json());
        return false;
    }
    getMessages();
    return true;
}

// ============================================================
// ACCUSÉS DE RÉCEPTION — marquer comme lus
// ============================================================
async function markMessagesAsRead() {
    if (!currentUserId || !userSelect.value) return;
    await fetch(
        `${supabaseUrl}/rest/v1/messages?id_sent=eq.${userSelect.value}&id_received=eq.${currentUserId}&read_at=is.null`,
        {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ read_at: new Date().toISOString() })
        }
    ).catch(e => console.error('Erreur marquage lu:', e));
}

// ============================================================
// SUPPRESSION D'UN MESSAGE
// ============================================================
async function deleteMessage(messageId) {
    const res = await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageId}`, {
        method: 'DELETE',
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    if (!res.ok) { console.error('Erreur suppression:', await res.json()); return; }
    getMessages();
}

// ============================================================
// RÉCUPÉRATION ET AFFICHAGE DES MESSAGES
// ============================================================
async function getMessages() {
    if (!currentUserId || !userSelect.value) {
        chatMessages.innerHTML = '';
        currentMessages  = [];
        lastMessageCount = 0;
        return;
    }

    const query = `${supabaseUrl}/rest/v1/messages?select=*&order=created_at.asc` +
        `&or=(and(id_sent.eq.${currentUserId},id_received.eq.${userSelect.value}),` +
        `and(id_sent.eq.${userSelect.value},id_received.eq.${currentUserId}))`;

    const res  = await fetch(query, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const data = await res.json();
    if (!res.ok) { console.error('Erreur messages:', data); return; }

    // Notifications pour nouveaux messages reçus
    if (data.length > lastMessageCount && lastMessageCount > 0) {
        data.slice(lastMessageCount).forEach(msg => {
            if (msg.id_sent === userSelect.value && msg.id_received === currentUserId) {
                const senderName = users[msg.id_sent]?.username || 'Quelqu\'un';
                showNotification(
                    `Nouveau message de ${senderName}`,
                    msg.content.substring(0, 60) + (msg.content.length > 60 ? '…' : '')
                );
            }
        });
    }
    lastMessageCount = data.length;

    // Marquer les messages reçus comme lus
    await markMessagesAsRead();

    // Ne redessiner que si quelque chose a changé
    const hasChanges =
        data.length !== currentMessages.length ||
        data.some((msg, i) => msg.id !== currentMessages[i]?.id || msg.read_at !== currentMessages[i]?.read_at);

    if (!hasChanges) return;

    const wasAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;
    currentMessages   = data;
    chatMessages.innerHTML = '';
    let lastDate = null;

    data.forEach(message => {
        const dateObj     = new Date(message.created_at);
        const messageDate = dateObj.toLocaleDateString();
        const messageTime = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const senderName  = users[message.id_sent]?.username || '?';

        // Séparateur de date
        if (messageDate !== lastDate) {
            const dateEl = document.createElement('div');
            dateEl.className   = 'date';
            dateEl.textContent = messageDate;
            chatMessages.appendChild(dateEl);
            lastDate = messageDate;
        }

        // Bulle de message
        const msgEl = document.createElement('div');
        msgEl.classList.add('message');

        // Nom de l'expéditeur
        const senderEl = document.createElement('span');
        senderEl.className   = 'msg-sender';
        senderEl.textContent = senderName;

        // Texte
        const textNode = document.createTextNode(message.content);

        // Méta : ville · heure · statut lecture
        const metaEl = document.createElement('span');
        metaEl.classList.add('msg-meta');
        let metaText = message.city ? `📍 ${message.city} · ${messageTime}` : messageTime;

        if (message.id_sent === currentUserId) {
            if (message.read_at) {
                metaText += ' · ✓✓ Lu';
                metaEl.classList.add('read'); // ✅ noir + bold via CSS
            } else {
                metaText += ' · ✓ Envoyé';
                metaEl.classList.add('sent-status'); // ✅ classe sans conflit
            }
        }
        metaEl.textContent = metaText;

        msgEl.appendChild(senderEl);
        msgEl.appendChild(textNode);
        msgEl.appendChild(metaEl);

        if (message.id_sent === currentUserId) {
            msgEl.classList.add('sent');
            const delBtn = document.createElement('span');
            delBtn.textContent = '✖';
            delBtn.className   = 'delete-button';
            delBtn.addEventListener('click', () => deleteMessage(message.id));
            msgEl.appendChild(delBtn);
        } else {
            msgEl.classList.add('received');
        }

        chatMessages.appendChild(msgEl);
    });

    if (wasAtBottom) chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================================
// RAFRAÎCHISSEMENT AUTOMATIQUE (1 seconde)
// ============================================================
function refreshMessages() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        getMessages();
        checkTypingStatus();
    }, 1000);
}

// ============================================================
// CONNEXION
// ============================================================
async function login() {
    const username = loginUsername.value.trim();
    const password 