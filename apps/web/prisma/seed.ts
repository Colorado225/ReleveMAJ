import { PrismaClient } from '@prisma/client';
import {
  CIE_DOMESTIC_GENERAL_5A,
  CIE_DOMESTIC_SOCIAL_5A,
  calculateConsumption,
  reverseEstimate,
  type TariffScheme,
} from '@conso-ci/tariff-engine';

const db = new PrismaClient();
const DAY = 86_400_000;

/**
 * Seed de démonstration — flow.md §54 et §55.
 *
 * Objectif : une application vivante immédiatement, avec 3 mois d'historique,
 * des tendances, une variation, une alerte et une projection. Les données sont
 * identifiées comme démonstration.
 */

type RuleSeed = { kind: string; label: string; value: number; unit?: string };

function rulesOf(scheme: TariffScheme): RuleSeed[] {
  const r = scheme.rules;
  const out: RuleSeed[] = [
    { kind: 'FIXED_BIMONTHLY', label: 'Prime fixe bimestrielle TTC', value: r.fixedBimonthlyTtc, unit: 'FCFA' },
    { kind: 'TIER1_PRICE', label: 'Prix tranche 1', value: r.tier1.priceTtc, unit: 'FCFA/kWh' },
    { kind: 'TIER2_PRICE', label: 'Prix tranche 2', value: r.tier2.priceTtc, unit: 'FCFA/kWh' },
    { kind: 'TAX_RURAL_BIMONTHLY', label: 'Redevance rurale fixe', value: r.taxes.ruralPerBimonthly, unit: 'FCFA' },
    { kind: 'TAX_RURAL_KWH', label: 'Redevance rurale par kWh', value: r.taxes.ruralPerKwh, unit: 'FCFA/kWh' },
    { kind: 'TAX_RTI_KWH', label: 'RTI par kWh', value: r.taxes.RTIPerKwh, unit: 'FCFA/kWh' },
    {
      kind: 'TAX_GARBAGE_ABIDJAN_KWH',
      label: 'Redevance ordure Abidjan par kWh',
      value: r.taxes.garbageAbidjanPerKwh,
      unit: 'FCFA/kWh',
    },
    {
      kind: 'TAX_GARBAGE_OTHER_KWH',
      label: 'Redevance ordure hors Abidjan par kWh',
      value: r.taxes.garbageOtherPerKwh,
      unit: 'FCFA/kWh',
    },
  ];
  if (r.tier1.thresholdKwh != null) {
    out.push({ kind: 'TIER1_THRESHOLD_KWH', label: 'Seuil tranche 1', value: r.tier1.thresholdKwh, unit: 'kWh' });
  }
  if (r.tier1.multiplierHours != null) {
    out.push({
      kind: 'TIER1_MULTIPLIER_HOURS',
      label: 'Heures multiplicateur du seuil',
      value: r.tier1.multiplierHours,
    });
  }
  return out;
}

async function seedTariffs() {
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
    });
  }

  // flow.md §17 — règles d'éligibilité administrables
  await db.eligibilityRule.upsert({
    where: { id: 'seed-eligibility-social-5a' },
    update: {},
    create: {
schemeCode: CIE_DOMESTIC_SOCIAL_5A.code,
      usageType: 'DOMESTIC',
      subscribedPower: 5,
      thresholdKwh: CIE_DOMESTIC_SOCIAL_5A.rules.tier1.thresholdKwh ?? 80,
      minimumObservationPeriodDays: 60,
      sourceUrl: CIE_DOMESTIC_SOCIAL_5A.source.sourceUrl,
      verifiedAt: new Date(CIE_DOMESTIC_SOCIAL_5A.source.verifiedAt),
    },
  });
}

