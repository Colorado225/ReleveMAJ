'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from './auth';
import { db } from './db';
import { addReading, getDashboard, resolveMeterTariff } from './services';
import {
  budgetSchema,
  createApplianceSchema,
  createMeterSchema,
  createPropertySchema,
  createPurchaseSchema,
  createReadingSchema,
  createWaterBillSchema,
  updateApplianceSchema,
  updateBudgetSchema,
  updateMeterSchema,
  updateProfileSchema,
  updatePropertySchema,
  updatePurchaseSchema,
  updateWaterBillSchema,
} from './validation';
import { reverseEstimate } from '@conso-ci/tariff-engine';
import { deleteUploadedFile, saveReceipt } from './upload';
import { audit } from './audit';
import { track } from './analytics';
import { checkQuota, type PlanName } from './plans';
import {
  confirmDraftExtraction,
  createDraftExtraction,
  rejectDraftExtraction,
} from './ocr-pipeline';

/**
 * Contrat de retour des Server Actions de formulaire.
 *
 * `null` = succès, `string` = message d'erreur affichable tel quel. Ce type est
 * ce que `useActionState` consomme dans les composants : il doit donc être
 * explicite, sinon une action qui glisse un `undefined` ou un objet trahirait
 * le contrat sans que le typecheck ne le remarque.
 */
export type ActionResult = Promise<string | null>;

async function requireUser() {
  const session = await getSessionUser();
  if (!session) throw new Error('Session expirée. Reconnectez-vous.');
  return session;
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Données invalides.';
}

/**
 * flow.md §40 — on n'agit que sur ce qui appartient à l'utilisateur.
 *
 * `findFirst` avec `userId` dans le where : une requête par identifiant nu
 * suffirait à modifier le logement d'autrui. Toutes les actions de
 * modification et de suppression passent par ce garde-fou.
 */
async function ownedProperty(id: string, userId: string) {
  return db.property.findFirst({ where: { id, userId }, select: { id: true } });
}

async function ownedMeter(id: string, userId: string) {
  return db.meter.findFirst({ where: { id, property: { userId } }, select: { id: true } });
}

async function ownedAppliance(id: string, userId: string) {
  return db.appliance.findFirst({ where: { id, property: { userId } }, select: { id: true } });
}

async function ownedBudget(id: string, userId: string) {
  return db.budget.findFirst({ where: { id, property: { userId } }, select: { id: true } });
}

/** flow.md §33 et §60 — création du logement */
export async function createPropertyAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const parsed = createPropertySchema.safeParse({
    name: formData.get('name'),
    address: formData.get('address') || undefined,
    isAbidjan: formData.get('isAbidjan') === 'on',
  });
  if (!parsed.success) return firstIssue(parsed.error);

  // flow.md §47 — la limite porte sur le volume, jamais sur la compréhension
  const [user, propertyCount] = await Promise.all([
    db.user.findUnique({ where: { id: session.id }, select: { plan: true } }),
    db.property.count({ where: { userId: session.id } }),
  ]);
  const quotaError = checkQuota({
    plan: (user?.plan ?? 'FREE') as PlanName,
    quota: 'properties',
    currentCount: propertyCount,
  });
  if (quotaError) return quotaError;

  await db.property.create({
    data: {
      name: parsed.data.name,
      address: parsed.data.address,
      isAbidjan: parsed.data.isAbidjan,
      userId: session.id,
    },
  });
  revalidatePath('/profil');
  await audit({ action: 'property_created', entity: 'Property', userId: session.id });
  // flow.md §48 — activation
  await track('property_created', { userId: session.id });
  return null;
}

/**
 * flow.md §60 — modification d'un logement.
 *
 * Le quota n'est PAS revérifié : modifier ne crée pas de logement, et le
 * compteur de quota est déjà figé par la création.
 */
export async function updatePropertyAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');
  if (!id) return 'Logement introuvable.';

  // flow.md §40 — garde-fou de propriété
  const property = await ownedProperty(id, session.id);
  if (!property) return 'Logement introuvable.';

  const parsed = updatePropertySchema.safeParse({
    name: formData.get('name'),
    address: formData.get('address') || undefined,
    isAbidjan: formData.get('isAbidjan') === 'on',
  });
  if (!parsed.success) return firstIssue(parsed.error);

  await db.property.update({
    where: { id: property.id },
    data: {
      name: parsed.data.name,
      address: parsed.data.address,
      isAbidjan: parsed.data.isAbidjan,
    },
  });
  revalidatePath('/profil');
  revalidatePath('/');
  revalidatePath('/ajouter');
  await audit({
    action: 'property_updated',
    entity: 'Property',
    entityId: property.id,
    userId: session.id,
  });
  return null;
}

