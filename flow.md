# PROMPT MASTER V1 — CONsoCI

## 0. RÔLE

Tu es un **architecte logiciel senior full-stack, product designer SaaS, ingénieur électricité/eau spécialisé dans le contexte ivoirien et développeur TypeScript confirmé**.

Tu dois construire un produit SaaS/mobile-first appelé provisoirement :

# ConsoCI

### Positionnement

> **Votre consommation. Votre budget. Votre contrôle.**

### Promesse

ConsoCI permet à un ménage ivoirien de :

1. enregistrer ses relevés d'électricité et d'eau ;
2. suivre sa consommation ;
3. enregistrer ses recharges CIE prépayées ;
4. enregistrer ses factures SODECI ;
5. comprendre combien il dépense réellement ;
6. anticiper ses dépenses ;
7. détecter les consommations inhabituelles ;
8. recevoir des recommandations simples pour réduire ses dépenses.

Le produit doit être conçu comme un **vrai produit commercialisable**, et non comme une simple démonstration technique.

---

# 1. RÈGLE ABSOLUE : CONSTRUIRE, NE PAS SE LIMITER À EXPLIQUER

Ne réponds pas uniquement avec des explications ou du pseudo-code.

Tu dois :

- créer les fichiers ;
- créer les dossiers ;
- écrire le code ;
- connecter frontend/backend ;
- créer le schéma Prisma ;
- créer les migrations/seed nécessaires ;
- implémenter les API ;
- implémenter le moteur de calcul ;
- implémenter l'interface ;
- implémenter les validations ;
- ajouter les tests ;
- documenter le lancement ;
- vérifier la cohérence du projet.

Lorsque quelque chose n'est pas vérifiable, **ne l'invente pas**.

---

# 2. STACK TECHNIQUE

Utiliser :

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- Framer Motion
- React Router
- TanStack Query
- React Hook Form
- Zod
- Lucide React
- Recharts

## Backend

- Node.js
- TypeScript
- NestJS
- Prisma
- PostgreSQL

## Infrastructure

- Docker
- Docker Compose
- Git
- GitHub Actions
- PWA

Redis est optionnel et ne doit pas être introduit inutilement dans le MVP.

---

# 3. ARCHITECTURE

Utiliser une architecture :

> **Modular Monolith**

Ne pas créer de microservices pour la V1.

Structure :

```text
conso-ci/
│
├── apps/
│   ├── web/
│   ├── api/
│   └── admin/
│
├── packages/
│   ├── shared/
│   ├── ui/
│   └── tariff-engine/
│
├── infra/
│   └── docker/
│
├── docs/
│
├── tests/
│
├── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

Si une structure plus simple est techniquement préférable pour une première livraison, elle est autorisée, mais elle doit permettre une évolution ultérieure sans réécriture complète.

---

# 4. PRINCIPES PRODUIT

Le produit doit suivre cette boucle :

```text
MESURER
   ↓
COMPRENDRE
   ↓
ANTICIPER
   ↓
AGIR
   ↓
