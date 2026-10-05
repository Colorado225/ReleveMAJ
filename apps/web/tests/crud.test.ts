// Tests d'intégration du CRUD complet — flow.md §53 (« CRUD », §21, §24, §30, §32, §33).
//
// Complète `api.test.ts`, qui ne couvrait que la création et la lecture. On
// appelle les VRAIES routes avec de vraies requêtes, contre la base de test
// isolée : aucun mock, c'est la seule façon de vérifier le câblage complet.
//
// Chaque test porte sur ce qui décide vraiment du comportement :
//   · un `PATCH` partiel ne doit ni exiger la ligne entière, ni effacer les
//     champs qu'il ne mentionne pas (le bug que le premier jet avait) ;
//   · les valeurs DÉRIVÉES (coût effectif) doivent être redérivées, jamais
//     laissées fausses ;
//   · une ressource d'autrui doit être « introuvable », jamais modifiable.
//
// Chaque test crée son PROPRE utilisateur (`beforeEach`) : c'est ce qui rend les
// tests d'isolation possibles sans nettoyer entre eux.

import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import { prepareTestDatabase, resetTestData, seedTariffs } from './setup';
import { db } from '@/lib/db';
import { signAccessToken } from '@/lib/auth-core';

const BASE = 'http://consoci.test/api/v1';

/** Propriétaire des données du test en cours. */
let ownerId = '';
let ownerToken = '';

let seq = 0;
function nextPhone(): string {
  seq += 1;
  return `+22508${String(seq).padStart(8, '0')}`;
}

async function newUser(): Promise<{ id: string; token: string }> {
  const user = await db.user.create({ data: { phone: nextPhone() } });
  const t = await signAccessToken({ id: user.id, phone: user.phone, firstName: null });
  return { id: user.id, token: t };
}

