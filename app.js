// Import de la bibliothèque emoji-picker
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
const summaryButton      = document.getElementById('summary-button');
const summaryModal       = document.getElementById('summary-modal');
const summaryContent     = document.getElementById('summary-content');
const closeSummary       = document.getElementById('close-summary');
const networkIndicator   = document.getElementById('network-indicator');

let users            = {};
let currentUserId    = null;
let refreshInterval  = null;
let typingTimeout    = null;
let isTyping         = false;
let currentMessages  = [];
let lastMessageCount = 0;
let emojiPickerInstance = null;
let emojiPickerOverlay  = null;
let sessionValidationInterval = null;

const SESSION_STORAGE_KEY    = 'persistent_session_v1';
const SESSION_DURATION_MS    = 1000 * 60 * 60 * 24 * 30; // 30 jours
const SESSION_CHECK_INTERVAL_MS = 1000 * 60 * 5;          // 5 minutes

// ============================================================
// RÉSEAU — indicateur de qualité
// ============================================================
function updateNetworkIndicator() {
    if (!navigator.onLine) {
        networkIndicator.textContent = '🔴';
        networkIndicator.title = 'Hors ligne';
        return;
    }
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
        const type = conn.effectiveType;
        if (type === '4g')      { networkIndicator.textContent = '🟢'; networkIndicator.title = 'Réseau excellent'; }
        else if (type === '3g') { networkIndicator.textContent = '🟡'; networkIndicator.title = 'Réseau moyen'; }
        else                    { networkIndicator.textContent = '🔴'; networkIndicator.title = 'Réseau faible'; }
    } else {
        networkIndicator.textContent = '🟢';
        networkIndicator.title = 'En ligne';
    }
}
window.addEventListener('online',  updateNetworkIndicator);
window.addEventListener('offline', updateNetworkIndicator);
updateNetworkIndicator();

// ============================================================
// SESSION — helpers
// ============================================================
function generateRefreshToken() {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function loadSession() {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (e) { localStorage.removeItem(SESSION_STORAGE_KEY); return null; }
}

function saveSession(session) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
}

function stopSessionValidation() {
    if (sessionValidationInterval) {
        clearInterval(sessionValidationInterval);
        sessionValidationInterval = null;
    }
}

// ============================================================
// SESSION — validation
// FIX : on compare le mot de passe en clair stocké en BDD
//       avec le mot de passe en clair stocké dans la session
//       (pas de double-hash qui cassait la validation)
// ============================================================
async function validateSession(session) {
    if (!session || !session.userId || !session.expiresAt) return false;
    if (Date.now() > session.expiresAt) return false;

    try {
        const response = await fetch(
            `${supabaseUrl}/rest/v1/users?select=id,username,password&id=eq.${session.userId}`,
            { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const data = await response.json();
        if (!response.ok || data.length === 0) return false;

        const user = data[0];
        // Comparaison directe en clair (mots de passe stockés en clair en BDD)
        if (user.password !== session.plainPassword) return false;

        session.username = user.username;
        session.lastValidatedAt = Date.now();
        saveSession(session);
        return true;
    } catch (e) {
        console.warn('Validation de session indisponible, on garde la session locale:', e);
        return true;
    }
}

function startSessionValidation() {
    stopSessionValidation();
    sessionValidationInterval = setInterval(async () => {
        const session = loadSession();
        const isValid = await validateSession(session);
        if (!isValid) logout({ silent: false, reason: 'Session expirée, veuillez vous reconnecter.' });
    }, SESSION_CHECK_INTERVAL_MS);
}

async function restoreSession() {
    const session = loadSession();
    if (!session) return false;

    const isValid = await validateSession(session);
    if (!isValid) { clearSession(); return false; }

    currentUserId = session.userId;
    users[session.userId] = { id: session.userId, username: session.username };

    loginContainer.style.display  = 'none';
    connectedUser.style.display   = 'flex';
    connectedUsername.textContent  = session.username;

    await requestNotificationPermission();
    getMessages();
    refreshMessages();
    startSessionValidation();
    return true;
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

emojiButton.addEventListener('click', (e) => { e.stopPropagation(); toggleEmojiPicker(); });

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
            body, tag: 'message-notification', requireInteraction: false, silent: false
        });
        n.onclick = () => { window.focus(); n.close(); };
        setTimeout(() => n.close(), 5000);
    }
}

// ============================================================
// GESTION DES UTILISATEURS
// ============================================================
async function getUsers() {
    const response = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const data = await response.json();
    if (!response.ok) { console.error('Erreur getUsers:', data); return; }

    userSelect.innerHTML = '';
    data.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.username;
        userSelect.appendChild(option);
        users[user.id] = user;
    });
}

