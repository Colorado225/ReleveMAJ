// Validation Zod — flow.md §40 et §52 (messages en français simple)
import { z } from 'zod';

export const readingTypeSchema = z.enum(['INDEX', 'CREDIT', 'ENERGY_AVAILABLE', 'UNKNOWN']);
export const unitSchema = z.enum(['KWH', 'M3', 'FCFA', 'UNKNOWN']);
export const paymentMethodSchema = z.enum([
  'ORANGE_MONEY',
  'MTN_MOMO',
  'MOOV_MONEY',
  'WAVE',
  'CASH',
  'OTHER',
]);

/**
 * Un relevé : flow.md §52 — montant négatif interdit, date non future.
 */
export const createReadingSchema = z.object({
  value: z.number().min(0, 'La valeur ne peut pas être négative.'),
  unit: unitSchema,
  readingType: readingTypeSchema,
  readingDate: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Date invalide.')
    .refine((v) => !v || new Date(v).getTime() <= Date.now(), 'La date ne peut pas être dans le futur.'),
  note: z.string().max(500).optional(),
});

export type CreateReadingInput = z.infer<typeof createReadingSchema>;

/**
 * Une recharge CIE : flow.md §35 — le champ kWh est facultatif.
 */
export const createPurchaseSchema = z.object({
  amountPaid: z.number().min(1, 'Le montant doit être supérieur à 0.'),
  energyCreditedKwh: z.number().min(0, 'Les kWh ne peuvent pas être négatifs.').optional(),
  paymentMethod: paymentMethodSchema.default('OTHER'),
  purchasedAt: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Date invalide.')
    .refine((v) => !v || new Date(v).getTime() <= Date.now(), 'La date ne peut pas être dans le futur.'),
  tokenReference: z.string().max(120).optional(),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

/** Une facture SODECI : minimum période, consommation, montant TTC (§22). */
export const createWaterBillSchema = z.object({
  periodStart: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date de début invalide.'),
  periodEnd: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date de fin invalide.'),
  consumptionM3: z.number().min(0, 'La consommation ne peut pas être négative.'),
  amountTtc: z.number().min(0, 'Le montant ne peut pas être négatif.'),
  invoiceReference: z.string().max(120).optional(),
});

export type CreateWaterBillInput = z.infer<typeof createWaterBillSchema>;

export const createMeterSchema = z.object({
  provider: z.enum(['CIE', 'SODECI']),
  utilityType: z.enum(['ELECTRICITY', 'WATER']),
  paymentMode: z.enum(['PREPAID', 'POSTPAID', 'UNKNOWN']).default('UNKNOWN'),
  meterNumber: z.string().max(60).optional(),
  subscribedPower: z.number().min(1, 'Puissance invalide.').optional(),
  label: z.string().max(80).optional(),
});

export type CreateMeterInput = z.infer<typeof createMeterSchema>;

export const createPropertySchema = z.object({
  name: z.string().min(1, 'Le nom du logement est requis.').max(80),
  address: z.string().max(200).optional(),
  isAbidjan: z.boolean().default(true),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

/** flow.md §32 — appareil du logement. */
export const createApplianceSchema = z.object({
  propertyId: z.string().min(1, 'Sélectionnez un logement.'),
  type: z.enum([
    'AC',
    'Fridge',
    'Freezer',
    'WaterHeater',
    'Pump',
    'TV',
    'Iron',
    'WashingMachine',
    'Other',
  ]),
  label: z.string().min(1, 'Donnez un nom à l’appareil.').max(80),
  powerWatts: z
    .number()
    .min(1, 'La puissance doit être supérieure à 0.')
    .max(10_000, 'Puissance inattendue — vérifiez la valeur en watts.'),
  hoursPerDay: z.number().min(0, 'Durée invalide.').max(24, 'Durée maximale : 24 h par jour.'),
  daysPerMonth: z.number().min(1, 'Au moins 1 jour par mois.').max(31, 'Maximum : 31 jours.'),
});

export type CreateApplianceInput = z.infer<typeof createApplianceSchema>;

export const requestOtpSchema = z.object({
  phone: z
    .string()
    .regex(/^\+225[0-9]{10}$/, 'Numéro invalide. Format attendu : +2250700000000.'),
});

export const verifyOtpSchema = z.object({
  phone: z.string().regex(/^\+225[0-9]{10}$/, 'Numéro invalide.'),
  code: z.string().regex(/^[0-9]{6}$/, 'Le code comporte 6 chiffres.'),
  firstName: z.string().max(60).optional(),
});

/**
 * Modification d'un logement — mêmes règles que la création (flow.md §60).
 * On réutilise volontairement le schéma de création : un champ ne peut pas
 * être valide à la création puis refusé à la modification.
 */
export const updatePropertySchema = createPropertySchema;

/**
 * Modification d'un compteur.
 * `propertyId` n'est pas modifiable : un compteur appartient à un logement
 * (flow.md §32) et le déplacer casserait l'historique rattaché.
 */
export const updateMeterSchema = createMeterSchema;

/**
 * ⚠ PAS de `updateReadingSchema`, volontairement (flow.md §21).
 *
 * La valeur d'un relevé EST la mesure : la modifier réécrirait
 * l'historique financier en silence. Un relevé se saisit, se signale
 * (`createReadingAction` renvoie une alerte si l'index baisse) ou se
 * supprime explicitement — jamais se réécrit.
 */

/** Modification d'une recharge CIE (flow.md §35). */
export const updatePurchaseSchema = createPurchaseSchema;

/** Modification d'une facture SODECI (flow.md §22). */
export const updateWaterBillSchema = createWaterBillSchema;