import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecommendations,
  calculate,
  calculateBaseline,
  calculateConsumption,
  calculateMonthlyProjection,
  calculateTrend,
  CIE_DOMESTIC_GENERAL_5A,
  CIE_DOMESTIC_SOCIAL_5A,
  CIE_SCHEMES,
  detectAnomaly,
  estimateApplianceKwh,
  estimateAppliances,
  generateAlerts,
  labelElectricityKwh,
  resolveTariff,
  reverseEstimate,
  round2,
  validateEligibility,
} from './index';

// ---------- Eau : 139.8 - 124.3 = 15.5 (flow.md §53) ----------
test('eau : 139.8 - 124.3 = 15.5 m³', () => {
  const r = calculateConsumption({
    previous: 124.3,
    current: 139.8,
    start: new Date('2026-01-01'),
    end: new Date('2026-01-31'),
  });
  assert.equal(r.quantity, 15.5);
  assert.equal(r.dailyAverage, 0.52);
  assert.equal(r.anomaly, false);
});

// ---------- Anomalie : nouvel index < ancien (flow.md §21 et §53) ----------
test('anomalie : index décroissant conservé et signalé, jamais corrigé', () => {
  const r = calculateConsumption({
    previous: 139.8,
    current: 120,
    start: new Date('2026-01-01'),
    end: new Date('2026-02-01'),
  });
  assert.equal(r.anomaly, true);
  assert.equal(r.anomalyReason, 'INDEX_DECREASED');
  assert.equal(r.quantity, 0);
});

// ---------- Tarification : tarif social 5A ----------
test('tarif social : seuil explicite à 80 kWh, deux tranches et taxes', () => {
  const r = calculate(100, CIE_DOMESTIC_SOCIAL_5A, { abidjan: true });
  assert.equal(r.thresholdKwh, 80);
  assert.equal(r.tier1Kwh, 80);
  assert.equal(r.tier2Kwh, 20);
  assert.equal(r.fixedTtc, 614.9);
  assert.equal(r.energyTtc, 80 * 31.72 + 20 * 65.11);
  // 100 (rural fixe) + 100 × (1 + 2 + 2.5)
  assert.equal(r.taxesTtc, 100 + 550);
  assert.equal(r.totalTtc, r.energyTtc + r.taxesTtc + r.fixedTtc);
});

test('tarif social : baisse du coût unitaire hors Abidjan', () => {
  const abidjan = calculate(100, CIE_DOMESTIC_SOCIAL_5A, { abidjan: true });
  const other = calculate(100, CIE_DOMESTIC_SOCIAL_5A, { abidjan: false });
  assert.equal(abidjan.taxesTtc - other.taxesTtc, 150);
});

// ---------- Tarification : domestique général 5A ----------
test('tarif général : seuil dérivé = 180 × (5 × 0.22) = 198 kWh', () => {
  const r = calculate(100, CIE_DOMESTIC_GENERAL_5A, { abidjan: true });
  assert.equal(r.thresholdKwh, 198);
  assert.equal(r.tier1Kwh, 100);
  assert.equal(r.tier2Kwh, 0);
  assert.equal(r.fixedTtc, 1618.04);
  assert.equal(r.energyTtc, 100 * 86.92);
});

test('tarif général : le seuil dépend de la puissance souscrite', () => {
  const r = calculate(100, CIE_DOMESTIC_GENERAL_5A, { subscribedPower: 10, abidjan: true });
  assert.equal(r.thresholdKwh, 396);
});

// ---------- reverseEstimate ----------
test('reverseEstimate : retrouve le kWh ayant produit ce montant', () => {
  const bill = calculate(150, CIE_DOMESTIC_SOCIAL_5A, { abidjan: true });
  const back = reverseEstimate(bill.totalTtc, CIE_DOMESTIC_SOCIAL_5A, { abidjan: true });
  assert.ok(Math.abs(back.kwh - 150) < 0.05, `attendu ~150, obtenu ${back.kwh}`);
  assert.equal(back.confidence, 'LOW');
  assert.equal(back.status, 'ESTIMATE');
});

test('reverseEstimate : montant nul ou négatif → 0 kWh', () => {
  assert.equal(reverseEstimate(0, CIE_DOMESTIC_SOCIAL_5A).kwh, 0);
  assert.equal(reverseEstimate(-100, CIE_DOMESTIC_SOCIAL_5A).kwh, 0);
});

// ---------- resolveTariff ----------
test('resolveTariff : la grille ne dépend pas du mode de paiement', () => {
  const s = resolveTariff(CIE_SCHEMES, { category: 'DOMESTIC_SOCIAL', at: '2026-01-01' });
  assert.equal(s?.code, 'CIE-DOM-SOCIAL-5A');
});