MESURER
```

Le produit ne doit jamais noyer l'utilisateur sous les données.

L'utilisateur doit comprendre immédiatement :

### Électricité

- combien il a dépensé ;
- combien de kWh ont été enregistrés ;
- quelle est sa consommation moyenne ;
- combien il risque de dépenser ;
- si sa consommation augmente.

### Eau

- combien de m³ il a consommé ;
- sur quelle période ;
- combien sa dernière facture lui a réellement coûté ;
- quelle est son évolution ;
- si sa consommation est inhabituelle.

---

# 5. UX MOBILE-FIRST

L'application doit être pensée d'abord pour un smartphone.

Navigation principale :

```text
Accueil
Consommation
Historique
Profil
```

Ajouter un bouton d'action flottant :

```text
+
```

Actions :

```text
Ajouter un relevé
Ajouter une recharge
Ajouter une facture
```

Ne jamais créer une navigation complexe.

---

# 6. DESIGN SYSTEM

Le design doit s'inspirer fortement de la philosophie de :

https://reui.io/components

Utiliser une approche proche de :

- shadcn/ui
- Tailwind
- composants composables
- design system cohérent
- cards
- stats
- charts
- tabs
- forms
- alerts
- sheets/drawers
- command patterns si utiles
- empty states
- skeleton loaders
- badges
- tooltips
- dropdowns

Ne pas dépendre inutilement de ReUI comme runtime.

L'objectif est de reproduire une expérience :

- moderne ;
- premium ;
- sobre ;
- rapide ;
- intuitive ;
- professionnelle.

---

# 7. DIRECTION VISUELLE

Style :

- SaaS moderne ;
- mobile-first ;
- beaucoup d'espace ;
- typographie claire ;
- cartes légèrement arrondies ;
- hiérarchie visuelle forte ;
- animations discrètes ;
- transitions fluides ;
- feedback immédiat.

Éviter :

- dashboards surchargés ;
- gradients excessifs ;
- animations inutiles ;
- couleurs criardes ;
- tableaux illisibles sur mobile ;
- dizaines de KPI simultanément.

---

# 8. DASHBOARD

Le dashboard doit avoir maximum 5 blocs principaux.

## Bloc 1 — Vue globale

Exemple :

```text
Bonjour Dominique 👋

Voici l'état de votre consommation.
```

---

## Bloc 2 — Électricité

Afficher :

```text
Électricité

12 500 FCFA dépensés
78,4 kWh enregistrés

+4,2 % vs période précédente
```

Si les kWh sont estimés :

```text
78,4 kWh estimés
```

et non :

```text
78,4 kWh
```

---

## Bloc 3 — Eau

```text
Eau

15,5 m³ consommés

depuis votre dernier relevé
```

---

## Bloc 4 — Prévision

```text
À ce rythme

≈ 18 700 FCFA

dépensés sur la période
```

Toujours indiquer qu'il s'agit d'une projection.

---

## Bloc 5 — Recommandation

Exemple :

```text
💡 Votre consommation électrique
augmente depuis 3 périodes.

Vérifiez notamment la climatisation
et les appareils fonctionnant longtemps.
```

---

# 9. ÉLECTRICITÉ CIE — MODÈLE MÉTIER

C'est un point critique.

Un compteur prépayé CIE ne doit PAS être traité automatiquement comme un compteur postpayé classique.

Le système doit distinguer :

```text
PREPAID
POSTPAID
UNKNOWN
```

Le compteur doit également connaître :

```text
provider = CIE
utilityType = ELECTRICITY
```

---

# 10. VALEUR « 116,5 » DU COMPTEUR

Ne jamais supposer que :

```text
116,5
```

signifie automatiquement :

```text
116,5 kWh
```

ou :

```text
116,5 FCFA
```

ou :

```text
116,5 kWh disponibles
```

L'interface doit demander :

```text
Que représente cette valeur ?

