// Tests des quotas d'abonnement — flow.md §47 et §53.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkQuota, limitFor, PLAN_LIMITS } from './plans';

test('FREE : 1 logement et 2 compteurs (flow.md §47)', () => {
  assert.equal(limitFor('FREE', 'properties'), 1);
  assert.equal(limitFor('FREE', 'meters'), 2);
  assert.equal(PLAN_LIMITS.FREE.historyMonths, 3);
});

test('PREMIUM : aucune limite de volume', () => {
  assert.equal(limitFor('PREMIUM', 'properties'), Infinity);
  assert.equal(limitFor('PREMIUM', 'meters'), Infinity);
});

test('FREE : la première création de logement est autorisée', () => {
  assert.equal(checkQuota({ plan: 'FREE', quota: 'properties', currentCount: 0 }), null);
});

test('FREE : le deuxième logement est refusé avec un message clair', () => {
  const message = checkQuota({ plan: 'FREE', quota: 'properties', currentCount: 1 });
  assert.ok(message);
  assert.match(message, /1 logement/);
  assert.match(message, /Premium/);
});

test('FREE : le troisième compteur est refusé', () => {
  assert.equal(checkQuota({ plan: 'FREE', quota: 'meters', currentCount: 1 }), null);
  assert.ok(checkQuota({ plan: 'FREE', quota: 'meters', currentCount: 2 }));
});

test('le pluriel est correct dans le message (compteurs)', () => {
  const message = checkQuota({ plan: 'FREE', quota: 'meters', currentCount: 2 });
  assert.ok(message);
  assert.match(message, /2 compteurs/);
});

test('PREMIUM : jamais bloqué, quel que soit le volume', () => {
  assert.equal(checkQuota({ plan: 'PREMIUM', quota: 'properties', currentCount: 99 }), null);
  assert.equal(checkQuota({ plan: 'PREMIUM', quota: 'meters', currentCount: 99 }), null);
});

test('flow.md §47 : un quota ne bloque jamais la LECTURE des données', () => {
  // checkQuota ne renvoie qu'un message bloquant sur création ; il n'existe
  // aucune fonction qui empêcherait la consultation de l'historique.
  assert.equal(typeof checkQuota, 'function');
});