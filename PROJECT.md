# Assistant de documentation local

Application desktop qui répond à des questions sur un langage de programmation à partir de sa documentation officielle, avec un petit modèle de langage qui tourne en local. Tout fonctionne hors ligne une fois les docs et le modèle installés.

Nom de travail : à définir.

## Objectif

Quand on arrive sur un langage inconnu, on le sélectionne, on pose une question en langage naturel ("copier une chaîne en C") et on obtient une réponse courte avec un exemple de code, appuyée sur la vraie documentation et accompagnée du lien vers la page source.

## Contraintes

- Multiplateforme : macOS, Windows, Linux. Pas de dépendance à Dash (payant) ni à Zeal (pas de version Mac).
- Rien à installer à côté : pas d'Ollama requis. Le moteur d'inférence est embarqué dans l'app.
- Légère : l'installeur ne contient ni modèle ni documentation. Tout se télécharge à la demande.
- Fonctionne hors ligne après installation des docs et du modèle.
- Les réponses doivent citer la source et respecter l'attribution de chaque doc.

## Stack

- Application : Tauri 2 (Rust pour le backend, front React + Vite + TypeScript).
- Interface de chat : assistant-ui (composants React : liste de messages, défilement, streaming, copie, régénération). Alternative : AI Elements (composants shadcn/ui de Vercel).
- Liaison avec le modèle : Vercel AI SDK (`useChat`), branché sur le serveur compatible API OpenAI de llama.cpp, lancé en local.
- Rendu Markdown : Streamdown (conçu pour le texte reçu en streaming). Repli : react-markdown + remark-gfm + Shiki, avec bouton "copier" sur les blocs de code.
- Inférence locale : llama.cpp embarqué, lancé comme processus compagnon (sidecar) ou via une crate Rust de liaison. Format de modèle : GGUF quantifié (Q4 en général).
- Documentation : DevDocs (devdocs.io), seule source au départ.

## Architecture

### 1. Gestionnaire de documentation

- Lire le manifeste `https://devdocs.io/docs.json`. Chaque entrée donne `name`, `slug`, `type`, `mtime`, `db_size`, `attribution`, et parfois `version`, `release`, `links`, `alias`.
- Afficher la liste des langages avec leur taille. Boutons Installer, Mettre à jour, Supprimer.
- Fichiers attendus pour une doc : `index.json` (liste des entrées : nom, chemin, type) et `db.json` (contenu HTML des pages, indexé par chemin), sous `https://documents.devdocs.io/<slug>/`. À VÉRIFIER avant de coder : l'URL exacte et le format des deux fichiers.
- Stocker dans le dossier de données de l'application (`app_data_dir` de Tauri). Télécharger une seule fois, mettre en cache, comparer `mtime` pour proposer une mise à jour. Ne jamais re-télécharger à chaque lancement : c'est un service gratuit.
- Garder le champ `attribution` de chaque doc pour l'afficher sous les réponses.

#### Mises à jour et versions

- Jamais de vérification à chaque message. Le manifeste est consulté au lancement de l'app, au plus une fois toutes les 24 heures, en tâche de fond sans bloquer l'interface. Un bouton "Vérifier maintenant" existe dans les réglages.
- Requête conditionnelle (ETag ou If-Modified-Since) pour ne retélécharger le manifeste que s'il a changé.
- Comparer le `mtime` du manifeste avec celui stocké pour chaque doc installée. Si différent, afficher "Mise à jour disponible" sur cette doc. Option dans les réglages : mise à jour automatique, désactivée par défaut.
- Hors ligne ou erreur réseau : ignorer en silence et continuer avec les docs installées.
- Mise à jour atomique : télécharger dans un dossier temporaire, vérifier, puis remplacer l'ancienne version. En cas d'échec, l'ancienne reste utilisable.
- Versions : DevDocs publie plusieurs versions d'un même outil comme des entrées séparées dans le manifeste (champs `version` et `release`). L'utilisateur choisit la version par langage. Si une version plus récente existe, le signaler sans changer automatiquement.
- Afficher dans les réponses le nom et la version de la doc utilisée.

### 1 bis. Installation de doc par la conversation

