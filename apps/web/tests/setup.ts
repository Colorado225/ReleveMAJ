// Isolement de la base pour les tests d'intégration (flow.md §53).
//
// Les tests ne doivent JAMAIS toucher la base de développement : on utilise un
// schéma PostgreSQL distinct, créé et vidé par le script de test.
import { execFileSync } from 'node:child_process';
import {
  CIE_DOMESTIC_GENERAL_5A,
  CIE_DOMESTIC_SOCIAL_5A,
  type TariffScheme,
} from '@conso-ci/tariff-engine';

const SCHEMA = 'test_consoci';

// `tsx` ne charge pas le `.env` comme le fait Next.js : on le lit ici, avant
// toute dépendance à DATABASE_URL.
function loadEnvFile(): void {
  if (process.env.DATABASE_URL) return;
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    const raw = fs.readFileSync('.env', 'utf8');
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, value] = match;
      const clean = value.replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = clean;
    }
  } catch {
    // pas de .env : DATABASE_URL devra venir de l'environnement
  }
}

loadEnvFile();

/**
 * Exigence de configuration : sans URL de base, on ne peut pas deviner la base.
 *
 * La CI ne fournit pas de `.env` : elle passe DATABASE_URL dans l'environnement.
 * Le message distinguishes les deux cas pour ne pas perdre une heure de
 * diagnostic sur une CI qui est simplement mal configurée.
 */
function requireDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (base) return base;
  throw new Error(
    'DATABASE_URL absent.\n' +
      '  • en développement : creates apps/web/.env (npm run setup)\n' +
      '  • en CI : définit DATABASE_URL dans les variables du job\n' +
      "  Les tests d'intégration ne peuvent pas choisir la base à votre place : " +
      'ils ont déjà accidentellement réinitialisé la base de démonstration une fois.',
  );
}

export const TEST_DATABASE_URL = (() => {
  const url = new URL(requireDatabaseUrl());
  url.searchParams.set('schema', SCHEMA);
  return url.toString();
})();

/**
 * Effet de bord volontaire : ce module doit être importé AVANT `@/lib/db`
 * (l'ordre d'évaluation des imports le garantit). Le client Prisma lit
 * DATABASE_URL au moment de sa création : il doit donc voir le schéma de test.
 */
process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * Garde-fou : refuse de s'exécuter si l'URL cible n'est pas explicitement le
 * schéma de test. Un test ne doit JAMAIS pouvoir réinitialiser la base de
 * développement — cette erreur a réellement effacé les données de démo une fois.
 */
export function assertTestDatabaseUrl(url: string): void {
  const schema = new URL(url).searchParams.get('schema');
  if (schema !== SCHEMA) {
    throw new Error(
      `Refus : DATABASE_URL pointe sur le schéma « ${schema ?? 'public'} » au lieu de « ${SCHEMA} ». ` +
        'Les tests d’intégration ne doivent jamais toucher la base de développement.',
    );
  }
}

/**
 * Crée le schéma de test et y applique le schéma Prisma.
 *
 * ⚠ SÛRETÉ : la commande vise EXPLICITEMENT le schéma de test. Ne jamais
 * construire l'URL en retirant le paramètre `schema` : cela viserait `public`,
 * la base de développement, et `--force-reset` la détruirait.
 */
export function prepareTestDatabase(): void {
  assertTestDatabaseUrl(TEST_DATABASE_URL);

  execFileSync(
    'npx',
    ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    {
      cwd: process.cwd(),
      // TEST_DATABASE_URL conserve `?schema=test_consoci`
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        // ⚠ OBLIGATOIRE depuis l'ajout de `directUrl` au datasource Prisma.
        // Sans cette ligne, la CLI Prisma lit DIRECT_URL (schéma `public`) et
        // applique `db push --accept-data-loss` sur la base de DÉVELOPPEMENT :
        // c'est-à-dire exactement ce que `assertTestDatabaseUrl` interdit.
        DIRECT_URL: TEST_DATABASE_URL,
      },
      stdio: 'pipe',
    },
  );
}

/**
 * Charge les grilles tarifaires comme le fait le seed de production.
 *
 * Sans elles, l'estimation des kWh ne peut pas s'exécuter : le test
 * « create purchase » vérifierait un chemin impossible en conditions réelles.
 */