/**
 * flow.md §40 — suppression d'un logement.
 *
 * Le schéma supprime en cascade compteurs, relevés, recharges et factures
 * rattachés. La confirmation est donc portée par l'interface (§21).
 */
export async function deletePropertyAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');

  const property = await ownedProperty(id, session.id);
  if (!property) return 'Logement introuvable.';

  await db.property.delete({ where: { id: property.id } });
  revalidatePath('/profil');
  revalidatePath('/');
  revalidatePath('/ajouter');
  await audit({
    action: 'property_deleted',
    entity: 'Property',
    entityId: property.id,
    userId: session.id,
  });
  return null;
}

/** flow.md §60 — ajout d'un compteur CIE ou SODECI */
export async function createMeterAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const propertyId = String(formData.get('propertyId') ?? '');
  const property = await db.property.findFirst({ where: { id: propertyId, userId: session.id } });
  if (!property) return 'Logement introuvable.';

  const parsed = createMeterSchema.safeParse({
    provider: formData.get('provider'),
    utilityType: formData.get('utilityType'),
    paymentMode: formData.get('paymentMode') || 'UNKNOWN',
    meterNumber: formData.get('meterNumber') || undefined,
    subscribedPower: formData.get('subscribedPower')
      ? Number(formData.get('subscribedPower'))
      : undefined,
    label: formData.get('label') || undefined,
  });
  if (!parsed.success) return firstIssue(parsed.error);

  // flow.md §47 — quota de compteurs
  const [user, meterCount] = await Promise.all([
    db.user.findUnique({ where: { id: session.id }, select: { plan: true } }),
    db.meter.count({ where: { property: { userId: session.id } } }),
  ]);
  const quotaError = checkQuota({
    plan: (user?.plan ?? 'FREE') as PlanName,
    quota: 'meters',
    currentCount: meterCount,
  });
  if (quotaError) return quotaError;

  const unit = parsed.data.utilityType === 'ELECTRICITY' ? 'KWH' : 'M3';
  await db.meter.create({
    data: {
      propertyId: property.id,
      provider: parsed.data.provider,
      utilityType: parsed.data.utilityType,
      paymentMode: parsed.data.paymentMode,
      meterNumber: parsed.data.meterNumber,
      subscribedPower: parsed.data.subscribedPower,
      label: parsed.data.label,
      unit,
    },
  });
  revalidatePath('/profil');
  await audit({ action: 'meter_created', entity: 'Meter', userId: session.id });
  await track('meter_created', {
    userId: session.id,
    metadata: { utilityType: parsed.data.utilityType },
  });
  return null;
}

/**
 * flow.md §47 — modification d'un compteur.
 *
 * Le logement de rattachement n'est pas modifiable : le déplacer couperait
 * l'historique du compteur de son logement d'origine.
 * `unit` suit `utilityType` : le changer seul rendrait les données incohérentes.
 */
export async function updateMeterAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');
  if (!id) return 'Compteur introuvable.';

  const meter = await ownedMeter(id, session.id);
  if (!meter) return 'Compteur introuvable.';

  const parsed = updateMeterSchema.safeParse({
    provider: formData.get('provider'),
    utilityType: formData.get('utilityType'),
    paymentMode: formData.get('paymentMode') || 'UNKNOWN',
    meterNumber: formData.get('meterNumber') || undefined,
    subscribedPower: formData.get('subscribedPower')
      ? Number(formData.get('subscribedPower'))
      : undefined,
    label: formData.get('label') || undefined,
  });
  if (!parsed.success) return firstIssue(parsed.error);

  await db.meter.update({
    where: { id: meter.id },
    data: {
      provider: parsed.data.provider,
      utilityType: parsed.data.utilityType,
      paymentMode: parsed.data.paymentMode,
      meterNumber: parsed.data.meterNumber,
      subscribedPower: parsed.data.subscribedPower,
      label: parsed.data.label,
      unit: parsed.data.utilityType === 'ELECTRICITY' ? 'KWH' : 'M3',
    },
  });
  revalidatePath('/profil');
  revalidatePath('/ajouter');
  await audit({ action: 'meter_updated', entity: 'Meter', entityId: meter.id, userId: session.id });
  return null;
}

