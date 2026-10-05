// Tests de CONCURRENCE — flow.md §40 (sécurité) et §53.
//
// Chaque test reproduit une course qui existait réellement avant ces
// corrections. Ils ne vérifient pas un cas théorique : sans la correction,
// ils échouent.
//
// Les requêtes partent SIMULTANÉMENT (`Promise.all`) sur la même base. C'est
// la seule façon de démontrer qu'un verrou tient : en séquentiel, le second
// appel verrait simplement l'état laissé par le premier.

import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { prepareTestDatabase, resetTestData, seedTariffs } from './setup';
import { db } from '@/lib/db';
import { signAccessToken } from '@/lib/auth-core';
import { checkRateLimit } from '@/lib/rate-limit';
import { createWithinQuota, QuotaExceeded } from '@/lib/plans';
import { issueSession, rotateSession } from '@/lib/sessions';

let seq = 0;
async function newUser(): Promise<{ id: string; phone: string; token: string }> {
  seq += 1;
  const user = await db.user.create({ data: { phone: `+22507${String(seq).padStart(8, '0')}` } });
  const t = await signAccessToken({ id: user.id, phone: user.phone, firstName: null });
  return { id: user.id, phone: user.phone, token: t };
}

before(async () => {
  prepareTestDatabase();
  await resetTestData(db);
  await seedTariffs(db);
});

after(async () => {
  await db.$disconnect();
});
// ---------- Quotas : deux créations simultanées (flow.md §47) ----------

test('concurrence · 3 logements demandés en même temps sur un compte FREE : 1 seul créé', async () => {
  const user = await newUser();

  const resultats = await Promise.all(
    Array.from({ length: 3 }, () =>
      createWithinQuota({
        userId: user.id,
        plan: 'FREE',
        quota: 'properties',
        create: (tx) => tx.property.create({ data: { name: 'Villa', userId: user.id } }),
      }),
    ),
  );

  const crees = resultats.filter((r) => r.ok).length;

  // Sans verrou : les trois lisaient « 0 logement » et les trois passaient.
  assert.equal(crees, 1, 'la limite FREE de 1 logement ne doit pas céder');
  assert.equal(resultats.filter((r) => !r.ok).length, 2);
  assert.equal(await db.property.count({ where: { userId: user.id } }), 1);
});

test('concurrence · compteurs demandés en même temps sur un compte FREE : 2 seuls créés', async () => {
  const user = await newUser();
  const property = await db.property.create({ data: { name: 'Villa', userId: user.id } });

  const resultats = await Promise.all(
    Array.from({ length: 5 }, () =>
      createWithinQuota({
        userId: user.id,
        plan: 'FREE',
        quota: 'meters',
        create: (tx) =>
          tx.meter.create({
            data: { propertyId: property.id, provider: 'CIE', utilityType: 'ELECTRICITY', unit: 'KWH' },
          }),
      }),
    ),
  );

  const crees = resultats.filter((r) => r.ok).length;
  assert.equal(crees, 2, 'la limite FREE de 2 compteurs ne doit pas céder');
  assert.equal(await db.meter.count({ where: { property: { userId: user.id } } }), 2);
});

test('concurrence · le refus porte un message lisible, pas une exception', async () => {
  const user = await newUser();
  await db.property.create({ data: { name: 'Déjà là', userId: user.id } });

  const resultat = await createWithinQuota({
    userId: user.id,
    plan: 'FREE',
    quota: 'properties',
    create: (tx) => tx.property.create({ data: { name: 'Villa', userId: user.id } }),
  });

  assert.equal(resultat.ok, false);
  if (resultat.ok) return;
  assert.match(resultat.message, /Premium/);
});

test('concurrence · Premium n’est jamais bloqué, même en parallèle', async () => {
  const user = await newUser();
  const resultats = await Promise.all(
    Array.from({ length: 6 }, () =>
      createWithinQuota({
        userId: user.id,
        plan: 'PREMIUM',
        quota: 'properties',
        create: (tx) => tx.property.create({ data: { name: 'Villa', userId: user.id } }),
      }),
    ),
  );
  assert.equal(resultats.filter((r) => r.ok).length, 6);
  assert.equal(await db.property.count({ where: { userId: user.id } }), 6);
});

test('concurrence · QuotaExceeded est une exception, pas un refus silencieux', async () => {
  // Le rollback doit être déclenché par une exception : c'est ce qui empêche
  // une création déjà effectuée dans la transaction de survivre au refus.
  assert.ok(new QuotaExceeded('refusé') instanceof Error);
  assert.equal(new QuotaExceeded('refusé').name, 'QuotaExceeded');
});

// ---------- Rate limiter : réinitialisation de fenêtre (flow.md §40) ----------

