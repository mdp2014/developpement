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

    // Détection des intentions avec patterns enrichis - 500+ suggestions au total
    const patterns = {
        greeting: {
            keywords: ['bonjour', 'salut', 'hello', 'hi', 'allo', 'coucou', 'yo', 'bonsoir', 'bonne journée', 'good morning', 'good evening', 'hey', 'heyy', 'heyyy'],
            replies: [
                '👋 Bonjour !', 'Salut !', 'Hello !', 'Coucou !', 'Bonsoir !', 'Ça va ?', 'Hey !', 'Yo !',
                'Binj !', 'Salutations !', 'Enchanté !', 'À toi !', 'Bien le bonjour 👋', 'Ouais salut',
                'Hello toi !', 'Yo mon ami', 'Coucou c\'est moi', 'Allo allo', '👋', 'Bienvenue',
                'Comment ça va toi ?', 'Ça boume ?', 'Ça va bien ?', 'Tu vas bien ?', 'Ça fait longtemps',
                'Ravi de te revoir', 'Enfin !', 'T\'es là toi !', 'Une belle journée n\'est-ce pas ?'
            ]
        },
        thanks: {
            keywords: ['merci', 'thanks', 'thx', 'merci beaucoup', 'super merci', 'merci !', 'merci!!!', 'thanks mate', 'gracias', 'thank you', 'cheers'],
            replies: [
                'De rien !', 'Avec plaisir !', '😊', 'C\'est normal', 'Pas de souci !', 'À bientôt !',
                'Heureux de t\'aider', 'Bien sûr', 'Pour toi toujours', 'C\'est gentil de demander',
                'Anytime !', 'Mon plaisir', 'Pas besoin de remercier', 'Rien que pour toi',
                '😊 De rien', 'Avec le sourire', 'T\'as raison', 'Tout le plaisir est pour moi',
                'C\'est l\'amitié', 'Toujours là quand tu as besoin', 'Service client 😄', 'No prob',
                'Satisfait ?', 'Ça t\'aide ?', 'Besoin d\'autre chose ?', 'Je suis là pour ça',
                'C\'est mon travail', 'Happy to help', 'Ya pas de quoi', 'Simplement',
                'Tu es trop sympa', 'De mon côté ça va', 'C\'est cool', 'Je suis là quand même'
            ]
        },
        howareyou: {
            keywords: ['comment vas', 'how are', 'ça va', 'tu vas', 'vous allez', 'comment ça', 'comment tu vas', 'comment tu vais', 'ça va comment', 'et toi', 'et vous'],
            replies: [
                'Très bien merci !', 'Ça va et toi ?', 'Super !', 'Pas mal !', 'Tout va bien 😊', 'En forme !',
                'Nickel !', 'Ça va nickel', 'Je suis en pleine forme', 'Ça roule wesh', 'Top du top',
                'J\'ai pas à me plaindre', 'Ça pourrait être pire', 'Au top', 'Formidable',
                'Excellent !', 'Fantastique !', '🔥', 'Vraiment bien', 'C\'est cool',
                'Je suis heureux', 'Le moral est bon', 'Rien à signaler', 'Tout baigne',
                'Entre bien et très bien', 'Plutôt pas mal', 'J\'ai connu mieux', 'Ça va aller',
                'Pas trop mal pour toi ?', 'Et de ton côté ?', 'Tu me dis', 'Et toi ça gaze ?',
                'De plus en plus cool', 'Ça s\'améliore', 'Bof bof', 'Y a des hauts et des bas'
            ]
        },
        agreement: {
            keywords: ['ok', 'd\'accord', 'oui', 'yes', 'yep', 'okay', 'sûr', 'certain', 'absolument', 'bien sûr', 'ouais', 'ouaip', 'yup', 'ok'],
            replies: [
                'Parfait !', '👍', 'Super !', 'Génial !', 'D\'accord', 'C\'est bon', 'Entendu',
                'Impeccable', 'Ouais', 'D\'acc', 'Yep', 'Yup', 'Sure', 'Oki dokey', 'Roger',
                'Message reçu', '✅', 'C\'est noté', 'Je prends note', 'Bien compris',
                'Sans problème', 'Très bien', 'Ok parfait', 'Banco', 'Motus',
                'Validé', 'Accepté', 'Approuvé', '👌', 'Magnifique', 'Pas de souci',
                'Je suis d\'accord', 'Tout à fait', 'Évidemment', 'Certainement', 'Absolument',
                'C\'est dingue qu\'on soit d\'accord', 'Exactement', 'Pile poil', 'Tout juste',
                'On se comprend', 'High five 🙌', 'Ça match', 'On parle la même langue',
                'Je valide', 'Je signe', 'Top choix', 'Impeccable vraiment'
            ]
        },
        disagreement: {
            keywords: ['non', 'no', 'nope', 'pas d\'accord', 'refused', 'refus', 'pas possible', 'vraiment pas', 'certainement pas', 'nein', 'nada'],
            replies: [
                'D\'accord', 'Pas de souci', 'Compris', 'Sans problème', 'Pas grave', 'Comme tu veux',
                'Pas de prob', 'C\'est ok', 'Je comprends', 'Je respecte', 'Pas de soucis',
                'Aucun souci', 'Libre à toi', 'À ta guise', 'C\'est bon', 'Tranquille',
                'Zen', 'Pas d\'inquiétude', 'Ça va', 'Peut-être une prochaine fois', 'C\'est rien',
                'Je comprends ton point', 'Je vois', 'D\'accord avec toi', 'Tu as raison',
                'On reessayera', 'Pas grave mon gars'
            ]
        },
        apology: {
            keywords: ['désolé', 'sorry', 'excuse', 'pardon', 'je regrette', 'my bad', 'faute', 'mea culpa', 'oups'],
            replies: [
                'Pas grave !', 'T\'inquiète pas', 'Aucun souci', 'C\'est oublié', 'On en parle plus',
                '😊', 'Pas de problème', 'Je te pardonne', 'Faut pas', 'Pas d\'inquiétude',
                'Y a pas de mal', 'Ça arrive à tout le monde', 'Sois pas désolé', 'C\'est rien du tout',
                'Aucune rancune', 'On tourne la page', 'À l\'eau les soucis', 'Du passé tout ça',
                'Pas besoin de t\'excuser', 'Je sais que tu n\'as pas fait exprès', 'On reste potes',
                'Je comprends', 'Pas grave mec', 'Go de l\'avant', 'C\'est bon mon gars'
            ]
        },
        love: {
            keywords: ['t\'aime', 'love', 'adore', 'amo', 'tu es gentil', 'tu es cool', 'generous', 'kind', 'sympathique'],
            replies: [
                'Moi aussi 😊', 'Toi aussi !', 'Tu es cool', 'C\'est gentil', '❤️', 'Pareil 😄',
                'Je t\'aime trop', '💕', 'T\'es le meilleur', 'T\'es awesome', 'Je t\'adore aussi',
                'Sens bien reçu', 'Du pareil au même', 'Mutuel', 'Le sentiment est réciproque',
                '😍', 'Tu fais mon jour', 'T\'es super gentil', 'Je te le rends', 'Trop sympa',
                'Je suis fan', 'Tu me plais beaucoup', 'T\'es formidable', 'J\'apprécie vraiment',
                'C\'est réciproque', 'Bisous', 'On se comprend', 'T\'es incroyable'
            ]
        },
        question_general: {
            keywords: ['quoi', 'pourquoi', 'lequel', 'laquelle', 'lesquels', 'où', 'quand', 'qui', 'comment', 'quoi de neuf'],
            replies: [
                'C\'est intéressant', 'Bonne question', 'Je sais pas trop', 'À voir', 'Peut-être',
                'Je vais réfléchir', '🤔', 'Complexe', 'Faudrait voir', 'Je crois que...',
                'Hmm...', 'Bonne question effectivement', 'Là je sais pas', 'Faudrait mieux connaître',
                'Ça dépend', 'C\'est une excellente question', 'Je dois y penser', 'Donne moi une sec',
                'Je vais chercher', 'C\'est pas simple', 'Y a plusieurs réponses', 'Pas obvious',
                'À définir', 'Intéressant comme thème', 'Bon point', 'À approfondir'
            ]
        },
        affirmation: {
            keywords: ['?'],
            replies: [
                'Oui 👍', 'Non', 'Je ne sais pas', 'Peut-être', 'Peut-être bien', 'Pourquoi pas',
                'C\'est possible', 'Ouais', 'Nope', 'Yep', 'Vraiment pas', 'Sûrement',
                'Probable', 'Improbable', 'Aucune idée', 'Mystère', 'Question piège',
                'Dépend du contexte', 'À 50/50', 'Clairement', 'Pas vraiment', 'À peu près',
                'Je ne suis pas sûr', 'Difficile' , 'Compliqué', 'Mmhhmmm'
            ]
        },
        casual_laugh: {
            keywords: ['haha', 'lol', 'c\'est drôle', 'mdr', 'marrant', 'rigolo', 'hilarant', 'hahaha', 'xd', 'xdd'],
            replies: [
                '😂', 'Haha oui', 'Trop marrant', 'J\'adore haha', 'Tu me fais rire', '😄',
                'Je crève de rire', 'Stopppp c\'est trop drôle', 'Hahahaha', 'Hehe',
                'Trop funny', 'Lol sérieusement', 'J\'ai pas pu m\'empêcher', 'Mortel', 'Excellent blague',
                'T\'es casse-toi déjà', 'Je ris trop', 'Modère ton humour 😂', 'C\'est du vécu',
                'C\'est fou ce truc', 'Pas elle', 'Classique mais efficace', 'Simple mais efficace',
                'Tu m\'as tué 😂', 'C\'est méchant haha', 'Je m\'attend pas à ça', 'Genial ta blague'
            ]
        },
        planning: {
            keywords: ['demain', 'ce soir', 'ce weekend', 'prochaine', 'ce week-end', 'demain il', 'on se vendredi', 'plan', 'on fait', 'rendez-vous'],
            replies: [
                'Avec plaisir', '✨', 'Super idée', 'Je suis partant', 'Carrément', 'Hâte 🎉',
                'C\'est in', 'Oki', 'Ouais envoie', 'À quelle heure ?', 'Où ça ?', 'Je viens',
                'Je vais me libérer', 'J\'arrive', 'Compte sur moi', 'Ça marche', 'C\'est noté',
                'Je suis motivé', 'Trop cool', 'Enfin !', 'Ça va être dingue', 'Let\'s go',
                'J\'ai hâte', 'À bientôt alors', 'Amène ta team', 'On amène quoi ?',
                'Je suis partout', 'Oui oui oui', 'Confirmé', 'Verrouillé', 'On y va'
            ]
        },
        busy_tired: {
            keywords: ['occupé', 'pris', 'busy', 'pas dispo', 'pas libre', 'j\'ai pas le temps', 'fatigue', 'nuit', 'dormir', 'sommeil', 'fatigué', 'épuisé'],
            replies: [
                'Pas grave', 'Pas de souci', 'À plus tard', 'Pas de problème', 'Quand tu as le temps',
                'Sans pression', 'À bientôt', 'Pas d\'inquiétude', 'On peut attendre', 'Ça peut attendre',
                'Dors bien !', 'Bonne nuit 😴', 'Repose-toi bien', 'À demain', 'Bon repos',
                'Dodo bien méritée', 'Dors warrior', 'À demain frérot', 'Zzz...',
                'Ça va aller', 'Repose-toi', 'On reparle après', 'Pas urgent',
                'Tu me manques', 'À plus alors', 'Profite de ton temps', 'Reste zen'
            ]
        },
        help_request: {
            keywords: ['aide', 'help', 'peux', 'peux tu', 'peux-tu', 'de l\'aide', 'besoin', 'aide moi', 'tu peux'],
            replies: [
                'Bien sûr !', 'Avec plaisir', 'Pas de souci', 'Je suis là', 'Compte sur moi',
                'Absolument', 'Je viens', 'On y va', 'Envoie', 'Dis moi tout', 'Je t\'écoute',
                'Qu\'est-ce que je fais ?', 'OK fais moi signe', 'Je suis prêt', 'J\'arrive',
                'Pas de soucis', 'Je vais t\'aider', 'On peut le faire', 'Ensemble c\'est mieux',
                'T\'inquiète pas', 'Je suis ton gars/fille', 'On va trouver une solution'
            ]
        },
        work_job: {
            keywords: ['boulot', 'travail', 'job', 'projet', 'mission', 'deadline', 'client', 'code', 'dev', 'bug'],
            replies: [
                'Comment ça se passe ?', 'Du nouveau ?', 'Ça avance ?', 'Tu t\'en sors ?', 'Courage !',
                'Bon courage 💪', 'T\'es un warrior', 'Tu lâches pas', 'C\'est du boulot',
                'Entre morceaux', 'Bien géré', 'T\'es dans le truc', 'Respire mon gars',
                'Faut pas craquer', 'Tu vas y arriver', 'C\'est pas si mal', 'Ça va être ouf',
                'La deadline c\'est quand ?', 'Pas easy', 'Reste focus', 'Power through'
            ]
        },
        family: {
            keywords: ['famille', 'maman', 'papa', 'enfant', 'bébé', 'mère', 'père', 'frère', 'sœur', 'amour', 'couple'],
            replies: [
                'C\'est super', 'Quelle chance', 'C\'est mignon', '🥰', 'Tu as de la chance',
                'C\'est beau', 'Trop mignon', 'Des news ?', 'Raconte moi', 'Comment vont-ils ?',
                'Vous êtes chanceux', 'C\'est la vie', 'L\'amour c\'est tout', 'Profite',
                'C\'est précieux', 'Garde ça précieusement', 'Ça fait rêver',
                'Comment ils vont ?', 'Des nouvelles ?', 'Donne moi des nouvelles'
            ]
        },
        food: {
            keywords: ['manger', 'food', 'pizza', 'resto', 'cuisine', 'repas', 'faim', 'déjeuner', 'dîner', 'bouffe', 'snack', 'goûter'],
            replies: [
                'Avec plaisir !', 'Bonne appétit !', '🍽️', 'C\'est bon !', 'J\'adore', 'Yum yum 😋',
                'J\'ai faim aussi', 'On va où ?', 'C\'est quoi ton avis ?', 'Épatante l\'idée',
                'Je valide', 'C\'est l\'heure', 'Excellente idée', 'J\'meurs de faim',
                'Ça m\'ouvre l\'appétit', 'Tu me donnes envie', 'Super plan',
                'Miam miam', 'C\'est tentant', 'Merci mais j\'ai pas faim', 'Cool plan'
            ]
        },
        sports: {
            keywords: ['sport', 'match', 'foot', 'tennis', 'courir', 'gym', 'fit', 'training', 'séance', 'muscu'],
            replies: [
                'Bien joué !', 'Bravo 🎉', 'T\'as gagné ?', 'Cool !', 'Courage champion', '💪',
                'Gg wp', 'Je suis fier', 'T\'es un beast', 'Incroyable', 'Quel athlète',
                'Continue comme ça', 'T\'es au top', 'Je peux pas suivre', 'T\'es trop fort',
                'J\'allais te dire', 'C\'est fou', 'T\'es fou', 'Dingue ces stats'
            ]
        },
        weather: {
            keywords: ['pluie', 'soleil', 'météo', 'weather', 'froid', 'chaud', 'beau', 'temps', 'nuage', 'neige'],
            replies: [
                'Quel temps 😞', 'Il pleut pour toi aussi ?', 'C\'est horrible', 'Pas ouf',
                'C\'est magnifique', 'Parfait', 'Superbe journée', 'À profiter dehors',
                'Pas terrible', 'Peut-être ça change', 'Pas d\'chance', 'L\'automne/été',
                'C\'est la saison', 'Froid non ?', 'Beau dehors', 'Bien agréable'
            ]
        },
        movie_music: {
            keywords: ['film', 'musique', 'chanson', 'série', 'show', 'théâtre', 'concert', 'artiste', 'album'],
            replies: [
                'J\'adore ce truc', 'T\'as bon goût', 'Excellent choix', 'À voir/écouter',
                'Je recommande', 'Pas mal hein', 'C\'est du lourd', 'Ça déchire',
                'Génial comme film/chanson', 'Je vais checker', 'Ajoute à ma liste', 'Je suis fan aussi',
                'Bonne recommandation', 'Je vérifierais', 'C\'est sympa'
            ]
        },
        travel: {
            keywords: ['voyage', 'vacances', 'trip', 'pays', 'visite', 'tourisme', 'destination', 'expédition'],
            replies: [
                'Tres cool', 'Tu as de la chance', 'J\'aimerais bien', 'Envoie des photos',
                'Raconte tout', 'C\'est ouf', 'Dément', 'Je suis jaloux', 'À quand mon tour',
                'Reviens vite', 'Profite bien', 'C\'est de rêve',
                'Quelle destination ?', 'Combien de temps ?', 'À quoi ça ressemble ?'
            ]
        },
        money: {
            keywords: ['argent', 'prix', 'coût', 'payer', 'budget', 'investir', 'vendre', 'acheter'],
            replies: [
                'C\'est dingue', 'Trop cher', 'Bon prix', 'Ça vaut le coup', 'À voir',
                'J\'peux pas', 'Trop chaud pour moi', 'Peut-être plus tard', 'Ça m\'intéresse',
                'C\'est l\'affaire du siècle', 'Pas idée'
            ]
        },
        tech: {
            keywords: ['code', 'tech', 'app', 'bug', 'dev', 'server', 'crash', 'programme', 'software', 'system'],
            replies: [
                'Ça marche ?', 'Ça bugue ?', 'T\'as un truc ?', 'L\'informatique c\'est fou',
                'C\'est de la magie noire', 'Ça me dépasse', 'T\'es un génie', 'On appelle un techno',
                'Essaye de redémarrer', 'C\'est de l\'ésotérisme', 'J\'y comprends rien',
                'Ouais tech', 'C\'est complexe'
            ]
        },
        learning: {
            keywords: ['école', 'examen', 'apprendre', 'étude', 'étudiant', 'université', 'classe', 'leçon'],
            replies: [
                'C\'est cool', 'Tu as de la chance', 'Bon courage', 'À bientôt les résultats',
                'Je croise les doigts', 'Tu vas assurer', 'T\'es un boss', 'L\'éducation c\'est l\'avenir',
                'Laisse pas tomber', 'Tu peux le faire', 'Ton futur c\'est lumineux'
            ]
        },
        health: {
            keywords: ['santé', 'doctor', 'médecin', 'malade', 'maladie', 'virus', 'vaccin', 'blessure', 'douleur'],
            replies: [
                'T\'inquiète pas', 'Ça va passer', 'Soigne-toi bien', 'Prends soin de toi',
                'C\'est pas grave', 'Ça va s\'arranger', 'Repose-toi', 'Vois un doc', 'Courage',
                'Rétablis-toi vite', 'Fais gaffe à toi'
            ]
        },
        accomplishment: {
            keywords: ['réussi', 'victoire', 'gagné', 'succès', 'exploit', 'record', 'primé', 'champion', 'won'],
            replies: [
                '🎉 Bravo !', 'Félicitations !', 'C\'est fou', 'T\'es le meilleur', 'Excellent',
                'Je suis fier', 'Gg monster', '🏆', 'Legend status', 'C\'est dingue',
                'Tu l\'as fait', 'Je valide casiment', 'Respect', 'Masterclass', 'Coup de génie',
                'Incroyable', 'Trop fort', 'C\'est insane'
            ]
        },
        random_support: {
            keywords: [],
            replies: [
                '👍', '❤️', '😊', '🔥', '⭐', '✨', 'Cool', 'Nice', 'Oui', 'Ah bon',
                'Intéressant', 'Je vois', 'D\'accord', 'Pour sûr', 'C\'est vrai', 'À voir',
                'Possible', 'Probable', 'Sûrement', 'Peut-être', 'Peut-être bien', 'Hehe',
                'Wa ouf', 'Énorme', 'Massif', 'Dément', 'Surreal', 'Bizarre', 'Chelou',
                'Fou', 'Foufou', 'Cinglé', 'Débile', 'Débil grave', 'Ahihi', 'Bluffant',
                'C\'est la', 'Ouep', 'Yup', 'Bien sûr', 'Exact', 'Moi aussi', 'Pareil',
                'Très bien', 'Plutôt cool', 'Ça va', 'Tout va', 'Sweet', 'Awesome',
                'Amazing', 'Stunning', 'Ahah', 'Lol', 'Hahaha', 'XD', 'c\'est ouf',
                'Ça m\'était pas venu à l\'esprit', 'C\'est vrai', 'Tout est possible',
                'Pas mal', 'Sympa', 'Agréable', 'Plaisant', 'Chouette', 'Gentil', 'Aimable'
            ]
        }
    };

    // Scorer chaque pattern - cherche les correspondances
    const scores = {};
    Object.entries(patterns).forEach(([category, pattern]) => {
        let score = 0;
        if (pattern.keywords.length === 0) {
            score = -1; // Fallback à la fin seulement
        } else {
            pattern.keywords.forEach(keyword => {
                if (content.includes(keyword)) score += 2;
            });
        }
        if (score > 0) scores[category] = score;
    });

    // Trouver les catégories avec les meilleurs scores (top 2-3)
    const sortedScores = Object.entries(scores).sort(([,a], [,b]) => b - a);
    const topCategories = sortedScores.slice(0, 3).map(([cat]) => cat);

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

    // Mélanger et limiter à 5-8 suggestions
    const shuffled = replies
        .filter((r, i, self) => self.indexOf(r) === i) // Dédupliquer
        .sort(() => Math.random() - 0.5)
        .slice(0, 8);

    if (shuffled.length === 0) { quickReplies.style.display = 'none'; return; }

    quickReplies.innerHTML = '';
    shuffled.forEach(reply => {
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
// RÉSUMÉ DE CONVERSATION (Claude API)
// ============================================================
async function generateConversationSummary() {
    if (currentMessages.length < 3) {
        summaryContent.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">Pas assez de messages.</p>';
        return;
    }

    summaryContent.innerHTML = '<div class="loading">✨ Génération du résumé...</div>';

    const conversationText = currentMessages.map(msg => {
        const sender = users[msg.id_sent]?.username || 'Inconnu';
        const time   = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `[${time}] ${sender}: ${msg.content}`;
    }).join('\n');

    try {
const response = await fetch("https://toglujtvmslqutjeqmrh.supabase.co/functions/v1/mistral", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    text: conversationText
  })
});

const data = await response.json();
const text = data.choices?.[0]?.message?.content || "Résumé indisponible.";

        const html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        summaryContent.innerHTML = `<h3>📝 Résumé</h3><p>${html}</p>`;

    } catch (e) {
        console.error('Erreur résumé:', e);
        summaryContent.innerHTML = `<p style="color:red;">Erreur : ${e.message}</p>`;
    }
}

summaryButton.addEventListener('click', () => {
    summaryModal.style.display = 'flex';
    generateConversationSummary();
});

closeSummary.addEventListener('click', () => {
    summaryModal.style.display = 'none';
});

summaryModal.addEventListener('click', (e) => {
    if (e.target === summaryModal) summaryModal.style.display = 'none';
});

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