○ Index de consommation
○ Crédit disponible
○ Énergie disponible en kWh
○ Montant en FCFA
○ Je ne sais pas
```

Si l'utilisateur ne sait pas :

```text
readingType = UNKNOWN
unit = UNKNOWN
```

La donnée peut être conservée mais ne doit pas alimenter un calcul financier déterministe.

---

# 11. RECHARGE CIE

Le modèle principal doit être :

```text
ElectricityPurchase
```

avec :

```text
amountPaid
energyCreditedKwh
paymentMethod
purchaseDate
tokenReference
receiptImage
source
confidence
```

Exemple :

```json
{
  "amountPaid": 10000,
  "energyCreditedKwh": 72.4,
  "paymentMethod": "ORANGE_MONEY"
}
```

Si seul le montant est connu :

```text
amountPaid = 10000
energyCreditedKwh = null
```

Le système doit afficher :

```text
Consommation estimée
```

et non une fausse précision.

---

# 12. TOKEN CIE

Un token CIE peut contenir 20 chiffres.

Ne pas stocker automatiquement le token complet.

Si nécessaire :

- stockage chiffré ;
- accès restreint ;
- audit ;
- justification métier.

Dans la V1, privilégier :

```text
tokenReference
```

plutôt que le token brut.

---

# 13. TARIFICATION CIE

Créer un véritable :

```text
TariffEngine
```

dans un package séparé.

Exemple :

```text
packages/tariff-engine/
```

API interne :

```typescript
resolveTariff();
calculate();
estimate();
reverseEstimate();
validateEligibility();
```

Ne jamais mettre les tarifs directement dans React.

---

# 14. TARIFS VERSIONNÉS

Chaque tarif doit posséder :

```text
tariffScheme
tariffRule
effectiveFrom
effectiveTo
source
verifiedAt
version
```

Exemple conceptuel :

```text
CIE
DOMESTIC_SOCIAL
PREPAID
5A
effectiveFrom
effectiveTo
```

Si un tarif change, créer une nouvelle version.

Ne jamais modifier silencieusement une ancienne version.

---

# 15. RÈGLE IMPORTANTE SUR LE PRÉPAIEMENT CIE

Le système doit partir du principe métier suivant :

> Le prépaiement n'est pas automatiquement un tarif totalement différent de la facturation ordinaire.

La grille applicable doit être déterminée selon :

- puissance souscrite ;
- catégorie ;
- consommation ;
- statut ;
- période ;
- règles tarifaires applicables.

Ne jamais écrire :

```text
tarif prépayé = X
```

sans source officielle vérifiée.

---

# 16. TARIF SOCIAL 5A

Le moteur doit pouvoir représenter les règles actuellement publiées pour le domestique social 5A.

Paramètres à gérer notamment :

```text
puissance
consommation
seuil
prime fixe
prix kWh
taxes
redevances
```

Les valeurs tarifaires doivent être stockées dans la base et versionnées.

Ne pas hardcoder :

```typescript
const PRICE = 31.72;
```

dans le frontend.

---

# 17. ÉLIGIBILITÉ CIE

Le moteur doit représenter les règles d'éligibilité au tarif social.

Par exemple :

```text
averageMonthlyConsumption
minimumObservationPeriod
subscribedPower
usageType
```

Si une consommation moyenne dépasse le seuil réglementaire :

ne pas afficher :

> Vous avez officiellement changé de tarif.

Afficher plutôt :

> Votre historique dépasse le seuil associé à votre régime actuel. Vérifiez votre situation auprès de CIE.

---

# 18. COÛT ÉLECTRICITÉ

Lorsque les données réelles sont disponibles :

```text
coût réel = montant total payé
```

et :

```text
coût effectif/kWh =
montant payé / kWh crédités
```

Exemple :

```text
10 000 FCFA / 72,4 kWh
= 138,12 FCFA/kWh effectifs
```

Attention :

ce chiffre est un :

> coût effectif observé

et non nécessairement :

> prix réglementaire du kWh.

---

# 19. ESTIMATION ÉLECTRICITÉ

Si seulement :

```text
amountPaid
```

est connu :

le système peut estimer les kWh selon le moteur tarifaire.

Mais le résultat doit être marqué :

```text
estimated
confidence = LOW
```

UI :

```text
≈ 72 kWh estimés
```

et non :

```text
72 kWh consommés
```

---

# 20. EAU SODECI

Le compteur SODECI doit principalement être suivi par index.

Exemple :

```text
ancien index = 124,3 m³
nouvel index = 139,8 m³
```

Calcul :

```text
139,8 - 124,3
= 15,5 m³
```

---

# 21. ANOMALIE D'INDEX EAU

Si :

```text
nouvel index < ancien index
```

ne jamais supprimer automatiquement la donnée.

Afficher :

```text
Index inhabituel

Le nouvel index est inférieur
au précédent.

Le compteur a-t-il été remplacé,
réinitialisé ou corrigé ?
```

Possibilités :

```text
Compteur remplacé
Correction d'index
Erreur de saisie
Conserver malgré tout
```

---

# 22. FACTURES SODECI

Une facture peut être saisie :

```text
WaterBill
```

avec :

```text
periodStart
periodEnd
consumptionM3
amountTtc
invoiceReference
source
receiptImage
```

Minimum obligatoire V1 :

```text
période
consommation
montant TTC
```

---

# 23. TARIFICATION SODECI

Ne jamais inventer une grille tarifaire actuelle.

Le système doit permettre :

```text
tariffSource
tariffVersion
tariffRules
```

Si la formule réglementaire applicable n'est pas suffisamment vérifiée :

l'application doit continuer à fonctionner grâce aux factures réelles.

Exemple :

```text
Votre dernière facture :

