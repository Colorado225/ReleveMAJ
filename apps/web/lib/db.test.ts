// Tests de la résilience du pool de connexions (Neon + PgBouncer).
//
// Le symptôme observé en développement était :
//   `prisma.user.findUnique()` → `Server has closed the connection.` (P1017)
// Le pooler Neon ferme les connexions inactives ; il faut savoir distinguer cette
// panne de connexion d'une vraie erreur de requête, sinon on masque des bugs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { isRetryableConnectionError, withConnectionRetry } from './db';

/** Reproduit une erreur Prisma avec un code donné. */
function prismaError(code: string, message = 'boom'): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '6.0.0',
  });
}

test('P1017 « Server has closed the connection » est rejouable', () => {
  assert.equal(isRetryableConnectionError(prismaError('P1017')), true);
});

test('P1001, P2024 et P2028 (connexion inatteignable / pool saturé) sont rejouables', () => {
  for (const code of ['P1001', 'P2024', 'P2028']) {
    assert.equal(isRetryableConnectionError(prismaError(code)), true, code);
  }
});

test('une erreur réseau sans code Prisma est reconnue par son message', () => {
  assert.equal(
    isRetryableConnectionError(new Error('Server has closed the connection.')),
    true,
  );
  assert.equal(isRetryableConnectionError(new Error('read ECONNRESET')), true);
  assert.equal(
    isRetryableConnectionError(new Error('terminating connection due to administrator command')),
    true,
  );
});

test('une contrainte violée n’est PAS rejouable : la rejouer ne servirait à rien', () => {
  assert.equal(isRetryableConnectionError(prismaError('P2002', 'Unique constraint failed')), false);
  assert.equal(isRetryableConnectionError(prismaError('P2025', 'Record to update not found')), false);
  assert.equal(isRetryableConnectionError(new Error('Données invalides.')), false);
});

test('un rejet n’est jamais rejoué (une action ne double pas ses effets)', async () => {
  let calls = 0;
  await assert.rejects(
    withConnectionRetry(async () => {
      calls += 1;
      throw new Error('Données invalides.');
    }),
    /Données invalides/,
  );
  assert.equal(calls, 1, 'une erreur non rejouable ne doit être tentée qu’une fois');
});

test('une connexion morte est rejouée puis réussit', async () => {
  let calls = 0;
  const result = await withConnectionRetry(async () => {
    calls += 1;
    if (calls < 3) throw prismaError('P1017');
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 3, 'deux échecs puis une réussite');
});

test('au bout de 3 tentatives l’erreur remonte : on ne boucle pas à l’infini', async () => {
  let calls = 0;
  await assert.rejects(
    withConnectionRetry(async () => {
      calls += 1;
      throw prismaError('P1017');
    }),
    (error: Prisma.PrismaClientKnownRequestError) => error.code === 'P1017',
  );
  assert.equal(calls, 3);
});

test('une requête qui réussit n’est tentée qu’une fois', async () => {
  let calls = 0;
  const value = await withConnectionRetry(async () => {
    calls += 1;
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(calls, 1);
});