/** flow.md §40 — suppression d'un compteur et de ses mesures. */
export async function deleteMeterAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');

  const meter = await ownedMeter(id, session.id);
  if (!meter) return 'Compteur introuvable.';

  await db.meter.delete({ where: { id: meter.id } });
  revalidatePath('/profil');
  revalidatePath('/');
  revalidatePath('/ajouter');
  revalidatePath('/historique');
  await audit({ action: 'meter_deleted', entity: 'Meter', entityId: meter.id, userId: session.id });
  return null;
}
/**
 * flow.md §35 — ajout d'une recharge CIE.
 *
 * Si les kWh crédités sont connus, ils sont stockés tels quels (mesure réelle).
 * Sinon on applique le moteur tarifaire pour estimer, avec confiance basse et
 * un marquage explicite (§11 et §19).
 */
export async function createPurchaseAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const meterId = String(formData.get('meterId') ?? '');

  const meter = await db.meter.findFirst({
    where: { id: meterId, property: { userId: session.id } },
  });
  if (!meter) return 'Compteur introuvable.';

  const parsed = createPurchaseSchema.safeParse({
    amountPaid: Number(formData.get('amountPaid')),
    energyCreditedKwh: formData.get('energyCreditedKwh')
      ? Number(formData.get('energyCreditedKwh'))
      : undefined,
    paymentMethod: formData.get('paymentMethod') || 'OTHER',
    purchasedAt: formData.get('purchasedAt') || undefined,
    tokenReference: formData.get('tokenReference') || undefined,
  });
  if (!parsed.success) return firstIssue(parsed.error);

  const { amountPaid, energyCreditedKwh } = parsed.data;
  let estimated: number | null = null;

  if (energyCreditedKwh == null) {
    const tariff = await resolveMeterTariff({
      subscribedPower: meter.subscribedPower,
      category: 'DOMESTIC_SOCIAL',
    });
    if (tariff) {
      estimated = reverseEstimate(amountPaid, tariff, { subscribedPower: meter.subscribedPower ?? 5 }).kwh;
    }
  }

  // flow.md §35 / §57 — le reçu est facultatif ; en V1 il est seulement stocké
  const file = formData.get('receipt');
  let receiptPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    const upload = await saveReceipt(file);
    if (!upload.ok) return upload.error;
    receiptPath = upload.path;
  }

  const purchase = await db.electricityPurchase.create({
    data: {
      meterId: meter.id,
      amountPaid,
      energyCreditedKwh: energyCreditedKwh ?? null,
      estimatedEnergyKwh: estimated,
      costPerKwh:
        energyCreditedKwh != null && energyCreditedKwh > 0 ? amountPaid / energyCreditedKwh : null,
      paymentMethod: parsed.data.paymentMethod,
      purchasedAt: parsed.data.purchasedAt ? new Date(parsed.data.purchasedAt) : new Date(),
      tokenReference: parsed.data.tokenReference,
      receiptImagePath: receiptPath,
      source: receiptPath ? 'PHOTO' : 'MANUAL',
      confidence: energyCreditedKwh != null ? 'HIGH' : 'LOW',
    },
  });

  revalidatePath('/');
  revalidatePath('/historique');
  await audit({ action: 'electricity_purchase_created', entity: 'ElectricityPurchase', userId: session.id });
  // flow.md §48 — activation : la première recharge compte
  const previousPurchases = await db.electricityPurchase.count({
    where: { meter: { property: { userId: session.id } }, purchasedAt: { lt: purchase.purchasedAt } },
  });
  if (previousPurchases === 0) await track('first_purchase', { userId: session.id });
  return null;
}

/**
 * flow.md §35 — modification d'une recharge CIE.
 *
 * Le reçu déjà stocké n'est PAS remplacé : le formulaire de modification ne
 * propose pas de fichier. Pour changer la photo, il faut en déposer une
 * nouvelle — on ne réécrit jamais une preuve déjà enregistrée (flow.md §21).
 */
export async function updatePurchaseAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');
  if (!id) return 'Recharge introuvable.';

  const purchase = await db.electricityPurchase.findFirst({
    where: { id, meter: { property: { userId: session.id } } },
    select: { id: true, purchasedAt: true },
  });
  if (!purchase) return 'Recharge introuvable.';

  const parsed = updatePurchaseSchema.safeParse({
    amountPaid: Number(formData.get('amountPaid')),
    energyCreditedKwh: formData.get('energyCreditedKwh')
      ? Number(formData.get('energyCreditedKwh'))
      : undefined,
    paymentMethod: formData.get('paymentMethod') || 'OTHER',
    purchasedAt: formData.get('purchasedAt') || undefined,
    tokenReference: formData.get('tokenReference') || undefined,
  });
  if (!parsed.success) return firstIssue(parsed.error);

  const { amountPaid, energyCreditedKwh } = parsed.data;

  await db.electricityPurchase.update({
    where: { id: purchase.id },
    data: {
      amountPaid,
      energyCreditedKwh: energyCreditedKwh ?? null,
      // Le coût effectif est redérivé : il doit toujours correspondre au
      // couple montant / kWh réellement enregistré.
      costPerKwh:
        energyCreditedKwh != null && energyCreditedKwh > 0 ? amountPaid / energyCreditedKwh : null,
      paymentMethod: parsed.data.paymentMethod,
      // La date de la recharge est une donnée, pas un horodatage de saisie :
      // si le formulaire ne la fournit pas, on conserve celle déjà enregistrée.
      purchasedAt: parsed.data.purchasedAt
        ? new Date(parsed.data.purchasedAt)
        : purchase.purchasedAt,
      tokenReference: parsed.data.tokenReference,
    },
  });

  revalidatePath('/');
  revalidatePath('/historique');
  await audit({
    action: 'electricity_purchase_updated',
    entity: 'ElectricityPurchase',
    entityId: purchase.id,
    userId: session.id,
  });
  return null;
}