function authed(t: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${t}` };
}

function post(path: string, body: unknown, t = ownerToken): Request {
  return new Request(`${BASE}${path}`, { method: 'POST', headers: authed(t), body: JSON.stringify(body) });
}

function patch(path: string, body: unknown, t = ownerToken): Request {
  return new Request(`${BASE}${path}`, { method: 'PATCH', headers: authed(t), body: JSON.stringify(body) });
}

function del(path: string, t = ownerToken): Request {
  return new Request(`${BASE}${path}`, { method: 'DELETE', headers: authed(t) });
}

/** Logement du propriétaire courant, créé directement pour alléger les tests. */
async function ownProperty(name = 'Villa'): Promise<string> {
  const p = await db.property.create({ data: { name, userId: ownerId } });
  return p.id;
}

before(async () => {
  prepareTestDatabase();
  await resetTestData(db);
  await seedTariffs(db);
});

beforeEach(async () => {
  const created = await newUser();
  ownerId = created.id;
  ownerToken = created.token;
});

after(async () => {
  await db.$disconnect();
});

// ---------- Budgets (§24, §30) ----------

test('CRUD · budgets : créer, lister, modifier, supprimer', async () => {
  const { POST, GET } = await import('@/app/api/v1/budgets/route');
  const { PATCH, DELETE } = await import('@/app/api/v1/budgets/[id]/route');
  const propertyId = await ownProperty();

  const created = await POST(post('/budgets', { propertyId, category: 'ELECTRICITY', monthlyAmount: 35_000 }));
  assert.equal(created.status, 201);
  const budget = (await created.json()) as { id: string; monthlyAmount: number; currency: string };
  assert.equal(budget.monthlyAmount, 35_000);
  // flow.md §24 — la devise est toujours annoncée, jamais supposée
  assert.equal(budget.currency, 'XOF');

  const listed = (await (await GET(new Request(`${BASE}/budgets`, { headers: authed(ownerToken) }))).json()) as { id: string }[];
  assert.equal(listed.length, 1);

  const updated = await PATCH(patch(`/budgets/${budget.id}`, { monthlyAmount: 42_000 }), {
    params: Promise.resolve({ id: budget.id }),
  });
  assert.equal(updated.status, 200);
  assert.equal(((await updated.json()) as { monthlyAmount: number }).monthlyAmount, 42_000);

  const removed = await DELETE(del(`/budgets/${budget.id}`), { params: Promise.resolve({ id: budget.id }) });
  assert.equal(removed.status, 200);
  assert.equal(await db.budget.count({ where: { id: budget.id } }), 0);
});

test('CRUD · budgets : un poste ne peut avoir qu’une enveloppe par logement (409)', async () => {
  const { POST } = await import('@/app/api/v1/budgets/route');
  const propertyId = await ownProperty();

  const first = await POST(post('/budgets', { propertyId, category: 'WATER', monthlyAmount: 10_000 }));
  assert.equal(first.status, 201);

  const second = await POST(post('/budgets', { propertyId, category: 'WATER', monthlyAmount: 20_000 }));
  assert.equal(second.status, 409);
  assert.match(((await second.json()) as { error: string }).error, /existe déjà/);
});

test('CRUD · budgets : une catégorie hors liste fermée est refusée (422)', async () => {
  const { POST } = await import('@/app/api/v1/budgets/route');
  const propertyId = await ownProperty();

  const res = await POST(post('/budgets', { propertyId, category: 'CARBURANT', monthlyAmount: 5000 }));
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { field: string }).field, 'category');
});

test('CRUD · budgets : le PATCH ne modifie QUE le montant, pas la catégorie', async () => {
  const { PATCH } = await import('@/app/api/v1/budgets/[id]/route');
  const propertyId = await ownProperty();
  const budget = await db.budget.create({ data: { propertyId, category: 'ELECTRICITY', monthlyAmount: 30_000 } });

  // La catégorie EST le budget : la changer réécrirait un historique trompeur.
  await PATCH(patch(`/budgets/${budget.id}`, { monthlyAmount: 31_000, category: 'WATER' }), {
    params: Promise.resolve({ id: budget.id }),
  });

  const stored = await db.budget.findUnique({ where: { id: budget.id } });
  assert.equal(stored?.category, 'ELECTRICITY');
  assert.equal(stored?.monthlyAmount, 31_000);
});

test('CRUD · budgets : le budget d’autrui est introuvable (404)', async () => {
  const { PATCH, DELETE } = await import('@/app/api/v1/budgets/[id]/route');
  // La ressource appartient à `other` ; c'est le propriétaire du test
  // (`ownerToken`) qui tente d'y toucher. Inverser les deux rôles ferait passer
  // un 200 pour une régression alors que la requête est légitime.
  const other = await newUser();
  const leurLogement = await db.property.create({ data: { name: 'Chez eux', userId: other.id } });
  const budget = await db.budget.create({
    data: { propertyId: leurLogement.id, category: 'WATER', monthlyAmount: 5_000 },
  });

  // garde-fou : les deux utilisateurs doivent être réellement distincts,
  // sinon le test ne prouverait rien.
  assert.notEqual(other.id, ownerId, 'le second utilisateur doit être distinct');
  assert.notEqual(other.token, ownerToken, 'les deux jetons doivent différer');

  // Le propriétaire du budget y accède : c'est la preuve que la ressource existe
  // et que le 404 ci-dessous vient bien du contrôle d'accès, pas d'un id fantôme.
  const parProprietaire = await PATCH(patch(`/budgets/${budget.id}`, { monthlyAmount: 4_000 }, other.token), {
    params: Promise.resolve({ id: budget.id }),
  });
  assert.equal(parProprietaire.status, 200);

  // Un tiers ne peut ni la modifier ni la supprimer.
  const res = await PATCH(patch(`/budgets/${budget.id}`, { monthlyAmount: 1 }), {
    params: Promise.resolve({ id: budget.id }),
  });
  assert.equal(res.status, 404);

  const removed = await DELETE(del(`/budgets/${budget.id}`), {
    params: Promise.resolve({ id: budget.id }),
  });
  assert.equal(removed.status, 404);
  // la donnée d'autrui est INTACTE
  assert.equal(await db.budget.count({ where: { id: budget.id } }), 1);
});
// ---------- Appareils (§32) ----------

test('CRUD · appareils : un PATCH d’un seul champ ne touche pas aux autres', async () => {
  // Régression : le premier jet exigeait la ligne entière via
  // `updateApplianceSchema`, si bien qu'un `PATCH {powerWatts}` était refusé
  // faute de `type` et `label`.
  const { PATCH } = await import('@/app/api/v1/appliances/[id]/route');
  const propertyId = await ownProperty();
  const appliance = await db.appliance.create({
    data: { propertyId, type: 'AC', label: 'Climatisation salon', powerWatts: 1200, hoursPerDay: 6, daysPerMonth: 30 },
  });

  const res = await PATCH(patch(`/appliances/${appliance.id}`, { powerWatts: 1800 }), {
    params: Promise.resolve({ id: appliance.id }),
  });
  assert.equal(res.status, 200);

  const stored = await db.appliance.findUnique({ where: { id: appliance.id } });
  assert.equal(stored?.powerWatts, 1800);
  assert.equal(stored?.type, 'AC', 'le type ne doit pas être effacé');
  assert.equal(stored?.label, 'Climatisation salon', 'le libellé ne doit pas être effacé');
  assert.equal(stored?.hoursPerDay, 6);
});

test('CRUD · appareils : le PATCH applique les mêmes bornes que la création (422)', async () => {
  const { PATCH } = await import('@/app/api/v1/appliances/[id]/route');
  const propertyId = await ownProperty();
  const appliance = await db.appliance.create({
    data: { propertyId, type: 'TV', label: 'Télé', powerWatts: 100, hoursPerDay: 4, daysPerMonth: 30 },
  });

  const res = await PATCH(patch(`/appliances/${appliance.id}`, { hoursPerDay: 30 }), {
    params: Promise.resolve({ id: appliance.id }),
  });
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { field: string }).field, 'hoursPerDay');
});

test('CRUD · appareils : le rattachement au logement n’est pas modifiable', async () => {
  const { PATCH } = await import('@/app/api/v1/appliances/[id]/route');
  const propertyId = await ownProperty();
  const autre = await ownProperty('Autre villa');
  const appliance = await db.appliance.create({
    data: { propertyId, type: 'AC', label: 'Clim', powerWatts: 1000, hoursPerDay: 4, daysPerMonth: 30 },
  });

  await PATCH(patch(`/appliances/${appliance.id}`, { propertyId: autre }), {
    params: Promise.resolve({ id: appliance.id }),
  });

  const stored = await db.appliance.findUnique({ where: { id: appliance.id } });
  assert.equal(stored?.propertyId, propertyId);
});

test('CRUD · appareils : suppression par le propriétaire', async () => {
  const { DELETE } = await import('@/app/api/v1/appliances/[id]/route');
  const propertyId = await ownProperty();
  const appliance = await db.appliance.create({
    data: { propertyId, type: 'Pump', label: 'Pompe', powerWatts: 400, hoursPerDay: 2, daysPerMonth: 30 },
  });

  const res = await DELETE(del(`/appliances/${appliance.id}`), { params: Promise.resolve({ id: appliance.id }) });
  assert.equal(res.status, 200);
  assert.equal(await db.appliance.count({ where: { id: appliance.id } }), 0);
});
// ---------- Profil (§38) ----------

test('CRUD · profil : prénom et nom se modifient', async () => {
  const { PATCH } = await import('@/app/api/v1/me/route');
  const res = await PATCH(patch('/me', { firstName: 'Awa', lastName: 'Koffi' }));
  assert.equal(res.status, 200);

  const user = await db.user.findUnique({ where: { id: ownerId } });
  assert.equal(user?.firstName, 'Awa');
  assert.equal(user?.lastName, 'Koffi');
});

test('CRUD · profil : ni le téléphone ni le palier ne sont modifiables', async () => {
  const { PATCH } = await import('@/app/api/v1/me/route');
  const before = await db.user.findUnique({ where: { id: ownerId } });

  // Ces deux champs sont hors schéma : Zod les retire, il ne reste rien à modifier.
  const res = await PATCH(patch('/me', { phone: '+2250101010101', plan: 'PREMIUM' }));
  assert.equal(res.status, 422);
  assert.match(((await res.json()) as { error: string }).error, /Aucun champ/);

  const after = await db.user.findUnique({ where: { id: ownerId } });
  assert.equal(after?.phone, before?.phone, 'le téléphone est l’identité de connexion');
  assert.equal(after?.plan, 'FREE', 'le palier relève de la facturation');
});

test('CRUD · profil : effacer le prénom le laisse null, pas vide', async () => {
  const { PATCH } = await import('@/app/api/v1/me/route');
  await PATCH(patch('/me', { firstName: 'Awa' }));

  const res = await PATCH(patch('/me', { firstName: '' }));
  assert.equal(res.status, 200);

  const user = await db.user.findUnique({ where: { id: ownerId } });
  assert.equal(user?.firstName, null, '"" se lirait « prénom renseigné mais vide »');
});

// ---------- Alertes (§33) ----------

test('CRUD · alertes : traiter puis rouvrir une alerte', async () => {
  const { PATCH } = await import('@/app/api/v1/alerts/[id]/route');

  // On part d'une alerte PERSISTÉE : les alertes du tableau de bord sont
  // recalculées à la volée et n'ont pas d'identifiant.
  const alert = await db.alert.create({
    data: {
      userId: ownerId,
      type: 'POSSIBLE_WATER_LEAK',
      severity: 'WARNING',
      title: 'Consommation d’eau en hausse',
      body: 'Vérifiez…',
      resolvedAt: new Date(),
    },
  });

  const rouvrir = await PATCH(patch(`/alerts/${alert.id}`, {}), {
    params: Promise.resolve({ id: alert.id }),
  });
  assert.equal(rouvrir.status, 200);
  assert.equal(((await rouvrir.json()) as { resolved: boolean }).resolved, false);
  assert.equal((await db.alert.findUnique({ where: { id: alert.id } }))?.resolvedAt, null);

  const traiter = await PATCH(patch(`/alerts/${alert.id}`, {}), {
    params: Promise.resolve({ id: alert.id }),
  });
  assert.equal(((await traiter.json()) as { resolved: boolean }).resolved, true);
});

test('CRUD · alertes : supprimer une alerte ACTIVE est refusé (409)', async () => {
  // Résoudre est réversible, supprimer ne l'est pas : une alerte active doit
  // d'abord être traitée.
  const { DELETE } = await import('@/app/api/v1/alerts/[id]/route');
  const alert = await db.alert.create({
    data: {
      userId: ownerId,
      type: 'HIGH_SPENDING',
      severity: 'WARNING',
      title: 'Dépense élevée',
      body: 'Vérifiez…',
      resolvedAt: null,
    },
  });

  const res = await DELETE(del(`/alerts/${alert.id}`), { params: Promise.resolve({ id: alert.id }) });
  assert.equal(res.status, 409);
  assert.equal(await db.alert.count({ where: { id: alert.id } }), 1, 'l’alerte doit rester');
});

test('CRUD · alertes : une alerte résolue se supprime', async () => {
  const { DELETE } = await import('@/app/api/v1/alerts/[id]/route');
  const alert = await db.alert.create({
    data: {
      userId: ownerId,
      type: 'MISSING_READING',
      severity: 'INFO',
      title: 'Relevé manquant',
      body: 'Vérifiez…',
      resolvedAt: new Date(),
    },
  });

  const res = await DELETE(del(`/alerts/${alert.id}`), { params: Promise.resolve({ id: alert.id }) });
  assert.equal(res.status, 200);
  assert.equal(await db.alert.count({ where: { id: alert.id } }), 0);
});
// ---------- PATCH partiels : ne rien effacer par accident (§38, §9) ----------

test('CRUD · logement : un PATCH d’un champ ne réinitialise pas les autres', async () => {
  const { PATCH } = await import('@/app/api/v1/properties/[id]/route');
  const property = await db.property.create({
    data: { name: 'Villa', address: 'Yopougon', isAbidjan: true, userId: ownerId },
  });

  await PATCH(patch(`/properties/${property.id}`, { name: 'Maison principale' }), {
    params: Promise.resolve({ id: property.id }),
  });

  const stored = await db.property.findUnique({ where: { id: property.id } });
  assert.equal(stored?.name, 'Maison principale');
  assert.equal(stored?.address, 'Yopougon', 'l’adresse ne doit pas être effacée');
  assert.equal(stored?.isAbidjan, true);
});

test('CRUD · compteur : changer le type RECALCULE l’unité', async () => {
  // flow.md §9 — un compteur d'eau qui stocke des kWh rendrait les données
  // incohérentes : l'unité suit toujours le type.
  const { PATCH } = await import('@/app/api/v1/meters/[id]/route');
  const propertyId = await ownProperty();
  const meter = await db.meter.create({
    data: { propertyId, provider: 'CIE', utilityType: 'ELECTRICITY', unit: 'KWH', subscribedPower: 5 },
  });

  await PATCH(patch(`/meters/${meter.id}`, { utilityType: 'WATER', provider: 'SODECI' }), {
    params: Promise.resolve({ id: meter.id }),
  });

  const stored = await db.meter.findUnique({ where: { id: meter.id } });
  assert.equal(stored?.utilityType, 'WATER');
  assert.equal(stored?.provider, 'SODECI');
  assert.equal(stored?.unit, 'M3');
  assert.equal(stored?.subscribedPower, 5, 'la puissance ne doit pas être effacée');
});

test('CRUD · compteur : supprimer annonce ce qui part en cascade (§21)', async () => {
  const { DELETE } = await import('@/app/api/v1/meters/[id]/route');
  const propertyId = await ownProperty();
  const meter = await db.meter.create({
    data: { propertyId, provider: 'CIE', utilityType: 'ELECTRICITY', unit: 'KWH' },
  });
  await db.meterReading.create({
    data: { meterId: meter.id, value: 100, unit: 'KWH', readingType: 'INDEX' },
  });

  const res = await DELETE(del(`/meters/${meter.id}`), { params: Promise.resolve({ id: meter.id }) });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cascaded: { readings: number } };
  assert.equal(body.cascaded.readings, 1, 'la cascade est annoncée, jamais silencieuse');
  assert.equal(await db.meterReading.count({ where: { meterId: meter.id } }), 0);
});

test('CRUD · alertes : une seule ligne par type et par utilisateur', async () => {
  // Le `@@unique([userId, type])` ajouté au schéma est ce qui empêche le doublon.
  // `satisfies` conserve les types littéraux : sans lui, `severity` serait
  // élargi en `string` et refusé par Prisma.
  const donnees = {
    userId: ownerId,
    type: 'RAPID_INCREASE',
    severity: 'WARNING',
    title: 'Hausse rapide',
    body: 'Vérifiez…',
    resolvedAt: new Date(),
  } satisfies Prisma.AlertUncheckedCreateInput;
  await db.alert.create({ data: donnees });

  await assert.rejects(
    db.alert.create({ data: { ...donnees, resolvedAt: null } }),
    /unique|Unique/i,
    'deux alertes de même type pour un même utilisateur doivent être refusées',
  );
});

// ---------- Valeurs dérivées : jamais laissées fausses (§18, §23) ----------

test('CRUD · recharge : corriger le montant REDÉRIVE le coût par kWh', async () => {
  const { PATCH } = await import('@/app/api/v1/electricity/purchases/[id]/route');
  const propertyId = await ownProperty();
  const meter = await db.meter.create({
    data: { propertyId, provider: 'CIE', utilityType: 'ELECTRICITY', unit: 'KWH' },
  });
  const purchase = await db.electricityPurchase.create({
    data: { meterId: meter.id, amountPaid: 10_000, energyCreditedKwh: 100, costPerKwh: 100 },
  });

  const res = await PATCH(patch(`/purchases/${purchase.id}`, { amountPaid: 20_000 }), {
    params: Promise.resolve({ id: purchase.id }),
  });
  assert.equal(res.status, 200);

  const stored = await db.electricityPurchase.findUnique({ where: { id: purchase.id } });
  assert.equal(stored?.amountPaid, 20_000);
  assert.equal(stored?.costPerKwh, 200, '20 000 / 100 kWh');
});

test('CRUD · facture : une période inversée est refusée (422)', async () => {
  const { PATCH } = await import('@/app/api/v1/water/bills/[id]/route');
  const propertyId = await ownProperty();
  const meter = await db.meter.create({
    data: { propertyId, provider: 'SODECI', utilityType: 'WATER', unit: 'M3' },
  });
  const bill = await db.waterBill.create({
    data: {
      meterId: meter.id,
      propertyId,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      consumptionM3: 15,
      amountTtc: 6_000,
    },
  });

  // On corrige SEULEMENT la fin : le contrôle doit la comparer au DÉBUT déjà
  // enregistré, pas seulement aux champs transmis.
  const res = await PATCH(patch(`/bills/${bill.id}`, { periodEnd: '2025-12-01' }), {
    params: Promise.resolve({ id: bill.id }),
  });
  assert.equal(res.status, 422);
  assert.match(((await res.json()) as { error: string }).error, /fin de période/);
});

test('CRUD · facture : corriger la consommation REDÉRIVE le coût par m³', async () => {
  const { PATCH } = await import('@/app/api/v1/water/bills/[id]/route');
  const propertyId = await ownProperty();
  const meter = await db.meter.create({
    data: { propertyId, provider: 'SODECI', utilityType: 'WATER', unit: 'M3' },
  });
  const bill = await db.waterBill.create({
    data: {
      meterId: meter.id,
      propertyId,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      consumptionM3: 10,
      amountTtc: 5_000,
      effectiveCostPerM3: 500,
    },
  });

  await PATCH(patch(`/bills/${bill.id}`, { consumptionM3: 20 }), {
    params: Promise.resolve({ id: bill.id }),
  });

  const stored = await db.waterBill.findUnique({ where: { id: bill.id } });
  assert.equal(stored?.consumptionM3, 20);
  assert.equal(stored?.effectiveCostPerM3, 250, '5 000 / 20 m³');
});
// ---------- Relevés : PAS de PATCH (§21) ----------

test('CRUD · relevés : aucun PATCH n’est exposé (§21)', async () => {
  // La valeur d'un relevé EST la mesure : la modifier réécrirait l'historique
  // financier en silence. L'API doit donc exposer seulement GET, POST, DELETE.
  const route = await import('@/app/api/v1/meters/[id]/readings/[readingId]/route');
  assert.equal('PATCH' in route, false, 'un PATCH de relevé ne doit pas exister');
  assert.equal('PUT' in route, false);
  assert.equal(typeof route.DELETE, 'function');
});

test('CRUD · relevés : suppression par le propriétaire', async () => {
  const { DELETE } = await import('@/app/api/v1/meters/[id]/readings/[readingId]/route');
  const propertyId = await ownProperty();
  const meter = await db.meter.create({
    data: { propertyId, provider: 'SODECI', utilityType: 'WATER', unit: 'M3' },
  });
  const reading = await db.meterReading.create({
    data: { meterId: meter.id, value: 120, unit: 'M3', readingType: 'INDEX' },
  });

  const res = await DELETE(del(`/meters/${meter.id}/readings/${reading.id}`), {
    params: Promise.resolve({ id: meter.id, readingId: reading.id }),
  });
  assert.equal(res.status, 200);
  assert.equal(await db.meterReading.count({ where: { id: reading.id } }), 0);
});

test('CRUD · relevés : un relevé d’un AUTRE compteur est introuvable', async () => {
  // Sans le filtre `meterId` de l'URL, un identifiant deviné suffirait à
  // supprimer un relevé d'un compteur qui n'est pas le sien.
  const { DELETE } = await import('@/app/api/v1/meters/[id]/readings/[readingId]/route');
  const propertyId = await ownProperty();
  const meterA = await db.meter.create({
    data: { propertyId, provider: 'SODECI', utilityType: 'WATER', unit: 'M3' },
  });
  const meterB = await db.meter.create({
    data: { propertyId, provider: 'SODECI', utilityType: 'WATER', unit: 'M3' },
  });
  const reading = await db.meterReading.create({
    data: { meterId: meterA.id, value: 50, unit: 'M3', readingType: 'INDEX' },
  });

  // bonne clé, mauvais compteur
  const res = await DELETE(del(`/meters/${meterB.id}/readings/${reading.id}`), {
    params: Promise.resolve({ id: meterB.id, readingId: reading.id }),
  });
  assert.equal(res.status, 404);
  assert.equal(await db.meterReading.count({ where: { id: reading.id } }), 1);
});