test('resolveTariff : grille future ignorée et version récente gagnante', () => {
  const future = { ...CIE_DOMESTIC_SOCIAL_5A, code: 'FUTUR', effectiveFrom: '2030-01-01' };
  const s1 = resolveTariff([future, CIE_DOMESTIC_SOCIAL_5A], {
    category: 'DOMESTIC_SOCIAL',
    at: '2026-01-01',
  });
  assert.equal(s1?.code, 'CIE-DOM-SOCIAL-5A');
  const v2 = { ...CIE_DOMESTIC_SOCIAL_5A, version: 2, effectiveFrom: '2025-01-01' };
  const s2 = resolveTariff([CIE_DOMESTIC_SOCIAL_5A, v2], {
    category: 'DOMESTIC_SOCIAL',
    at: '2026-01-01',
  });
  assert.equal(s2?.version, 2);
});
// ---------- Éligibilité (flow.md §17) ----------
test('éligibilité : historique sous le seuil', () => {
  const r = validateEligibility(CIE_DOMESTIC_SOCIAL_5A, {
    subscribedPower: 5,
    usageType: 'DOMESTIC',
    averageMonthlyConsumption: 30,
    observationDays: 120,
  });
  assert.equal(r.status, 'ELIGIBLE');
  assert.equal(r.thresholdKwh, 80);
});

test('éligibilité : ne jamais affirmer un changement officiel de tarif', () => {
  const r = validateEligibility(CIE_DOMESTIC_SOCIAL_5A, {
    subscribedPower: 5,
    usageType: 'DOMESTIC',
    averageMonthlyConsumption: 90,
    observationDays: 120,
  });
  assert.equal(r.status, 'ABOVE_THRESHOLD');
  assert.match(r.message, /Vérifiez votre situation auprès de CIE\./);
  assert.doesNotMatch(r.message, /officiellement/i);
  assert.doesNotMatch(r.message, /vous avez chang/i);
});

test('éligibilité : historique insuffisant', () => {
  const r = validateEligibility(CIE_DOMESTIC_SOCIAL_5A, {
    subscribedPower: 5,
    usageType: 'DOMESTIC',
    averageMonthlyConsumption: 30,
    observationDays: 10,
  });
  assert.equal(r.status, 'INSUFFICIENT_DATA');
});

// ---------- Projection (flow.md §29) ----------
test('projection : moyenne journalière × jours restants', () => {
  const p = calculateMonthlyProjection({ dailyAverage: 10, days: 30 });
  assert.equal(p.projectedQuantity, 300);
  assert.equal(p.status, 'FORECAST');
  assert.match(p.caveat, /Projection/);
  assert.equal(calculateMonthlyProjection({ dailyAverage: 10 }).projectedAmount, null);
  assert.equal(calculateMonthlyProjection({ dailyAverage: 10, amountPerDay: 500 }).projectedAmount, 15000);
});

// ---------- Tendance, baseline, anomalie ----------
test('trend et baseline', () => {
  assert.equal(calculateTrend(110, 100), 10);
  assert.equal(calculateTrend(10, 0), null);
  assert.equal(calculateBaseline([10, 20, 30]), 20);
  assert.equal(calculateBaseline([]), 0);
});

test('détection d’anomalie : seuil relatif à 1,5×', () => {
  assert.equal(detectAnomaly({ value: 20, baseline: 10 }).anomaly, true);
  assert.equal(detectAnomaly({ value: 12, baseline: 10 }).anomaly, false);
});

// ---------- Appareils (flow.md §32 et §53) ----------
test('appareil : AC 1200 W × 6 h × 30 j = 216 kWh/mois', () => {
  const kwh = estimateApplianceKwh({
    type: 'AC',
    label: 'Climatisation salon',
    powerWatts: 1200,
    hoursPerDay: 6,
    daysPerMonth: 30,
  });
  assert.equal(kwh, 216);
});

test('appareil : cumuls sur 12 jours/mois', () => {
  const kwh = estimateApplianceKwh({
    type: 'WashingMachine',
    label: 'Machine à laver',
    powerWatts: 500,
    hoursPerDay: 1.5,
    daysPerMonth: 12,
  });
  assert.equal(kwh, 9);
});

