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

  // 3 sur une fenêtre de 100 ms
  await checkRateLimit(key, 2, 100);
  await checkRateLimit(key, 2, 100);
  const bloque = await checkRateLimit(key, 2, 100);
  assert.equal(bloque.allowed, false);

  // après expiration, la requête doit repasser
  await new Promise((r) => setTimeout(r, 150));
  const apres = await checkRateLimit(key, 2, 100);
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