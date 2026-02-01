const supabaseUrl = 'https://unjdpzraozgcswfucezd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuamRwenJhb3pnY3N3ZnVjZXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMzOTQsImV4cCI6MjA4NTUyOTM5NH0.2fAnI9_Z-iay53GZ2UkXWxBnDULPC6Dm0sCK3XXIMwc';

const regUsername = document.getElementById('reg-username');
const regPassword = document.getElementById('reg-password');
const regPasswordConfirm = document.getElementById('reg-password-confirm');
const regButton = document.getElementById('reg-button');
const regError = document.getElementById('reg-error');

function showError(message) {
    regError.textContent = message;
    regError.style.display = 'block';
}

function hideError() {
    regError.style.display = 'none';
}

// Vérifie en temps réel si le username existe déjà
async function checkUsernameAvailable(username) {
    const response = await fetch(`${supabaseUrl}/rest/v1/users?select=id&username=eq.${encodeURIComponent(username)}`, {
        method: 'GET',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        }
    });
    const data = await response.json();
    return data.length === 0; // true si disponible
}

async function register() {
    hideError();

    const username = regUsername.value.trim();
    const password = regPassword.value;
    const passwordConfirm = regPasswordConfirm.value;

    // --- Validations côté client ---
    if (username === '') {
        showError('Le nom d\'utilisateur est obligatoire.');
        return;
    }

    if (username.length < 3) {
        showError('Le nom d\'utilisateur doit contenir au moins 3 caractères.');
        return;
    }

    if (password === '') {
        showError('Le mot de passe est obligatoire.');
        return;
    }

    if (password.length < 4) {
        showError('Le mot de passe doit contenir au moins 4 caractères.');
        return;
    }

    if (password !== passwordConfirm) {
        showError('Les deux mots de passe ne correspondent pas.');
        return;
    }

    // --- Vérifie si le username est déjà pris ---
    regButton.disabled = true;
    regButton.textContent = 'Vérification...';

    const available = await checkUsernameAvailable(username);
    if (!available) {
        showError('Ce nom d\'utilisateur est déjà utilisé.');
        regButton.disabled = false;
        regButton.textContent = 'S\'inscrire';
        return;
    }

    // --- POST vers Supabase pour créer l'utilisateur ---
    regButton.textContent = 'Création...';

    const response = await fetch(`${supabaseUrl}/rest/v1/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify({
            username: username,
            password: password
        })
    });

    if (!response.ok) {
        const error = await response.json();
        console.error('Erreur inscription :', error);
        showError('Une erreur est survenue lors de la création du compte.');
        regButton.disabled = false;
        regButton.textContent = 'S\'inscrire';
        return;
    }

    // --- Succès ---
    alert('Compte créé avec succès ! Vous pouvez vous connecter.');
    window.location.href = 'index.html';
}

regButton.addEventListener('click', register);

// Permettre l'inscription avec Enter depuis le dernier champ
regPasswordConfirm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        register();
    }
});