async function main() {
  await seedTariffs();

  // ---------- Utilisateur de démonstration ----------
  const phone = '+2250700000000';
  const user = await db.user.upsert({
    where: { phone },
    update: {},
    create: { phone, firstName: 'Dominique' },
  });

  // flow.md §49 et §40 — l'accès au back-office est conditionné à un rôle
  // d'organisation (OWNER). Sans lui, le back-office serait inaccessible même
  // en environnement de démonstration.
  const organization =
    (await db.organization.findFirst({ where: { name: 'ConsoCI Démo' } })) ??
    (await db.organization.create({ data: { name: 'ConsoCI Démo' } }));

  await db.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: organization.id, userId: user.id },
    },
    update: { role: 'OWNER' },
    create: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
  });

  const property =
    (await db.property.findFirst({ where: { userId: user.id } })) ??
    (await db.property.create({
      data: {
        userId: user.id,
        name: 'Maison principale',
        address: 'Cocody, Abidjan',
        isAbidjan: true,
      },
    }));

  // ---------- Compteurs ----------
  const cie =
    (await db.meter.findFirst({ where: { propertyId: property.id, provider: 'CIE' } })) ??
    (await db.meter.create({
      data: {
        propertyId: property.id,
        provider: 'CIE',
        utilityType: 'ELECTRICITY',
        paymentMode: 'PREPAID',
        meterType: 'CREDIT',
        unit: 'KWH',
        label: 'Compteur CIE',
        subscribedPower: 5,
        meterNumber: 'CI-0482917',
      },
    }));

  const sod =
    (await db.meter.findFirst({ where: { propertyId: property.id, provider: 'SODECI' } })) ??
    (await db.meter.create({
      data: {
        propertyId: property.id,
        provider: 'SODECI',
        utilityType: 'WATER',
paymentMode: 'POSTPAID',
        meterType: 'INDEX',
        unit: 'M3',
        label: 'Compteur SODECI',
        meterNumber: 'SO-1132874',
      },
    }));

  // ---------- Recharges CIE : 3 mois avec hausse progressive (flow.md §55) ----------
  if ((await db.electricityPurchase.count({ where: { meterId: cie.id } })) === 0) {
    const now = Date.now();
    const rows = [
      { days: 84, amount: 10_000, kwh: 96, method: 'WAVE' as const },
      { days: 77, amount: 5_000, kwh: null, method: 'ORANGE_MONEY' as const },
      { days: 63, amount: 10_000, kwh: 94, method: 'ORANGE_MONEY' as const },
      { days: 56, amount: 5_000, kwh: null, method: 'MTN_MOMO' as const },
      { days: 42, amount: 10_000, kwh: 91, method: 'WAVE' as const },
      { days: 35, amount: 15_000, kwh: null, method: 'ORANGE_MONEY' as const },
      { days: 21, amount: 10_000, kwh: 88, method: 'WAVE' as const },
      { days: 14, amount: 10_000, kwh: 85, method: 'ORANGE_MONEY' as const },
      // dernière période : consommation en hausse → déclenche une alerte
      { days: 5, amount: 20_000, kwh: null, method: 'WAVE' as const },
      // recharge du mois courant : le dashboard est parlant dès le premier écran
      { days: 2, amount: 10_000, kwh: 82, method: 'ORANGE_MONEY' as const },
    ];

    for (const r of rows) {
      // sans kWh crédités, on applique le moteur tarifaire (statut ESTIMATE)
      const estimated =
        r.kwh != null
          ? null
          : reverseEstimate(r.amount, CIE_DOMESTIC_SOCIAL_5A, { subscribedPower: 5, abidjan: true }).kwh;
      await db.electricityPurchase.create({
        data: {
          meterId: cie.id,
          amountPaid: r.amount,
          energyCreditedKwh: r.kwh,
          estimatedEnergyKwh: estimated,
          costPerKwh: r.kwh != null ? r.amount / r.kwh : null,
          paymentMethod: r.method,
          purchasedAt: new Date(now - r.days * DAY),
          tokenReference: `REF-${r.days}-${r.amount}`,
          source: 'IMPORT',
          confidence: r.kwh != null ? 'HIGH' : 'LOW',
        },
      });
    }
  }
