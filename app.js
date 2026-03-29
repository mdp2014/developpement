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
let onlineUsers     = new Set();
let usersWithUnread = new Map();
let heartbeatInterval = null;
let presenceInterval  = null;

const SESSION_STORAGE_KEY       = 'persistent_session_v1';
const SESSION_DURATION_MS       = 1000 * 60 * 60 * 24 * 30;
const SESSION_CHECK_INTERVAL_MS = 1000 * 60 * 5;
const ONLINE_THRESHOLD_SECONDS  = 30;
const HEARTBEAT_INTERVAL_MS     = 15000;

// ===========================================================
// FONT PICKER — conversion Unicode en temps réel
// ===========================================================

/**
 * Table de conversion Unicode pour chaque style.
 * Les caractères Unicode Math/Script/Fraktur/etc. s'affichent sans
 * aucune police externe et sont conservés tels quels en base de données.
 */
const FONT_STYLES = [
    {
        id: 'normal',
        label: 'Normal',
        preview: 'Abc',
        description: 'Texte standard',
        convert: text => text
    },
    {
        id: 'bold',
        label: '𝐆𝐫𝐚𝐬',
        preview: '𝐀𝐁𝐂',
        description: 'Bold',
        convert: text => convertUnicode(text, MAPS.bold)
    },
    {
        id: 'italic',
        label: '𝘐𝘵𝘢𝘭𝘪𝘲𝘶𝘦',
        preview: '𝘈𝘉𝘊',
        description: 'Italique',
        convert: text => convertUnicode(text, MAPS.italic)
    },
    {
        id: 'bold_italic',
        label: '𝑩𝑰',
        preview: '𝑨𝑩𝑪',
        description: 'Gras italique',
        convert: text => convertUnicode(text, MAPS.bold_italic)
    },
    {
        id: 'script',
        label: '𝓢𝓬𝓻𝓲𝓹𝓽',
        preview: '𝓐𝓑𝓒',
        description: 'Script / Cursive',
        convert: text => convertUnicode(text, MAPS.script)
    },
    {
        id: 'double',
        label: '𝔻𝕠𝕦𝕓𝕝𝕖',
        preview: '𝔸𝔹ℂ',
        description: 'Double trait',
        convert: text => convertUnicode(text, MAPS.double)
    },
    {
        id: 'fraktur',
        label: '𝔉𝔯𝔞𝔨𝔱𝔲𝔯',
        preview: '𝔄𝔅ℭ',
        description: 'Fraktur gothique',
        convert: text => convertUnicode(text, MAPS.fraktur)
    },
    {
        id: 'mono',
        label: '𝙼𝚘𝚗𝚘',
        preview: '𝙰𝙱𝙲',
        description: 'Monospace',
        convert: text => convertUnicode(text, MAPS.mono)
    },
    {
        id: 'bubble',
        label: 'Ⓑⓤⓑⓑⓛⓔ',
        preview: 'ⒶⒷⒸ',
        description: 'Cerclé',
        convert: text => convertUnicode(text, MAPS.bubble)
    },
    {
        id: 'small_caps',
        label: 'Sᴍᴀʟʟ Cᴀᴘꜱ',
        preview: 'Aʙᴄ',
        description: 'Petites capitales',
        convert: text => convertUnicode(text, MAPS.small_caps)
    },
    {
        id: 'wide',
        label: 'Ｗｉｄｅ',
        preview: 'ＡＢＣ',
        description: 'Pleine largeur',
        convert: text => convertUnicode(text, MAPS.wide)
    }
];

