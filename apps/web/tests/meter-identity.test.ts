import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { prepareTestDatabase, resetTestData } from './setup';
import { db } from '../lib/db';
import {
  PROVIDER_FOR_KIND,
  checkMeterCoherence,
  checkMeterIdentityChange,
  meterHasHistory,
} from '../lib/meter-identity';
import { addReading } from '../lib/services';

before(async () => {
  prepareTestDatabase();
  await resetTestData(db);
});

after(async () => {
  await db.$disconnect();
});

let seq = 0;

async function compteur(utilityType: 'WATER' | 'ELECTRICITY') {
  seq += 1;
  const user = await db.user.create({ data: { phone: `+22509${String(seq).padStart(8, '0')}` } });
  const property = await db.property.create({ data: { userId: user.id, name: `Logement ${seq}` } });
  return db.meter.create({
    data: {
      propertyId: property.id,
      utilityType,
      provider: utilityType === 'WATER' ? 'SODECI' : 'CIE',
    },
  });
}

// ---------- Cohérence réseau / type ----------

test('cohérence · le réseau est déterminé par le type', () => {
  assert.equal(PROVIDER_FOR_KIND.WATER, 'SODECI');
  assert.equal(PROVIDER_FOR_KIND.ELECTRICITY, 'CIE');

  assert.equal(checkMeterCoherence({ provider: 'SODECI', utilityType: 'WATER' }), null);
  assert.equal(checkMeterCoherence({ provider: 'CIE', utilityType: 'ELECTRICITY' }), null);
  // CIE + eau n'a jamais existé : c'est le cas que rien ne bloquait jusqu'ici.
  assert.ok(checkMeterCoherence({ provider: 'CIE', utilityType: 'WATER' }));
  assert.ok(checkMeterCoherence({ provider: 'SODECI', utilityType: 'ELECTRICITY' }));
});

// ---------- Le cas central : réécrire un compteur qui porte des données ----------

test('identité · un compteur avec relevés ne peut plus changer de type', () => {
  // C'est le défaut exact que la règle du §9 rend dangereux : un compteur passé
  // de l'eau à l'électricité garde des relevés en m³ qui ne repasseraient plus
  // la cohérence, et son `unit` basculerait à KWH.
  const refus = checkMeterIdentityChange({
    actuel: { provider: 'SODECI', utilityType: 'WATER' },
    demande: { provider: 'CIE', utilityType: 'ELECTRICITY' },
    aDesDonnees: true,
  });
  assert.ok(refus, 'la conversion doit être refusée');
  assert.match(refus, /mesures/);
});

test('identité · un compteur SANS donnée reste convertible', () => {
  // Corriger un compteur ajouté par erreur est un besoin réel : interdire
  // absolument laisserait ces compteurs orphelins à jamais.
  assert.equal(
    checkMeterIdentityChange({
      actuel: { provider: 'SODECI', utilityType: 'WATER' },
      demande: { provider: 'CIE', utilityType: 'ELECTRICITY' },
      aDesDonnees: false,
    }),
    null,
  );
});

test('identité · le réseau seul ne bouge pas si le type reste cohérent', () => {
  // Aucun des deux champs ne change de valeur → rien à réécrire.
  assert.equal(
    checkMeterIdentityChange({
      actuel: { provider: 'CIE', utilityType: 'ELECTRICITY' },
      demande: { provider: 'CIE', utilityType: 'ELECTRICITY' },
      aDesDonnees: true,
    }),
    null,
  );
});

test('identité · changer un réseau avec données est refusé', () => {
  const refus = checkMeterIdentityChange({
    actuel: { provider: 'SODECI', utilityType: 'WATER' },
    demande: { provider: 'CIE' },
    aDesDonnees: true,
  });
  assert.ok(refus, 'le réseau ne doit plus bouger une fois le compteur utilisé');
});

test('identité · sans données, la cohérence prime sur l’historique', () => {
  // Un compteur sans mesures mais déclaré SODECI + ELECTRICITY doit être refusé
  // quand même : il n'a rien à protéger, il est simplement faux.
  assert.ok(
    checkMeterIdentityChange({
      actuel: { provider: 'SODECI', utilityType: 'WATER' },
      demande: { utilityType: 'ELECTRICITY' },
      aDesDonnees: false,
    }),
  );
});

