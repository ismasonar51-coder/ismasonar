# IsmaSonar — Phase 1 : Lobby (créer / rejoindre un salon)

Ce qui fonctionne dans cette version :
- Écran d'accueil (créer un salon / rejoindre un salon)
- Création de salon : nom du host, config "même pièce / à distance", format (manches ou durée)
- Génération d'un code à 6 chiffres + QR code
- Jonction d'un salon via le code
- Liste des joueurs synchronisée en temps réel (Firestore) — teste avec deux téléphones ou deux onglets, tu verras les joueurs apparaître en direct des deux côtés

Ce qui **n'est pas encore fait** (prochaines phases) :
- Le bouton "Lancer la partie" (logique de jeu : manches, musique, vote, score, piège)
- Les comptes host (authentification)
- Le paiement / les limites gratuit-payant
- Le design final (c'est une version fonctionnelle, pas encore stylée à 100%)

---

## 1. Configurer Firebase (5-10 min)

1. Va sur https://console.firebase.google.com et crée un projet (ex: `ismasonar`)
2. Dans le menu de gauche : **Bases de données et stockage > Firestore > Créer une base de données**
3. ⚠️ **Point important** (c'est ce qui t'a bloqué la dernière fois) : à l'étape où on te demande un **ID de base de données**, laisse la valeur par défaut **`(default)`** — ne tape pas de nom personnalisé. Seule la base `(default)` est gratuite ; toute base avec un nom personnalisé exige d'activer la facturation.
4. Choisis une région proche de toi, démarre en **mode production**
5. Une fois la base créée, va dans l'onglet **Règles** (en haut de la page Firestore, à côté de "Données", "Index"...) et remplace le contenu par :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomCode} {
      allow read, create, update: if true;
      match /{subcollection}/{docId} {
        allow read, create, update, delete: if true;
      }
    }
  }
}
```

> Ces règles couvrent maintenant toutes les sous-collections d'un salon (joueurs, chat, et celles à venir) en une seule fois — plus besoin de les retoucher à chaque nouvelle fonctionnalité jusqu'à la phase de sécurisation (phase 5, avec les comptes host).

Clique sur **Publier**.

> ⚠️ Ces règles sont volontairement ouvertes pour tester rapidement. On les sécurisera (limiter qui peut écrire quoi) en phase 5, avec les comptes host.

6. Retourne à la page d'accueil du projet Firebase, clique sur l'icône Web `</>`, donne un nom à l'app
7. Copie les valeurs affichées dans `firebaseConfig` et colle-les dans `js/firebase-config.js` à la place de `"REMPLACE_MOI"`

## 2. Tester en local

Comme c'est un site statique (pas de build), tu peux juste ouvrir `index.html` dans un navigateur — mais certains navigateurs bloquent les modules JS en `file://`. Le plus simple :

```bash
# Depuis le dossier ismasonar/
python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

Ouvre deux onglets (ou un onglet + ton téléphone sur le même réseau avec ton IP locale) pour tester la création/jonction de salon en simultané.

## 3. Déployer sur Netlify

Comme d'habitude : glisse le dossier `ismasonar/` sur https://app.netlify.com/drop, ou connecte le repo Git si tu en crées un.

---

## Structure du projet

```
ismasonar/
├── index.html          → toutes les vues (accueil, création, lobbies)
├── css/style.css        → charte Isma dérivée (dark navy + amber/violet/teal)
├── js/
│   ├── firebase-config.js   → tes clés Firebase (à remplir)
│   └── app.js                → toute la logique (routing, Firestore, QR code)
└── README.md
```

## Prochaine étape

Une fois que tu as testé et que la synchro des joueurs fonctionne bien des deux côtés, on attaque la **phase 2 : logique de jeu** (lancement des manches, lecture des musiques, timer de débat, vote, calcul des points, piège).

**Conseil pour ne pas reperdre le projet :** garde ce dossier dans un endroit stable sur ton PC (pas dans un dossier temporaire/téléchargements que tu vides souvent), et si tu es à l'aise avec Git, ça vaut le coup de créer un dépôt GitHub pour ce projet — ça te met à l'abri d'une perte de fichiers.