test('concurrence · fenêtre expirée : le compteur repart à 1 puis progresse', async () => {
  const key = `course-fenetre-${Date.now()}`;
  const FENETRE = 5000;
  const LIMITE = 3;

  await checkRateLimit(key, LIMITE, FENETRE);
  await db.rateLimit.updateMany({
    where: { key },
    data: { windowStart: new Date(Date.now() - FENETRE - 1000) },
  });

  // 10 requêtes simultanées sur une fenêtre expirée.
  const resultats = await Promise.all(
    Array.from({ length: 10 }, () => checkRateLimit(key, LIMITE, FENETRE)),
  );

  const autorisees = resultats.filter((r) => r.allowed).length;

  // Le bug d'origine : chaque requête concurrente constatait « fenêtre expirée »
  // et remettait count = 1. Les 10 étaient alors autorisées, et le compteur
  // finissait à 1 au lieu de 10.
  assert.equal(autorisees, LIMITE, `exactement ${LIMITE} requêtes doivent passer, pas ${autorisees}`);
  assert.equal(
    (await db.rateLimit.findUnique({ where: { key } }))?.count,
    10,
    'chaque requête doit être comptée, même celles qui sont refusées',
  );
});

beforeEach(async () => {
  await db.alert.deleteMany();
  await db.otpChallenge.deleteMany();
});

// ---------- Refresh token : rotation (flow.md §40) ----------

test('concurrence · un même refresh token ne produit qu’UNE rotation', async () => {
  const user = await newUser();
  const initiale = await issueSession({ id: user.id, phone: user.phone, firstName: null });
  const refreshToken = initiale.refreshToken;

  // 4 rafraîchissements simultanés du MÊME jeton.
  const resultats = await Promise.all(
    Array.from({ length: 4 }, () => rotateSession(refreshToken, { ip: '10.0.0.1' })),
  );

  const succes = resultats.filter((r) => r.ok).length;

  // Sans la mise à jour conditionnelle, chaque requête voyait `revokedAt = null`
  // et émettait son propre couple : plusieurs rotations valides issues du MÊME
  // jeton, et la détection de vol ne servait plus à rien.
  assert.equal(succes, 1, `un jeton ne doit donner qu'une rotation, obtenue ${succes} fois`);

  // Les doublons sont écartés SANS sanction : une double-clic ou deux onglets
  // qui rafraîchissent en parallèle doivent déconnecter personne.
  const ecartes = resultats.filter((r) => !r.ok).length;
  assert.equal(ecartes, 3, 'les doublons concurrents doivent être refusés');

  // Une seule session active : le compte n'a pas été « déconnecté » par erreur.
  const actives = await db.session.count({ where: { userId: user.id, revokedAt: null } });
  assert.equal(actives, 1, 'la rotation gagnante doit rester utilisable');
});

test('concurrence · un rejeu APRÈS rotation est détecté comme réutilisation', async () => {
  // C'est la VRAIE détection de vol, distincte de la course ci-dessus : le
  // jeton est rejoué alors qu'il est durablement révoqué.
  const user = await newUser();
  const initiale = await issueSession({ id: user.id, phone: user.phone, firstName: null });

  const rotation = await rotateSession(initiale.refreshToken, { ip: '10.0.0.1' });
  assert.equal(rotation.ok, true);

  // Rejeu du jeton périmé, bien plus tard.
  const rejeu = await rotateSession(initiale.refreshToken, { ip: '10.0.0.9' });
  assert.equal(rejeu.ok, false);
  if (!rejeu.ok) assert.equal(rejeu.reason, 'REUSE_DETECTED');

  // La détection révoque TOUTES les sessions, y compris la rotation légitime.
  const actives = await db.session.count({ where: { userId: user.id, revokedAt: null } });
  assert.equal(actives, 0);
});

test('concurrence · la réutilisation détectée révoque TOUTES les sessions du compte', async () => {
  const user = await newUser();
  const payload = { id: user.id, phone: user.phone, firstName: null };

  const premiere = await issueSession(payload);
  await issueSession(payload);
  assert.equal(
    await db.session.count({ where: { userId: user.id, revokedAt: null } }),
    2,
    'deux sessions ouvertes',
  );

  // Rotation normale de la première, puis rejeu de son jeton : compromission.
  const rotation = await rotateSession(premiere.refreshToken, { ip: '10.0.0.1' });
  assert.equal(rotation.ok, true);

  const rejeu = await rotateSession(premiere.refreshToken, { ip: '10.0.0.9' });
  assert.equal(rejeu.ok, false);
  if (!rejeu.ok) assert.equal(rejeu.reason, 'REUSE_DETECTED');

  // Toutes les sessions du compte sont révoquées, y compris celle de la
  // rotation et la seconde ouverte au départ.
  const restantes = await db.session.count({ where: { userId: user.id, revokedAt: null } });
  assert.equal(restantes, 0, 'la détection de vol doit fermer toutes les sessions');
});

test('concurrence · un jeton expiré est refusé sans créer de session', async () => {
  const user = await newUser();
  const paire = await issueSession({ id: user.id, phone: user.phone, firstName: null });

  await db.session.updateMany({
    where: { userId: user.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const avant = await db.session.count({ where: { userId: user.id } });
  const resultat = await rotateSession(paire.refreshToken, { ip: '10.0.0.1' });

  assert.equal(resultat.ok, false);
  if (!resultat.ok) assert.equal(resultat.reason, 'EXPIRED');
  assert.equal(
    await db.session.count({ where: { userId: user.id } }),
    avant,
    'aucune session ne doit être créée pour un jeton expiré',
  );
});