// Maps de conversion Unicode — tableau [uppercase_start, lowercase_start, digits_start]
// Les valeurs sont les points de code du premier caractère du bloc Unicode correspondant
const MAPS = {
    bold:        { upper: 0x1D400, lower: 0x1D41A, digits: 0x1D7CE },
    italic:      { upper: 0x1D434, lower: 0x1D44E, special: { 'h': '\u210E' } },
    bold_italic: { upper: 0x1D468, lower: 0x1D482, digits: null },
    script:      { upper: 0x1D4D0, lower: 0x1D4EA, special: { 'B': '\u212C', 'E': '\u2130', 'F': '\u2131', 'H': '\u210B', 'I': '\u2110', 'L': '\u2112', 'M': '\u2133', 'R': '\u211B', 'e': '\u212F', 'g': '\u210A', 'o': '\u2134' } },
    double:      { upper: 0x1D538, lower: 0x1D552, digits: 0x1D7D8, special: { 'C': '\u2102', 'H': '\u210D', 'N': '\u2115', 'P': '\u2119', 'Q': '\u211A', 'R': '\u211D', 'Z': '\u2124' } },
    fraktur:     { upper: 0x1D504, lower: 0x1D51E, special: { 'C': '\u212D', 'H': '\u210C', 'I': '\u2111', 'R': '\u211C', 'Z': '\u2128' } },
    mono:        { upper: 0x1D670, lower: 0x1D68A, digits: 0x1D7F6 },
    bubble:      { upper: 0x24B6,  lower: 0x24D0,  digits: { '0': '⓪', '1': '①', '2': '②', '3': '③', '4': '④', '5': '⑤', '6': '⑥', '7': '⑦', '8': '⑧', '9': '⑨' } },
    wide:        { upper: 0xFF21,  lower: 0xFF41,  digits: 0xFF10 },
    small_caps:  {
        map: {
            'a':'ᴀ','b':'ʙ','c':'ᴄ','d':'ᴅ','e':'ᴇ','f':'ꜰ','g':'ɢ','h':'ʜ','i':'ɪ','j':'ᴊ',
            'k':'ᴋ','l':'ʟ','m':'ᴍ','n':'ɴ','o':'ᴏ','p':'ᴘ','q':'ǫ','r':'ʀ','s':'s','t':'ᴛ',
            'u':'ᴜ','v':'ᴠ','w':'ᴡ','x':'x','y':'ʏ','z':'ᴢ'
        }
    }
};

function convertUnicode(text, map) {
    if (!text) return text;
    // Small caps : map direct
    if (map.map) {
        return [...text].map(ch => map.map[ch.toLowerCase()] || ch).join('');
    }
    return [...text].map(ch => {
        const code = ch.codePointAt(0);
        // Lettres majuscules A-Z
        if (code >= 65 && code <= 90) {
            if (map.special && map.special[ch]) return map.special[ch];
            if (map.upper) return String.fromCodePoint(map.upper + (code - 65));
        }
        // Lettres minuscules a-z
        if (code >= 97 && code <= 122) {
            if (map.special && map.special[ch]) return map.special[ch];
            if (map.lower) return String.fromCodePoint(map.lower + (code - 97));
        }
        // Chiffres 0-9
        if (code >= 48 && code <= 57) {
            if (map.digits && typeof map.digits === 'object' && !Number.isInteger(map.digits)) {
                return map.digits[ch] || ch;
            }
            if (map.digits && Number.isInteger(map.digits)) {
                return String.fromCodePoint(map.digits + (code - 48));
            }
        }
        return ch;
    }).join('');
}

// État du font picker
let activeFontId       = 'normal';
let rawInputText       = '';    // texte brut (avant conversion)
let fontPickerOpen     = false;
let fontPickerEl       = null;
let fontPickerOverlay  = null;

function getActiveStyle() {
    return FONT_STYLES.find(s => s.id === activeFontId) || FONT_STYLES[0];
}

/**
 * Applique la police active sur le contenu brut.
 * Met à jour le champ sans déclencher la boucle input→convert→input.
 */
function applyFontToInput() {
    const style = getActiveStyle();
    const converted = style.convert(rawInputText);
    // Éviter un re-rendu inutile
    if (messageInput.value !== converted) {
        const selStart = messageInput.selectionStart;
        const selEnd   = messageInput.selectionEnd;
        messageInput.value = converted;
        // Essayer de conserver la position du curseur (approximatif avec Unicode)
        try { messageInput.setSelectionRange(selStart, selEnd); } catch {}
    }
}

