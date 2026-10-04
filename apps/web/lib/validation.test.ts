// Tests de la validation Zod — flow.md §52 (cas d'erreur) et §53.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCivPhone, isCivPhoneComplete, normalizeCivPhone } from './phone';
import {
  createApplianceSchema,
  createMeterSchema,
  createPropertySchema,
  createPurchaseSchema,
  createReadingSchema,
  createWaterBillSchema,
  requestOtpSchema,
  verifyOtpSchema,
} from './validation';

const issueOf = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues[0]?.message ?? '';

// ---------- Relevés (flow.md §52) ----------
test('relevé : valeur négative refusée', () => {
  const r = createReadingSchema.safeParse({ value: -1, unit: 'M3', readingType: 'INDEX' });
  assert.equal(r.success, false);
  assert.match(issueOf(r), /négative/);
});

test('relevé : date future refusée', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const r = createReadingSchema.safeParse({
    value: 100,
    unit: 'M3',
    readingType: 'INDEX',
    readingDate: future,
  });
  assert.equal(r.success, false);
  assert.match(issueOf(r), /futur/);
});

test('relevé : un relevé valide passe', () => {
  const r = createReadingSchema.safeParse({ value: 139.8, unit: 'M3', readingType: 'INDEX' });
  assert.equal(r.success, true);
});

// ---------- Recharges (flow.md §35) ----------
test('recharge : les kWh sont facultatifs', () => {
  const r = createPurchaseSchema.safeParse({ amountPaid: 10_000 });
  assert.equal(r.success, true);
});

test('recharge : montant négatif ou nul refusé', () => {
  assert.equal(createPurchaseSchema.safeParse({ amountPaid: 0 }).success, false);
  assert.equal(createPurchaseSchema.safeParse({ amountPaid: -500 }).success, false);
});

test('recharge : kWh négatifs refusés', () => {
  const r = createPurchaseSchema.safeParse({ amountPaid: 5000, energyCreditedKwh: -10 });
  assert.equal(r.success, false);
});

test('recharge : méthode de paiement doit appartenir à la liste fermée', () => {
  assert.equal(createPurchaseSchema.safeParse({ amountPaid: 1000, paymentMethod: 'BITCOIN' }).success, false);
  assert.equal(createPurchaseSchema.safeParse({ amountPaid: 1000, paymentMethod: 'WAVE' }).success, true);
});

// ---------- Factures SODECI (flow.md §22) ----------
test('facture : période obligatoire et consommation non négative', () => {
  const base = {
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    consumptionM3: 15.5,
    amountTtc: 6850,
  };
  assert.equal(createWaterBillSchema.safeParse(base).success, true);
  assert.equal(createWaterBillSchema.safeParse({ ...base, consumptionM3: -1 }).success, false);
  assert.equal(createWaterBillSchema.safeParse({ ...base, amountTtc: -1 }).success, false);
});

// ---------- Compteurs (flow.md §9) ----------
test('compteur : le mode de paiement accepte PRÉPAYÉ, POSTPAYÉ et INCONNU', () => {
  for (const mode of ['PREPAID', 'POSTPAID', 'UNKNOWN']) {
    const r = createMeterSchema.safeParse({
      provider: 'CIE',
      utilityType: 'ELECTRICITY',
      paymentMode: mode,
    });
    assert.equal(r.success, true, `mode ${mode} devrait être accepté`);
  }
});

test('compteur : le mode de paiement ne peut pas être inventé', () => {
  const r = createMeterSchema.safeParse({
    provider: 'CIE',
    utilityType: 'ELECTRICITY',
    paymentMode: 'PEAGE',
  });
  assert.equal(r.success, false);
});

// ---------- Logements ----------
test('logement : le nom est obligatoire', () => {
  assert.equal(createPropertySchema.safeParse({ name: '' }).success, false);
  assert.equal(createPropertySchema.safeParse({ name: 'Villa', isAbidjan: true }).success, true);
});

// ---------- Appareils (flow.md §32 et §52) ----------
test('appareil : données valides acceptées', () => {
  const r = createApplianceSchema.safeParse({
    propertyId: 'p1',
    type: 'AC',
    label: 'Climatisation salon',
    powerWatts: 1200,
    hoursPerDay: 6,
    daysPerMonth: 30,
  });
  assert.equal(r.success, true);
});

test('appareil : puissance nulle ou négative refusée', () => {
  const base = {
    propertyId: 'p1',
    type: 'AC',
    label: 'Climatisation',
    hoursPerDay: 6,
    daysPerMonth: 30,
  };
  assert.equal(createApplianceSchema.safeParse({ ...base, powerWatts: 0 }).success, false);
  assert.equal(createApplianceSchema.safeParse({ ...base, powerWatts: -100 }).success, false);
});