/** flow.md §21 — suppression d'une recharge. */
export async function deletePurchaseAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');

  const purchase = await db.electricityPurchase.findFirst({
    where: { id, meter: { property: { userId: session.id } } },
    select: { id: true, receiptImagePath: true },
  });
  if (!purchase) return 'Recharge introuvable.';

  await db.electricityPurchase.delete({ where: { id: purchase.id } });

  // La photo du disque ne doit pas survivre à la donnée qu'elle documente.
  if (purchase.receiptImagePath) await deleteUploadedFile(purchase.receiptImagePath);

  revalidatePath('/');
  revalidatePath('/historique');
  await audit({
    action: 'electricity_purchase_deleted',
    entity: 'ElectricityPurchase',
    entityId: purchase.id,
    userId: session.id,
  });
  return null;
}

/**
 * flow.md §36 — ajout d'un relevé.
 * Le type de valeur est obligatoire : jamais d'interprétation automatique (§10).
 */
export async function createReadingAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const meterId = String(formData.get('meterId') ?? '');

  const meter = await db.meter.findFirst({
    where: { id: meterId, property: { userId: session.id } },
  });
  if (!meter) return 'Compteur introuvable.';

  const parsed = createReadingSchema.safeParse({
    value: Number(formData.get('value')),
    unit: formData.get('unit'),
    readingType: formData.get('readingType'),
    readingDate: formData.get('readingDate') || undefined,
    note: formData.get('note') || undefined,
  });
  if (!parsed.success) return firstIssue(parsed.error);

  try {
    const result = await addReading({
      meterId: meter.id,
      value: parsed.data.value,
      unit: parsed.data.unit,
      readingType: parsed.data.readingType,
      readingDate: parsed.data.readingDate,
      note: parsed.data.note,
    });
    revalidatePath('/');
    revalidatePath('/historique');
    await audit({ action: 'meter_reading_created', entity: 'MeterReading', entityId: result.reading.id, userId: session.id });

    // flow.md §48 — activation : le tout premier relevé de l'utilisateur
    const previousReadings = await db.meterReading.count({
      where: { meter: { property: { userId: session.id } }, id: { not: result.reading.id } },
    });
    if (previousReadings === 0) await track('first_reading', { userId: session.id });

    // flow.md §21 — on informe sans jamais supprimer la donnée
    if (result.period?.anomaly) {
      return 'Relevé enregistré. Attention : le nouvel index est inférieur au précédent. Le compteur a-t-il été remplacé ou corrigé ?';
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Enregistrement impossible.';
  }
}

/**
 * flow.md §32 — ajouter un appareil et estimer sa consommation.
 *
 * L'estimation sert à COMPARER les appareils entre eux. Elle n'est jamais
 * présentée comme une mesure, et le coût est calculé avec le coût effectif
 * observé sur les recharges réelles — jamais avec un prix réglementaire inventé.
 */
