# 🔐 Migration vers Supabase Auth

Documentation pour migrer une table `users` vers le système d’authentification de Supabase et activer la connexion (email, Google, etc).

---

# 📋 Objectif

Utiliser le système **Authentication** de Supabase afin de :

* gérer les comptes utilisateurs
* permettre la connexion avec Google
* voir combien d’utilisateurs sont inscrits
* sécuriser les mots de passe
* relier les utilisateurs à une table `users` personnalisée

---

# ✅ Checklist installation

## 1️⃣ Créer un projet Supabase

* [ ] Aller sur https://supabase.com
* [ ] Créer un projet
* [ ] Attendre la création de la base de données
* [ ] Récupérer :

  * [ ] `Project URL`
  * [ ] `anon public key`

Ces informations seront utilisées dans ton code JavaScript.

---

# 🔑 Comprendre Supabase Auth

Supabase possède une table spéciale :

```
auth.users
```

Cette table est **protégée (🔒)** et contient :

| colonne         | description                    |
| --------------- | ------------------------------ |
| id              | identifiant unique utilisateur |
| email           | email utilisateur              |
| created_at      | date de création               |
| last_sign_in_at | dernière connexion             |

⚠️ Cette table **ne doit jamais être modifiée directement**.

---

# 👤 Créer une table profil

La bonne pratique est de créer une table publique :

```
public.users
```

Exemple structure :

```sql
create table users (
  id uuid primary key references auth.users(id),
  email text,
  pseudo text,
  avatar text,
  created_at timestamp default now()
);
```

### Explication

| champ  | rôle                               |
| ------ | ---------------------------------- |
| id     | identifiant venant de `auth.users` |
| email  | email utilisateur                  |
| pseudo | nom affiché                        |
| avatar | image utilisateur                  |

---

# ⚙️ Créer un trigger automatique

Objectif : créer un profil automatiquement quand un utilisateur s’inscrit.

## Étape SQL

```sql
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
```

### Explication

Quand un utilisateur :

* crée un compte
* se connecte avec Google

Supabase :

1. crée un utilisateur dans `auth.users`
2. le trigger crée automatiquement son profil dans `public.users`

---

# 🌐 Installer Supabase dans ton projet

Ajouter la librairie :

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js"></script>
```

---

# 📄 Exemple `app.js`

```javascript
const supabaseUrl = "https://TONPROJET.supabase.co"
const supabaseKey = "ANON_PUBLIC_KEY"

const supabase = window.supabase.createClient(supabaseUrl, supabaseKey)

async function loginGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google"
  })

  if (error) {
    console.error(error)
  }
}

async function logout() {
  await supabase.auth.signOut()
}

async function getUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}
```

---

# 🔑 Activer la connexion Google

Dans le dashboard Supabase :

Authentication → Providers

* [ ] Activer Google
* [ ] Créer un projet Google Cloud
* [ ] Copier le Client ID
* [ ] Copier le Client Secret
* [ ] Coller dans Supabase

---

# 📊 Voir les utilisateurs

Dans Supabase :

```
Authentication → Users
```

Tu peux voir :

* nombre d’utilisateurs
* date d’inscription
* dernière connexion
* provider utilisé (Google, email)

---

# 🔒 Bonnes pratiques sécurité

* [ ] Ne jamais stocker les mots de passe dans `users`
* [ ] Toujours utiliser `auth.users`
* [ ] Activer Row Level Security (RLS)
* [ ] Restreindre l’accès aux données utilisateurs

---

# 🚀 Fonctionnalités possibles

Avec Supabase Auth tu peux :

* [ ] connexion Google
* [ ] connexion GitHub
* [ ] connexion email / mot de passe
* [ ] reset mot de passe
* [ ] voir les utilisateurs inscrits
* [ ] voir les connexions

---

# 🧠 Architecture finale

```
auth.users
│
├── id
├── email
└── created_at
```

```
public.users
│
├── id (référence auth.users)
├── pseudo
├── avatar
└── created_at
```

---

# 🎯 Résultat

Ton site possède :

* authentification sécurisée
* connexion Google
* gestion utilisateurs
* base de données liée

---

# 🧪 Étapes de test

* [ ] créer un compte
* [ ] vérifier apparition dans `auth.users`
* [ ] vérifier création du profil dans `public.users`
* [ ] tester connexion Google
* [ ] tester déconnexion

---

# 📌 Notes

Supabase gère automatiquement :

* sécurité
* sessions
* tokens
* stockage des mots de passe

Tu n’as donc **rien à coder pour la sécurité**.
