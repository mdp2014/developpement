# 🔧 Guide de dépannage - Indicateur "en train d'écrire"

## 🎯 Problème : L'indicateur ne s'affiche pas

### ✅ Checklist de vérification

#### 1. Vérifier la table `typing_status` dans Supabase

Allez dans l'éditeur SQL de Supabase et exécutez :

```sql
-- Créer la table si elle n'existe pas
CREATE TABLE IF NOT EXISTS public.typing_status (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  is_typing boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT typing_status_pkey PRIMARY KEY (id),
  CONSTRAINT typing_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT typing_status_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT typing_status_unique UNIQUE (user_id, recipient_id)
);

-- Créer les index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_typing_status_updated_at ON public.typing_status(updated_at);
CREATE INDEX IF NOT EXISTS idx_typing_status_recipient ON public.typing_status(recipient_id);
```

#### 2. Configurer les politiques RLS (Row Level Security)

**TRÈS IMPORTANT** : Supabase bloque par défaut toutes les requêtes avec RLS. Vous devez créer des politiques :

```sql
-- Activer RLS sur la table
ALTER TABLE public.typing_status ENABLE ROW LEVEL SECURITY;

-- Supprimer les anciennes politiques si elles existent
DROP POLICY IF EXISTS "Permettre la lecture du statut de frappe" ON public.typing_status;
DROP POLICY IF EXISTS "Permettre la mise à jour de son propre statut" ON public.typing_status;
DROP POLICY IF EXISTS "Permettre l'insertion de son propre statut" ON public.typing_status;

-- Politique pour LIRE le statut de frappe (tout le monde peut voir)
CREATE POLICY "Permettre la lecture du statut de frappe"
ON public.typing_status FOR SELECT
USING (true);

-- Politique pour INSÉRER un nouveau statut
CREATE POLICY "Permettre l'insertion de son propre statut"
ON public.typing_status FOR INSERT
WITH CHECK (true);

-- Politique pour METTRE À JOUR son propre statut
CREATE POLICY "Permettre la mise à jour de son propre statut"
ON public.typing_status FOR UPDATE
USING (true)
WITH CHECK (true);

-- Politique pour SUPPRIMER (optionnel, pour le nettoyage)
CREATE POLICY "Permettre la suppression"
ON public.typing_status FOR DELETE
USING (true);
```

**Note** : Ces politiques sont très permissives (pour la démo). En production, vous devriez les restreindre.

#### 3. Tester manuellement dans Supabase

Allez dans **Table Editor** → `typing_status` et essayez d'insérer manuellement une ligne :

| Colonne | Valeur |
|---------|--------|
| user_id | [copiez un ID depuis la table users] |
| recipient_id | [copiez un autre ID depuis la table users] |
| is_typing | true |
| updated_at | now() |

Si l'insertion échoue, c'est un problème de RLS ou de clés étrangères.

#### 4. Vérifier dans la console du navigateur

1. Ouvrez la console (F12)
2. Connectez-vous avec un utilisateur
3. Sélectionnez un destinataire
4. Commencez à taper dans le champ de message

Vous devriez voir des logs comme :
```
⌨️ Input détecté, isTyping: false
🟢 Début de frappe
📝 Mise à jour statut frappe: true (user: xxx -> recipient: yyy)
✅ Statut créé: [...]
```

Sur l'autre compte (dans un autre onglet), vous devriez voir :
```
🔍 Vérification statut frappe de Username : [{is_typing: true, ...}]
⏱️ Dernière mise à jour: il y a 0.5s, is_typing: true
✅ Indicateur affiché
```

#### 5. Vérifier l'élément HTML

Dans la console, tapez :
```javascript
document.getElementById('typing-indicator')
```

Cela devrait retourner un élément HTML. Si c'est `null`, vérifiez votre fichier `index.html`.

---

## 🐛 Problèmes courants et solutions

### Problème 1 : "PGRST116 - No policy allows access"

**Cause** : Les politiques RLS bloquent l'accès.

**Solution** : Exécutez les commandes SQL de la section 2 ci-dessus.

### Problème 2 : L'indicateur s'affiche mais disparaît immédiatement

**Cause** : Le délai de 5 secondes est trop court ou l'horloge n'est pas synchronisée.

**Solution** : Dans `app.js`, ligne ~220, changez :
```javascript
if (status.is_typing && secondsSinceUpdate < 5) {
```
en :
```javascript
if (status.is_typing && secondsSinceUpdate < 10) {  // 10 secondes au lieu de 5
```

### Problème 3 : "violates foreign key constraint"

**Cause** : L'ID utilisateur n'existe pas dans la table `users`.

**Solution** : Vérifiez que vous êtes bien connecté et que `currentUserId` est défini :
```javascript
console.log('Current user ID:', currentUserId);
```