export async function createApplianceAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const propertyId = String(formData.get('propertyId') ?? '');

  const property = await db.property.findFirst({ where: { id: propertyId, userId: session.id } });
  if (!property) return 'Logement introuvable.';

  const parsed = createApplianceSchema.safeParse({
    propertyId,
    type: formData.get('type'),
    label: formData.get('label'),
    powerWatts: Number(formData.get('powerWatts')),
    hoursPerDay: Number(formData.get('hoursPerDay')),
    daysPerMonth: Number(formData.get('daysPerMonth')),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  await db.appliance.create({ data: { ...parsed.data, propertyId: property.id } });

  await audit({
    action: 'appliance_created',
    entity: 'Appliance',
    userId: session.id,
    metadata: { type: parsed.data.type },
  });

  revalidatePath('/appareils');
  revalidatePath('/profil');
  return null;
}

/**
 * flow.md §32 — modifier un appareil.
 *
 * Un appareil se corrige facilement : on se trompe de puissance ou de durée
 * d'utilisation. Contrairement au relevé, aucune valeur financière n'en dépend :
 * l'estimation est recalculée à chaque affichage, elle n'est pas stockée.
 *
 * Le rattachement au logement n'est pas modifiable : il détermine le périmètre
 * de l'estimation (cf. `updateApplianceSchema`).
 */
export async function updateApplianceAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');
  if (!id) return 'Appareil introuvable.';

  const appliance = await ownedAppliance(id, session.id);
  if (!appliance) return 'Appareil introuvable.';

  const parsed = updateApplianceSchema.safeParse({
    type: formData.get('type'),
    label: formData.get('label'),
    powerWatts: Number(formData.get('powerWatts')),
    hoursPerDay: Number(formData.get('hoursPerDay')),
    daysPerMonth: Number(formData.get('daysPerMonth')),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  await db.appliance.update({ where: { id: appliance.id }, data: parsed.data });

  await audit({
    action: 'appliance_updated',
    entity: 'Appliance',
    entityId: appliance.id,
    userId: session.id,
  });

  revalidatePath('/appareils');
  return null;
}

/** flow.md §32 — supprimer un appareil du logement. */
export async function deleteApplianceAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');

  // flow.md §40 — on ne supprime que ce qui appartient à l'utilisateur
  const appliance = await db.appliance.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true },
  });
  if (!appliance) return 'Appareil introuvable.';

  await db.appliance.delete({ where: { id } });
  await audit({ action: 'appliance_deleted', entity: 'Appliance', entityId: id, userId: session.id });

  revalidatePath('/appareils');
  return null;
}

/**
 * flow.md §57 — déposer une photo de reçu.
 * Ne crée AUCUNE facture : uniquement une proposition à confirmer.
 */
export async function createDraftAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const meterId = String(formData.get('meterId') ?? '');
  const file = formData.get('receipt');

  if (!(file instanceof File) || file.size === 0) return 'Sélectionnez une photo de reçu.';

  const result = await createDraftExtraction({
    userId: session.id,
    meterId,
    sourceType: 'WATER_BILL',
    file,
    // flow.md §57 — un texte déjà transcrit permet de proposer des valeurs,
    // qui restent à confirmer. Sans texte, aucune proposition n'est faite.
    rawText: String(formData.get('rawText') ?? '') || null,
  });
  if (!result.ok) return result.error;

  revalidatePath('/recus');
  return null;
}

/** flow.md §57 — confirmation explicite : c'est ICI que la facture est écrite. */
export async function confirmDraftAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();

  const result = await confirmDraftExtraction(session.id, {
    draftId: formData.get('draftId'),
    consumptionM3: Number(formData.get('consumptionM3')),
    amountTtc: Number(formData.get('amountTtc')),
    periodStart: formData.get('periodStart'),
    periodEnd: formData.get('periodEnd'),
  });
  if (!result.ok) return result.error;

  revalidatePath('/recus');
  revalidatePath('/');
  revalidatePath('/historique');
  return null;
}

/** flow.md §57 — refus : aucune donnée n'est écrite. */
export async function rejectDraftAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const draftId = String(formData.get('draftId') ?? '');

  const rejected = await rejectDraftExtraction(session.id, draftId);
  if (!rejected) return 'Proposition introuvable ou déjà traitée.';

  revalidatePath('/recus');
  return null;
}

