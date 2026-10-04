// Tests d'intégration de l'API REST — flow.md §53 (« API »).
//
// On appelle les VRAIES routes /api/v1 avec de vraies requêtes, contre une base
// de test isolée (schéma PostgreSQL `test_consoci`). Aucun mock : c'est la seule
// façon de vérifier que le câblage complet fonctionne.
//
// Couverture exigée par le plan :
//   create property · create meter · create reading · create purchase · dashboard

import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// IMPORTANT : `./setup` doit être importé en premier — il redirige
// DATABASE_URL vers le schéma de test avant que Prisma ne lise la variable.
import { prepareTestDatabase, resetTestData, seedTariffs } from './setup';
import { db } from '@/lib/db';
import { signAccessToken } from '@/lib/auth-core';

const BASE = 'http://consoci.test/api/v1';

let token = '';
let userId = '';

// Chaque test a son propre utilisateur. La suite s'exécute séquentiellement
// (--test-concurrency=1) : le jeton partagé est donc sûr.
let seq = 0;
function nextPhone(): string {
  seq += 1;
  return `+22507${String(seq).padStart(8, '0')}`;
}

async function newUser(): Promise<{ id: string; token: string }> {
  const user = await db.user.create({ data: { phone: nextPhone(), firstName: 'Test' } });
  const t = await signAccessToken({ id: user.id, phone: user.phone, firstName: 'Test' });
  return { id: user.id, token: t };
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, init);
}