export async function seedTariffs(db: {
  tariffScheme: {
    upsert: (args: never) => Promise<unknown>;
  };
}): Promise<void> {
  const rulesOf = (scheme: TariffScheme) => {
    const r = scheme.rules;
    const out: { kind: string; label: string; value: number; unit: string; position: number }[] = [
      { kind: 'FIXED_BIMONTHLY', label: 'Prime fixe', value: r.fixedBimonthlyTtc, unit: 'FCFA', position: 0 },
      { kind: 'TIER1_PRICE', label: 'Prix tranche 1', value: r.tier1.priceTtc, unit: 'FCFA/kWh', position: 1 },
      { kind: 'TIER2_PRICE', label: 'Prix tranche 2', value: r.tier2.priceTtc, unit: 'FCFA/kWh', position: 2 },
      { kind: 'TAX_RURAL_BIMONTHLY', label: 'Redevance rurale fixe', value: r.taxes.ruralPerBimonthly, unit: 'FCFA', position: 3 },
      { kind: 'TAX_RURAL_KWH', label: 'Redevance rurale par kWh', value: r.taxes.ruralPerKwh, unit: 'FCFA/kWh', position: 4 },
      { kind: 'TAX_RTI_KWH', label: 'RTI par kWh', value: r.taxes.RTIPerKwh, unit: 'FCFA/kWh', position: 5 },
      { kind: 'TAX_GARBAGE_ABIDJAN_KWH', label: 'Ordure Abidjan', value: r.taxes.garbageAbidjanPerKwh, unit: 'FCFA/kWh', position: 6 },
      { kind: 'TAX_GARBAGE_OTHER_KWH', label: 'Ordure hors Abidjan', value: r.taxes.garbageOtherPerKwh, unit: 'FCFA/kWh', position: 7 },
    ];
    if (r.tier1.thresholdKwh != null) {
      out.push({ kind: 'TIER1_THRESHOLD_KWH', label: 'Seuil tranche 1', value: r.tier1.thresholdKwh, unit: 'kWh', position: 8 });
    }
    if (r.tier1.multiplierHours != null) {
      out.push({ kind: 'TIER1_MULTIPLIER_HOURS', label: 'Heures multiplicateur', value: r.tier1.multiplierHours, unit: '', position: 9 });
    }
    return out;
  };

  for (const scheme of [CIE_DOMESTIC_SOCIAL_5A, CIE_DOMESTIC_GENERAL_5A]) {
    await db.tariffScheme.upsert({
      where: { code_version: { code: scheme.code, version: scheme.version } },
      update: {},
      create: {
        code: scheme.code,
        version: scheme.version,
        provider: scheme.provider,
        category: scheme.category,
        subscribedPower: scheme.subscribedPower,
        effectiveFrom: new Date(scheme.effectiveFrom),
        effectiveTo: scheme.effectiveTo ? new Date(scheme.effectiveTo) : null,
        sourceUrl: scheme.source.sourceUrl,
        sourceName: scheme.source.sourceName,
        documentReference: scheme.source.documentReference,
        verifiedAt: new Date(scheme.source.verifiedAt),
        rules: { create: rulesOf(scheme) },
      },
    } as never);
  }
}

/** Vide les tables métier sans casser les clés étrangères. */
export async function resetTestData(db: {
  alert: { deleteMany: () => Promise<unknown> };
  draftExtraction: { deleteMany: () => Promise<unknown> };
  waterBill: { deleteMany: () => Promise<unknown> };
  consumptionPeriod: { deleteMany: () => Promise<unknown> };
  electricityPurchase: { deleteMany: () => Promise<unknown> };
  meterReading: { deleteMany: () => Promise<unknown> };
  budget: { deleteMany: () => Promise<unknown> };
  appliance: { deleteMany: () => Promise<unknown> };
  meter: { deleteMany: () => Promise<unknown> };
  property: { deleteMany: () => Promise<unknown> };
  organizationMember: { deleteMany: () => Promise<unknown> };
  organization: { deleteMany: () => Promise<unknown> };
  productEvent: { deleteMany: () => Promise<unknown> };
  auditLog: { deleteMany: () => Promise<unknown> };
  otpChallenge: { deleteMany: () => Promise<unknown> };
  rateLimit: { deleteMany: () => Promise<unknown> };
  session: { deleteMany: () => Promise<unknown> };
  user: { deleteMany: () => Promise<unknown> };
}): Promise<void> {
  // `alert` avant `user` : la clé étrangère pointe sur l'utilisateur.
  // Sans ce deleteMany, la contrainte `@@unique([userId, type])` ferait échouer
  // les tests d'alertes d'une exécution à l'autre.
  await db.alert.deleteMany();
  await db.draftExtraction.deleteMany();
  await db.waterBill.deleteMany();
  await db.consumptionPeriod.deleteMany();
  await db.electricityPurchase.deleteMany();
  await db.meterReading.deleteMany();
  await db.budget.deleteMany();
  await db.appliance.deleteMany();
  await db.meter.deleteMany();
  await db.property.deleteMany();
  await db.organizationMember.deleteMany();
  await db.organization.deleteMany();
  await db.productEvent.deleteMany();
  await db.auditLog.deleteMany();
  await db.otpChallenge.deleteMany();
  await db.rateLimit.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}