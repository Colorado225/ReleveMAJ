import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { prepareTestDatabase, resetTestData } from './setup';
import { db } from '../lib/db';
import { addReading } from '../lib/services';
import {
  READING_TYPES_FOR_KIND,
  UNIT_FOR_KIND,
  shouldComputeConsumptionPeriod,
  validateReadingAgainstMeter,
} from '../lib/reading-rules';

before(async () => {
  prepareTestDatabase();
  await resetTestData(db);
});

after(async () => {
  await db.$disconnect();
});

// ---------- La règle, sans base de données ----------

test('relevé · un compteur d’eau refuse les unités et types électriques', () => {
  // Les deux exemples littéraux de l'audit (instr.md §9).
  assert.ok(validateReadingAgainstMeter({ meterKind: 'WATER', unit: 'KWH', readingType: 'CREDIT' }));
  assert.ok(validateReadingAgainstMeter({ meterKind: 'ELECTRICITY', unit: 'M3', readingType: 'INDEX' }));
});

test('relevé · les combinaisons cohérentes passent', () => {
  assert.equal(validateReadingAgainstMeter({ meterKind: 'WATER', unit: 'M3', readingType: 'INDEX' }), null);
  assert.equal(
    validateReadingAgainstMeter({ meterKind: 'ELECTRICITY', unit: 'KWH', readingType: 'CREDIT' }),
    null,
  );
  assert.equal(
    validateReadingAgainstMeter({ meterKind: 'ELECTRICITY', unit: 'KWH', readingType: 'ENERGY_AVAILABLE' }),
    null,
  );
});

test('relevé · UNKNOWN reste admis partout (flow.md §10 : « ne pas deviner »)', () => {
  // Refuser `UNKNOWN` obligerait l’utilisateur à inventer une unité.
  assert.equal(validateReadingAgainstMeter({ meterKind: 'WATER', unit: 'UNKNOWN', readingType: 'UNKNOWN' }), null);
  assert.ok(READING_TYPES_FOR_KIND.WATER.includes('UNKNOWN'));
  assert.ok(READING_TYPES_FOR_KIND.ELECTRICITY.includes('UNKNOWN'));
});

test('relevé · chaque compteur a une seule unité et des types cohérents', () => {
  // Un tableau qui laissait passer un type incohérent passerait ces deux tests.
  assert.equal(UNIT_FOR_KIND.WATER, 'M3');
  assert.equal(UNIT_FOR_KIND.ELECTRICITY, 'KWH');
  for (const kind of ['WATER', 'ELECTRICITY'] as const) {
    assert.ok(READING_TYPES_FOR_KIND[kind].length > 0, `${kind} sans type admis`);
  }
});

test('période de consommation · calculée sur tout relevé d’INDEX', () => {
  assert.equal(shouldComputeConsumptionPeriod({ readingType: 'INDEX' }), true);
  // Un CREDIT ou un ENERGY_AVAILABLE est un solde, pas un index : un différentiel
  // n'aurait aucun sens.
  assert.equal(shouldComputeConsumptionPeriod({ readingType: 'CREDIT' }), false);
  assert.equal(shouldComputeConsumptionPeriod({ readingType: 'ENERGY_AVAILABLE' }), false);
  assert.equal(shouldComputeConsumptionPeriod({ readingType: 'UNKNOWN' }), false);
});

// ---------- La règle, appliquée pour de vrai ----------

let seq = 0;

/** Un compteur neuf du type demandé, avec son propriétaire et son logement. */
async function compteur(utilityType: 'WATER' | 'ELECTRICITY') {
  seq += 1;
  const user = await db.user.create({ data: { phone: `+22508${String(seq).padStart(8, '0')}` } });
  const property = await db.property.create({
    data: { userId: user.id, name: `Logement ${seq}` },
  });
  return db.meter.create({
    data: {
      propertyId: property.id,
      utilityType,
      // Le fournisseur suit le type : SODECI pour l'eau, CIE pour l'électricité.
      provider: utilityType === 'WATER' ? 'SODECI' : 'CIE',
    },
  });
}

test('relevé · addReading refuse une incohérence ET ne l’enregistre pas', async () => {
  const meter = await compteur('WATER');

  await assert.rejects(
    () => addReading({ meterId: meter.id, value: 120, unit: 'KWH', readingType: 'CREDIT' }),
    /m³|SODE|CIE/,
  );

  // Le point important : le relevé refusé ne doit pas rester en base, sinon le
  // dashboard le relirait comme une donnée d’eau valide.
  const laisses = await db.meterReading.count({ where: { meterId: meter.id } });
  assert.equal(laisses, 0, 'un relevé refusé ne doit pas être persisté');
});

test('relevé · l’eau refuse un CRÉDIT, qui n’existe que pour le CIE', async () => {
  // Un CREDIT en m³ est incohérent : le crédit d'énergie est une notion CIE.
  const meter = await compteur('WATER');
  await assert.rejects(() => addReading({ meterId: meter.id, value: 50, unit: 'M3', readingType: 'CREDIT' }));
  assert.equal(await db.meterReading.count({ where: { meterId: meter.id } }), 0);
});

test('relevé · un INDEX en KWH sur compteur CIE reste accepté et calculé', async () => {
  // Le contre-test de la règle retirée : un compteur CIE postpayé a un index en
  // kWh. Le refuser supprimerait des données valides — voir reading-rules.
  const meter = await compteur('ELECTRICITY');
  await addReading({ meterId: meter.id, value: 100, unit: 'KWH', readingType: 'INDEX' });
  const resultat = await addReading({ meterId: meter.id, value: 160, unit: 'KWH', readingType: 'INDEX' });

  assert.ok(resultat.period, 'un index CIE doit produire une période');
  assert.equal(resultat.period?.quantity, 60);
  assert.equal(
    await db.consumptionPeriod.count({ where: { meterId: meter.id } }),
    1,
    'la période ne doit pas être créée deux fois',
  );
});

test('période de consommation · toujours calculée sur un compteur d’eau', async () => {
  // Le contre-test : la correction ne doit rien casser au chemin nominal.
  const meter = await compteur('WATER');
  const premier = await addReading({ meterId: meter.id, value: 100, unit: 'M3', readingType: 'INDEX' });
  assert.equal(premier.period, null, 'un premier index n’a pas de précédent : pas de période');

  const deuxieme = await addReading({ meterId: meter.id, value: 160, unit: 'M3', readingType: 'INDEX' });
  assert.ok(deuxieme.period, 'le second index doit produire une période');
  assert.equal(deuxieme.period?.quantity, 60);
});