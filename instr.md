J’ai terminé l’audit structurel du dépôt **[Colorado225/ReleveMAJ](https://github.com/Colorado225/ReleveMAJ?utm_source=chatgpt.com)**. Je me suis basé sur le code de `main`, le schéma Prisma, les API, les Server Actions, le moteur tarifaire, les tests, le CI GitHub Actions et les derniers commits.

## Verdict global

**Le projet est nettement plus avancé qu’un simple MVP**, avec une architecture cohérente et plusieurs bonnes décisions de sécurité. En revanche, je **ne le considérerais pas encore production-ready**.

### Note actuelle : **7,4 / 10**

| Domaine           |       Note | Diagnostic                                                                |
| ----------------- | ---------: | ------------------------------------------------------------------------- |
| Architecture      | **8.5/10** | Très bonne séparation Next.js / métier / moteur tarifaire                 |
| Modèle de données |   **8/10** | Riche et bien pensé, quelques invariants manquants                        |
| Sécurité          | **7.5/10** | Beaucoup de protections, mais concurrence/auth à renforcer                |
| API               |   **7/10** | Bonne isolation, validation et structure                                  |
| Métier CIE/SODECI | **7.5/10** | Très bon principe réel/estimé, mais incohérences possibles                |
| Tests             |   **8/10** | Beaucoup de tests pertinents, mais certains invariants critiques manquent |
| CI/CD             |   **5/10** | Pipeline actuellement cassé                                               |
| Performance       |   **8/10** | Lazy loading, requêtes bornées, SSR                                       |
| UI/UX             |   **7/10** | Propre et cohérent, mais encore assez sobre                               |
| Maintenabilité    |   **8/10** | Code documenté et conventions assez claires                               |

---

# 1. Architecture : bonne décision

Le choix actuel :

```text
Next.js 15
├── App Router
├── Server Components
├── Server Actions
├── API REST /api/v1
├── Prisma
│   └── PostgreSQL / Neon
│
└── packages/
    └── tariff-engine
```

est beaucoup plus simple à maintenir qu'un :

```text
Next.js
   ↓
NestJS
   ↓
PostgreSQL
```

pour cette V1.

Le moteur `tariff-engine` est particulièrement bien isolé :

```text
packages/tariff-engine/
├── tariff.ts
├── consumption.ts
├── alerts.ts
├── schemes.ts
├── types.ts
└── tests
```

C'est une excellente décision.

Les calculs CIE ne sont donc pas dispersés dans les composants React.

### Très bon point

Le principe :

> **la base contient les tarifs administrables, le moteur ne dépend pas du front**

est exactement celui que je conserverais.

---

# 2. Le plus gros problème actuel : CI cassée

C'est le premier problème à régler.

Le dernier commit est :

```text
62f969b
Updated package-lock.json
```

et le workflow CI correspondant est actuellement en cours d'exécution.

Mais le run précédent a échoué **avant même les tests**.

L'erreur exacte est :

```text
Error: Prisma schema validation
Error code: P1012

Environment variable not found: DIRECT_URL.

--> prisma/schema.prisma:18
directUrl = env("DIRECT_URL")
```

Le workflow définit :

```yaml
DATABASE_URL: ...
AUTH_SECRET: ...
```

mais **pas `DIRECT_URL`**.

Or `schema.prisma` contient :

```prisma
directUrl = env("DIRECT_URL")
```

Donc :

```text
npm ci                    ✅
prisma generate           ✅
prisma validate           ❌
tests                     ⏭️
```

Le pipeline ne teste actuellement même pas l'application.

### Correction immédiate

Dans `.github/workflows/ci.yml` :

```yaml
env:
  DATABASE_URL: postgresql://conso:conso@localhost:5432/conso_ci?schema=public
  DIRECT_URL: postgresql://conso:conso@localhost:5432/conso_ci?schema=public
  AUTH_SECRET: secret-de-ci-uniquement
```

C'est une correction **P0**.

---

# 3. Autre problème CI : dépendances vulnérables

Le run CI a également rapporté :

```text
5 vulnerabilities
1 moderate
4 high
```

après `npm ci`.

Le pipeline continue malgré cela.

Je recommande d'ajouter une étape :

```yaml
- name: Audit des dépendances
  run: npm audit --audit-level=high
```

Mais **ne fais surtout pas** :

```bash
npm audit fix --force
```

aveuglément.

Il faut identifier les packages concernés, vérifier leur chaîne de dépendances et faire les upgrades compatibles avec Next 15 / React 19 / Prisma 6.

---

# 4. Très gros point positif : sécurité multi-utilisateur

J'ai particulièrement regardé les accès aux données.

Vous utilisez correctement des patterns comme :

```ts
where: {
  id,
  property: {
    userId: session.id
  }
}
```

au lieu de :

```ts
where: {
  id;
}
```

C'est important.

Par exemple :

```text
User A
 └── Property A
      └── Meter A

User B
 └── Property B
      └── Meter B
```

User A ne peut pas simplement envoyer :

```http
GET /api/v1/meters/METER_B/readings
```

pour obtenir les données de B.

Le test d'isolation existe également.

**Très bon niveau sur ce point.**

---

# 5. Mais il y a une vraie faille de concurrence dans le refresh token

C'est l'un des problèmes que je corrigerais avant production.

Actuellement :

```ts
const session = await db.session.findUnique(...)
```

puis :

```ts
if (session.revokedAt) {
   ...
}
```

puis :

```ts
await db.session.update({
  where: { id: session.id },
  data: { revokedAt: new Date() },
});
```

Imagine deux requêtes simultanées :

```text
Request A ── find session ── revokedAt = null
Request B ── find session ── revokedAt = null

Request A ── revoke
Request B ── revoke

Request A ── create new refresh
Request B ── create new refresh
```

Résultat :

**un même refresh token peut théoriquement produire deux rotations concurrentes.**

Le mécanisme de détection de réutilisation est donc moins robuste qu'il n'en a l'air.

### Correction recommandée

Faire la rotation dans une transaction avec une mise à jour conditionnelle :

```text
BEGIN

UPDATE Session
SET revokedAt = NOW()
WHERE id = ?
AND revokedAt IS NULL
AND expiresAt > NOW()

si 0 ligne :
    reuse / expired

si 1 ligne :
    créer nouvelle session

COMMIT
```

Ou utiliser un verrou transactionnel PostgreSQL.

### Priorité

**P0 sécurité.**

---

# 6. Même problème sur l'OTP

Il existe une race similaire ici :

```ts
const challenge = await db.otpChallenge.findFirst(...)
```

puis :

```ts
otpCodeMatches(...)
```

puis :

```ts
await db.otpChallenge.update({
  data: { consumedAt: new Date() },
});
```

Deux requêtes peuvent théoriquement faire :

```text
A → lit challenge PENDING
B → lit challenge PENDING

A → code correct
B → code correct

A → consumed
B → consumed

A → session
B → session
```

Donc le même OTP pourrait être consommé deux fois dans une fenêtre de concurrence.

### Il faut rendre la consommation atomique.

Par exemple :

```sql
UPDATE "OtpChallenge"
SET "consumedAt" = NOW()
WHERE id = ?
  AND "consumedAt" IS NULL;
```

et vérifier :

```text
affectedRows === 1
```

Cela devrait être couvert par un test concurrent.

---

# 7. Le rate limiter est amélioré, mais possède encore une race

La correction actuelle est bonne dans l'intention :

```ts
updateMany({
  data: {
    count: {
      increment: 1,
    },
  },
});
```

C'est nettement mieux qu'un simple :

```text
SELECT count
→ +1
→ UPDATE
```

Mais lorsque la fenêtre expire :

```ts
if (incremented.count === 0) {
  await db.rateLimit.updateMany({
    where: { key },
    data: { count: 1, windowStart: now },
  });
}
```

plusieurs requêtes concurrentes peuvent toutes constater :

```text
window expired
```

et toutes remettre :

```text
count = 1
```

La protection peut donc être contournée dans cette fenêtre particulière.

### Solution

Faire le reset atomique côté PostgreSQL, idéalement avec :

- transaction ;
- `SELECT ... FOR UPDATE` ;
- ou un `UPSERT` / `UPDATE` conditionnel correctement construit.

---

# 8. Grosse faiblesse métier : les compteurs ne sont pas suffisamment contraints

C'est probablement **le principal problème fonctionnel** du domaine.

Le schéma permet :

```text
provider = CIE
utilityType = WATER
```

ou :

```text
provider = SODECI
utilityType = ELECTRICITY
```

Le Zod actuel autorise également ces combinaisons.

Or dans le métier :

```text
CIE    → ELECTRICITY
SODECI → WATER
```

devrait être un invariant.

### Il faut imposer :

```ts
z.discriminatedUnion(...)
```

ou un `.superRefine()`.

Par exemple conceptuellement :

```ts
if (provider === "CIE" && utilityType !== "ELECTRICITY") error;

if (provider === "SODECI" && utilityType !== "WATER") error;
```

---

# 9. Encore plus important : `MeterReading` n'est pas lié à son type de compteur

Le serveur accepte actuellement des combinaisons incohérentes.

Par exemple :

```json
{
  "value": 120,
  "unit": "KWH",
  "readingType": "CREDIT"
}
```

sur un compteur SODECI.

Ou :

```json
{
  "value": 120,
  "unit": "M3",
  "readingType": "INDEX"
}
```

sur un compteur CIE.

Le schéma Zod valide uniquement la valeur :

```ts
unit: unitSchema;
readingType: readingTypeSchema;
```

mais ne connaît pas le compteur.

### Et surtout :

`addReading()` fait :

```ts
if (input.readingType !== 'INDEX') return ...
```

puis pour n'importe quel compteur :

```ts
db.consumptionPeriod.create(...)
```

Il ne vérifie pas :

```text
meter.utilityType === WATER
```

C'est dangereux.

### Conséquence

Une API client malveillante ou simplement mal programmée pourrait créer une période de consommation d'eau sur un compteur électrique.

Et le dashboard pourrait ensuite l'interpréter comme une vraie donnée.

---

# 10. Il y a même une incohérence explicite dans l'API

Dans :

```text
/api/v1/meters/:id/readings
```

la réponse du `period` fait :

```ts
unit: "M3";
```

en dur.

Donc même si un relevé est créé sur un compteur électrique :

```json
{
  "period": {
    "quantity": 120,
    "unit": "M3"
  }
}
```

C'est faux.

### Je recommande

`addReading()` devrait devenir quelque chose comme :

```text
Meter
 ├── utilityType
 ├── unit
 └── provider
       ↓
Reading validation
       ↓
Domain rule
       ↓
Consumption calculation
```

et **une `ConsumptionPeriod` ne devrait être créée que pour un compteur d'eau à index**, si c'est la règle métier retenue.

---

# 11. Le changement de type d'un compteur est dangereux

`updateMeterSchema` permet de modifier :

```text
provider
utilityType
paymentMode
...
```

sur un compteur existant.

Imagine :

```text
2026
Meter A = SODECI / WATER

↓ 6 mois de relevés

2027
Meter A → CIE / ELECTRICITY
```

Tu viens de transformer l'identité métier du compteur tout en conservant son historique.

C'est une corruption historique potentielle.

### Je recommande

Une fois qu'un compteur possède des données :

```text
provider
utilityType
unit
```

deviennent immuables.

Si l'utilisateur change de compteur :

```text
désactiver ancien compteur
+
créer nouveau compteur
```

C'est beaucoup plus propre.

---

# 12. Les quotas présentent une race similaire

Par exemple :

```ts
const count = await db.property.count(...)
const quotaError = checkQuota(...)
await db.property.create(...)
```

Deux requêtes simultanées peuvent faire :

```text
count = 0
count = 0

A → autorisé
B → autorisé

A → create
B → create
```

Donc le FREE :

```text
1 logement
```

peut théoriquement finir avec 2 logements.

Même chose pour les compteurs.

### Correction

Le quota doit être vérifié dans une transaction ou protégé par une contrainte structurelle.

Pour les compteurs, on peut envisager un mécanisme de verrouillage par utilisateur.

---

# 13. Problème de cohérence dans le moteur tarifaire

Le moteur est bien conçu, mais il utilise des `Float` JavaScript :

```ts
priceTtc: number;
amountTtc: number;
kwh: number;
```

Pour un moteur financier, je préférerais :

```text
Decimal
```

ou une représentation en unités minimales :

```text
centimes / millièmes de FCFA
```

Même si le `round2()` limite les erreurs d'affichage, il ne supprime pas les problèmes intermédiaires de représentation IEEE-754.

Pour une application qui veut éventuellement produire :

```text
facture
rapport
analyse financière
```

je passerais progressivement le domaine monétaire en `Decimal`.

---

# 14. Attention à `reverseEstimate()`

La fonction est intéressante :

```ts
reverseEstimate();
```

utilise une dichotomie, ce qui est une bonne approche.

Mais elle fait :

```ts
while (cost(hi) < amountTtc && hi < 1_000_000)
```

sans gérer explicitement le cas :

```text
amountTtc > cost(1_000_000)
```

Ce n'est probablement pas exploitable avec les montants normaux, mais un moteur financier devrait retourner un état explicite :

```text
RESOLVED
OUT_OF_RANGE
INVALID_AMOUNT
```

plutôt que produire silencieusement une approximation bornée.

---

# 15. Les tarifs sont actuellement anciens

Le code embarque :

```text
CIE_SOURCE_2023
effectiveFrom: 2023-12-27
```

avec une vérification :

```text
2023-12-27
```

Le système est bien conçu pour versionner les tarifs, **mais le seed actuel dépend encore de cette source historique**.

Donc techniquement :

```text
architecture tarifaire : excellente
données tarifaires actuelles : à vérifier avant production
```

C'est un point important pour ConsoCI : un moteur parfait avec une grille obsolète produit quand même un mauvais résultat.

---

# 16. Le modèle Prisma est globalement très bon

J'ai particulièrement apprécié :

```text
User
Organization
OrganizationMember
Property
Meter
MeterReading
ConsumptionPeriod
ElectricityPurchase
WaterBill
TariffScheme
TariffRule
Forecast
Alert
Recommendation
Appliance
DraftExtraction
AuditLog
ProductEvent
```

La modélisation est suffisamment riche pour faire évoluer le produit.

### Mais j'ajouterais des contraintes métier

Par exemple :

```text
Meter
 ├── provider
 ├── utilityType
 └── unit
```

doit être cohérent.

Et :

```text
WaterBill.propertyId
```

est redondant avec :

```text
WaterBill.meter.propertyId
```

La duplication n'est pas nécessairement mauvaise, mais elle crée un invariant supplémentaire :

```text
waterBill.propertyId === waterBill.meter.propertyId
```

que PostgreSQL ne garantit pas actuellement.

---

# 17. OCR : très bonne architecture

La partie OCR est propre conceptuellement.

Vous avez :

```text
Photo
 ↓
DraftExtraction
 ↓
Extraction
 ↓
Proposition
 ↓
Confirmation
 ↓
WaterBill
```

et non :

```text
Photo
 ↓
WaterBill
```

C'est exactement ce qu'il faut faire pour éviter qu'une reconnaissance imparfaite écrive directement dans les données financières.

Le commentaire dans le code est particulièrement juste :

> une photo ne devient une facture qu'après validation explicite.

### Très bon choix

La transaction :

```ts
db.$transaction(...)
```

protège également contre le double clic.

---

# 18. Upload : bon niveau de sécurité

La fonction vérifie :

```text
taille
MIME déclaré
magic bytes
UUID
permissions 0600
path traversal
```

C'est bien.

Le fichier utilisateur ne choisit pas directement son chemin disque.

### Je renforcerais néanmoins

Pour les fichiers image :

```text
JPEG
PNG
WebP
HEIC
```

je recommande en production :

```text
decode image
→ re-encode
→ supprimer métadonnées EXIF
→ stocker version normalisée
```

Cela permet notamment de réduire :

- risques liés aux métadonnées ;
- fichiers malformés ;
- images extrêmement lourdes ;
- payloads atypiques.

---

# 19. Attention à `x-forwarded-for`

Le code fait :

```ts
request.headers.get("x-forwarded-for")?.split(",")[0];
```

C'est acceptable derrière un reverse proxy correctement configuré.

Mais si l'application est directement exposée :

```http
X-Forwarded-For: 1.2.3.4
```

est falsifiable.

Cela impacte :

```text
OTP rate limiting
API rate limiting
audit IP
```

### En production

Il faut définir une politique claire :

```text
Internet
 ↓
Cloudflare / Vercel / reverse proxy
 ↓
Next.js
```

et ne faire confiance au header que lorsqu'il vient d'une infrastructure de confiance.

---

# 20. Audit logs : attention aux données personnelles

Vous écrivez notamment :

```ts
metadata: {
  phone;
}
```

dans les événements OTP.

Le téléphone est une donnée personnelle.

Ce n'est pas forcément interdit, mais je recommande :

```text
phoneHash
```

ou éventuellement :

```text
phoneMasked = +225 ** ** ** 00
```

dans les logs opérationnels.

Et surtout :

```text
audit log retention
```

devrait être défini.

---

# 21. Performance : plutôt bon

J'ai trouvé plusieurs bonnes optimisations.

### Graphiques

Vous avez :

```ts
dynamic(() => import("./charts"));
```

pour Recharts.

Très bien.

### Requêtes bornées

Exemple :

```ts
take: 200;
```

et :

```ts
take: DASHBOARD_WINDOW;
```

Cela évite de charger plusieurs années de données inutilement.

### SSR

Le dashboard est serveur :

```ts
export const dynamic = "force-dynamic";
```

et les données sont récupérées côté serveur.

Bonne décision.

---

# 22. Mais le dashboard a encore un problème d'architecture à moyen terme

Actuellement :

```ts
getDashboard(userId);
```

fait énormément de choses :

```text
meters
purchases
water periods
water bills
budget
readings
tariffs
alerts
recommendations
projection
series
```

C'est acceptable maintenant.

Mais ce service deviendra rapidement un **god service**.

Je le découperais à terme :

```text
dashboard/
├── electricity-summary.ts
├── water-summary.ts
├── forecast-summary.ts
├── budget-summary.ts
├── alerts-summary.ts
├── recommendations-summary.ts
└── index.ts
```

puis :

```ts
getDashboard();
```

compose les résultats.

---

# 23. UI/UX : propre, mais pas encore au niveau "premium SaaS"

Le design actuel est cohérent :

```text
gris / blanc
rounded-xl
cards
sidebar desktop
bottom navigation mobile
shadcn
Tailwind v4
motion
```

L'UX mobile est même assez bien pensée.

Le système :

```text
Accueil
Conso
Historique
   +
Profil
```

avec le bouton d'action central est pertinent.

### Mais visuellement

On reste encore dans une esthétique :

> **dashboard utilitaire propre**

plutôt que :

> **produit SaaS premium / fintech / utility intelligence**

Il manque notamment :

- hiérarchie visuelle plus forte ;
- identité graphique propre à ConsoCI ;
- meilleure visualisation de la provenance des données ;
- micro-interactions ;
- états de chargement plus riches ;
- transitions entre pages ;
- visualisation des anomalies plus explicite ;
- dashboard plus "analytique".

Le système shadcn est bien intégré, mais il sert surtout de couche technique.

---

# 24. Motion : bonne approche

Le fichier :

```text
components/motion.tsx
```

est raisonnable.

Vous avez :

```ts
duration: 0.22;
```

et :

```text
prefers-reduced-motion
```

C'est beaucoup mieux que de mettre :

```text
animate-pulse
animate-bounce
infinite
```

partout.

Je conserverais cette philosophie.

---

# 25. Auth UI : très bonne décision produit

Le choix :

```text
Numéro
 ↓
OTP
 ↓
connexion OU création automatique
```

est adapté au marché ivoirien.

Le code normalise :

```text
07 00 00 00 00
0700000000
+225 07 00 00 00 00
2250700000000
```

vers :

```text
+2250700000000
```

Très bon.

Le formulaire explique également pourquoi le numéro est demandé.

---

# 26. Tests : bonne base, mais les tests les plus importants manquent

Vous avez déjà :

```text
tariff engine tests
auth tests
validation tests
rate limit tests
OCR tests
API integration tests
projection tests
```

C'est très bien.

Mais les tests devraient maintenant couvrir **les races critiques que j'ai identifiées**.

### À ajouter immédiatement

```text
OTP
├── concurrent verify → une seule session

Refresh
├── concurrent refresh → une seule rotation valide

Rate limit
├── concurrent first request
├── concurrent expired window

Quota
├── concurrent property creation
├── concurrent meter creation

Meter invariants
├── CIE + WATER → rejected
├── SODECI + ELECTRICITY → rejected

Reading invariants
├── WATER + KWH → rejected
├── ELECTRICITY + M3 → rejected
├── WATER + CREDIT → rejected si interdit

Meter mutation
├── compteur avec historique → utilityType immutable
```

Ces tests apporteraient énormément de valeur.

---

# 27. Il y a une incohérence entre la documentation et le code

Le README affirme notamment une isolation très stricte avec des réponses :

```text
404 plutôt que 403
```

mais certaines API utilisent :

```ts
return forbidden(...)
```

pour des ressources inexistantes ou appartenant à quelqu'un d'autre.

Ce n'est pas forcément une faille car le message est générique :

```text
Compteur introuvable ou inaccessible.
```

mais la documentation et le comportement devraient être alignés.

---

# 28. Un autre point important : `createProperty` et `createMeter`

Les quotas sont actuellement :

```text
FREE
 ├── 1 logement
 └── 2 compteurs
```

mais ils sont vérifiés avant l'écriture sans verrou.

Comme expliqué plus haut :

```text
COUNT
 ↓
CHECK
 ↓
INSERT
```

n'est pas atomique.

Il faut passer à :

```text
transaction
+
lock
+
check
+
insert
```

pour garantir le quota.

---

# 29. Le projet a déjà une très bonne base produit

Ce que je **ne toucherais surtout pas** :

### Architecture

```text
Next.js
+
Prisma
+
PostgreSQL
+
tariff-engine
```

### Philosophie des données

```text
REAL
ESTIMATE
FORECAST
CALCULATED
UNKNOWN
```

C'est excellent.

### OCR

```text
Draft → Confirmation → Data
```

À conserver.

### Tarifs

```text
TariffScheme
+
TariffRule
+
version
+
source
+
effectiveFrom
```

Très bon.

### Audit

À conserver et renforcer.

### PWA

Bonne direction.

---

# 30. Mon classement des corrections

## 🔴 P0 — avant toute mise en production

### 1. Réparer CI

```text
DIRECT_URL
```

manquant dans GitHub Actions.

### 2. Atomicité OTP

Empêcher deux validations concurrentes.

### 3. Atomicité refresh token

Empêcher deux rotations simultanées.

### 4. Invariants compteur

Imposer :

```text
CIE → ELECTRICITY
SODECI → WATER
```

### 5. Invariants relevé

Empêcher :

```text
water → KWH
electricity → M3
```

et les types incompatibles.

### 6. Empêcher la mutation historique d'un compteur

Ne plus permettre de transformer :

```text
SODECI/WATER
```

en :

```text
CIE/ELECTRICITY
```

après création de données.

---

# 31. 🟠 P1 — juste après

### 7. Rate limiter transactionnel

### 8. Quotas transactionnels

### 9. Audit PII

Réduire les numéros de téléphone dans les logs.

### 10. Proxy/IP trust

Formaliser la gestion de :

```text
X-Forwarded-For
```

### 11. Decimal pour les valeurs financières

Particulièrement :

```text
amountPaid
amountTtc
costPerKwh
effectiveCostPerM3
tariff prices
```

### 12. Mettre à jour/vérifier les grilles CIE

Le système est prêt, les données doivent être maintenues.

---

# 32. 🟡 P2 — qualité produit

### 13. Refactor `services.ts`

Découper `getDashboard`.

### 14. Pagination

Les :

```text
take: 200
take: 500
```

sont mieux que l'illimité, mais une vraie pagination est préférable.

### 15. Observabilité

Ajouter :

```text
structured logs
request id
latency
DB errors
OTP failures
SMS provider failures
```

### 16. Monitoring

À prévoir :

```text
Sentry
ou équivalent
```

pour les erreurs serveur.

---

# 33. 🟢 P3 — évolution produit

Après stabilisation :

```text
OCR réel
↓
notifications
↓
WhatsApp/SMS
↓
rapports PDF
↓
multi-logements avancé
↓
partage familial
↓
budgets
↓
comparaison historique
↓
analytics avancées
```

---

# 34. Architecture cible que je recommande

Je ferais évoluer le projet vers :

```text
apps/
└── web/
    ├── app/
    │   ├── (marketing)/
    │   ├── (auth)/
    │   ├── (dashboard)/
    │   ├── back-office/
    │   └── api/v1/
    │
    ├── components/
    │   ├── ui/
    │   ├── dashboard/
    │   ├── meters/
    │   ├── readings/
    │   ├── purchases/
    │   ├── bills/
    │   ├── forecasts/
    │   └── auth/
    │
    └── lib/
        ├── auth/
        ├── db/
        ├── domain/
        │   ├── meters/
        │   ├── readings/
        │   ├── purchases/
        │   ├── bills/
        │   └── forecasts/
        ├── api/
        ├── security/
        └── analytics/

packages/
└── tariff-engine/
```

L'objectif est de rapprocher progressivement le code de :

```text
UI
 ↓
Application Service
 ↓
Domain
 ↓
Persistence
```

plutôt que :

```text
Page
 ↓
db directement
 ↓
business logic
```

---

# 35. Mon diagnostic final

**Le projet n'est pas à refaire.**

C'est important.

Je vois plutôt :

```text
❌ Mauvaise architecture
```

non.

Je vois :

```text
✅ Bonne architecture
✅ Bonne vision produit
✅ Bonne base de sécurité
✅ Bon modèle de données
✅ Bon moteur métier
✅ Bon début de tests
⚠️ Invariants métier insuffisamment verrouillés
⚠️ Concurrence insuffisamment traitée
❌ CI actuellement cassée
⚠️ Dépendances avec vulnérabilités signalées
⚠️ Quelques risques financiers liés aux Float
```

Le point le plus intéressant est que **la majorité des problèmes sont maintenant des problèmes de hardening**, pas de conception fondamentale.

### Je ferais donc exactement cet ordre :

```text
PHASE 1
CI + Prisma
        ↓
PHASE 2
Auth concurrente
OTP + Refresh
        ↓
PHASE 3
Invariants métier
Meter + Reading
        ↓
PHASE 4
Rate limit + Quotas atomiques
        ↓
PHASE 5
Financial precision / Decimal
        ↓
PHASE 6
Tests de concurrence
        ↓
PHASE 7
UI/UX premium
        ↓
PHASE 8
Production hardening
```

**Et surtout : je ne commencerais pas par refaire l'interface.** Le backend contient actuellement quelques invariants qui doivent être verrouillés avant de consacrer du temps au polish visuel.

Le CI précédent a échoué précisément sur `DIRECT_URL`, et le nouveau run du commit `62f969b` était encore en cours au moment de l'audit ; le code source montre par ailleurs les problèmes de concurrence et de cohérence métier décrits ci-dessus.
