// Tests de la validation Zod — flow.md §52 (cas d'erreur) et §53.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCivPhone, isCivPhoneComplete, normalizeCivPhone } from './phone';
import {
  budgetSchema,
  createApplianceSchema,
  createMeterSchema,
  createPropertySchema,
  createPurchaseSchema,
  createReadingSchema,
  createWaterBillSchema,
  requestOtpSchema,
  updateApplianceSchema,
  updateBudgetSchema,
  updateProfileSchema,
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
// ---------- Appareils (flow.md §32) ----------
test('appareil : la modification refuse un rattachement de logement', () => {
  // Le rattachement détermine le périmètre de l'estimation du logement : le
  // déplacer depuis le formulaire de modification serait une faute de données.
  const r = updateApplianceSchema.safeParse({
    propertyId: 'logement-1',
    type: 'AC',
    label: 'Climatisation',
    powerWatts: 1200,
    hoursPerDay: 6,
    daysPerMonth: 30,
  });
  assert.equal(r.success, true);
  // Zod retire les clés inconnues : `propertyId` n'est pas retenu.
  assert.equal('propertyId' in r.data!, false);
});

test('appareil : les bornes de durée restent celles de la création', () => {
  const base = { type: 'TV', label: 'Téléviseur', powerWatts: 100, hoursPerDay: 4, daysPerMonth: 30 };
  assert.equal(updateApplianceSchema.safeParse({ ...base, hoursPerDay: 25 }).success, false);
  assert.equal(updateApplianceSchema.safeParse({ ...base, daysPerMonth: 32 }).success, false);
  assert.equal(updateApplianceSchema.safeParse({ ...base, powerWatts: 0 }).success, false);
  assert.equal(updateApplianceSchema.safeParse(base).success, true);
});

// ---------- Budgets (flow.md §24 et §30) ----------
test('budget : les trois postes du ménage sont acceptés', () => {
  for (const category of ['ELECTRICITY', 'WATER', 'WASTE']) {
    const r = budgetSchema.safeParse({ propertyId: 'p1', category, monthlyAmount: 35_000 });
    assert.equal(r.success, true, category);
  }
});

test('budget : une catégorie libre est refusée', () => {
  // Une catégorie hors liste fermée produirait des budgets non additionnables.
  const r = budgetSchema.safeParse({ propertyId: 'p1', category: 'CARBURANT', monthlyAmount: 10_000 });
  assert.equal(r.success, false);
  assert.match(issueOf(r), /Catégorie de budget inconnue/);
});

test('budget : montant négatif ou aberrant refusé', () => {
  assert.equal(
    budgetSchema.safeParse({ propertyId: 'p1', category: 'WATER', monthlyAmount: -1 }).success,
    false,
  );
  // Un budget à 100 000 000 FCFA est un oubli de saisie, pas un objectif.
  assert.equal(
    budgetSchema.safeParse({ propertyId: 'p1', category: 'WATER', monthlyAmount: 100_000_000 }).success,
    false,
  );
});

test('budget : un budget de 0 FCFA est accepté (enveloppe suspendue)', () => {
  assert.equal(budgetSchema.safeParse({ propertyId: 'p1', category: 'WASTE', monthlyAmount: 0 }).success, true);
});

test('budget : la modification ne porte que sur le montant', () => {
  // La catégorie EST le budget : la changer via PATCH réécrirait l'historique.
  const r = updateBudgetSchema.safeParse({ monthlyAmount: 40_000 });
  assert.equal(r.success, true);
  assert.deepEqual(Object.keys(r.data!).sort(), ['monthlyAmount']);

  const avecCategorie = updateBudgetSchema.safeParse({ monthlyAmount: 40_000, category: 'WATER' });
  assert.equal('category' in avecCategorie.data!, false);
  // Ni logement : un budget reste attaché à son logement d'origine.
  assert.equal('propertyId' in avecCategorie.data!, false);
});

// ---------- Profil (flow.md §38) ----------
test('profil : prénom et nom sont acceptés, champ vide compris', () => {
  assert.equal(updateProfileSchema.safeParse({ firstName: 'Awa', lastName: 'Koffi' }).success, true);
  // Un champ effacé est envoyé vide : l'action le transforme en null.
  assert.equal(updateProfileSchema.safeParse({ firstName: '', lastName: '' }).success, true);
});

test('profil : le téléphone et le palier ne sont pas modifiables', () => {
  const r = updateProfileSchema.safeParse({ phone: '+2250700000001', plan: 'PREMIUM' });
  assert.equal(r.success, true);
  // Zod retire les clés inconnues : ni le téléphone ni le palier ne sont acceptés.
  assert.equal('phone' in r.data!, false);
  assert.equal('plan' in r.data!, false);
});

test('profil : un prénom absurdement long est refusé', () => {
  assert.equal(updateProfileSchema.safeParse({ firstName: 'a'.repeat(200) }).success, false);
});
});