18,4 m³
6 850 FCFA TTC
```

Puis :

```text
Coût effectif :

372 FCFA/m³
```

Libellé obligatoire :

> Coût effectif observé sur cette facture

et non :

> Tarif officiel SODECI : 372 FCFA/m³

---

# 24. MODÈLE DE DONNÉES

Créer au minimum :

```text
User
Organization
OrganizationMember
Property
Meter
MeterReading
ElectricityPurchase
ConsumptionPeriod
WaterBill
Budget
Forecast
Alert
Recommendation
SavingsEvent
TariffScheme
TariffRule
TariffSource
EligibilityRule
AuditLog
```

---

# 25. METER

Structure conceptuelle :

```typescript
Meter {
  id
  propertyId

  provider
  utilityType

  meterNumber

  meterType
  paymentMode

  subscribedPower

  unit

  label

  active

  createdAt
  updatedAt
}
```

---

# 26. METER READING

```typescript
MeterReading {
  id
  meterId

  value
  unit

  readingType

  readingDate

  source

  confidence

  note

  createdAt
}
```

Enums :

```text
KWH
M3
FCFA
UNKNOWN
```

et :

```text
INDEX
CREDIT
ENERGY_AVAILABLE
UNKNOWN
```

---

# 27. QUALITÉ DES DONNÉES

Toutes les données importantes doivent avoir :

```text
source
confidence
```

Sources :

```text
MANUAL
PHOTO
OCR
IMPORT
SYSTEM
```

Confidence :

```text
HIGH
MEDIUM
LOW
```

Cela permet de distinguer :

- mesure réelle ;
- estimation ;
- OCR ;
- saisie incertaine.

---

# 28. MOTEUR DE CONSOMMATION

Créer :

```text
ConsumptionEngine
```

Fonctions :

```typescript
calculateConsumption();
calculateDailyAverage();
calculateMonthlyProjection();
calculateTrend();
calculateBaseline();
detectAnomaly();
```

Pour un compteur indexé :

```text
consommation =
index courant - index précédent
```

---

# 29. PROJECTION

V1 sans machine learning.

Utiliser :

```text
dailyAverage × remainingDays
```

avec correction éventuelle basée sur les historiques :

```text
30 jours
90 jours
```

Afficher clairement :

```text
Projection
```

et non :

```text
Prévision garantie
```

---

# 30. ALERTES

Créer :

```text
AlertEngine
```

Types :

```text
HIGH_CONSUMPTION
RAPID_INCREASE
RAPID_DECREASE
POSSIBLE_WATER_LEAK
MISSING_READING
INVALID_READING
HIGH_SPENDING
```

Ne jamais écrire :

> Vous avez une fuite.

Écrire :

> Votre consommation d'eau est inhabituellement élevée. Vérifiez les robinets, chasses d'eau, réservoirs et éventuelles fuites.

---

# 31. RECOMMANDATIONS

Maximum 3 recommandations simultanées.

Exemples :

```text
Votre consommation électrique augmente.
Vérifiez les appareils à forte puissance.
```

```text
Votre consommation d'eau augmente.
Vérifiez les robinets et chasses d'eau.
```

```text
Votre recharge électrique est consommée
plus rapidement que votre moyenne récente.
```

Les recommandations doivent être basées sur les données.

---

# 32. APPAREILS — OPTION V1

Permettre éventuellement :

```text
AC
Fridge
Freezer
WaterHeater
Pump
TV
Iron
WashingMachine
Other
```

avec :

```text
powerWatts
hoursPerDay
daysPerMonth
```

Calcul :

```text
kWh =
(powerWatts / 1000)
× hoursPerDay
× daysPerMonth
```

---

# 33. ONBOARDING

Flux :

```text
Landing
↓
Téléphone
↓
OTP
↓
Prénom
↓
Logement
↓
Choix énergie/eau
↓
Ajout compteur
↓
Premier relevé
↓
Première recharge
↓
Dashboard
```

Le système doit permettre de sauter certaines étapes.

---

# 34. EMPTY STATES

Ne jamais afficher :

```text
0 FCFA
0 kWh
0 m³
```

lorsque l'utilisateur n'a encore aucune donnée.

Afficher plutôt :

```text
Aucune donnée pour le moment.