// ---------- Détection de l'historique, sur une vraie base ----------

test('historique · un compteur neuf n’a pas d’historique', async () => {
  const meter = await compteur('WATER');
  assert.equal(await meterHasHistory(meter.id), false);
});

test('historique · un relevé suffit à figer l’identité', async () => {
  const meter = await compteur('WATER');
  await addReading({ meterId: meter.id, value: 10, unit: 'M3', readingType: 'INDEX' });

  assert.equal(await meterHasHistory(meter.id), true);
  assert.ok(
    checkMeterIdentityChange({
      actuel: { provider: 'SODECI', utilityType: 'WATER' },
      demande: { provider: 'CIE', utilityType: 'ELECTRICITY' },
      aDesDonnees: await meterHasHistory(meter.id),
    }),
  );
});

test('historique · une facture fige aussi l’identité, sans aucun relevé', async () => {
  // Le cas que seul un comptage de `meterReading` manquerait : une facture
  // SODECI est un document financier, même sans une seule mesure d'index.
  const meter = await compteur('WATER');
  const debut = new Date('2026-01-01');
  await db.waterBill.create({
    data: {
      meterId: meter.id,
      propertyId: meter.propertyId,
      periodStart: debut,
      periodEnd: new Date('2026-01-31'),
      consumptionM3: 12,
      amountTtc: 5000,
    },
  });

  assert.equal(await db.meterReading.count({ where: { meterId: meter.id } }), 0);
  assert.equal(await meterHasHistory(meter.id), true, 'la facture doit figer le compteur');
});

// ---------- Comptes déjà incohérents, créés avant la correction ----------

test('identité · un compteur incohérent reste utilisable tel quel', async () => {
  // Des compteurs « CIE » + eau existent peut-être déjà en base. La règle ne
  // doit pas les rendre inutilisables : on refuse de les RÉÉCRIRE, pas de les
  // lire ou d'y ajouter un relevé. C'est la différence entre une règle de
  // cohérence et une règle de verrouillage.
  const incohérent = await compteur('WATER');
  await db.meter.update({ where: { id: incohérent.id }, data: { provider: 'CIE' } });

  // Renvoyer des valeurs inchangées passe : rien n'est réécrit.
  assert.equal(
    checkMeterIdentityChange({
      actuel: { provider: 'CIE', utilityType: 'WATER' },
      demande: { provider: 'CIE', utilityType: 'WATER' },
      aDesDonnees: false,
    }),
    null,
  );

  // Le formulaire web renvoie TOUTE la ligne, y compris ces deux champs : sans
  // ce cas, un compteur incohérent deviendrait immodifiable.
  assert.equal(
    checkMeterIdentityChange({
      actuel: { provider: 'CIE', utilityType: 'WATER' },
      demande: { provider: 'CIE', utilityType: 'WATER', paymentMode: 'PREPAY' } as never,
      aDesDonnees: true,
    }),
    null,
  );

  // Et on peut toujours y ajouter un relevé cohérent avec son type.
  const lecture = await addReading({
    meterId: incohérent.id,
    value: 5,
    unit: 'M3',
    readingType: 'INDEX',
  });
  assert.ok(lecture.reading.id);
});

test('identité · corriger un compteur incohérent sans données est permis', async () => {
  // Le rattrapage doit rester possible tant qu'aucune donnée n'est en jeu :
  // c'est le seul moment où la correction est sans risque.
  const resultat = checkMeterIdentityChange({
    actuel: { provider: 'CIE', utilityType: 'WATER' },
    demande: { provider: 'SODECI' },
    aDesDonnees: false,
  });
  assert.equal(resultat, null);
});

test('historique · les relevés d’un compteur ne figent pas son voisin', async () => {
  // Un compteur sans donnée reste convertible même si un autre compteur du même
  // logement en est rempli : la règle porte sur le compteur, pas sur le logement.
  const premier = await compteur('WATER');
  const second = await compteur('WATER');
  await addReading({ meterId: premier.id, value: 10, unit: 'M3', readingType: 'INDEX' });

  assert.equal(await meterHasHistory(premier.id), true);
  assert.equal(await meterHasHistory(second.id), false);
});