/**
 * Extrait le texte "brut" (non converti) depuis le champ.
 * Quand la police est "normal", le raw = la valeur du champ directement.
 * Quand une police est active, on ne peut pas inverser la conversion Unicode
 * de façon parfaite → on maintient rawInputText séparément.
 */
function syncRawFromInput() {
    if (activeFontId === 'normal') {
        rawInputText = messageInput.value;
    }
    // Si une police est active, rawInputText est mis à jour à chaque frappe
    // dans le listener ci-dessous (voir handleFontInput).
}

/**
 * Appelé à chaque frappe clavier quand une police Unicode est active.
 * Reconstruit le texte brut en décodant la différence entre ancienne et
 * nouvelle valeur du champ, puis ré-applique la conversion.
 *
 * Stratégie : comparer la valeur actuelle (convertie) et la précédente
 * pour déduire ce qui a été ajouté/supprimé, puis répercuter sur rawInputText.
 */
let prevConvertedValue = '';

function handleFontInput(e) {
    if (activeFontId === 'normal') {
        rawInputText = messageInput.value;
        prevConvertedValue = messageInput.value;
        return;
    }

    const currentValue = messageInput.value;
    const style = getActiveStyle();

    // Détecter l'opération : ajout ou suppression
    if (currentValue.length === 0) {
        rawInputText = '';
        prevConvertedValue = '';
        return;
    }

    // Reconstruire le texte brut caractère par caractère via la différence
    // Longueur en "code points" (les emoji/Unicode > 0xFFFF comptent pour 2 en .length)
    const prevCPs  = [...prevConvertedValue];
    const currCPs  = [...currentValue];
    const rawCPs   = [...rawInputText];

    if (currCPs.length > prevCPs.length) {
        // Ajout : trouver la position de l'insertion
        let insertPos = 0;
        while (insertPos < prevCPs.length && prevCPs[insertPos] === currCPs[insertPos]) insertPos++;
        const insertedConverted = currCPs.slice(insertPos, insertPos + (currCPs.length - prevCPs.length));
        // On stocke les caractères bruts en décodant chaque code point converti
        const insertedRaw = insertedConverted.map(ch => decodeUnicodeChar(ch, style));
        rawCPs.splice(insertPos, 0, ...insertedRaw);
    } else if (currCPs.length < prevCPs.length) {
        // Suppression
        let delPos = 0;
        while (delPos < currCPs.length && prevCPs[delPos] === currCPs[delPos]) delPos++;
        const delCount = prevCPs.length - currCPs.length;
        rawCPs.splice(delPos, delCount);
    } else {
        // Remplacement (paste ou IME) — reconstruire entièrement depuis la valeur courante
        // On ne peut pas inverser proprement → on reset et on utilise les chars bruts
        rawInputText = [...currentValue].map(ch => decodeUnicodeChar(ch, style)).join('');
        prevConvertedValue = currentValue;
        // Ré-appliquer pour normaliser
        applyFontToInput();
        prevConvertedValue = messageInput.value;
        return;
    }

    rawInputText = rawCPs.join('');
    // Ré-appliquer la police sur le texte brut mis à jour
    const newConverted = style.convert(rawInputText);
    if (messageInput.value !== newConverted) {
        const pos = messageInput.selectionStart;
        messageInput.value = newConverted;
        try { messageInput.setSelectionRange(pos, pos); } catch {}
    }
    prevConvertedValue = messageInput.value;
}

/**
 * Décode un caractère converti en son équivalent brut ASCII/latin.
 * Utile lors des suppressions pour maintenir rawInputText synchronisé.
 */