Ajoutez votre premier relevé
pour commencer à suivre votre consommation.
```

CTA :

```text
Ajouter un relevé
```

---

# 35. AJOUT D'UNE RECHARGE

Formulaire :

```text
Montant
Date
Méthode de paiement
kWh crédités
Référence
Photo du reçu
```

Méthodes :

```text
ORANGE_MONEY
MTN_MOMO
MOOV_MONEY
WAVE
CASH
OTHER
```

Le champ kWh doit être facultatif.

---

# 36. AJOUT D'UN RELEVÉ

Formulaire simple :

```text
Compteur
Valeur
Date
Type de valeur
Photo
Note
```

Si compteur SODECI :

```text
m³
```

Si compteur CIE index :

```text
kWh
```

Si compteur prépayé :

présenter les types possibles plutôt que d'imposer une interprétation.

---

# 37. HISTORIQUE

Filtres :

```text
7 jours
30 jours
3 mois
6 mois
1 an
```

Graphiques :

```text
consommation
dépenses
évolution
```

Comparer :

```text
période actuelle
vs
période précédente
```

---

# 38. API

Créer notamment :

```http
POST /api/v1/auth/request-otp
POST /api/v1/auth/verify-otp

GET /api/v1/me

GET /api/v1/properties
POST /api/v1/properties

GET /api/v1/meters
POST /api/v1/meters

GET /api/v1/meters/:id/readings
POST /api/v1/meters/:id/readings

GET /api/v1/electricity/purchases
POST /api/v1/electricity/purchases

GET /api/v1/water/bills
POST /api/v1/water/bills

GET /api/v1/consumption
GET /api/v1/consumption/summary

GET /api/v1/forecasts

GET /api/v1/alerts

GET /api/v1/recommendations

