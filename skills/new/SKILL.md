---
name: new
description: Exécuter automatiquement une séquence Git de démarrage de tâche: checkout main, pull, journaliser le titre du dernier commit, créer une nouvelle branche, puis lire replit.md comme source d'instructions. Utiliser ce skill quand l'utilisateur demande de lancer une nouvelle branche avec cette checklist.
---

# Procédure

1. Vérifier l'état du dépôt:
   - `git status --short --branch`

2. Basculer sur `main`:
   - `git checkout main`

3. Mettre à jour `main`:
   - `git pull`

4. Journaliser le titre du dernier commit de `main`:
   - `git log -1 --pretty=%s`

5. Créer une nouvelle branche (nom fourni par l'utilisateur, sinon générer automatiquement un nom court de type `feat/<sujet>` ou `chore/<sujet>`):
   - `git checkout -b <nouvelle-branche>`

6. Si la branche prévue existe déjà:
   - si elle a déjà été mergée, créer automatiquement une nouvelle branche avec un suffixe unique
   - ne jamais réutiliser une branche déjà mergée
   - si elle n'est pas mergée, vérifier qu'elle correspond bien à la tâche avant de continuer dessus

7. Charger les instructions du dépôt:
   - Lire `replit.md` à la racine
   - Appliquer ces règles pour toute la suite du travail

# Sortie attendue

- Donner un récapitulatif court:
  - branche source (`main`) synchronisée ou non,
  - titre du dernier commit,
  - nom de la nouvelle branche créée,
  - confirmation de lecture de `replit.md`.

# Sortie ChatGPT

- Après création d'une pull request, afficher son URL GitHub brute.
- L'URL doit être celle de la PR déjà créée et finir par `/pull/<number>`.
- Ne pas donner d'URL `compare` sauf si la création de PR échoue vraiment.
- Après merge, afficher deux URL brutes:
  - l'URL GitHub Actions du workflow Pages pour vérifier l'état du build/deploy
  - l'URL finale GitHub Pages du jeu publié
- Éviter les liens enrichis pour ces sorties.
