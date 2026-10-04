# ConsoCI

Application mobile-first de suivi de consommation d'eau SODECI et d'électricité CIE prépayée/postpayée.

> Votre consommation. Votre budget. Votre contrôle.

## Principes produit

- **mesurer** : relevés d'index et recharges ;
- **comprendre** : consommation entre deux relevés ;
- **anticiper** : projection simple basée sur la moyenne journalière ;
- **agir** : alertes et recommandations explicables ;
- **ne jamais présenter une estimation comme une facture officielle**.

## Stack

- **Next.js 15** (App Router, Server Components, Server Actions) — serveur *et* front dans une seule application
- React 19 + TypeScript + Tailwind CSS v4
- Prisma + PostgreSQL
- package `tariff-engine` indépendant, pur et testé
- UI inspirée de ReUI/shadcn : tokens, cards, stats, tabs, charts, sheets, empty states.

> **Note d'architecture.** Ce projet a initialement été spécifié avec un backend NestJS séparé
> (`flow.md` §2). Il a été restructuré pour Next.js : le backend NestJS a été supprimé et la
> logique métier a migré dans le moteur partagé, les Server Actions et l'API REST exposée par
> `/api/v1`. PostgreSQL reste le support de persistance (multi-utilisateur, OTP, sessions).

## Démarrage

```bash
cp apps/web/.env.example apps/web/.env
docker compose up -d
npm install
npm run db:push
npm run db:seed
npm run dev
```

Application : http://localhost:3000

Connexion de démonstration : saisissez un numéro au format `+2250700000000`.
Le code OTP à 6 chiffres s'affiche dans l'interface en développement.

Le seed crée un utilisateur `OWNER` de l'organisation « ConsoCI Démo » : il a
donc accès au back-office (`/back-office`).

## Scripts