/** flow.md §22 — ajout d’une facture SODECI */
export async function createWaterBillAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const meterId = String(formData.get('meterId') ?? '');

  const meter = await db.meter.findFirst({
    where: { id: meterId, property: { userId: session.id } },
    include: { property: true },
  });
  if (!meter) return 'Compteur introuvable.';

  const parsed = createWaterBillSchema.safeParse({
    periodStart: formData.get('periodStart'),
    periodEnd: formData.get('periodEnd'),
    consumptionM3: Number(formData.get('consumptionM3')),
    amountTtc: Number(formData.get('amountTtc')),
    invoiceReference: formData.get('invoiceReference') || undefined,
  });
  if (!parsed.success) return firstIssue(parsed.error);

  const { consumptionM3, amountTtc } = parsed.data;
  if (consumptionM3 === 0 && amountTtc > 0) {
    return 'Indiquez la consommation en m³ pour calculer le coût effectif.';
  }

  // flow.md §52 — facture incohérente : période inversée ou future
  if (new Date(parsed.data.periodEnd) < new Date(parsed.data.periodStart)) {
    return 'La fin de période doit être postérieure au début.';
  }
  if (new Date(parsed.data.periodEnd) > new Date()) {
    return 'La fin de période ne peut pas être dans le futur.';
  }

  const file = formData.get('receipt');
  let receiptPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    const upload = await saveReceipt(file);
    if (!upload.ok) return upload.error;
    receiptPath = upload.path;
  }

  const bill = await db.waterBill.create({
    data: {
      meterId: meter.id,
      propertyId: meter.propertyId,
      periodStart: new Date(parsed.data.periodStart),
      periodEnd: new Date(parsed.data.periodEnd),
      consumptionM3,
      amountTtc,
      // flow.md §23 — coût effectif observé, jamais présenté comme le tarif officiel
      effectiveCostPerM3: consumptionM3 > 0 ? amountTtc / consumptionM3 : null,
      invoiceReference: parsed.data.invoiceReference,
      receiptImagePath: receiptPath,
      source: receiptPath ? 'PHOTO' : 'MANUAL',
    },
  });

  revalidatePath('/');
  revalidatePath('/historique');
  await audit({ action: 'water_bill_created', entity: 'WaterBill', entityId: bill.id, userId: session.id });

  // flow.md §48 — activation : la première facture SODECI compte
  const previousBills = await db.waterBill.count({
    where: { property: { userId: session.id }, id: { not: bill.id } },
  });
  if (previousBills === 0) await track('first_bill', { userId: session.id });

  return null;
}

/**
 * flow.md §22 — modification d'une facture SODECI.
 *
 * Comme pour la recharge, la photo déjà enregistrée n'est pas réécrite (§21).
 * Le coût effectif est redérivé pour rester cohérent avec le couple
 * consommation / montant.
 */
export async function updateWaterBillAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');
  if (!id) return 'Facture introuvable.';

  const bill = await db.waterBill.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true },
  });
  if (!bill) return 'Facture introuvable.';

  const parsed = updateWaterBillSchema.safeParse({
    periodStart: formData.get('periodStart'),
    periodEnd: formData.get('periodEnd'),
    consumptionM3: Number(formData.get('consumptionM3')),
    amountTtc: Number(formData.get('amountTtc')),
    invoiceReference: formData.get('invoiceReference') || undefined,
  });
  if (!parsed.success) return firstIssue(parsed.error);

  const { consumptionM3, amountTtc } = parsed.data;
  if (consumptionM3 === 0 && amountTtc > 0) {
    return 'Indiquez la consommation en m³ pour calculer le coût effectif.';
  }

  // flow.md §52 — les mêmes garde-fous qu'à la création
  if (new Date(parsed.data.periodEnd) < new Date(parsed.data.periodStart)) {
    return 'La fin de période doit être postérieure au début.';
  }
  if (new Date(parsed.data.periodEnd) > new Date()) {
    return 'La fin de période ne peut pas être dans le futur.';
  }

  await db.waterBill.update({
    where: { id: bill.id },
    data: {
      periodStart: new Date(parsed.data.periodStart),
      periodEnd: new Date(parsed.data.periodEnd),
      consumptionM3,
      amountTtc,
      effectiveCostPerM3: consumptionM3 > 0 ? amountTtc / consumptionM3 : null,
      invoiceReference: parsed.data.invoiceReference,
    },
  });

  revalidatePath('/');
  revalidatePath('/historique');
  await audit({ action: 'water_bill_updated', entity: 'WaterBill', entityId: bill.id, userId: session.id });
  return null;
}

/** flow.md §21 — suppression d'une facture SODECI. */
export async function deleteWaterBillAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');

  const bill = await db.waterBill.findFirst({
    where: { id, property: { userId: session.id } },
    select: { id: true, receiptImagePath: true },
  });
  if (!bill) return 'Facture introuvable.';

  await db.waterBill.delete({ where: { id: bill.id } });
  if (bill.receiptImagePath) await deleteUploadedFile(bill.receiptImagePath);

  revalidatePath('/');
  revalidatePath('/historique');
  await audit({ action: 'water_bill_deleted', entity: 'WaterBill', entityId: bill.id, userId: session.id });
  return null;
}

// ---------- Budget mensuel (flow.md §24 et §30) ----------
//
// Le budget est la seule donnée de comparaison que l'utilisateur SAISIT
// lui-même : aucun tarif réglementaire ne le fournit. Il sert à dire « je
// dépasse ou non », jamais à calculer une facture.