// ---------- Relevés SODECI : index sur 3 mois, dernière période en hausse ----------
  if ((await db.meterReading.count({ where: { meterId: sod.id } })) === 0) {
    const now = Date.now();
    const indexes = [
      { days: 92, value: 118.4 },
      { days: 72, value: 124.3 },
      { days: 52, value: 130.1 },
      { days: 32, value: 135.9 },
      { days: 12, value: 141.4 },
      { days: 2, value: 158.6 },
    ];

    let previous: { value: number; date: Date } | null = null;
    for (const idx of indexes) {
      const date = new Date(now - idx.days * DAY);
      await db.meterReading.create({
        data: {
          meterId: sod.id,
          value: idx.value,
          unit: 'M3',
          readingType: 'INDEX',
          readingDate: date,
          source: 'MANUAL',
          confidence: 'HIGH',
        },
      });

      // la période est dérivée par le même moteur que l'application
      if (previous) {
        const result = calculateConsumption({
          previous: previous.value,
          current: idx.value,
          start: previous.date,
          end: date,
        });
        await db.consumptionPeriod.create({
          data: {
            meterId: sod.id,
            startDate: previous.date,
            endDate: date,
            startValue: previous.value,
            endValue: idx.value,
            quantity: result.quantity,
            dailyAverage: result.dailyAverage,
            anomaly: result.anomaly,
            anomalyNote: result.anomaly ? 'Index inférieur au précédent.' : null,
          },
        });
      }
      previous = { value: idx.value, date };
    }
  }
// ---------- Facture SODECI : la référence financière (flow.md §22) ----------
  if ((await db.waterBill.count({ where: { propertyId: property.id } })) === 0) {
    const now = Date.now();
    await db.waterBill.create({
      data: {
        meterId: sod.id,
        propertyId: property.id,
        periodStart: new Date(now - 32 * DAY),
        periodEnd: new Date(now - 2 * DAY),
        consumptionM3: 15.5,
        amountTtc: 6_850,
        effectiveCostPerM3: 6_850 / 15.5,
        invoiceReference: 'SO-2026-00412',
        source: 'IMPORT',
      },
    });
  }

  // ---------- Budget ----------
  if ((await db.budget.count({ where: { propertyId: property.id } })) === 0) {
    await db.budget.create({
      data: { propertyId: property.id, category: 'ELECTRICITY', monthlyAmount: 35_000 },
    });
  }

  // ---------- Appareils (flow.md §32) ----------
  // Rattachés au logement : la consommation estimée est celle de CE logement.
  if ((await db.appliance.count({ where: { propertyId: property.id } })) === 0) {
    await db.appliance.createMany({
      data: [
        {
          propertyId: property.id,
          type: 'AC',
          label: 'Climatisation salon',
          powerWatts: 1200,
          hoursPerDay: 6,
          daysPerMonth: 30,
        },
        {
          propertyId: property.id,
          type: 'Fridge',
          label: 'Réfrigérateur',
          powerWatts: 150,
          hoursPerDay: 10,
          daysPerMonth: 30,
        },
        {
          propertyId: property.id,
          type: 'Freezer',
          label: 'Congélateur',
          powerWatts: 200,
          hoursPerDay: 9,
          daysPerMonth: 30,
        },
        {
          propertyId: property.id,
          type: 'WaterHeater',
          label: 'Chauffe-eau',
          powerWatts: 2000,
          hoursPerDay: 2,
          daysPerMonth: 30,
        },
        {
          propertyId: property.id,
          type: 'TV',
          label: 'Télévision',
          powerWatts: 100,
          hoursPerDay: 5,
          daysPerMonth: 30,
        },
        {
          propertyId: property.id,
          type: 'WashingMachine',
          label: 'Machine à laver',
          powerWatts: 500,
          hoursPerDay: 1.5,
          daysPerMonth: 12,
        },
      ],
    });
  }

  // flow.md §29 — les projections ne sont PAS seedées : elles sont calculées à
  // la volée depuis les recharges réelles. Inscrire des montants en dur dans la
  // base reviendrait à afficher des chiffres inventés (§1).

  const purchases = await db.electricityPurchase.count({ where: { meterId: cie.id } });
  const periods = await db.consumptionPeriod.count({ where: { meterId: sod.id } });

  console.log('Seed OK');
  console.log(`  utilisateur        : ${user.phone} (${user.firstName})`);
  console.log(`  logement           : ${property.name}`);
  console.log('  compteurs          : CIE prépayé + SODECI');
  console.log(`  recharges CIE      : ${purchases}`);
  console.log(`  périodes eau       : ${periods}`);
  console.log(
    `  grilles tarifaires : ${CIE_DOMESTIC_SOCIAL_5A.code} v${CIE_DOMESTIC_SOCIAL_5A.version}, ${CIE_DOMESTIC_GENERAL_5A.code} v${CIE_DOMESTIC_GENERAL_5A.version}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