function decodeUnicodeChar(ch, style) {
    if (!ch) return ch;
    const cp = ch.codePointAt(0);
    const map = style.id === 'small_caps' ? null : MAPS[style.id];
    if (!map) {
        // small_caps : inverser le map
        const scMap = MAPS.small_caps.map;
        const entry = Object.entries(scMap).find(([, v]) => v === ch);
        return entry ? entry[0] : ch;
    }
    if (map.map) return ch; // fallback
    // Tester upper
    if (map.upper && cp >= map.upper && cp < map.upper + 26)
        return String.fromCodePoint(65 + cp - map.upper);
    // Tester lower
    if (map.lower && cp >= map.lower && cp < map.lower + 26)
        return String.fromCodePoint(97 + cp - map.lower);
    // Tester digits (plage numérique)
    if (map.digits && Number.isInteger(map.digits) && cp >= map.digits && cp < map.digits + 10)
        return String.fromCodePoint(48 + cp - map.digits);
    // Tester specials
    if (map.special) {
        const entry = Object.entries(map.special).find(([, v]) => v === ch);
        if (entry) return entry[0];
    }
    return ch;
}

/**
 * Crée et affiche le panneau de sélection de polices.
 */
function openFontPicker() {
    if (fontPickerOpen) { closeFontPicker(); return; }
    fontPickerOpen = true;

    // Overlay transparent pour fermer au clic extérieur
    fontPickerOverlay = document.createElement('div');
    fontPickerOverlay.className = 'font-picker-overlay';
    fontPickerOverlay.addEventListener('click', closeFontPicker);
    document.body.appendChild(fontPickerOverlay);

    fontPickerEl = document.createElement('div');
    fontPickerEl.className = 'font-picker-panel';
    fontPickerEl.innerHTML = `
        <div class="font-picker-header">
            <span class="font-picker-title">Style de texte</span>
            <span class="font-picker-hint">Visible pour tout le monde</span>
        </div>
        <div class="font-picker-grid">
            ${FONT_STYLES.map(s => `
                <button class="font-style-btn ${s.id === activeFontId ? 'active' : ''}"
                        data-font-id="${s.id}"
                        title="${s.description}">
                    <span class="font-style-preview">${s.preview}</span>
                    <span class="font-style-label">${s.description}</span>
                </button>
            `).join('')}
        </div>
    `;

    fontPickerEl.querySelectorAll('.font-style-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            selectFont(btn.dataset.fontId);
        });
    });

    // Positionner le panneau au-dessus du bouton
    const fontBtn = document.getElementById('font-button');
    document.body.appendChild(fontPickerEl);

    // Positionner après insertion dans le DOM
    requestAnimationFrame(() => {
        if (!fontBtn || !fontPickerEl) return;
        const btnRect   = fontBtn.getBoundingClientRect();
        const panelRect = fontPickerEl.getBoundingClientRect();
        let left = btnRect.right - panelRect.width;
        let top  = btnRect.top - panelRect.height - 8;
        // Ne pas sortir à gauche
        if (left < 8) left = 8;
        // Ne pas sortir en haut
        if (top < 8) top = btnRect.bottom + 8;
        fontPickerEl.style.left = `${left}px`;
        fontPickerEl.style.top  = `${top}px`;
    });

    document.getElementById('font-button').classList.add('active');
}

function closeFontPicker() {
    if (!fontPickerOpen) return;
    fontPickerOpen = false;
    if (fontPickerEl) {
        fontPickerEl.classList.add('hiding');
        setTimeout(() => { fontPickerEl?.remove(); fontPickerEl = null; }, 180);
    }
    if (fontPickerOverlay) { fontPickerOverlay.remove(); fontPickerOverlay = null; }
    const fontBtn = document.getElementById('font-button');
    if (fontBtn) fontBtn.classList.remove('active');
}