### Problème 4 : Rien ne se passe quand je tape

**Cause** : L'événement `input` n'est pas écouté.

**Solution** : Vérifiez que le fichier `app.js` est bien chargé :
```javascript
console.log('app.js chargé');
```

### Problème 5 : L'indicateur ne disparaît jamais

**Cause** : Le statut `is_typing` n'est pas remis à `false`.

**Solution** : Vérifiez les logs. Vous devriez voir "🔴 Fin de frappe (timeout)" après 2 secondes d'inactivité.

---

## 🧪 Test complet étape par étape

### Étape 1 : Préparez deux comptes

1. Créez deux utilisateurs : `alice` et `bob`
2. Ouvrez deux fenêtres de navigateur (ou une normale + une incognito)

### Étape 2 : Connectez les utilisateurs

- Fenêtre 1 : Connectez-vous avec `alice`
- Fenêtre 2 : Connectez-vous avec `bob`

### Étape 3 : Sélectionnez les destinataires

- Fenêtre 1 (alice) : Sélectionnez `bob` dans le menu déroulant
- Fenêtre 2 (bob) : Sélectionnez `alice` dans le menu déroulant

### Étape 4 : Testez l'indicateur

1. Dans la fenêtre 1 (alice), **commencez à taper** dans le champ de message
2. **Attendez 1 seconde**
3. Dans la fenêtre 2 (bob), vous devriez voir : "alice est en train d'écrire..." avec 3 points animés
4. **Arrêtez de taper** pendant 2 secondes
5. L'indicateur devrait **disparaître** dans la fenêtre de bob

### Étape 5 : Vérifiez les logs

Dans la console de la fenêtre 1 (alice) :
```
⌨️ Input détecté, isTyping: false
🟢 Début de frappe
📝 Mise à jour statut frappe: true
✅ Statut créé: [...]
```

Dans la console de la fenêtre 2 (bob) :
```
🔍 Vérification statut frappe de alice : [{is_typing: true, ...}]
✅ Indicateur affiché
```

---

## 📊 Vérification directe dans Supabase

Allez dans **Table Editor** → `typing_status` pendant que quelqu'un tape.

Vous devriez voir une ligne comme :

| id | user_id | recipient_id | is_typing | updated_at |
|----|---------|--------------|-----------|------------|
| xxx | alice_id | bob_id | true | 2025-02-02 14:30:45 |

Si la ligne existe mais `is_typing` est toujours `false`, il y a un problème avec la mise à jour.

---

## 🚨 Débogage avancé

### Activer les logs réseau

1. Ouvrez l'onglet **Network** dans la console (F12)
2. Filtrez par "typing_status"
3. Tapez dans le champ de message
4. Vous devriez voir des requêtes `POST` ou `PATCH` vers `/typing_status`
5. Cliquez sur une requête pour voir :
   - **Payload** : Les données envoyées
   - **Response** : La réponse de Supabase

### Vérifier les permissions de l'API key

Dans Supabase → **Settings** → **API**, vérifiez que vous utilisez bien la clé `anon` (publique) et non la clé `service_role` (secrète).

### Tester directement avec curl

Remplacez `YOUR_USER_ID` et `YOUR_RECIPIENT_ID` :

```bash
curl -X POST 'https://unjdpzraozgcswfucezd.supabase.co/rest/v1/typing_status' \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuamRwenJhb3pnY3N3ZnVjZXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMzOTQsImV4cCI6MjA4NTUyOTM5NH0.2fAnI9_Z-iay53GZ2UkXWxBnDULPC6Dm0sCK3XXIMwc" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuamRwenJhb3pnY3N3ZnVjZXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMzOTQsImV4cCI6MjA4NTUyOTM5NH0.2fAnI9_Z-iay53GZ2UkXWxBnDULPC6Dm0sCK3XXIMwc" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "YOUR_USER_ID",
    "recipient_id": "YOUR_RECIPIENT_ID",
    "is_typing": true
  }'
```

Si cela fonctionne, le problème vient du code JavaScript.

---

## 📝 Rappel des fichiers à utiliser

Utilisez les fichiers suivants (renommez-les en enlevant le suffixe) :

- `app.js` (version avec logs de debug)
- `index_enhanced.html` → renommez en `index.html`
- `style_enhanced.css` → renommez en `style.css`

---

## ✅ Si tout fonctionne

Une fois que tout marche, vous pouvez retirer les logs de debug en cherchant et supprimant toutes les lignes contenant `console.log` dans `app.js`.

---

## 🆘 Besoin d'aide ?

Si le problème persiste :

1. Copiez les logs de la console
2. Faites une capture d'écran de l'onglet Network
3. Vérifiez l'onglet **Logs** dans Supabase (API → Logs)
4. Vérifiez les politiques RLS dans Supabase

**Bon débogage ! 🚀**