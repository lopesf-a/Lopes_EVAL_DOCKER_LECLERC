# TP ÉVALUATION — Advanced Docker Debugging & Architecture (5h)
Master 2 — Développement Web

---

## Contexte

Vous rejoignez une équipe ayant quitté un projet web en urgence.

Une stack Docker existe déjà mais :

- l'application ne fonctionne pas correctement
- plusieurs erreurs runtime sont présentes
- la configuration n'est pas sécurisée
- les performances sont mauvaises

Votre mission :

Analyser, corriger et améliorer la stack existante afin d'obtenir une application fonctionnelle et robuste.

---

## Important

Aucune solution détaillée ne sera fournie.

Vous devez :

- analyser
- comprendre
- tester
- corriger

---

## Stack fournie

Une archive contient :

```
project/
│
├── docker-compose.yml
├── frontend/        (React)
├── backend/         (Node API)
├── nginx/
└── secrets/
```

---

## Architecture cible attendue

```
Browser
   |
Nginx (reverse proxy)
   |
Frontend (React)
   |
Backend API (Node.js)
   |
PostgreSQL
```

---

## État actuel (volontairement problématique)

Sans modification :

- frontend accessible mais API ne répond pas
- backend crash parfois
- base de données instable
- rebuild très lent
- credentials exposés
- healthchecks inexistants

---

## Durée

5 heures

---

## PARTIE 1 — Diagnostic complet (30 min)

Identifier :

- pourquoi le frontend ne peut pas appeler l'API
- pourquoi la base de données ne répond pas immédiatement
- quels services ne communiquent pas correctement

Livrable :

- liste des problèmes identifiés

---
### 1. 
```
 db:
      image: postgres:16-alpine
      container_name: m2_db
      environment:
        POSTGRES_DB: ${POSTGRES_DB}
        POSTGRES_USER: ${POSTGRES_USER}
        # Volontairement en clair au départ (à migrer vers secrets)
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      volumes:
        - pg_data:/var/lib/postgresql/data
      networks:
        - backend
      # Pas de healthcheck au départ (à ajouter)

    backend:
      build:
        context: ./backend
      container_name: m2_backend
      environment:
        PORT: ${API_PORT}
        NODE_ENV: ${NODE_ENV}
        # Volontairement faux : ne doit pas être localhost en Docker
        DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}
      ports:
        - "3000:3000"
      depends_on:
        - db
      networks:
        - backend
```
Problème : localhost dans Docker Compose fait référence au container lui-même, pas au container backend.
Le frontend doit appeler le backend via le nom de service Docker ou la variable VITE_API_BASE_URL correcte :

```
VITE_API_BASE_URL=http://backend:3000
```
### 2. Base de données lente

PostgreSQL alpine prend quelques secondes pour être prêt.
Backend tente de se connecter immédiatement, donc risque d’erreur ECONNREFUSED.
Solution : ajouter un healthcheck pour la DB et attendre qu’elle soit prête avant de lancer le backend.

### 3. Services qui ne communiquent pas

Le backend et la DB sont sur le même réseau (backend), c’est correct.
Frontend et nginx ont le frontend réseau pour exposer les ports.
Mais DATABASE_URL et VITE_API_BASE_URL sont mal configurés → pas de communication fonctionnelle.

## PARTIE 2 — Debugging Docker Compose (1h)

Corriger :

- réseaux Docker
- ports incorrects
- variables d’environnement invalides
- dépendances entre services

Contraintes :

- ne pas supprimer de services
- architecture globale conservée

---

### 1. Ports

Corrects pour backend (3000), frontend (5173), nginx (8080)
### 2. Réseaux

Backend et DB sur backend → ok
Frontend doit pouvoir parler backend → ok car présent sur backend

### 3. Variables d’environnement

Backend : remplacer localhost par db (ou postgres) dans DATABASE_URL :
``` DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB} ```

### 4. depends_on
Ne suffit pas → ajouter healthchecks pour la DB et le backend


## PARTIE 3 — Dockerfile avancé backend (1h)

Le backend possède un Dockerfile non optimisé.

Objectifs :

- réduire taille image
- améliorer cache build
- ajouter multi-stage build
- exécution non-root

---

### Problèmes
COPY . . copie tout → image plus lourde, cache inefficace
Tout se fait en root → risque sécurité
Pas de multi-stage build → image plus grande

### Solution optimisée
```
# Stage 1 : build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2 : production
FROM node:20-alpine
WORKDIR /app
# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

Avantages :
Multi-stage → image finale plus légère
Cache npm efficace
Exécution non-root

## PARTIE 4 — Gestion des secrets (45 min)

Actuellement :

- mot de passe DB visible dans compose

Objectifs :

- supprimer credentials en clair
- utiliser Docker secrets
- adaptation backend si nécessaire

---

### Problème

Mot de passe DB visible en clair dans Compose
Solution : Docker secrets

``` 
services:
  db:
    ...
    secrets:
      - db_password
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password

  backend:
    ...
    secrets:
      - db_password
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:/run/secrets/db_password@db:5432/${POSTGRES_DB}

secrets:
  db_password:
    file: ./secrets/db_password.txt
```
Créer le fichier ./secrets/db_password.txt contenant juste le mot de passe.
Backend doit lire /run/secrets/db_password pour se connecter.

## PARTIE 5 — Healthchecks et résilience (45 min)

Ajouter :

- healthcheck PostgreSQL
- healthcheck backend API
- dépendances conditionnelles

Attendu :

- application démarre même si DB lente

---

### DB healthcheck
```
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
  interval: 10s
  retries: 5
```

### Backend healthcheck
Ajouter endpoint /health dans le backend
```
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
  interval: 10s
  retries: 5
```
Depends_on avec condition
```
depends_on:
  db:
    condition: service_healthy
```
Garantit que le backend attend la DB prête avant de démarrer.

## PARTIE 6 — Optimisation développeur (30 min)

Améliorer :

- rebuild rapide
- hot reload fonctionnel
- cache npm efficace

---

### Hot reload et rebuild rapide
Utiliser volumes pour monter le code :
``` 
backend:
  volumes:
    - ./backend:/app
```

Nodemon pour hot reload :
```
CMD ["npx", "nodemon", "dist/index.js"]
```

Cache npm
``` 
COPY package*.json ./
RUN npm install
COPY . .
```
→ npm install est réutilisé tant que package.json n’a pas changé.

## BONUS — Diagnostic expert (30 min)

Identifier :

- pourquoi COPY . . est dangereux
COPY . . copie fichiers inutiles → augmente taille et peut exposer secrets
- pourquoi depends_on ne suffit pas
depends_on ne garantit pas que service est prêt → il faut healthchecks
- pourquoi une image node officielle peut être mauvaise par défaut
Image Node officielle full → grande, root, pas optimisée pour prod

---

## Critères d’évaluation

| Compétence | Points |
|---|---|
| Diagnostic architecture | 5 |
| Debugging Compose | 5 |
| Dockerfile avancé | 4 |
| Secrets sécurisés | 3 |
| Healthchecks | 3 |

---

## Contraintes

- utilisation de Docker Compose obligatoire
- aucune installation locale runtime (Node, Postgres…)
- solution reproductible

---

## Attendus implicites

- comprendre networking Docker
- comprendre startup order
- comprendre layers Docker
- comprendre secrets vs env