// ============================================================
// GÉOLOCALISATION
// ============================================================
function getGeolocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('Non supporté')); return; }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            err => reject(err)
        );
    });
}

async function getCityFromCoordinates(lat, lon) {
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
        const d = await r.json();
        return d.address?.city || d.address?.town || d.address?.village || null;
    } catch { return null; }
}

// ============================================================
// TYPING INDICATOR
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
                    user_id: currentUserId,
                    recipient_id: userSelect.value,
                    is_typing: isTypingNow,
                    updated_at: new Date().toISOString()
                })
            });
        }
    } catch (e) { console.error('updateTypingStatus:', e); }
}

async function checkTypingStatus() {
    if (!currentUserId || !userSelect.value) {
        typingIndicator.style.display = 'none';
        return;
    }
    try {
        const r = await fetch(
            `${supabaseUrl}/rest/v1/typing_status?user_id=eq.${userSelect.value}&recipient_id=eq.${currentUserId}&select=*`,
            { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const data = await r.json();

        if (data.length > 0) {
            const status = data[0];
            const secondsSince = (Date.now() - new Date(status.updated_at)) / 1000;
            if (status.is_typing && secondsSince < 3) {
                const name = users[userSelect.value]?.username || 'L\'utilisateur';
                typingIndicator.innerHTML = `
                    <span>${name} est en train d'écrire</span>
                    <span class="typing-dots">
                        <span></span><span></span><span></span>
                    </span>`;
                typingIndicator.style.display = 'flex';
            } else {
                typingIndicator.style.display = 'none';
            }
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

// ============================================================
// RÉPONSES RAPIDES — Améliorées avec plus de patterns
// ============================================================
function generateQuickReplies(lastMessage) {
    if (!lastMessage || lastMessage.id_sent === currentUserId) {
        quickReplies.style.display = 'none';
        return;
    }

    const content = lastMessage.content.toLowerCase().trim();
    const replies = [];

    // Optimisation : pas de suggestions pour messages très courts
    if (content.length < 3) {
        quickReplies.style.display = 'none';
        return;
    }

    // Détection des intentions avec patterns optimisés - réduits pour performance
    const patterns = {
        greeting: {
            keywords: ['bonjour', 'salut', 'hello', 'coucou', 'bonsoir'],
            replies: ['👋 Bonjour !', 'Salut !', 'Hello !', 'Coucou !', 'Bonsoir !', 'Ça va ?']
        },
        thanks: {
            keywords: ['merci', 'thanks', 'thx'],
            replies: ['De rien !', 'Avec plaisir !', '😊', 'C\'est normal', 'Pas de souci !']
        },
        howareyou: {
            keywords: ['comment vas', 'ça va', 'tu vas'],
            replies: ['Très bien merci !', 'Ça va et toi ?', 'Super !', 'Pas mal !', 'En forme !']
        },
        agreement: {
            keywords: ['ok', 'oui', 'yes', 'd\'accord'],
            replies: ['Parfait !', '👍', 'Super !', 'Génial !', 'D\'accord']
        },
        disagreement: {
            keywords: ['non', 'no', 'pas d\'accord'],
            replies: ['D\'accord', 'Pas de souci', 'Compris', 'Sans problème', 'Pas grave']
        },
        apology: {
            keywords: ['désolé', 'sorry', 'pardon'],
            replies: ['Pas grave !', 'T\'inquiète pas', 'Aucun souci', 'C\'est oublié']
        },
        love: {
            keywords: ['t\'aime', 'love', 'adore'],
            replies: ['Moi aussi 😊', 'Toi aussi !', '❤️', 'Pareil 😄']
        },
        question_general: {
            keywords: ['quoi', 'pourquoi', 'où', 'quand', 'qui', 'comment'],
            replies: ['C\'est intéressant', 'Bonne question', 'Je sais pas trop', 'À voir', 'Peut-être']
        },
        affirmation: {
            keywords: ['?'],
            replies: ['Oui 👍', 'Non', 'Je ne sais pas', 'Peut-être', 'Pourquoi pas']
        },
        casual_laugh: {
            keywords: ['haha', 'lol', 'mdr'],
            replies: ['😂', 'Haha oui', 'Trop marrant', 'J\'adore haha', 'Tu me fais rire']
        },
        planning: {
            keywords: ['demain', 'ce soir', 'weekend', 'plan', 'rendez-vous'],
            replies: ['Avec plaisir', '✨', 'Super idée', 'Je suis partant', 'Carrément']
        },
        busy_tired: {
            keywords: ['occupé', 'fatigue', 'dormir', 'pas le temps'],
            replies: ['Pas grave', 'À plus tard', 'Dors bien !', 'Bonne nuit 😴', 'Repose-toi']
        },
        help_request: {
            keywords: ['aide', 'help', 'besoin'],
            replies: ['Bien sûr !', 'Avec plaisir', 'Je suis là', 'Dis moi tout', 'Qu\'est-ce que je fais ?']
        },
        work_job: {
            keywords: ['boulot', 'travail', 'projet', 'deadline'],
            replies: ['Comment ça se passe ?', 'Ça avance ?', 'Courage !', 'Bon courage 💪']
        },
        family: {
            keywords: ['famille', 'maman', 'papa', 'enfant'],
            replies: ['C\'est super', 'Quelle chance', 'C\'est mignon', '🥰', 'Raconte moi']
        },
        food: {
            keywords: ['manger', 'pizza', 'resto', 'faim'],
            replies: ['Avec plaisir !', 'Bonne appétit !', '🍽️', 'J\'adore', 'Yum yum 😋']
        },
        sports: {
            keywords: ['sport', 'match', 'foot', 'gym'],
            replies: ['Bien joué !', 'Bravo 🎉', 'Cool !', 'Courage champion', '💪']
        },
        weather: {
            keywords: ['pluie', 'soleil', 'météo', 'froid', 'chaud'],
            replies: ['Quel temps 😞', 'C\'est magnifique', 'Parfait', 'Superbe journée']
        },
        movie_music: {
            keywords: ['film', 'musique', 'chanson', 'série'],
            replies: ['J\'adore ce truc', 'T\'as bon goût', 'Excellent choix', 'À voir/écouter']
        },
        travel: {
            keywords: ['voyage', 'vacances', 'pays'],
            replies: ['Tres cool', 'Tu as de la chance', 'J\'aimerais bien', 'Envoie des photos']
        },
        money: {
            keywords: ['argent', 'prix', 'payer'],
            replies: ['C\'est dingue', 'Trop cher', 'Bon prix', 'Ça vaut le coup']
        },
        tech: {
            keywords: ['code', 'tech', 'bug', 'app'],
            replies: ['Ça marche ?', 'Ça bugue ?', 'T\'as un truc ?', 'L\'informatique c\'est fou']
        },
        learning: {
            keywords: ['école', 'examen', 'apprendre'],
            replies: ['C\'est cool', 'Bon courage', 'Tu vas assurer', 'T\'es un boss']
        },
        health: {
            keywords: ['santé', 'malade', 'docteur'],
            replies: ['T\'inquiète pas', 'Ça va passer', 'Soigne-toi bien', 'Prends soin de toi']
        },
        accomplishment: {
            keywords: ['réussi', 'victoire', 'gagné', 'succès'],
            replies: ['🎉 Bravo !', 'Félicitations !', 'C\'est fou', 'T\'es le meilleur']
        },
        random_support: {
            keywords: [],
            replies: ['👍', '❤️', '😊', '🔥', 'Cool', 'Nice', 'Oui', 'Intéressant', 'D\'accord', 'Pour sûr']
        }
    };

    // Scorer chaque pattern de manière optimisée
    const scores = {};
    for (const [category, pattern] of Object.entries(patterns)) {
        if (pattern.keywords.length === 0) {
            scores[category] = -1; // Fallback
            continue;
        }
        let score = 0;
        for (const keyword of pattern.keywords) {
            if (content.includes(keyword)) {
                score += 2;
                break; // Un match suffit par catégorie pour accélérer
            }
        }
        if (score > 0) scores[category] = score;
    }

    // Trouver les catégories avec les meilleurs scores (top 2)
    const sortedScores = Object.entries(scores).sort(([,a], [,b]) => b - a);
    const topCategories = sortedScores.slice(0, 2).map(([cat]) => cat);

    // Ajouter des réponses des catégories matchantes
    if (topCategories.length > 0) {
        topCategories.forEach(category => {
            replies.push(...patterns[category].replies);
        });
    }

    // Ajouter des réponses générales de support si pas assez de match
    if (replies.length < 50) {
        replies.push(...patterns.random_support.replies);
    }

    // Prioriser les réponses et limiter à 4 suggestions
    const selectedReplies = [];
    for (const category of topCategories) {
        for (const reply of patterns[category].replies) {
            if (!selectedReplies.includes(reply)) {
                selectedReplies.push(reply);
                if (selectedReplies.length >= 4) break;
            }
        }
        if (selectedReplies.length >= 4) break;
    }

    if (selectedReplies.length < 4) {
        for (const reply of patterns.random_support.replies) {
            if (!selectedReplies.includes(reply)) {
                selectedReplies.push(reply);
                if (selectedReplies.length >= 4) break;
            }
        }
    }

    if (selectedReplies.length === 0) {
        quickReplies.style.display = 'none';
        return;
    }

    const finalReplies = selectedReplies;

    quickReplies.innerHTML = '';
    finalReplies.forEach(reply => {
        const btn = document.createElement('button');
        btn.className   = 'quick-reply-btn';
        btn.textContent = reply;
        btn.addEventListener('click', () => {
            messageInput.value = reply;
            handleSend();
            quickReplies.style.display = 'none';
        });
        quickReplies.appendChild(btn);
    });
    quickReplies.style.display = 'flex';
}

// ============================================================
// ACCUSÉS DE RÉCEPTION
// ============================================================
async function markMessagesAsRead() {
    if (!currentUserId || !userSelect.value) return;
    try {
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
        );
    } catch (e) { console.error('markMessagesAsRead:', e); }
}

// ============================================================
// MESSAGES — suppression
// ============================================================
async function deleteMessage(messageId) {
    const r = await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageId}`, {
        method: 'DELETE',
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    if (r.ok) getMessages();
    else console.error('deleteMessage:', await r.json());
}

// ============================================================
// MESSAGES — récupération & affichage
// ============================================================
async function getMessages() {
    if (!currentUserId || !userSelect.value) {
        chatMessages.innerHTML = '';
        currentMessages = [];
        lastMessageCount = 0;
        return;
    }

    const query = `${supabaseUrl}/rest/v1/messages?select=*&order=created_at.asc` +
        `&or=(and(id_sent.eq.${currentUserId},id_received.eq.${userSelect.value}),` +
        `and(id_sent.eq.${userSelect.value},id_received.eq.${currentUserId}))`;

    const r = await fetch(query, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const data = await r.json();
    if (!r.ok) { console.error('getMessages:', data); return; }

    // Notifications pour les nouveaux messages
    if (data.length > lastMessageCount && lastMessageCount > 0) {
        data.slice(lastMessageCount).forEach(msg => {
            if (msg.id_sent === userSelect.value && msg.id_received === currentUserId) {
                const name = users[msg.id_sent]?.username || 'Un utilisateur';
                showNotification(`Nouveau message de ${name}`, msg.content.substring(0, 50));
            }
        });
    }
    lastMessageCount = data.length;

    await markMessagesAsRead();

    // Ne redessiner que s'il y a des changements
    const hasChanges =
        data.length !== currentMessages.length ||
        data.some((m, i) => m.id !== currentMessages[i]?.id || m.read_at !== currentMessages[i]?.read_at);

    if (!hasChanges) return;

    const wasAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;
    currentMessages = data;
    chatMessages.innerHTML = '';
    let lastDate = null;

    data.forEach(message => {
        const dateObj     = new Date(message.created_at);
        const messageDate = dateObj.toLocaleDateString('fr-FR');
        const messageTime = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const senderName  = users[message.id_sent]?.username || 'Inconnu';
        const isMine      = message.id_sent === currentUserId;

        // Séparateur de date
        if (messageDate !== lastDate) {
            const dateEl = document.createElement('div');
            dateEl.textContent = messageDate;
            dateEl.classList.add('date');
            chatMessages.appendChild(dateEl);
            lastDate = messageDate;
        }

        const msgEl = document.createElement('div');
        msgEl.classList.add('message', isMine ? 'sent' : 'received');

        // Expéditeur
        const senderSpan = document.createElement('span');
        senderSpan.classList.add('msg-sender');
        senderSpan.textContent = senderName;

        // Contenu
        const textNode = document.createTextNode(message.content);

        // Méta (ville · heure · statut lecture)
        const metaSpan = document.createElement('span');
        metaSpan.classList.add('msg-meta');
        let metaText = message.city ? `📍 ${message.city} · ${messageTime}` : messageTime;

        if (isMine) {
            if (message.read_at) {
                metaText += ' · 👁️ Lu';
                metaSpan.classList.add('read');
            } else {
                metaText += ' · ✓ Envoyé';
                metaSpan.classList.add('sent');
            }
        }
        metaSpan.textContent = metaText;

        msgEl.appendChild(senderSpan);
        msgEl.appendChild(textNode);
        msgEl.appendChild(metaSpan);

        if (isMine) {
            const delBtn = document.createElement('span');
            delBtn.textContent = '✖';
            delBtn.classList.add('delete-button');
            delBtn.addEventListener('click', () => deleteMessage(message.id));
            msgEl.appendChild(delBtn);
        }

        chatMessages.appendChild(msgEl);
    });

    if (wasAtBottom) chatMessages.scrollTop = chatMessages.scrollHeight;

    // Réponses rapides sur le dernier message reçu
    if (data.length > 0) generateQuickReplies(data[data.length - 1]);
}

// ============================================================
// RAFRAÎCHISSEMENT
// ============================================================
function refreshMessages() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        getMessages();
        checkTypingStatus();
    }, 1000);
}

// ============================================================
// ENVOI DE MESSAGE
// ============================================================
async function sendMessage(userId, content) {
    let latitude = null, longitude = null, city = null;
    try {
        const geo = await getGeolocation();
        latitude  = geo.latitude;
        longitude = geo.longitude;
        city      = await getCityFromCoordinates(latitude, longitude);
    } catch { /* géoloc optionnelle */ }

    isTyping = false;
    clearTimeout(typingTimeout);
    await updateTypingStatus(false);

    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/messages`, {
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
        if (r.ok) { getMessages(); return true; }
        else console.error('sendMessage:', await r.json());
    } catch (e) { console.error('sendMessage:', e); }
    return false;
}

async function handleSend() {
    if (!currentUserId) { alert('Veuillez vous connecter pour envoyer un message'); return; }
    const content = messageInput.value.trim();
    if (!content) return;
    messageInput.value = '';
    messageInput.focus();
    quickReplies.style.display = 'none';
    await sendMessage(currentUserId, content);
}

sendButton.addEventListener('click', handleSend);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
});

// ============================================================
// CONNEXION
// FIX : on stocke le mot de passe en clair dans la session
//       (correspond à ce qui est en BDD) pour que validateSession fonctionne
// ============================================================
async function login() {
    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    if (!username || !password) { alert('Veuillez remplir tous les champs'); return; }

    try {
        const r = await fetch(
            `${supabaseUrl}/rest/v1/users?select=id,username,password&username=eq.${encodeURIComponent(username)}`,
            { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const data = await r.json();

        if (!r.ok)            { alert('Erreur de connexion'); return; }
        if (data.length === 0){ alert('Utilisateur non trouvé'); return; }

        const user = data[0];
        if (user.password !== password) { alert('Mot de passe incorrect'); return; }

        await requestNotificationPermission();

        currentUserId = user.id;
        users[user.id] = { id: user.id, username: user.username };

        loginContainer.style.display  = 'none';
        connectedUser.style.display   = 'flex';
        connectedUsername.textContent  = user.username;

        // FIX : on stocke plainPassword pour la validation de session
        saveSession({
            userId:        user.id,
            username:      user.username,
            plainPassword: password,             // comparaison directe en clair
            refreshToken:  generateRefreshToken(),
            issuedAt:      Date.now(),
            expiresAt:     Date.now() + SESSION_DURATION_MS,
            lastValidatedAt: Date.now()
        });

        getMessages();
        refreshMessages();
        startSessionValidation();

    } catch (e) { console.error('login:', e); alert('Erreur de connexion'); }
}

// ============================================================
// DÉCONNEXION
// ============================================================
async function logout(options = {}) {
    const { silent = false, reason = '' } = options;
    if (isTyping) await updateTypingStatus(false);
    closeEmojiPicker();

    currentUserId = null;
    isTyping      = false;
    clearTimeout(typingTimeout);
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    stopSessionValidation();
    clearSession();

    loginContainer.style.display  = 'block';
    connectedUser.style.display   = 'none';
    chatMessages.innerHTML        = '';
    currentMessages  = [];
    lastMessageCount = 0;
    typingIndicator.style.display = 'none';
    quickReplies.style.display    = 'none';

    if (!silent && reason) alert(reason);
}

loginButton.addEventListener('click', login);
logoutButton.addEventListener('click', () => logout());
loginPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); login(); }
});

// ============================================================
// INIT
// ============================================================
window.onload = () => {
    getUsers().then(async () => {
        const restored = await restoreSession();
        if (!restored) getMessages();
    });
};

userSelect.addEventListener('change', () => {
    currentMessages  = [];
    lastMessageCount = 0;
    typingIndicator.style.display = 'none';
    quickReplies.style.display    = 'none';
    getMessages();
});

window.addEventListener('beforeunload', () => {
    if (isTyping && currentUserId) updateTypingStatus(false);
});