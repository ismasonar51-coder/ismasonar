// =====================================================================
// CLÉ API YOUTUBE DATA v3 — nécessaire pour la recherche de musiques
// =====================================================================
//
// Ton projet Firebase EST déjà un projet Google Cloud (ismasonar-af5b8),
// donc pas besoin d'en créer un nouveau : juste activer une API en plus.
//
// 1. Va sur https://console.cloud.google.com/apis/library/youtube.googleapis.com
//    (connecte-toi avec le même compte Google que Firebase)
// 2. Vérifie en haut de la page que le projet sélectionné est bien "ismasonar-af5b8"
// 3. Clique sur "Activer" pour activer la YouTube Data API v3
// 4. Va dans "Identifiants" (menu de gauche) > "Créer des identifiants" > "Clé API"
// 5. Une fois la clé créée, clique dessus pour la restreindre (important) :
//    - "Restrictions relatives aux applications" → "Référents HTTP (sites web)"
//      Ajoute : https://ismasonar.vercel.app/* et http://localhost:8000/*
//    - "Restrictions relatives à l'API" → sélectionne uniquement "YouTube Data API v3"
//    - Enregistre
// 6. Copie la clé et colle-la ci-dessous
//
// ⚠️ Quota gratuit : 10 000 unités/jour, une recherche coûte 100 unités
// → environ 100 recherches par jour gratuitement. Largement suffisant pour
// tester ; à surveiller si le jeu grandit (Google Cloud Console > Quotas).
//
// =====================================================================

export const YOUTUBE_API_KEY = "AIzaSyANQLA_uypByat0rCY9odkbkGDn1BKKqq8";
