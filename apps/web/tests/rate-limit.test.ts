// Test de concurrence du rate limiter — flow.md §40.
//
// Régression : la version lecture-puis-écriture laissait passer deux requêtes
// simultanées au-delà de la limite. Sur une protection anti-force brute sur les
// codes OTP, cela doublait la limite effective.
//
// Ce test doit rester : il vérifie une propriété qui ne se voit pas en
// exécutant les requêtes l'une après l'autre.

import test, { before } from 'node:test';
import assert from 'node:assert/strict';

import { prepareTestDatabase, resetTestData } from './setup';
import { db } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

const WINDOW = 60_000;

before(async () => {
  prepareTestDatabase();
  await resetTestData(db);
});

test('rate limit · requêtes séquentielles : exactement la limite', async () => {
  const key = `seq-${Date.now()}`;
  const LIMIT = 5;

  // Type explicite : un `[]` nu serait inféré `any[]`, masquant toute erreur
  // sur la forme du retour de `checkRateLimit`.
  type RateLimitResult = Awaited<ReturnType<typeof checkRateLimit>>;
  const results: RateLimitResult[] = [];
  for (let i = 0; i < LIMIT + 3; i += 1) {
    results.push(await checkRateLimit(key, LIMIT, WINDOW));
  }

  const allowed = results.filter((r) => r.allowed).length;
  assert.equal(allowed, LIMIT, 'le nombre de requêtes autorisées doit être exactement la limite');
});

test('rate limit · 30 requêtes SIMULTANÉES : la limite ne cède pas', async () => {
  const key = `burst-${Date.now()}`;
  const LIMIT = 5;

  // Promise.all lance les 30 vérifications en même temps : c'est exactement le
  // scénario qui échouait avant la correction.
  const results = await Promise.all(
    Array.from({ length: 30 }, () => checkRateLimit(key, LIMIT, WINDOW)),
  );

  const allowed = results.filter((r) => r.allowed).length;
  assert.ok(
    allowed <= LIMIT,
    `la limite a cédé sous concurrence : ${allowed} autorisées pour une limite de ${LIMIT}`,
  );
});

test('rate limit · fenêtre expirée : le compteur repart à zéro', async () => {
  const key = `fenetre-${Date.now()}`;
  // Fenêtre longue : elle doit rester VALIDE pendant les trois appels, sinon on
  // testerait la latence de la base et non le rate limiter.
  const WINDOW_LONGUE = 3_600_000;

  await checkRateLimit(key, 2, WINDOW_LONGUE);
  await checkRateLimit(key, 2, WINDOW_LONGUE);
  const bloque = await checkRateLimit(key, 2, WINDOW_LONGUE);
  assert.equal(bloque.allowed, false);

  // L'expiration est SIMULÉE en base plutôt qu'attendue : un `setTimeout`
  // serait noyé dans la latence (2 à 15 s par requête vers la base distante),
  // et le test deviendrait vert ou rouge selon la machine.
  // On recule `windowStart` de plus d'une fenêtre : c'est exactement l'état que
  // la base présenterait une heure plus tard.
  await db.rateLimit.updateMany({
    where: { key },
    data: { windowStart: new Date(Date.now() - WINDOW_LONGUE - 1_000) },
  });

  const apres = await checkRateLimit(key, 2, WINDOW_LONGUE);
  assert.equal(apres.allowed, true);
});

test('rate limit · clés indépendantes ne se gênent pas', async () => {
  const LIMIT = 2;
  const a = `a-${Date.now()}`;
  const b = `b-${Date.now()}`;

  await checkRateLimit(a, LIMIT, WINDOW);
  await checkRateLimit(a, LIMIT, WINDOW);
  assert.equal((await checkRateLimit(a, LIMIT, WINDOW)).allowed, false);

  // une autre clé n'est pas pénalisée
  assert.equal((await checkRateLimit(b, LIMIT, WINDOW)).allowed, true);
});