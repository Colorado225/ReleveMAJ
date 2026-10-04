'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from './auth';
import { db } from './db';
import { addReading, resolveMeterTariff } from './services';
import {
  createApplianceSchema,
  createMeterSchema,
  createPropertySchema,
  createPurchaseSchema,
  createReadingSchema,
  createWaterBillSchema,
  updateMeterSchema,
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