/** Création d'un budget mensuel pour un logement. */
export async function createBudgetAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const propertyId = String(formData.get('propertyId') ?? '');

  const property = await db.property.findFirst({
    where: { id: propertyId, userId: session.id },
    select: { id: true },
  });
  if (!property) return 'Logement introuvable.';

  const parsed = budgetSchema.safeParse({
    propertyId,
    category: formData.get('category'),
    monthlyAmount: Number(formData.get('monthlyAmount')),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  // Un budget par catégorie et par logement : deux enveloppes sur la même
  // catégorie ne pourraient jamais être additionnées, et `services.ts` n'en
  // lirait qu'une au hasard (il prend la plus récente).
  const existing = await db.budget.findFirst({
    where: { propertyId: property.id, category: parsed.data.category },
    select: { id: true },
  });
  if (existing) return 'Un budget existe déjà pour cette catégorie. Modifiez-le plutôt.';

  await db.budget.create({
    data: {
      propertyId: property.id,
      category: parsed.data.category,
      monthlyAmount: parsed.data.monthlyAmount,
    },
  });

  await audit({
    action: 'budget_created',
    entity: 'Budget',
    userId: session.id,
    metadata: { category: parsed.data.category },
  });

  revalidatePath('/profil');
  revalidatePath('/');
  revalidatePath('/consommation');
  return null;
}

/**
 * Modification d'un budget.
 *
 * Seul le montant change : changer la catégorie d'une enveloppe existante
 * produirait une historique trompeur (« mon budget électricité était de 35 000,
 * il est passé à 20 000 pour l'eau »). Pour changer de catégorie, on supprime
 * et on recrée — ce que l'interface propose explicitement.
 */
export async function updateBudgetAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');
  if (!id) return 'Budget introuvable.';

  const budget = await ownedBudget(id, session.id);
  if (!budget) return 'Budget introuvable.';

  const parsed = updateBudgetSchema.safeParse({
    monthlyAmount: Number(formData.get('monthlyAmount')),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  await db.budget.update({
    where: { id: budget.id },
    data: { monthlyAmount: parsed.data.monthlyAmount },
  });

  await audit({ action: 'budget_updated', entity: 'Budget', entityId: budget.id, userId: session.id });

  revalidatePath('/profil');
  revalidatePath('/');
  revalidatePath('/consommation');
  return null;
}

/**
 * Suppression d'un budget.
 *
 * Aucune cascade ici : le budget est un point de comparaison, pas une donnée
 * d'historique. Supprimer l'enveloppe n'affecte ni les factures déjà saisies
 * ni les périodes de consommation.
 */
export async function deleteBudgetAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');

  const budget = await ownedBudget(id, session.id);
  if (!budget) return 'Budget introuvable.';

  await db.budget.delete({ where: { id: budget.id } });
  await audit({ action: 'budget_deleted', entity: 'Budget', entityId: budget.id, userId: session.id });

  revalidatePath('/profil');
  revalidatePath('/');
  revalidatePath('/consommation');
  return null;
}

// ---------- Alertes (flow.md §33) ----------

/**
 * Résoudre ou rouvrir une alerte.
 *
 * `resolvedAt` est une date, jamais un booléen : « résolue le 3 mars » est une
 * information, « résolue : oui/non » ne l'est pas. Rouvrir remet le champ à
 * `null` pour que l'alerte réapparaisse parmi les alertes actives.
 */
export async function updateAlertAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');

  const alert = await db.alert.findFirst({
    where: { id, userId: session.id },
    select: { id: true, resolvedAt: true },
  });
  if (!alert) return 'Alerte introuvable.';

  // Un clic sur « résoudre » puis sur « rouvrir » : l'état courant suffit à
  // décider, aucun champ caché n'est nécessaire.
  await db.alert.update({
    where: { id: alert.id },
    data: { resolvedAt: alert.resolvedAt ? null : new Date() },
  });

  await audit({ action: 'alert_updated', entity: 'Alert', entityId: alert.id, userId: session.id });

  revalidatePath('/');
  revalidatePath('/profil');
  revalidatePath('/alertes');
  return null;
}

/**
 * Supprimer une alerte.
 *
 * ⚠ Résoudre est réversible, supprimer ne l'est pas : c'est pourquoi
 * l'interface ne propose la suppression que sur les alertes déjà résolues.
 * Une alerte active doit d'abord être traitée, pas effacée.
 */