function postJson(path: string, body: unknown): Request {
  return req(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function makeMeter(utility: 'ELECTRICITY' | 'WATER') {
  const property = await db.property.create({ data: { name: 'Villa', userId } });
  return db.meter.create({
    data: {
      propertyId: property.id,
      provider: utility === 'WATER' ? 'SODECI' : 'CIE',
      utilityType: utility,
      unit: utility === 'WATER' ? 'M3' : 'KWH',
    },
  });
}

const waterMeter = () => makeMeter('WATER');
const elecMeter = () => makeMeter('ELECTRICITY');

before(async () => {
  prepareTestDatabase();
  await resetTestData(db);
  // comme en production : sans grille tarifaire, l'estimation des kWh est
  // impossible et le test vérifierait un chemin qui n'existe pas en usage réel
  await seedTariffs(db);
});

beforeEach(async () => {
  const created = await newUser();
  token = created.token;
  userId = created.id;
});

after(async () => {
  await db.$disconnect();
});
// ---------- create property (§38, §33) ----------

test('API · create property : crée un logement', async () => {
  const { POST } = await import('@/app/api/v1/properties/route');
  const res = await POST(postJson('/properties', { name: 'Villa Test', isAbidjan: true }));

  assert.equal(res.status, 201);
  const body = (await res.json()) as { name: string; id: string };
  assert.equal(body.name, 'Villa Test');
  assert.ok(body.id);
});

test('API · create property : sans authentification → 401', async () => {
  const { POST } = await import('@/app/api/v1/properties/route');
  const res = await POST(
    req('/properties', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Intrusion' }),
    }),
  );
  assert.equal(res.status, 401);
});

test('API · create property : nom manquant → 422', async () => {
  const { POST } = await import('@/app/api/v1/properties/route');
  const res = await POST(postJson('/properties', { name: '' }));
  assert.equal(res.status, 422);
});

// ---------- create meter (§9, §25) ----------

test('API · create meter : crée un compteur CIE prépayé', async () => {
  const property = await db.property.create({ data: { name: 'Villa', userId } });
  const { POST } = await import('@/app/api/v1/meters/route');

  const res = await POST(
    postJson('/meters', {
      propertyId: property.id,
      provider: 'CIE',
      utilityType: 'ELECTRICITY',
      paymentMode: 'PREPAID',
      subscribedPower: 5,
    }),
  );

  assert.equal(res.status, 201);
  const body = (await res.json()) as { provider: string; paymentMode: string };
  assert.equal(body.provider, 'CIE');
  // flow.md §9 — le mode de paiement est conservé tel quel
  assert.equal(body.paymentMode, 'PREPAID');
});

test('API · create meter : logement d’un tiers → 403', async () => {
  // le logement appartient à l'utilisateur courant (A) ; la requête est faite
  // par un autre utilisateur (B) : c'est bien une tentative d'intrusion
  const foreignProperty = await db.property.create({ data: { name: 'Chez A', userId } });
  const other = await newUser();

  const { POST } = await import('@/app/api/v1/meters/route');
  const res = await POST(
    req('/meters', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${other.token}` },
      body: JSON.stringify({
        propertyId: foreignProperty.id,
        provider: 'CIE',
        utilityType: 'ELECTRICITY',
      }),
    }),
  );
  assert.equal(res.status, 403);
});

// ---------- create reading (§10, §21) ----------

test('API · create reading : calcule la consommation entre deux index', async () => {
  const meter = await waterMeter();
  const { POST } = await import('@/app/api/v1/meters/[id]/readings/route');
  const ctx = { params: Promise.resolve({ id: meter.id }) };

  const first = await POST(
    postJson(`/meters/${meter.id}/readings`, { value: 124.3, unit: 'M3', readingType: 'INDEX' }),
    ctx,
  );
  assert.equal(first.status, 201);

  const second = await POST(
    postJson(`/meters/${meter.id}/readings`, { value: 139.8, unit: 'M3', readingType: 'INDEX' }),
    ctx,
  );
  assert.equal(second.status, 201);

  const body = (await second.json()) as { period: { quantity: number; anomaly: boolean } | null };
  // flow.md §53 — 139.8 - 124.3 = 15.5
  assert.equal(body.period?.quantity, 15.5);
  assert.equal(body.period?.anomaly, false);
});

test('API · create reading : index décroissant conservé et signalé (§21)', async () => {
  const meter = await waterMeter();
  const { POST } = await import('@/app/api/v1/meters/[id]/readings/route');
  const ctx = { params: Promise.resolve({ id: meter.id }) };

  await POST(
    postJson(`/meters/${meter.id}/readings`, { value: 139.8, unit: 'M3', readingType: 'INDEX' }),
    ctx,
  );
  const res = await POST(
    postJson(`/meters/${meter.id}/readings`, { value: 120, unit: 'M3', readingType: 'INDEX' }),
    ctx,
  );

  assert.equal(res.status, 201);
  const body = (await res.json()) as { period: { anomaly: boolean; anomalyNote: string } | null };
  assert.equal(body.period?.anomaly, true);
  assert.ok(body.period?.anomalyNote);

  // la donnée n'est jamais supprimée (§21)
  const stored = await db.meterReading.count({ where: { meterId: meter.id } });
  assert.equal(stored, 2);
});

test('API · create reading : valeur négative refusée (§52)', async () => {
  const meter = await waterMeter();
  const { POST } = await import('@/app/api/v1/meters/[id]/readings/route');
  const res = await POST(
    postJson(`/meters/${meter.id}/readings`, { value: -5, unit: 'M3', readingType: 'INDEX' }),
    { params: Promise.resolve({ id: meter.id }) },
  );
  assert.equal(res.status, 422);
});

// ---------- create purchase (§11, §19) ----------

test('API · create purchase : sans kWh, énergie estimée et confiance basse', async () => {
  const meter = await elecMeter();
  const { POST } = await import('@/app/api/v1/electricity/purchases/route');
  const res = await POST(postJson('/electricity/purchases', { meterId: meter.id, amountPaid: 10_000 }));

  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    consumptionStatus: string;
    consumptionConfidence: string;
    consumptionKwh: number;
  };
  assert.equal(body.consumptionStatus, 'ESTIMATE');
  assert.equal(body.consumptionConfidence, 'LOW');
  assert.ok(body.consumptionKwh > 0);
});

test('API · create purchase : avec kWh crédités, la mesure est RÉELLE', async () => {
  const meter = await elecMeter();
  const { POST } = await import('@/app/api/v1/electricity/purchases/route');
  const res = await POST(
    postJson('/electricity/purchases', { meterId: meter.id, amountPaid: 10_000, energyCreditedKwh: 82 }),
  );

  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    consumptionStatus: string;
    consumptionKwh: number;
    effectiveCostPerKwh: number;
  };
  assert.equal(body.consumptionStatus, 'REAL');
  assert.equal(body.consumptionKwh, 82);
  // flow.md §18 — coût effectif observé, pas le prix réglementaire
  assert.equal(Math.round(body.effectiveCostPerKwh), 122);
});

test('API · create purchase : compteur d’eau refusé', async () => {
  const meter = await waterMeter();
  const { POST } = await import('@/app/api/v1/electricity/purchases/route');
  const res = await POST(postJson('/electricity/purchases', { meterId: meter.id, amountPaid: 5_000 }));
  assert.equal(res.status, 403);
});

// ---------- dashboard (§39) ----------

test('API · dashboard : reflète les données réellement enregistrées', async () => {
  const water = await waterMeter();
  const { POST: POSTReading } = await import('@/app/api/v1/meters/[id]/readings/route');
  const ctx = { params: Promise.resolve({ id: water.id }) };
  await POSTReading(
    postJson(`/meters/${water.id}/readings`, { value: 124.3, unit: 'M3', readingType: 'INDEX' }),
    ctx,
  );
  await POSTReading(
    postJson(`/meters/${water.id}/readings`, { value: 139.8, unit: 'M3', readingType: 'INDEX' }),
    ctx,
  );

  const elec = await elecMeter();
  const { POST: POSTPurchase } = await import('@/app/api/v1/electricity/purchases/route');
  await POSTPurchase(
    postJson('/electricity/purchases', { meterId: elec.id, amountPaid: 10_000, energyCreditedKwh: 82 }),
  );

  const { GET } = await import('@/app/api/v1/dashboard/route');
  const res = await GET(req('/dashboard', { headers: { authorization: `Bearer ${token}` } }));

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    electricity: { spent: number; consumptionKwh: number; consumptionStatus: string };
    water: { consumptionM3: number };
    alerts: unknown[];
    recommendations: unknown[];
  };

  assert.equal(body.electricity.spent, 10_000);
  assert.equal(body.electricity.consumptionKwh, 82);
  assert.equal(body.electricity.consumptionStatus, 'REAL');
  assert.equal(body.water.consumptionM3, 15.5);
  assert.ok(Array.isArray(body.alerts));
  assert.ok(Array.isArray(body.recommendations));
});

test('API · dashboard : sans donnée, aucun faux zéro (§34)', async () => {
  const { GET } = await import('@/app/api/v1/dashboard/route');
  const res = await GET(req('/dashboard', { headers: { authorization: `Bearer ${token}` } }));

  const body = (await res.json()) as {
    electricity: { hasData: boolean };
    water: { hasData: boolean };
  };
  assert.equal(body.electricity.hasData, false);
  assert.equal(body.water.hasData, false);
});

// ---------- isolation entre comptes (§40) ----------

test('API · les données d’un utilisateur ne fuient pas chez un autre (§40)', async () => {
  const meter = await waterMeter();
  const { GET } = await import('@/app/api/v1/meters/[id]/readings/route');
  const ctx = { params: Promise.resolve({ id: meter.id }) };

  const own = await GET(
    req(`/meters/${meter.id}/readings`, { headers: { authorization: `Bearer ${token}` } }),
    ctx,
  );
  assert.equal(own.status, 200);

  const other = await newUser();
  const foreign = await GET(
    req(`/meters/${meter.id}/readings`, { headers: { authorization: `Bearer ${other.token}` } }),
    ctx,
  );
  // 404 et non 403 : on ne divulgue pas l'existence de la ressource
  assert.equal(foreign.status, 404);
});