GET /api/v1/dashboard
```

---

# 39. DASHBOARD API

Format :

```json
{
  "electricity": {
    "spent": 12500,
    "consumptionKwh": 78.4,
    "consumptionConfidence": "HIGH",
    "forecastAmount": 18700,
    "trendPercent": 4.2
  },
  "water": {
    "consumptionM3": 15.5,
    "consumptionConfidence": "HIGH",
    "effectiveCost": null,
    "trendPercent": 8.4
  },
  "alerts": [],
  "recommendations": []
}
```

---

# 40. SÉCURITÉ

Implémenter :

- HTTPS en production
- Argon2 si mot de passe
- OTP sécurisé
- JWT
- refresh token rotation
- rate limiting
- validation Zod/class-validator
- RBAC
- isolation par utilisateur/organisation
- upload validation
- audit logs
- protection contre les fichiers dangereux
- protection des endpoints sensibles

---

# 41. PWA

L'application doit pouvoir :

- fonctionner avec réseau faible ;
- afficher le dashboard précédemment chargé ;
- permettre un relevé hors ligne ;
- synchroniser lorsque la connexion revient.

Utiliser une stratégie offline raisonnable.

Ne pas essayer de rendre toute l'application offline dans la V1.

---

# 42. PERFORMANCE

Objectifs :

```text
LCP < 2.5 s
```

Optimiser :

- lazy loading ;
- images ;
- charts ;
- bundles ;
- API ;
- cache TanStack Query.

Les graphiques lourds doivent être chargés à la demande.

---

# 43. ACCESSIBILITÉ

Respecter :

- labels explicites ;
- navigation clavier ;
- contrastes ;
- focus visible ;
- aria-labels ;
- boutons suffisamment grands sur mobile ;
- feedback d'erreur compréhensible.

---

# 44. ANIMATIONS

Utiliser Framer Motion avec parcimonie.

Animations :

- page transition ;
- apparition des cards ;
- changement des KPI ;
- drawer ;
- feedback après sauvegarde.

Durée typique :

```text
150–300 ms
```

Éviter les animations permanentes.

---

# 45. DESIGN DU DASHBOARD

Structure mobile :

```text
┌─────────────────────────┐
│ Bonjour 👋              │
│ Votre consommation      │
│                         │
│ ┌─────────────────────┐ │
│ │ ⚡ Électricité       │ │
│ │                     │ │
│ │ 12 500 FCFA         │ │
│ │ 78,4 kWh            │ │
│ │ +4,2 %              │ │
│ └─────────────────────┘ │
│                         │
│ ┌─────────────────────┐ │
│ │ 💧 Eau              │ │
│ │                     │ │
│ │ 15,5 m³             │ │
│ └─────────────────────┘ │
│                         │
│ ┌─────────────────────┐ │
│ │ Projection          │ │
│ │ ≈18 700 FCFA        │ │
│ └─────────────────────┘ │
│                         │
│ 💡 Conseil              │
│                         │
│                [+]      │
│ Accueil Conso Hist Profil
└─────────────────────────┘
```

---

# 46. DESKTOP

Sur desktop :

```text
Sidebar
│
├── Accueil
├── Consommation
├── Historique
├── Logements
├── Compteurs
├── Rapports
└── Paramètres
```

Le mobile reste prioritaire.

---

# 47. MONÉTISATION

Modèle initial :

## FREE

```text
1 logement
2 compteurs
3 mois d'historique
calculs de base
```

## PREMIUM

```text
historique illimité
prévisions avancées
alertes avancées
OCR
multi-logements
rapports
analyse avancée
```

Ne pas imposer le paiement avant que l'utilisateur ait compris la valeur du produit.

---

# 48. ANALYTICS PRODUIT

Événements :

```text
signup
otp_verified
property_created
meter_created
first_reading
first_purchase
first_bill
dashboard_viewed
forecast_viewed
alert_viewed
recommendation_viewed
premium_clicked
```

KPIs :

```text
activation
D7
D30
MAU
readings/user/month
purchases/user/month
bills/user/month
forecast_usage
premium_conversion
```

---

# 49. BACK-OFFICE

Préparer une application admin.

Fonctions :

```text
Users
Properties
Meters
Tariffs
Tariff Versions
Tariff Sources
Alerts
Analytics
Audit Logs
```

Les tarifs doivent être administrables sans modifier le frontend.

---

# 50. SOURCES TARIFAIRES

Chaque règle tarifaire doit être accompagnée de :

```text
sourceUrl
sourceName
documentReference
verifiedAt
effectiveFrom
effectiveTo
```

Les données tarifaires réglementaires doivent être séparées du code.

---

# 51. RÈGLE DE FIABILITÉ

Ne jamais présenter une estimation comme une mesure.

Utiliser visuellement :

```text
Réel
Estimé
Calculé
OCR
Inconnu
```

Exemple :

```text
78,4 kWh
Réel
```

ou :

```text
≈ 78,4 kWh
Estimé
```

---

# 52. CAS D'ERREUR

Prévoir :

```text
index négatif
index inférieur précédent
date future
date trop ancienne
doublon
compteur inexistant
compteur désactivé
montant négatif
kWh négatifs
facture incohérente
```

Messages utilisateurs en français simple.

---

# 53. TESTS

Créer tests unitaires et intégration.

Minimum :

### Tarification

```text
social 5A
domestic general
threshold
fixed charge
estimated kWh
```

### Eau

```text
139.8 - 124.3 = 15.5
```

### Anomalies

```text
nouvel index < ancien
```

### Forecast

```text
daily average × remaining days
```

### API

Tester :

```text
create property
create meter
create reading
create purchase
dashboard
```

---

# 54. SEED

Créer un seed réaliste.

Exemple :

```text
Utilisateur
    ↓
Logement Abidjan
    ↓
CIE prépayé
SODECI
    ↓
Historique 3 mois
    ↓
Recharges
    ↓
Relevés
    ↓