- Si l'utilisateur demande une doc non installée ("je veux la doc de Rust", "comment faire X en Go" alors que Go n'est pas installé), l'assistant propose de l'installer directement dans le chat : une carte avec le nom, la version, la taille et un bouton "Installer". Au clic, la doc est téléchargée, ajoutée au menu des langages et sélectionnée.
- L'assistant ne génère jamais d'URL. Il ne fait que chercher dans le manifeste DevDocs déjà chargé (nom, slug, alias, version). Une URL inventée par un petit modèle serait peu fiable.
- Détection de l'intention et du langage en code (correspondance sur le manifeste, avec tolérance aux fautes et aux alias comme "js" ou "golang"), pas par l'appel d'outils du modèle, peu fiable sur les petits modèles. Le modèle n'intervient qu'ensuite, pour la réponse.
- Plusieurs versions possibles : la carte propose la plus récente par défaut, avec un sélecteur pour les autres.
- Aucune doc n'est téléchargée sans clic de confirmation.
- Si le langage n'est pas dans le manifeste, le dire clairement et proposer les docs proches, sans inventer de source.
- Après l'installation, répondre à la question initiale si elle en contenait une.

### 2. Recherche dans la doc

- Au départ, pas de modèle d'embedding. Recherche lexicale sur `index.json` : correspondance exacte du nom, préfixe, puis recherche approchée (fuzzy), avec un classement simple.
- Pour une question en langage naturel, deux étapes : le modèle extrait des mots-clés ou des noms de fonctions candidats, la recherche trouve les entrées, on récupère les 2 à 3 meilleures pages dans `db.json`.
- Convertir le HTML des pages en texte propre (garder blocs de code, signature, description) et tronquer à une taille compatible avec le contexte du modèle.
- Amélioration possible plus tard : embeddings légers pour la recherche sémantique.

### 3. Gestionnaire de modèles

- Écran de réglages : liste de modèles proposés, avec taille, quantification et recommandation. Installer, Supprimer, Choisir le modèle actif.
- Téléchargement avec barre de progression, reprise après interruption, vérification d'intégrité (somme de contrôle).
- Stockage dans le dossier de données de l'app.
- Modèle par défaut : un modèle de 3 à 4 milliards de paramètres quantifié (environ 2 à 3 Go). Option plus précise : 7 à 8 milliards (environ 4 à 5 Go). Les tailles sont des ordres de grandeur. Choisir les modèles réels disponibles en GGUF au moment du développement, en privilégiant ceux orientés code, et vérifier leur licence.
- L'utilisateur peut changer de modèle à tout moment si la réponse n'est pas assez précise.

### 4. Génération de la réponse

- Prompt système : répondre uniquement à partir des passages fournis, en français ou dans la langue de la question, de façon courte, avec un exemple de code. Si les passages ne contiennent pas la réponse, le dire au lieu d'inventer.
- Réponse en streaming dans l'interface, via le serveur local compatible OpenAI de llama.cpp et le hook `useChat` du Vercel AI SDK.
- Ne pas recoder les éléments génériques d'un chat (défilement, liste de messages, rendu Markdown, copie du code) : les bibliothèques ci-dessus s'en chargent.
- Toujours afficher sous la réponse : la ou les pages sources (titre et lien vers la page officielle) et l'attribution de la doc.

### 5. Interface

- Écran principal : sélecteur de langage, champ de question, zone de réponse, sources.
- Écran de réglages : gestionnaire de docs et gestionnaire de modèles.
- Premier lancement : proposer d'installer un modèle et une ou deux docs, avec l'espace disque affiché.
- Un mode "recherche seule" (sans modèle) qui affiche directement les entrées de la doc, utile avant l'installation du modèle ou sur une machine modeste.

## Étapes proposées

1. Squelette Tauri et écran de réglages.
2. Gestionnaire de docs : manifeste, téléchargement, stockage, suppression. Vérifier les URL et formats réels.
3. Recherche lexicale dans `index.json`, affichage des pages en mode "recherche seule".
4. Intégration de llama.cpp (sidecar) : chargement d'un modèle, génération en streaming.
5. Gestionnaire de modèles avec téléchargement.
6. Assemblage : question, recherche, passages, réponse sourcée.
7. Finitions : premier lancement, gestion d'erreurs, thème, empaquetage pour les trois plateformes.

## Points à vérifier avant de coder

- Format et URL exacts des fichiers d'une doc DevDocs.
- Conditions d'utilisation de DevDocs et licence de chaque doc, pour l'attribution.
- Meilleure méthode pour embarquer llama.cpp avec Tauri sur les trois plateformes (sidecar ou crate), et accélération matérielle (Metal sur Mac, CPU ou GPU ailleurs).
- Modèles GGUF disponibles aujourd'hui, leur licence et leur taille réelle.
- Taille de contexte réaliste pour une machine modeste.
- État actuel et compatibilité de assistant-ui, du Vercel AI SDK et de Streamdown avec le serveur llama.cpp et avec Tauri (versions, configuration du transport).

## Hors périmètre pour la première version

Recherche web, docs hors DevDocs (Dash, Zeal, docs maison), embeddings, historique de conversation.
