// Tests de projection — flow.md §29 et §53.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectionInput } from './services';

const DAY = 86_400_000;
const now = new Date('2026-03-10T12:00:00.000Z');

test('projection : historique suffisant → rythme journalier calculé', () => {
  const purchases = [
    { purchasedAt: new Date(now.getTime() - 60 * DAY), amountPaid: 30_000 },
    { purchasedAt: new Date(now.getTime() - 20 * DAY), amountPaid: 20_000 },
  ];
  const r = projectionInput(purchases, now);
  assert.equal(r.reliable, true);
  // 50 000 FCFA observés sur 61 jours
  assert.ok(r.amountPerDay != null && r.amountPerDay > 700 && r.amountPerDay < 900, `rythme inattendu : ${r.amountPerDay}`);
  assert.equal(r.observedSpend, 50_000);
});
test('projection : l’ordre des recharges n’influence PAS le résultat', () => {
  // Régression : le tableau de bord charge les recharges en `desc` pour borner
  // le volume. Le calcul prenait `observed[0]`, donc la date la PLUS RÉCENTE :
  // `observedDays` tombait à 1 et la projection disparaissait silencieusement.
  // Le même compte, dans l'autre ordre, doit donner exactement le même rythme.
  const asc = [
    { purchasedAt: new Date(now.getTime() - 60 * DAY), amountPaid: 30_000 },
    { purchasedAt: new Date(now.getTime() - 20 * DAY), amountPaid: 20_000 },
  ];
  const desc = [...asc].reverse();

  const fromAsc = projectionInput(asc, now);
  const fromDesc = projectionInput(desc, now);

  assert.equal(fromAsc.reliable, true);
  assert.equal(fromDesc.reliable, true, 'l’ordre décroissant ne doit pas casser la projection');
  assert.equal(fromDesc.amountPerDay, fromAsc.amountPerDay);
  assert.equal(fromDesc.observedDays, fromAsc.observedDays);
  assert.equal(fromDesc.observedSpend, fromAsc.observedSpend);
});

test('projection : historique trop court → AUCUNE projection (jamais de faux chiffre)', () => {
  // une seule recharge d'aujourd'hui : on refuse de projeter
  const r = projectionInput([{ purchasedAt: now, amountPaid: 10_000 }], now);
  assert.equal(r.reliable, false);
  assert.equal(r.amountPerDay, null);
});

test('projection : deux recharges du jour ne suffisent pas', () => {
  const r = projectionInput(
    [
      { purchasedAt: now, amountPaid: 5_000 },
      { purchasedAt: now, amountPaid: 5_000 },
    ],
    now,
  );
  assert.equal(r.reliable, false);
  assert.equal(r.amountPerDay, null);
});

test('projection : aucun historique → aucun rythme', () => {
  const r = projectionInput([], now);
  assert.equal(r.reliable, false);
  assert.equal(r.amountPerDay, null);
  assert.equal(r.observedDays, 0);
});

test('projection : jours restants dans le mois courant', () => {
  // mars 2026 → 31 jours ; le 10, il reste 21 jours
  const r = projectionInput([], now);
  assert.equal(r.remainingDays, 21);
});

test('projection : les recharges hors fenêtre de 90 jours sont ignorées', () => {
  const purchases = [
    { purchasedAt: new Date(now.getTime() - 200 * DAY), amountPaid: 500_000 },
    { purchasedAt: new Date(now.getTime() - 30 * DAY), amountPaid: 10_000 },
    { purchasedAt: new Date(now.getTime() - 10 * DAY), amountPaid: 10_000 },
  ];
  const r = projectionInput(purchases, now);
  assert.equal(r.observedSpend, 20_000);
  assert.equal(r.reliable, true);
});

test('projection : dernier jour du mois → 0 jour restant, sans division par zéro', () => {
  const lastDay = new Date('2026-03-31T23:00:00.000Z');
  const r = projectionInput([{ purchasedAt: lastDay, amountPaid: 1_000 }], lastDay);
  assert.equal(r.remainingDays, 0);
  assert.equal(Number.isFinite(r.amountPerDay ?? 0), true);
});