Dashboard
```

Le seed doit permettre de voir immédiatement une application vivante.

---

# 55. DEMO DATA

Créer des données avec :

```text
tendances
variations
recharges
relevés
une alerte
une recommandation
une projection
```

Mais clairement identifier les données de démonstration.

---

# 56. CE QUI EST EXCLU DE LA V1

Ne pas développer maintenant :

```text
paiement automatique
intégration directe CIE
intégration directe SODECI
IoT
compteurs connectés
WhatsApp bot
marketplace
réseau social
IA complexe
reconnaissance automatique complète des compteurs
microservices
application mobile native séparée
```

---

# 57. OCR

OCR en V1.1.

Architecture prévue dès maintenant.

Pipeline :

```text
Photo
↓
OCR
↓
Extraction
↓
Proposition
↓
Confirmation utilisateur
↓
Sauvegarde
```

L'OCR ne doit jamais écrire directement une facture sans confirmation humaine.

---

# 58. ORDRE DE DÉVELOPPEMENT

Respecter cet ordre :

```text
1. Repository
2. Docker
3. PostgreSQL
4. Prisma
5. NestJS
6. React
7. Tailwind
8. Design system
9. Auth
10. User
11. Property
12. Meter
13. Reading
14. Consumption Engine
15. CIE Purchase
16. Tariff Engine
17. Water Bills
18. Dashboard
19. Charts
20. Forecast
21. Alerts
22. Recommendations
23. PWA
24. Tests
25. Security
26. Production build
```

---

# 59. DEFINITION OF DONE

Une fonctionnalité n'est terminée que si :

```text
UI
+
API
+
DB
+
Validation
+
Error handling
+
Tests
+
Mobile
```

sont cohérents.

---

# 60. CRITÈRE PRODUIT PRINCIPAL

Après installation, un utilisateur doit pouvoir faire :

```text
Créer son compte
↓
Créer son logement
↓
Ajouter CIE
↓
Ajouter SODECI
↓
Saisir son premier relevé
↓
Enregistrer une recharge CIE
↓
Voir son dashboard
↓
Comprendre sa consommation
↓
Voir une projection
```

sans avoir besoin de comprendre la technologie derrière.

---

# 61. PHILOSOPHIE BUSINESS

Ne pas essayer de monétiser immédiatement toutes les données.

La priorité est :

```text
FIRST VALUE
```

L'utilisateur doit ressentir :

> « Cette application m'aide réellement à comprendre où part mon argent. »

Puis :

```text
habitude
↓
rétention
↓
historique
↓
prévisions
↓
fonctionnalités premium
```

---

# 62. RÈGLE DE SIMPLICITÉ

Si une fonctionnalité ne permet pas directement de :

- mesurer ;
- comprendre ;
- anticiper ;
- agir ;

elle ne doit probablement pas être dans le MVP.

---

# 63. LIVRABLE FINAL ATTENDU

À la fin de l'implémentation, fournir :

```text
Repository complet
README.md
.env.example
docker-compose.yml
Prisma schema
Seed
API NestJS
React frontend
Tailwind
Design system
Tariff Engine
Consumption Engine
Forecast Engine
Alert Engine
Tests
```

et une procédure :

```bash
npm install
docker compose up -d
npm run db:push
npm run db:seed
npm run dev
```

---

# 64. EXIGENCE FINALE

Tu dois prendre des décisions techniques lorsque nécessaire.

Ne pose pas une question pour chaque détail mineur.

Utilise les principes suivants :

```text
simplicité
fiabilité
maintenabilité
sécurité
mobile-first
performance
évolutivité
qualité UX
```

Lorsqu'une information réglementaire ou tarifaire est incertaine :

```text
NE PAS INVENTER
```

Créer plutôt une structure permettant de mettre à jour la règle lorsque la source officielle est vérifiée.

---

# 65. RÉSULTAT RECHERCHÉ

ConsoCI doit devenir progressivement :

```text
le carnet numérique
de consommation
du ménage ivoirien
```

avec une expérience suffisamment simple pour être utilisée chaque semaine.

Le produit final doit donner l'impression :

```text
Simple comme une application bancaire.
Clair comme un tableau de bord.
Utile comme un conseiller de consommation.
```

Construire maintenant.
Ne pas se limiter à décrire ce qu'il faudrait construire.