function selectFont(fontId) {
    activeFontId = fontId;
    // Mettre à jour le bouton principal pour refléter le style actif
    updateFontButtonState();
    // Ré-appliquer la police sur le contenu actuel
    applyFontToInput();
    prevConvertedValue = messageInput.value;
    // Mettre à jour l'état visuel des boutons dans le panneau
    if (fontPickerEl) {
        fontPickerEl.querySelectorAll('.font-style-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fontId === fontId);
        });
    }
    messageInput.focus();
}

function updateFontButtonState() {
    const fontBtn = document.getElementById('font-button');
    if (!fontBtn) return;
    const style = getActiveStyle();
    if (activeFontId === 'normal') {
        fontBtn.textContent = '🔤';
        fontBtn.classList.remove('font-active');
        fontBtn.title = 'Style de texte';
    } else {
        fontBtn.textContent = style.preview.charAt(0) || '🔤';
        fontBtn.classList.add('font-active');
        fontBtn.title = `Style actif : ${style.description}`;
    }
}

/**
 * Réinitialise la police et le texte brut (ex: après envoi).
 */
function resetFont() {
    activeFontId = 'normal';
    rawInputText = '';
    prevConvertedValue = '';
    updateFontButtonState();
}

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
            if (msg.id_sent === userSelect.value) return;
            map.set(msg.id_sent, (map.get(msg.id_sent) || 0) + 1);
        });
        usersWithUnread = map;
    } catch { /* silencieux */ }
}

function updatePresenceUI_display() {
    Array.from(userSelect.options).forEach(opt => {
        const uid  = opt.value;
        const user = users[uid];
        if (!user) return;
        if      (usersWithUnread.has(uid)) opt.textContent = `🔴 ${user.username}`;
        else if (onlineUsers.has(uid))     opt.textContent = `🟢 ${user.username}`;
        else                               opt.textContent = user.username;
    });

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
        }
    }

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
        // Insérer l'emoji dans le texte brut, puis ré-appliquer la police
        const rawPos = Math.min(pos, rawInputText.length);
        rawInputText = rawInputText.slice(0, rawPos) + e.detail.unicode + rawInputText.slice(rawPos);
        applyFontToInput();
        prevConvertedValue = messageInput.value;
        const newPos = pos + e.detail.unicode.length;
        try { messageInput.setSelectionRange(newPos, newPos); } catch {}
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

messageInput.addEventListener('input', e => {
    // Gérer la conversion de police AVANT de traiter le typing status
    handleFontInput(e);

    // Typing status
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
        btn.addEventListener('click', () => { messageInput.value = reply; rawInputText = reply; prevConvertedValue = reply; handleSend(); quickReplies.style.display = 'none'; });
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
    // Utiliser le contenu converti affiché dans le champ
    const content = messageInput.value.trim();
    if (!content) return;
    messageInput.value = '';
    messageInput.focus();
    quickReplies.style.display = 'none';
    // Réinitialiser le suivi du texte brut
    rawInputText = '';
    prevConvertedValue = '';
    // Ne pas réinitialiser la police — l'utilisateur peut vouloir envoyer
    // plusieurs messages dans le même style.
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
    closeFontPicker();
    resetFont();
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
    // Injecter le bouton font-picker dans la barre de saisie
    injectFontButton();

    await getUsers();
    const autoLogged = await checkAutoLogin();
    if (!autoLogged) {
        const restored = await restoreSession();
        if (!restored) getMessages();
    }
};

/**
 * Insère le bouton 🔤 entre le bouton emoji et le bouton d'envoi.
 */
function injectFontButton() {
    const chatInput = document.querySelector('.chat-input');
    if (!chatInput) return;
    const sendBtn = document.getElementById('send-button');
    if (!sendBtn) return;

    const btn = document.createElement('button');
    btn.id        = 'font-button';
    btn.className = 'icon-button font-button';
    btn.textContent = '🔤';
    btn.title     = 'Style de texte';
    btn.type      = 'button';

    btn.addEventListener('click', e => { e.stopPropagation(); openFontPicker(); });

    chatInput.insertBefore(btn, sendBtn);
}

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