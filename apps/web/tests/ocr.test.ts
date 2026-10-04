// Invariant de confirmation humaine — flow.md §57.
//
// « L'OCR ne doit jamais écrire directement une facture sans confirmation
// humaine. » Ce test verrouille cette propriété, y compris contre la
// réutilisation, la double confirmation et la confirmation par un tiers.

import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { prepareTestDatabase, resetTestData, seedTariffs } from './setup';
import { db } from '@/lib/db';
import { confirmDraftExtraction, rejectDraftExtraction } from '@/lib/ocr-pipeline';

let seq = 0;
function nextPhone(): string {
  seq += 1;
  return `+22506${String(seq).padStart(8, '0')}`;
}

async function makeUser() {
  const user = await db.user.create({ data: { phone: nextPhone() } });
  return user.id;
}

async function makeWaterMeter(userId: string) {
  const property = await db.property.create({ data: { name: 'Villa', userId } });
  return db.meter.create({
    data: { propertyId: property.id, provider: 'SODECI', utilityType: 'WATER', unit: 'M3' },
  });
}

async function makeDraft(userId: string) {
  const meter = await makeWaterMeter(userId);
  return db.draftExtraction.create({
    data: { userId, meterId: meter.id, sourceType: 'WATER_BILL', imagePath: 'uploads/x.png' },
  });
}

const CONFIRM = {
  consumptionM3: 15.5,
  amountTtc: 6850,
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
};

before(async () => {
  prepareTestDatabase();
  await resetTestData(db);
  await seedTariffs(db);
});

beforeEach(async () => {
  await resetTestData(db);
});

after(async () => {
  await db.$disconnect();
});

test('OCR · une proposition seule n’écrit AUCUNE facture', async () => {
  const userId = await makeUser();
  await makeDraft(userId);

  assert.equal(await db.waterBill.count(), 0, 'rien ne doit être écrit avant confirmation');
});

test('OCR · la confirmation crée la facture et marque le statut', async () => {
  const userId = await makeUser();
  const draft = await makeDraft(userId);

  const before = await db.waterBill.count();
  const result = await confirmDraftExtraction(userId, { ...CONFIRM, draftId: draft.id });

  assert.equal(result.ok, true);
  assert.equal(await db.waterBill.count(), before + 1);

  const updated = await db.draftExtraction.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(updated.status, 'CONFIRMED');
  assert.ok(updated.confirmedAt);

  // flow.md §23 — coût effectif observé sur la facture créée
  const bill = await db.waterBill.findFirstOrThrow({
    where: { id: updated.confirmedEntityId ?? '' },
  });
  assert.equal(Math.round(bill.effectiveCostPerM3 ?? 0), 442);
});

test('OCR · double confirmation refusée : aucune facture en double', async () => {
  const userId = await makeUser();
  const draft = await makeDraft(userId);

  const first = await confirmDraftExtraction(userId, { ...CONFIRM, draftId: draft.id });
  const second = await confirmDraftExtraction(userId, { ...CONFIRM, draftId: draft.id });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(await db.waterBill.count(), 1, 'une seule facture doit exister');
});

test('OCR · confirmation par un tiers refusée', async () => {
  const ownerId = await makeUser();
  const strangerId = await makeUser();
  const draft = await makeDraft(ownerId);

  const result = await confirmDraftExtraction(strangerId, { ...CONFIRM, draftId: draft.id });

  assert.equal(result.ok, false);
  assert.equal(await db.waterBill.count(), 0, 'un tiers ne doit jamais créer une facture');
});

test('OCR · le refus n’écrit rien', async () => {
  const userId = await makeUser();
  const draft = await makeDraft(userId);

  const rejected = await rejectDraftExtraction(userId, draft.id);

  assert.equal(rejected, true);
  assert.equal(await db.waterBill.count(), 0);
  const updated = await db.draftExtraction.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(updated.status, 'REJECTED');
});

test('OCR · dates incohérentes refusées à la confirmation', async () => {
  const userId = await makeUser();
  const draft = await makeDraft(userId);

  const inverse = await confirmDraftExtraction(userId, {
    ...CONFIRM,
    draftId: draft.id,
    periodStart: '2026-09-30',
    periodEnd: '2026-09-01',
  });
  assert.equal(inverse.ok, false);

  const futur = await confirmDraftExtraction(userId, {
    ...CONFIRM,
    draftId: draft.id,
    periodStart: '2099-01-01',
    periodEnd: '2099-12-31',
  });
  assert.equal(futur.ok, false);

  assert.equal(await db.waterBill.count(), 0);
});

test('OCR · le refus supprime la photo du disque', async () => {
  const userId = await makeUser();
  const meter = await makeWaterMeter(userId);

  // un vrai fichier déposé, puis refusé
  const { saveReceipt } = await import('@/lib/upload');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const uploaded = await saveReceipt(new File([png], 'recu.png', { type: 'image/png' }));
  assert.equal(uploaded.ok, true);
  if (!uploaded.ok) return;

  const draft = await db.draftExtraction.create({
    data: { userId, meterId: meter.id, sourceType: 'WATER_BILL', imagePath: uploaded.path },
  });

  await rejectDraftExtraction(userId, draft.id);

  const { existsSync } = await import('node:fs');
  const path = await import('node:path');
  const full = path.resolve(
    process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads'),
    uploaded.path,
  );
  assert.equal(existsSync(full), false, 'la photo d’un reçu refusé doit être supprimée');
});