test('appareil : durée > 24 h refusée', () => {
  const r = createApplianceSchema.safeParse({
    propertyId: 'p1',
    type: 'AC',
    label: 'Climatisation',
    powerWatts: 1000,
    hoursPerDay: 25,
    daysPerMonth: 30,
  });
  assert.equal(r.success, false);
});

test('appareil : jours > 31 refusés', () => {
  const r = createApplianceSchema.safeParse({
    propertyId: 'p1',
    type: 'AC',
    label: 'Climatisation',
    powerWatts: 1000,
    hoursPerDay: 2,
    daysPerMonth: 45,
  });
  assert.equal(r.success, false);
});

test('appareil : le nom est obligatoire', () => {
  const r = createApplianceSchema.safeParse({
    propertyId: 'p1',
    type: 'AC',
    label: '',
    powerWatts: 1000,
    hoursPerDay: 2,
    daysPerMonth: 30,
  });
  assert.equal(r.success, false);
});

test('appareil : type hors liste fermée refusé', () => {
  const r = createApplianceSchema.safeParse({
    propertyId: 'p1',
    type: 'NUCLEAR_REACTOR',
    label: 'X',
    powerWatts: 1000,
    hoursPerDay: 2,
    daysPerMonth: 30,
  });
  assert.equal(r.success, false);
});

// ---------- Authentification ----------
test('OTP : le format nigérian/ivoirien est exigé', () => {
  assert.equal(requestOtpSchema.safeParse({ phone: '+2250700000000' }).success, true);
  assert.equal(requestOtpSchema.safeParse({ phone: '0700000000' }).success, false);
  assert.equal(requestOtpSchema.safeParse({ phone: '+22507000' }).success, false);
});

test('OTP : le code de vérification doit compter 6 chiffres', () => {
  const phone = '+2250700000000';
  assert.equal(verifyOtpSchema.safeParse({ phone, code: '123456' }).success, true);
  assert.equal(verifyOtpSchema.safeParse({ phone, code: '12345' }).success, false);
  assert.equal(verifyOtpSchema.safeParse({ phone, code: 'abcdef' }).success, false);
});

// ---------- Normalisation du numéro (formulaire de connexion) ----------

test('Téléphone : les écritures courantes mènent au même numéro', () => {
  const attendu = '+2250700000000';
  for (const saisie of [
    '0700000000',
    '07 00 00 00 00',
    '07-00-00-00-00',
    '(07) 00 00 00 00',
    '+2250700000000',
    '+225 07 00 00 00 00',
    '2250700000000',
    '002250700000000',
    '.07.00.00.00.00.',
  ]) {
    assert.equal(normalizeCivPhone(saisie), attendu, `échec sur « ${saisie} »`);
  }
});

test('Téléphone : le résultat est toujours accepté par le schéma serveur', () => {
  // invariant critique : le client ne doit jamais produire une valeur que le
  // serveur refusera ensuite (flow.md §40 — une seule règle de vérité)
  for (const saisie of ['0700000000', '+225 07 00 00 00 00', '002250700000000']) {
    const normalise = normalizeCivPhone(saisie);
    assert.notEqual(normalise, null);
    assert.equal(requestOtpSchema.safeParse({ phone: normalise }).success, true);
  }
});

test('Téléphone : les saisies invalides sont refusées', () => {
  for (const saisie of [
    '',
    '070000000',     // 9 chiffres
    '07000000000',   // 11 chiffres
    '+33123456789',  // indicatif français
    'abcdefghij',
    '+22507000',
  ]) {
    assert.equal(normalizeCivPhone(saisie), null, `aurait dû refuser « ${saisie} »`);
    assert.equal(isCivPhoneComplete(saisie), false);
  }
});

test('Téléphone : un numéro fixe ivoirien est accepté', () => {
  assert.equal(normalizeCivPhone('2721234567'), '+2252721234567');
});

test('Téléphone : l’affichage du numéro reste lisible', () => {
  assert.equal(formatCivPhone('+2250700000000'), '+225 07 00 00 00 00');
  // un numéro local est complété par l'indicatif : l'affichage montre toujours
  // le numéro entier, ce que l'utilisateur reconnaît sur son téléphone
  assert.equal(formatCivPhone('0700000000'), '+225 07 00 00 00 00');
  // une longueur inattendue est renvoyée telle quelle plutôt que tronquée
  assert.equal(formatCivPhone('+2250700'), '+2250700');
});