export async function deleteAlertAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');

  const alert = await db.alert.findFirst({
    where: { id, userId: session.id },
    select: { id: true, resolvedAt: true },
  });
  if (!alert) return 'Alerte introuvable.';

  if (!alert.resolvedAt) return 'Traitez d’abord cette alerte avant de la supprimer.';

  await db.alert.delete({ where: { id: alert.id } });
  await audit({ action: 'alert_deleted', entity: 'Alert', entityId: alert.id, userId: session.id });

  revalidatePath('/');
  revalidatePath('/profil');
  revalidatePath('/alertes');
  return null;
}
/**
 * Enregistrer une alerte CALCULÉE comme « traitée » (flow.md §33).
 *
 * Les alertes de `getDashboard` sont recalculées à chaque appel et ne sont
 * donc pas stockées. Cette action sert à persister le fait que l'utilisateur a
 * traité une alerte d'un type donné : elle crée la ligne `Alert` correspondante,
 * marquée résolue, pour qu'elle ne soit plus présentée.
 *
 * L'upsert porte sur `(userId, type)` : traiter deux fois la même alerte ne crée
 * pas deux lignes. Le `type` est la clé naturelle — c'est lui qui identifie le
 * constat, pas l'identifiant technique.
 */
export async function acknowledgeAlertAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();

  const type = String(formData.get('type') ?? '');

  // Le formulaire transmet aussi `title`, `body` et `severity` pour l'affichage,
  // mais cette action les IGNORE volontairement : seul `type` est lu, et le
  // contenu enregistré provient du moteur. Les lire ici sans s'en servir
  // n'apporterait rien — d'où leur absence, pas un `void` artificiel.

  // Ces quatre champs viennent d'un `<form>` : on ne fait jamais confiance à un
  // contenu client sans vérifier qu'il correspond à une alerte réellement
  // calculée pour cet utilisateur (flow.md §40).
  const dashboard = await getDashboard(session.id);
  const known = dashboard.alerts.find((a) => a.type === type);
  if (!known) return 'Alerte inconnue ou déjà traitée.';

  // Le contenu affiché est celui du moteur, jamais celui transmis par le client.
  await db.alert.upsert({
    where: { userId_type: { userId: session.id, type } },
    create: {
      userId: session.id,
      type,
      severity: known.severity,
      title: known.title,
      body: known.body,
      actionable: known.actionable,
      resolvedAt: new Date(),
    },
    update: { resolvedAt: new Date() },
  });

  await audit({ action: 'alert_acknowledged', entity: 'Alert', userId: session.id });

  revalidatePath('/alertes');
  revalidatePath('/');
  revalidatePath('/profil');
  return null;
}

// ---------- Profil (flow.md §38) ----------

/**
 * Modification du profil.
 *
 * Ni le téléphone ni le palier ne sont modifiables ici :
 * - le téléphone est l'IDENTITÉ de connexion, le changer exige une
 *   vérification OTP sur le nouveau numéro, pas une Server Action ;
 * - le palier relève de la facturation.
 *
 * Un champ vide est enregistré comme `null` et non comme une chaîne vide :
 * `''` se lirait « prénom renseigné mais vide », ce qui fausse l'affichage.
 */
export async function updateProfileAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();

  const firstName = String(formData.get('firstName') ?? '').trim();
  const lastName = String(formData.get('lastName') ?? '').trim();

  const parsed = updateProfileSchema.safeParse({
    firstName: firstName || undefined,
    lastName: lastName || undefined,
  });
  if (!parsed.success) return firstIssue(parsed.error);

  // ⚠ `|| null` et non `?? null` : `''` n'est ni `null` ni `undefined`, donc
  // `'' ?? null` renverrait `''`. La chaîne vide doit EFFACER le champ, sinon
  // la base garderait un prénom « renseigné mais vide ».
  await db.user.update({
    where: { id: session.id },
    data: {
      firstName: parsed.data.firstName?.trim() || null,
      lastName: parsed.data.lastName?.trim() || null,
    },
  });

  await audit({ action: 'profile_updated', entity: 'User', entityId: session.id, userId: session.id });

  revalidatePath('/profil');
  revalidatePath('/');
  return null;
}

/**
 * flow.md §21 — suppression d'un relevé.
 *
 * Un relevé est une MESURE : le supprimer efface une information du compteur.
 * On ne le propose que sur demande explicite, jamais en cascade silencieuse.
 */
export async function deleteReadingAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await requireUser();
  const id = String(formData.get('id') ?? '');

  const reading = await db.meterReading.findFirst({
    where: { id, meter: { property: { userId: session.id } } },
    select: { id: true },
  });
  if (!reading) return 'Relevé introuvable.';

  await db.meterReading.delete({ where: { id: reading.id } });

  revalidatePath('/');
  revalidatePath('/historique');
  revalidatePath('/consommation');
  await audit({ action: 'meter_reading_deleted', entity: 'MeterReading', entityId: reading.id, userId: session.id });
  return null;
}

