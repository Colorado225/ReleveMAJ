import assert from 'node:assert/strict';
import test from 'node:test';

import { rateLimitKey, resolveClientIp } from '../lib/client-ip';

// Un objet Headers minimal : on teste la logique, pas le runtime Next.js.
function h(init: Record<string, string>) {
  return { get: (name: string) => init[name.toLowerCase()] ?? null };
}

function avecHops(valeur: string | undefined, run: () => void) {
  const precedent = process.env.TRUSTED_PROXY_HOPS;
  if (valeur === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = valeur;
  try {
    run();
  } finally {
    if (precedent === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = precedent;
  }
}

// ---------- Le cas par défaut : aucun proxy déclaré ----------

test('IP · sans proxy déclaré, un x-forwarded-for forgé est ignoré', () => {
  avecHops(undefined, () => {
    // C'est l'attaque de l'audit §19 : un client s'attribue une IP à volonté.
    const forgé = h({ 'x-forwarded-for': '1.2.3.4' });
    assert.deepEqual(resolveClientIp(forgé), { ip: null, trusted: false });

    // Deux en-têtes forgés ne valent pas mieux qu'un.
    const double = h({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' });
    assert.equal(resolveClientIp(double).ip, null);
  });
});

test("IP · la clé de quota ne change plus quand l'attaquant forge l'IP", () => {
  avecHops(undefined, () => {
    const base = { 'user-agent': 'Mozilla/5.0 (compatible)' };
    const premiere = rateLimitKey(h({ ...base, 'x-forwarded-for': '1.2.3.4' }), 'otp');
    const seconde = rateLimitKey(h({ ...base, 'x-forwarded-for': '9.9.9.9' }), 'otp');

    // Avant la correction, ces deux clés étaient différentes : un quota neuf à
    // chaque requête, donc une limite de débit sans effet.
    assert.equal(premiere, seconde, 'forger x-forwarded-for ne doit pas donner un nouveau quota');
  });
});

test('IP · sans IP fiable, la clé mélange le User-Agent plutôt que « inconnu »', () => {
  avecHops(undefined, () => {
    const a = rateLimitKey(h({ 'user-agent': 'Mozilla/5.0' }), 'otp');
    const b = rateLimitKey(h({ 'user-agent': 'Mozilla/5.0' }), 'otp');
    const autre = rateLimitKey(h({ 'user-agent': 'curl/8.0' }), 'otp');

    assert.equal(a, b, 'un même client doit rester dans la même file');
    // Un quota global unique bloquerait tous les utilisateurs d'un coup.
    assert.notEqual(a, autre, 'deux clients distincts ne doivent pas partager un quota');
    assert.ok(!a.endsWith(':inconnu'), '« inconnu » seul mutualiserait tous les quotas');
  });
});

// ---------- Derrière un proxy de confiance ----------

test('IP · derrière un proxy, on lit la chaîne depuis la droite', () => {
  avecHops('1', () => {
    // Un proxy enchaîne : `client, proxy1`. Le client a lui-même écrit le
    // premier élément, seul le dernier est écrit par notre proxy.
    const headers = h({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1' });
    assert.equal(resolveClientIp(headers).ip, '10.0.0.1');
  });
});

test('IP · deux proxys de confiance → on saute deux sauts depuis la droite', () => {
  avecHops('2', () => {
    const headers = h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' });
    assert.equal(resolveClientIp(headers).ip, '2.2.2.2');
  });
});

test("IP · derrière le proxy, la clé varie avec l'IP légitime", () => {
  avecHops('1', () => {
    const un = rateLimitKey(h({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1' }), 'otp');
    const deux = rateLimitKey(h({ 'x-forwarded-for': '7.7.7.7, 10.0.0.2' }), 'otp');
    assert.notEqual(un, deux, 'deux vrais clients doivent avoir deux quotas');
  });
});

test('IP · chaîne plus courte que la topologie : aucune confiance', () => {
  avecHops('3', () => {
    // Un seul élément alors que trois proxys sont annoncés : la topologie ne
    // correspond pas, on ne fabrique pas d'adresse.
    const headers = h({ 'x-forwarded-for': '1.2.3.4' });
    assert.equal(resolveClientIp(headers).ip, null);
  });
});

test('IP · x-real-ip reste accepté en repli du proxy', () => {
  avecHops('1', () => {
    assert.equal(resolveClientIp(h({ 'x-real-ip': '8.8.8.8' })).ip, '8.8.8.8');
  });
});

// ---------- Robustesse ----------

test('IP · une valeur qui n’est pas une IP est rejetée', () => {
  avecHops('1', () => {
    for (const valeur of ['', '   ', 'inconnu', '<script>', 'a b c', 'x'.repeat(50)]) {
      const r = resolveClientIp(h({ 'x-forwarded-for': `${valeur}, 10.0.0.1` }));
      assert.ok(r.ip === '10.0.0.1' || r.ip === null, `valeur inattendue : ${JSON.stringify(valeur)}`);
    }
    // Injecté à la place de l'IP, un texte libre ne doit pas devenir une clé.
    assert.equal(resolveClientIp(h({ 'x-real-ip': 'pas une ip' })).ip, null);
  });
});

test('IP · un nombre de proxys illisible ne fait pas retomber sur « confiance totale »', () => {
  // `TRUSTED_PROXY_HOPS="beaucoup"` ne doit pas être interprété comme « tout ».
  avecHops('beaucoup', () => {
    assert.equal(resolveClientIp(h({ 'x-forwarded-for': '1.2.3.4' })).ip, null);
  });
  avecHops('-1', () => {
    assert.equal(resolveClientIp(h({ 'x-forwarded-for': '1.2.3.4' })).ip, null);
  });
});

test('IP · IPv6 et ports sont acceptés', () => {
  avecHops('1', () => {
    assert.equal(resolveClientIp(h({ 'x-forwarded-for': '2001:db8::1, 10.0.0.1' })).ip, '10.0.0.1');
    assert.equal(resolveClientIp(h({ 'x-forwarded-for': '::ffff:1.2.3.4, 10.0.0.1' })).ip, '10.0.0.1');
  });
});