test('appareils : triés par consommation estimée décroissante', () => {
  const rows = estimateAppliances([
    { id: 'a', type: 'Fridge', label: 'Réfrigérateur', powerWatts: 150, hoursPerDay: 10, daysPerMonth: 30 },
    { id: 'b', type: 'AC', label: 'Climatisation', powerWatts: 1200, hoursPerDay: 6, daysPerMonth: 30 },
    { id: 'c', type: 'TV', label: 'Télévision', powerWatts: 100, hoursPerDay: 5, daysPerMonth: 30 },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c']);
  assert.equal(rows[0].monthlyKwh, 216);
});

test('appareils : les parts sommées font 100 %', () => {
  const rows = estimateAppliances([
    { id: 'a', type: 'Fridge', label: 'F', powerWatts: 150, hoursPerDay: 10, daysPerMonth: 30 },
    { id: 'b', type: 'AC', label: 'A', powerWatts: 1200, hoursPerDay: 6, daysPerMonth: 30 },
  ]);
  const sum = round2(rows.reduce((s, r) => s + r.sharePercent, 0));
  assert.equal(sum, 100);
});

test('appareils : le coût utilise le coût effectif observé, sinon null', () => {
  const appliances = [
    { id: 'a', type: 'AC' as const, label: 'A', powerWatts: 1200, hoursPerDay: 6, daysPerMonth: 30 },
  ];
  // flow.md §18 — coût effectif observé, jamais un prix réglementaire inventé
  const withCost = estimateAppliances(appliances, { costPerKwh: 138.12 });
  assert.equal(withCost[0].monthlyCostTtc, round2(216 * 138.12));

  const withoutCost = estimateAppliances(appliances, { costPerKwh: null });
  assert.equal(withoutCost[0].monthlyCostTtc, null);
});

test('appareils : toujours marqués ESTIMATION, jamais comme une mesure', () => {
  const rows = estimateAppliances([
    { id: 'a', type: 'Fridge', label: 'F', powerWatts: 150, hoursPerDay: 10, daysPerMonth: 30 },
  ]);
  assert.equal(rows[0].status, 'ESTIMATE');
});

test('appareils : liste vide ne provoque pas de division par zéro', () => {
  const rows = estimateAppliances([]);
  assert.deepEqual(rows, []);
});

// ---------- Étiquetage réel / estimé (flow.md §1 et §51) ----------
test('kWh crédités = RÉEL, kWh estimés = ESTIMATE', () => {
  assert.equal(labelElectricityKwh({ creditedKwh: 72.4, estimatedKwh: 70 }).status, 'REAL');
  const est = labelElectricityKwh({ creditedKwh: null, estimatedKwh: 70 });
  assert.equal(est.status, 'ESTIMATE');
  assert.equal(est.confidence, 'LOW');
});

// ---------- Alertes et recommandations (flow.md §30 et §31) ----------
test('alerte fuite d’eau : formulation prudente, jamais un verdict', () => {
  const alerts = generateAlerts({
    waterPeriodQuantities: [10, 10, 10, 40],
    electricityDailyAverageHistory: [],
  });
  const leak = alerts.find((a) => a.type === 'POSSIBLE_WATER_LEAK');
  assert.ok(leak);
  assert.match(leak!.body, /Vérifiez/);
  assert.doesNotMatch(leak!.body, /Vous avez une fuite/);
});

test('alertes : index inhabituel, relevé manquant, maximum 3', () => {
  const alerts = generateAlerts({
    waterPeriodQuantities: [10, 10, 10, 60],
    indexJustDecreased: true,
    waterLastReadingDaysAgo: 90,
    electricityDailyAverageHistory: [5, 5, 20],
    budgetMonthly: 1000,
    electricitySpentThisMonth: 9000,
  });
  assert.ok(alerts.some((a) => a.type === 'INVALID_READING'));
  assert.ok(alerts.length <= 3);
});

test('alerte relevé manquant quand aucun relevé récent', () => {
  const alerts = generateAlerts({
    waterPeriodQuantities: [],
    waterLastReadingDaysAgo: 90,
    electricityDailyAverageHistory: [],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'MISSING_READING');
});

test('recommandations : maximum 3, justifiées par des données', () => {
  const recs = buildRecommendations({
    hasPurchase: true,
    hasPurchaseWithKwh: false,
    hasWaterReading: true,
    waterTrend: 40,
    electricityTrend: 30,
    alerts: [],
  });
  assert.ok(recs.length <= 3);
  assert.ok(recs.every((r) => r.basis.length > 0));
});

test('recommandations : première recharge quand aucune donnée', () => {
  const recs = buildRecommendations({
    hasPurchase: false,
    hasPurchaseWithKwh: false,
    hasWaterReading: false,
    alerts: [],
  });
  assert.equal(recs[0].id, 'first-purchase');
});
