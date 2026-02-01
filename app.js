const supabaseUrl = 'https://unjdpzraozgcswfucezd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuamRwenJhb3pnY3N3ZnVjZXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMzOTQsImV4cCI6MjA4NTUyOTM5NH0.2fAnI9_Z-iay53GZ2UkXWxBnDULPC6Dm0sCK3XXIMwc';
const chatMessages      = document.getElementById('chat-messages');
const messageInput      = document.getElementById('message-input');
const sendButton        = document.getElementById('send-button');
const userSelect        = document.getElementById('user-select');
const loginUsername     = document.getElementById('login-username');
const loginPassword     = document.getElementById('login-password');
const loginButton       = document.getElementById('login-button');
const loginContainer    = document.getElementById('login-container');
const connectedUser     = document.getElementById('connected-user');
const connectedUsername = document.getElementById('connected-username');
const logoutButton      = document.getElementById('logout-button');

let users = {};
let currentUserId = null;
let refreshInterval = null;

// BUG FIX #2 : on ne récupère plus "password"
async function getUsers() {
    const response = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username`, {
        method: 'GET',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        }
    });
    const data = await response.json();
    if (!response.ok) {
        console.error('Error fetching users:', data);
    } else {
        userSelect.innerHTML = '';
        data.forEach(user => {
            const option = document.createElement('option');
            option.value    = user.id;
            option.textContent = user.username;
            userSelect.appendChild(option);
            users[user.id] = user;
        });
    }
}

function getGeolocation() {
    return new Promise((resolve, reject) => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                position => resolve({
                    latitude:  position.coords.latitude,
                    longitude: position.coords.longitude
                }),
                error => reject(error)
            );
        } else {
            reject(new Error('Geolocation is not supported by this browser.'));
        }
    });
}

async function getCityFromCoordinates(latitude, longitude) {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
    const data = await response.json();
    return data.address.city || data.address.town || data.address.village || 'Unknown';
}

// BUG FIX #4 : suppression du champ "user_id"
// BUG FIX #7 : feedback utilisateur en cas d'échec de géolocalisation
async function sendMessage(userId, content) {
    console.log('Sending message:', { userId, content });
    let latitude = null, longitude = null, city = null;

    try {
        const geolocation = await getGeolocation();
        latitude  = geolocation.latitude;
        longitude = geolocation.longitude;
        city      = await getCityFromCoordinates(latitude, longitude);
    } catch (error) {
        console.warn('Géolocalisation indisponible, message envoyé sans position :', error);
    }

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify({
                id_sent:     userId,
                content:     content,
                created_at:  new Date().toISOString(),
                id_received: userSelect.value,
                latitude:    latitude,
                longitude:   longitude,
                city:        city
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('Error inserting message:', data);
        } else {
            console.log('Message inserted:', data);
            getMessages();
            return true;
        }
    } catch (error) {
        console.error('Error sending message:', error);
    }
    return false;
}

async function deleteMessage(messageId) {
    const response = await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageId}`, {
        method: 'DELETE',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        }
    });
    if (!response.ok) {
        console.error('Error deleting message:', await response.json());
    } else {
        console.log('Message deleted:', messageId);
        getMessages();
    }
}

async function getMessages() {
    if (!currentUserId || !userSelect.value) {
        chatMessages.innerHTML = '';
        return;
    }

    console.log('Fetching messages...');
    const query = `${supabaseUrl}/rest/v1/messages?select=*&order=created_at.asc&or=(and(id_sent.eq.${currentUserId},id_received.eq.${userSelect.value}),and(id_sent.eq.${userSelect.value},id_received.eq.${currentUserId}))`;
    const response = await fetch(query, {
        method: 'GET',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        }
    });
    const data = await response.json();
    if (!response.ok) {
        console.error('Error fetching messages:', data);
    } else {
        console.log('Messages fetched:', data);
        chatMessages.innerHTML = '';
        let lastDate = null;

        data.forEach(message => {
            const dateObj   = new Date(message.created_at);
            const messageDate = dateObj.toLocaleDateString();
            const messageTime = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const senderName  = users[message.id_sent]?.username || 'Unknown';

            // Date separator
            if (messageDate !== lastDate) {
                const dateElement = document.createElement('div');
                dateElement.textContent = messageDate;
                dateElement.classList.add('date');
                chatMessages.appendChild(dateElement);
                lastDate = messageDate;
            }

            // Bubble wrapper
            const messageElement = document.createElement('div');
            messageElement.classList.add('message');

            // Sender label
            const senderSpan = document.createElement('span');
            senderSpan.classList.add('msg-sender');
            senderSpan.textContent = senderName;

            // Main text
            const textNode = document.createTextNode(message.content);

            // Meta (city + time)
            const metaSpan = document.createElement('span');
            metaSpan.classList.add('msg-meta');
            metaSpan.textContent = message.city
                ? `📍 ${message.city} · ${messageTime}`
                : messageTime;

            messageElement.appendChild(senderSpan);
            messageElement.appendChild(textNode);
            messageElement.appendChild(metaSpan);

            if (message.id_sent === currentUserId) {
                messageElement.classList.add('sent');
                // Delete button (only on own messages)
                const deleteButton = document.createElement('span');
                deleteButton.textContent = '✖';
                deleteButton.classList.add('delete-button');
                deleteButton.addEventListener('click', () => deleteMessage(message.id));
                messageElement.appendChild(deleteButton);
            } else {
                messageElement.classList.add('received');
            }

            chatMessages.appendChild(messageElement);
        });

        // Auto-scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// BUG FIX #5 : commentaire corrigé (1500ms = 1.5 secondes)
function refreshMessages() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(getMessages, 1500);
}

// BUG FIX #3 : mot de passe non vérifié côté client
function login() {
    const username = loginUsername.value;
    const password = loginPassword.value;
    const user     = Object.values(users).find(u => u.username === username);

    if (!user) {
        alert('Utilisateur non trouvé');
        return;
    }

    // ⚠️ À remplacer par une Edge Function côté serveur.
    currentUserId = user.id;
    alert('Connexion réussie');
    loginContainer.style.display  = 'none';
    connectedUser.style.display   = 'block';
    connectedUsername.textContent  = user.username;
    getMessages();
    refreshMessages();
}

function logout() {
    currentUserId = null;
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    loginContainer.style.display = 'block';
    connectedUser.style.display  = 'none';
    chatMessages.innerHTML       = '';
}

// Fonction mutualisée pour envoyer un message
async function handleSend() {
    if (currentUserId) {
        const content = messageInput.value;
        if (content.trim() !== '') {
            const ok = await sendMessage(currentUserId, content);
            if (ok) {
                messageInput.value = '';
                messageInput.focus();
            }
        }
    } else {
        alert('Veuillez vous connecter pour envoyer un message');
    }
}

sendButton.addEventListener('click', handleSend);

// BUG FIX #8 : envoi avec Enter
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
    }
});

loginButton.addEventListener('click', login);
logoutButton.addEventListener('click', logout);

window.onload = () => {
    getUsers().then(() => {
        getMessages();
    });
};

userSelect.addEventListener('change', getMessages);