| Commande | Effet |
| --- | --- |
| `npm run dev` | compile le moteur puis lance Next.js en développement |
| `npm run build` | build de production |
| `npm test` | tests unitaires (moteur + application) |
| `npm run test:integration` | tests d'intégration de l'API (§53) — nécessite PostgreSQL |
| `npm run test:engine` | tests du moteur de tarification |
| `npm run test:app` | tests des quotas, validations, OTP et champs de formulaire |
| `npm run typecheck` | vérification TypeScript |
| `npm run db:push` | applique le schéma Prisma |
| `npm run db:seed` | jeu de données de démonstration (3 mois d'historique) |

Générer les icônes PWA (optionnel, déjà versionnées) :

```bash
node apps/web/scripts/generate-icons.mjs
```

## Architecture

```text
conso-ci/
├── apps/
│   └── web/                  # Next.js : UI + Server Actions + API REST
│       ├── app/              # pages (App Router) + back-office
│       │   └── api/v1/       # API REST (flow.md §38)
│       ├── components/       # design system et formulaires
│       ├── lib/              # auth, services, validation, plans, analytics, actions
│       ├── public/           # manifest, service worker, icônes
│       └── prisma/           # schéma et seed
├── packages/
│   └── tariff-engine/        # moteurs déterministes, sans dépendance
├── .github/workflows/ci.yml  # types + tests sur chaque push
├── .env.example              # variables d'environnement (flow.md §63)
└── docker-compose.yml        # PostgreSQL
```

## API REST (flow.md §38)

Une API JSON est exposée sous `/api/v1`. Elle réutilise **exactement** les mêmes
services métier que l'interface : aucune règle de calcul n'est dupliquée.

| Méthode | Route | Rôle |
| --- | --- | --- |
| `POST` | `/api/v1/auth/request-otp` | demande un code de 6 chiffres |
| `POST` | `/api/v1/auth/verify-otp` | vérifie le code et renvoie un jeton `Bearer` |
| `POST` | `/api/v1/auth/refresh` | rotation du jeton de rafraîchissement |
| `GET` | `/api/v1/me` | profil, formule et quotas |
| `GET` `POST` | `/api/v1/properties` | logements |
| `GET` `POST` | `/api/v1/meters` | compteurs CIE et SODECI |
| `GET` `POST` | `/api/v1/meters/:id/readings` | relevés d'index |
| `GET` `POST` | `/api/v1/electricity/purchases` | recharges CIE |
| `GET` `POST` | `/api/v1/water/bills` | factures SODECI |
| `GET` | `/api/v1/consumption` | consommation à plat |
| `GET` | `/api/v1/consumption/summary` | agrégation par compteur |
| `GET` | `/api/v1/forecasts` | projections 30 / 90 jours |
| `GET` | `/api/v1/alerts` | alertes recalculées |
| `GET` | `/api/v1/recommendations` | recommandations justifiées |
| `GET` | `/api/v1/dashboard` | tableau de bord (format §39) |

Authentification par `Authorization: Bearer <token>` ou par le cookie de session.
Les erreurs sont renvoyées en français : `{"error": "message", "field": "champ"}`.

```bash
# exemple complet
curl -X POST localhost:3000/api/v1/auth/request-otp \
  -H 'Content-Type: application/json' -d '{"phone":"+2250700000000"}'

curl -X POST localhost:3000/api/v1/auth/verify-otp \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+2250700000000","code":"123456"}'

curl localhost:3000/api/v1/dashboard -H "Authorization: Bearer <token>"
```

Chaque réponse porte le **statut de la donnée** (`REAL`, `ESTIMATE`, `FORECAST`,
`CALCULATED`) : le client ne peut pas confondre une mesure et une estimation.

## Formules (flow.md §47)

| | Gratuite | Premium |
| --- | --- | --- |
| Logements | 1 | illimité |
| Compteurs | 2 | illimité |
| Historique affiché | 3 mois | illimité |
| Projections | 30 jours | 30 et 90 jours |

Les limites portent sur le **volume**, jamais sur la compréhension : toutes les
données déjà saisies restent lisibles, et un quota dépassé n'efface rien. Le
paiement n'est pas implémenté en V1 — `/premium` explique ce que Premium apporte
sans jamais bloquer le produit.

## Sécurité (flow.md §40)

- **OTP** : code haché (SHA-256 + secret), expiration 10 min, 5 tentatives max,
  lockout, invalidation des anciens codes, **comparaison à temps constant**.
- **Rate limiting** en base, **incrément atomique** : deux requêtes simultanées
  ne peuvent pas dépasser la limite (une lecture-puis-écriture le permettait).
  3 demandes de code par numéro et par heure, 10 vérifications par IP.
- **Audit logs** : chaque demande, échec, connexion et publication de tarif est journalisé.
- **Upload de reçus** : signature binaire vérifiée (magic bytes) — un fichier
  `.png` contenant un script est rejeté — taille plafonnée à 5 Mo, noms
  regénérés en UUID (aucun nom utilisateur ne touche le disque).
- **RBAC** : le back-office est réservé aux rôles `OWNER` et `ADMIN` (contrôle
  centralisé dans `lib/backoffice.ts`).
- **Sessions** : JWT `httpOnly`, `sameSite=lax`, `secure` en production.
- **Rotation des jetons** (`POST /api/v1/auth/refresh`) : le jeton de
  rafraîchissement (30 j) n'est **stocké que haché** (SHA-256). Chaque usage le
  **révoque** et en émet un nouveau. Présenter un jeton déjà révoqué est traité
  comme un vol : **toutes les sessions du compte sont révoquées** et l'événement
  est journalisé.
- **Isolation multi-utilisateur** : une ressource appartenant à autrui répond
  `404` et non `403`, pour ne rien divulguer sur son existence. Toutes les tables
  dérivées (projections, alertes, recommandations, appareils) portent un
  propriétaire : aucune donnée n'est partagée entre comptes.
- **Limitation de débit** sur les endpoints d'écriture de l'API.
- **Confidentialité des reçus** : un reçu **refusé** par l'utilisateur est
  supprimé du disque. La suppression refuse toute sortie du dossier d'upload
  (pas de traversée de répertoire).
- **Frontières d'erreur** : `error.tsx` et `not-found.tsx` garantissent un
  message en français même en cas d'exception — jamais la page par défaut de
  Next.js, en anglais.
- **Purge automatique** : sessions expirées, challenges OTP périmés et compteurs
  de débit sont nettoyés à l'occasion des opérations fréquentes, sans cron.

### Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | connexion PostgreSQL utilisée par l'application |
| `DIRECT_URL` | connexion **directe** (sans pooler) utilisée par la CLI Prisma (`db push`, `db seed`). En local, identique à `DATABASE_URL`. **Obligatoire avec Neon.** |
| `AUTH_SECRET` | signature des sessions et hachage des OTP (**à changer en production**) |
| `SMS_PROVIDER_URL` / `SMS_PROVIDER_TOKEN` | fournisseur SMS. Absents → aucun envoi, message d'échec explicite |
| `UPLOAD_DIR` | stockage des reçus (défaut `./uploads`) |

## Design system (shadcn/ui)

L'interface utilise [shadcn/ui](https://ui.shadcn.com) sur Tailwind v4. Les briques
vivent dans `apps/web/components/ui/` et `components/ui.tsx` en reste la façade :
toutes les pages importent `@/components/ui`, jamais un fichier shadcn directement.

La palette est calée sur le design d'origine (gris `#111827`, fond `#f7f8fa`) :
l'installation de shadcn n'a pas changé l'identité visuelle du produit. Les
tokens sont dans `app/globals.css`.

### Select et RadioGroup : un adaptateur est obligatoire

Les `Select` et `RadioGroup` de shadcn sont des widgets Radix : ils tiennent leur
état dans React et **ne produisent rien** dans un `<form>` HTML. Or le projet
soumet des `FormData` natifs à ses Server Actions.

`components/form-fields.tsx` résout ce décalage : `SelectField` et `RadioField`
pilotent le widget Radix **et** répliquent la valeur dans un `<input type="hidden">`.
Le serveur reçoit donc exactement la même valeur qu'avec un `<select>` natif.
Le contrat est verrouillé par `lib/form-fields.test.ts` : si un jour la valeur
cessait d'être sérialisée, le test échouerait.

### Migrer un nouveau composant

```bash
npx shadcn@latest add <nom-du-composant>   # depuis apps/web
```

Puis, si la page doit l'importer via la façade, ajouter le réexport dans
`components/ui.tsx`.

### Base de données managée (Neon) ✅ projet lié

Le projet est lié au projet Neon **`conso-ci`** (région `aws-eu-central-1`).
Le lien est stocké dans `.neon` (ignoré par git) :

```bash
neon link                      # relier le projet courant
neon checkout dev --create     # branche de travail isolée (copy-on-write)
```

`.agents/skills/neon/` contient le skill Neon (mise à jour : `neon skills update`),
et le serveur MCP Neon est enregistré dans Cline.

`neon link` et `neon checkout` tirent les variables d'environnement de la branche
vers `.env` **par défaut**. Sur ce dépôt, `.env` pointe volontairement sur
**Docker Compose en local** : utilisez donc `--no-env-pull` pour ne pas l'écraser.

```bash
neon link --no-env-pull
neon checkout dev-add-reports --create --no-env-pull
```

Pour utiliser Neon réellement, remplacez `DATABASE_URL` / `DIRECT_URL` dans
`apps/web/.env` (valeurs obtenues avec `neon connection-string --prisma` et
`neon connection-string --pooled --prisma`), puis `npm run db:push`.

| Variable | Valeur |
| --- | --- |
| `DATABASE_URL` | endpoint **pooled** (contient `-pooler`) + `pgbouncer=true` |
| `DIRECT_URL` | endpoint **direct** (sans `-pooler`) |

- `pgbouncer=true` est obligatoire : le pooler de Neon ne gère pas les
  transactions interactives, Prisma doit adapter son protocole.
- `connect_timeout=30` absorbe le *cold start* : le compute se met en veille
  après inactivité et il faut quelques secondes pour le réveiller.
- `directUrl` (`prisma/schema.prisma`) est indispensable : sans lui la CLI
  Prisma (`db push`, `db seed`) passe par le pooler et échoue.

> ⚠ **Le schéma `test_consoci` reste isolé.** `tests/setup.ts` redirige les
> **deux** variables vers le schéma de test. Ne retirez pas `DIRECT_URL` de cet
> `env` : `db push --accept-data-loss` viserait alors la base de développement.

## PWA (flow.md §41)

Application installable : manifest complet, icônes 192/512 + maskable, service
worker enregistré **uniquement en production** (en développement il masquerait
les modifications). Stratégie offline volontairement limitée à la V1 : squelette
et dernier dashboard chargé restent disponibles, les Server Actions ne sont
jamais mises en cache.

## Back-office (flow.md §49)

| Route | Contenu |
| --- | --- |
| `/back-office` | vue d'ensemble et activité récente |
| `/back-office/tarifs` | grilles versionnées, publication d'une nouvelle version |
| `/back-office/analytics` | activation, rétention J7, premiers pas, événements |
| `/back-office/audit` | journal filtrable des actions sensibles |

Les tarifs sont administrables sans modifier le code : les valeurs sont
contrôlées, la source doit être une URL `https`, et une version ne peut pas
démarrer avant la précédente. Les versions publiées ne sont jamais modifiées.

Les analytics ne montrent que des chiffres **calculés depuis les événements
réellement enregistrés** (table `ProductEvent`) : aucun indicateur n'est estimé
ni extrapolé.

## Appareils (flow.md §32)

`/appareils` estime la consommation de chaque appareil déclaré :

```text
kWh/mois = (puissance W / 1000) × heures par jour × jours par mois
```

Les appareils sont classés par consommation décroissante, avec leur part. Le coût
en FCFA n'est affiché **que** si le coût effectif par kWh est connu — c'est-à-dire
issu de recharges comportant les kWh crédités du reçu (flow.md §18). L'ensemble
est marqué `ESTIMÉ` : ces chiffres servent à **comparer vos appareils entre eux**,
pas à mesurer votre consommation réelle.

## Performance (flow.md §42)

**Les graphiques sont chargés à la demande.** Recharts est le poste le plus
lourd du bundle ; il est isolé derrière `components/charts-lazy.tsx` et un
squelette s'affiche à sa place. Les pages importent `charts-lazy`, jamais
`charts` directement.

| Route | Avant | Après |
| --- | --- | --- |
| `/` (tableau de bord) | 222 ko | 157 ko |
| `/consommation` | 222 ko | 117 ko |
| `/historique`, `/premium` | 116 ko | 116 ko |

`motion` n'est importé que par les pages qui animent réellement : les pages
qui l'ignorent ne le payent pas.

**Mesures réelles** (build de production, Chrome headless, `PerformanceObserver`
sur `largest-contentful-paint`) :

| Page | LCP | CLS |
| --- | --- | --- |
| `/accueil` | 632 ms | 0 |
| `/` (tableau de bord) | 344 ms | 0 |

Objectif §42 : LCP < 2 500 ms. Le CLS nul confirme que les animations n'introduisent
pas de décalage de mise en page.

## Accessibilité (flow.md §43)

- `lang="fr"`, `aria-label` sur chaque navigation, `aria-current` sur l'onglet actif ;
- anneau de focus visible (`:focus-visible`) — la navigation clavier ne dépend
  pas de l'anneau par défaut ;
- cibles tactiles ≥ 44 px sur mobile ;
- erreurs de formulaire annoncées en `role="alert"` et **jamais masquées** par
  une animation ;
- `prefers-reduced-motion` et `prefers-contrast: more` sont respectés.

## Animations (flow.md §44)

Volontairement sobres et non permanentes — `components/motion.tsx` :

- apparition en cascade des cartes (`Reveal`) ;
- changement de valeur des KPI (`AnimatedValue`), animé **uniquement quand la
  valeur bouge**, via une `key` qui force le remontage ;
- retour après sauvegarde (`SaveButton`) : état « en cours » puis confirmation.

Durée unique : **220 ms**, `easeOut`. Aucune animation en boucle. Avec
`prefers-reduced-motion`, le mouvement disparaît mais le changement reste visible.

## Reçus et lecture automatique (flow.md §57)

L'OCR est une V1.1, mais son **architecture est en place dès maintenant** :

```text
Photo → OCR → Extraction → Proposition → Confirmation → Sauvegarde
```

`/recus` permet de déposer une photo de facture SODECI. Elle est enregistrée
dans `DraftExtraction` au statut `PENDING` — **jamais** comme facture.

> **Invariant vérifié :** une photo ne devient une facture qu'après validation
> explicite. `createDraftExtraction` n'écrit que dans `DraftExtraction` ;
> `confirmDraftExtraction` est le seul point d'écriture d'une `WaterBill`.

- **double confirmation** refusée : une transaction + le filtre `status: PENDING`
  empêchent qu'un double-clic crée deux factures ;
- **confirmation par un tiers** refusée : le `userId` est toujours exigé ;
- **refus** possible : `REJECTED`, rien n'est écrit ;
- le formulaire de dépôt ne contient **aucun** champ montant/consommation : ces
  valeurs ne peuvent pas être enregistrées sans passer par la confirmation.

Le moteur de reconnaissance n'est pas embarqué (V1.1). En revanche, l'**étape
d'extraction est fonctionnelle** : si vous collez le texte de votre reçu,
l'application en extrait le montant, la consommation et la période, puis vous les
**propose** à la vérification. Sans texte, aucune valeur n'est proposée : rien
n'est deviné.

L'extraction reste volontairement conservatrice : elle gère les deux formats de
montant (`6 850 FCFA` et `12.500,50 FCFA`) ainsi que `m3` comme `m³`, et un champ
non trouvé reste vide. Une extraction automatique n'est jamais de confiance
`HIGH` avant vérification humaine.

## Tests d'intégration de l'API (flow.md §53)

```bash
npm run test:integration
```

Les **vraies routes** `/api/v1` sont appelées avec de vraies requêtes, sans
mock, contre un schéma PostgreSQL **distinct** (`test_consoci`). Couverture :

| Endpoint | Ce qui est vérifié |
| --- | --- |
| `POST /properties` | création, 401 sans jeton, 422 sans nom |
| `POST /meters` | création, mode de paiement conservé, 403 sur logement d'autrui |
| `POST /meters/:id/readings` | 139,8 − 124,3 = 15,5, index décroissant signalé **et conservé**, 422 si négatif |
| `POST /electricity/purchases` | `ESTIMATE`/confiance basse sans kWh, `REAL` avec kWh, coût effectif, 403 sur compteur d'eau |
| `GET /dashboard` | reflète les données réelles, pas de faux zéro si vide |
| `GET /meters/:id/readings` | isolation : `404` et non `403` chez un autre utilisateur |

Trois fichiers de tests, tous sans mock :

| Fichier | Propriété verrouillée |
| --- | --- |
| `tests/api.test.ts` | les 5 endpoints du §53 + l'isolation entre comptes |
| `tests/rate-limit.test.ts` | **la limite ne cède pas sous 30 requêtes simultanées** (§40) |
| `tests/ocr.test.ts` | l'OCR n'écrit jamais une facture sans confirmation (§57) |

Le test de concurrence a été validé en réintroduisant volontairement la
version naïve du rate limiter : il échoue bien. Un test qui n'a jamais échoué ne
prouve rien.

### Propriétés garanties par `tests/ocr.test.ts`

- une proposition d'extraction seule n'écrit **aucune** facture ;
- la confirmation écrit la facture et marque le brouillon `CONFIRMED` ;
- une double confirmation est refusée (pas de doublon) ;
- un tiers ne peut pas confirmer le brouillon d'autrui ;
- le refus supprime la **photo du disque** ;
- des dates incohérentes ou dans le futur sont refusées.

> ⚠ **La base de développement n'est jamais touchée.** `tests/setup.ts` vérifie
> que `DATABASE_URL` pointe bien sur `test_consoci` et **refuse de s'exécuter**
> sinon. Cette barrière existe parce qu'une version antérieure de ce script a
> réellement réinitialisé la base de démonstration.

## Test d'acceptation (§60)

Le parcours défini par le plan est rejoué **dans l'interface réelle**, sur un
build de production, via `tools/journey.sh` :

```bash
bash tools/journey.sh
```

Le script démarre un faux fournisseur SMS (`tools/sms-stub.mjs`) puis déroule,
avec un vrai navigateur : compte → logement → compteur CIE → compteur SODECI →
relevé d'eau → recharge CIE → tableau de bord → projection → deuxième relevé.

Résultat observé : la recharge de 10 000 FCFA est bien enregistrée et marquée
`≈ 169,3 kWh` **Estimé** (aucun kWh crédité saisi), et l'historique calcule
**15,5 m³** entre les index 124,3 et 139,8.

> Ce script **crée un compte de test** avec un numéro généré aléatoirement.
> Les comptes qu'il produit peuvent être supprimés avec :
> `DELETE FROM "User" WHERE phone LIKE '+225079%';`

## Règles métier respectées

Les invariants suivants sont codés et couverts par les tests :

- une valeur de compteur n'est **jamais** interprétée automatiquement (`readingType`obligatoire) ;
- un index décroissant est **conservé et signalé**, jamais supprimé ;
- les kWh estimés sont marqués `ESTIMATE` avec une confiance basse, les kWh crédités `REAL` ;
- le moteur tarifaire est **déterministe** et versionné, jamais alimenté par une IA ;
- le prépaiement réutilise la grille des compteurs ordinaires (pas de grille « prépayé » inventée) ;
- une facture SODECI donne un **coût effectif observé**, jamais présenté comme le tarif officiel ;
- l'éligibilité au tarif social ne **jamais** affirmer un changement officiel de tarif ;
- **aucune projection** n'est affichée sans au moins 7 jours d'historique et
  2 recharges : mieux vaut « — » qu'un chiffre trompeur ;
- le coût effectif par kWh (`montant payé / kWh crédités`) est un **coût observé**,
  pas le prix réglementaire du kWh.

## Tarification CIE

Le moteur embarque la grille publiée par la CIE pour le tarif domestique social monophasé 5A et
le tarif domestique général 5A, avec version, date d'effet, source et date de vérification.

ANARE indique qu'il n'existe pas de grille prépayée distincte : la grille des compteurs ordinaires
est appliquée au prépaiement. Les tarifs sont stockés en base et administrables sans modifier le front.