// Tests du noyau d'authentification — flow.md §40 et §53.
// On teste le hachage, la comparaison à temps constant et les jetons,
// sans toucher à la base ni aux cookies.
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'secret-de-test-uniquement';

import test from 'node:test';
import assert from 'node:assert/strict';
import { jwtVerify } from 'jose';
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_SECONDS,
  hashOtpCode,
  hashRefreshToken,
  otpCodeMatches,
  secretKey,
  signAccessToken,
  signTokenPair,
  verifyAccessToken,
} from './auth-core';

test('OTP : le code n’est jamais stocké en clair', () => {
  const hash = hashOtpCode('+2250700000000', '123456');
  assert.notEqual(hash, '123456');
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('OTP : deux numéros distincts donnent des hachages distincts', () => {
  assert.notEqual(
    hashOtpCode('+2250700000000', '123456'),
    hashOtpCode('+2250700000001', '123456'),
  );
});

test('OTP : la correspondance est exacte', () => {
  const hash = hashOtpCode('+2250700000000', '123456');
  assert.equal(otpCodeMatches('+2250700000000', '123456', hash), true);
  assert.equal(otpCodeMatches('+2250700000000', '123457', hash), false);
  assert.equal(otpCodeMatches('+2250700000001', '123456', hash), false);
});

test('OTP : un hachage corrompu ne provoque pas de levée d’erreur', () => {
  assert.equal(otpCodeMatches('+2250700000000', '123456', 'pas-un-hachage'), false);
});

test('JWT : un jeton signé est vérifié et restitue son utilisateur', async () => {
  const user = { id: 'user_1', phone: '+2250700000000', firstName: 'Dominique' };
  const token = await signAccessToken(user);
  const verified = await verifyAccessToken(token);
  assert.deepEqual(verified, user);
});

test('JWT : un jeton falsifié est rejeté', async () => {
  const token = await signAccessToken({ id: 'user_1', phone: '+2250700000000', firstName: null });
  const tampered = `${token.slice(0, -3)}abc`;
  assert.equal(await verifyAccessToken(tampered), null);
});

test('JWT : une chaîne aléatoire est rejetée', async () => {
  assert.equal(await verifyAccessToken('pas.un.jeton'), null);
});

// ---------- Rotation de jeton (flow.md §40) ----------
test('refresh token : jamais stocké en clair, seulement son hash', () => {
  const hash = hashRefreshToken('abc-123');
  assert.notEqual(hash, 'abc-123');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashRefreshToken('abc-123'), hash); // déterministe
  assert.notEqual(hashRefreshToken('abc-124'), hash);
});

test('refresh token : hash diffère du hash OTP pour une même valeur', () => {
  assert.notEqual(hashRefreshToken('meme-valeur'), hashOtpCode('+2250700000000', 'meme-valeur'));
});

test('rotation : le couple de jetons porte deux jetons distincts', async () => {
  const user = { id: 'user_1', phone: '+2250700000000', firstName: 'Awa' };
  const pair = await signTokenPair(user);

  assert.notEqual(pair.accessToken, pair.refreshToken);
  assert.ok(pair.refreshJti.length > 10, 'le jti doit être unique et non trivial');

  // le refresh token est vérifiable et contient le jti attendu
  const { payload } = await jwtVerify(pair.refreshToken, secretKey());
  assert.equal(payload.sub, 'user_1');
  assert.equal(payload.jti, pair.refreshJti);
  assert.equal(payload.typ, 'refresh');

  // l'access token est vérifiable comme jeton d'accès
  assert.deepEqual(await verifyAccessToken(pair.accessToken), user);
});

test('rotation : deux appels produisent des jetons différents', async () => {
  const user = { id: 'user_1', phone: '+2250700000000', firstName: null };
  const a = await signTokenPair(user);
  const b = await signTokenPair(user);
  assert.notEqual(a.refreshJti, b.refreshJti);
  assert.notEqual(a.refreshToken, b.refreshToken);
});

test('rotation : un refresh token falsifié est rejeté', async () => {
  const user = { id: 'user_1', phone: '+2250700000000', firstName: null };
  const pair = await signTokenPair(user);
  const tampered = `${pair.refreshToken.slice(0, -4)}0000`;
  await assert.rejects(() => jwtVerify(tampered, secretKey()));
});

test('rotation : le refresh dure plus longtemps que l’accès (2 h)', () => {
  assert.ok(REFRESH_TOKEN_TTL_SECONDS > 7200, 'le refresh doit dépasser la durée d’accès');
  assert.equal(ACCESS_TOKEN_TTL, '2h');
});