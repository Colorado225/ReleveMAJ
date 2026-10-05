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
 * Modification PARTIELLE d'un logement — réservée à `PATCH /api/v1/properties/:id`.
 *
 * Un `PATCH` ne contient que les champs modifiés ; exiger la ligne entière
 * obligerait un client à relire, puis renvoyer, des valeurs qu'il ne touche pas.
 * Les mêmes bornes restent appliquées à chaque champ fourni.
 */
export const patchPropertySchema = createPropertySchema.partial();

/**
 * Modification d'un compteur.
 * `propertyId` n'est pas modifiable : un compteur appartient à un logement
 * (flow.md §32) et le déplacer casserait l'historique rattaché.
 */
export const updateMeterSchema = createMeterSchema;

/** Modification partielle d'un compteur — réservée à `PATCH /api/v1/meters/:id`. */
export const patchMeterSchema = createMeterSchema.partial();

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

/** Modification partielle d'une recharge — réservée à `PATCH`. */
export const patchPurchaseSchema = createPurchaseSchema.partial();

/** Modification d'une facture SODECI (flow.md §22). */
export const updateWaterBillSchema = createWaterBillSchema;

/** Modification partielle d'une facture — réservée à `PATCH`. */
export const patchWaterBillSchema = createWaterBillSchema.partial();

/**
 * Modification d'un appareil (flow.md §32).
 *
 * `propertyId` est retiré : un appareil appartient à un logement et le déplacer
 * changerait le périmètre de l'estimation de tout le logement. On modifie les
 * caractéristiques de l'appareil, pas son rattachement — même règle que pour
 * le compteur (`updateMeterSchema`).
 */
export const updateApplianceSchema = createApplianceSchema.omit({ propertyId: true });

export type UpdateApplianceInput = z.infer<typeof updateApplianceSchema>;

/**
 * Modification PARTIELLE d'un appareil — réservée à `PATCH /api/v1/appliances/:id`.
 *
 * `updateApplianceSchema` exige tous les champs : c'est le bon contrat pour le
 * formulaire web, qui renvoie la ligne entière. Un `PATCH` reçu par une API,
 * lui, ne contient que les champs réellement modifiés : sans cela, corriger une
 * seule puissance serait refusé faute de `type` et de `label`.
 *
 * `.partial()` conserve les mêmes bornes qu'à la création — un `PATCH` ne peut
 * pas valider moins qu'un formulaire complet.
 */
export const patchApplianceSchema = updateApplianceSchema.partial();

export type PatchApplianceInput = z.infer<typeof patchApplianceSchema>;

/**
 * Budget mensuel — flow.md §24 et §30.
 *
 * C'est un ENVELOPPE que l'utilisateur compare à sa facture, pas une donnée
 * réglementaire : aucune source n'est exigée, contrairement aux tarifs.
 *
 * La catégorie est une liste fermée pour que le budget reste comparable d'un
 * logement à l'autre. Une catégorie libre produirait des budgets qu'on ne peut
 * jamais agréger.
 */
export const BUDGET_CATEGORIES = ['ELECTRICITY', 'WATER', 'WASTE'] as const;

export const budgetSchema = z.object({
  propertyId: z.string().min(1, 'Sélectionnez un logement.'),
  category: z.enum(BUDGET_CATEGORIES, {
    errorMap: () => ({ message: 'Catégorie de budget inconnue.' }),
  }),
  monthlyAmount: z
    .number()
    .min(0, 'Le budget ne peut pas être négatif.')
    .max(10_000_000, 'Budget inattendu — vérifiez le montant.'),
});

export type BudgetInput = z.infer<typeof budgetSchema>;

/**
 * Modification d'un budget : seul le montant change.
 *
 * La catégorie EST le budget : en changer reviendrait à supprimer l'ancien et
 * en créer un autre, ce que l'interface propose déjà explicitement.
 */
export const updateBudgetSchema = budgetSchema.omit({ propertyId: true, category: true });

export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

/**
 * Profil utilisateur — flow.md §38 (`GET /api/v1/me`).
 *
 * Le téléphone et le palier ne sont PAS modifiables ici : le téléphone est
 * l'identifiant de connexion (le changer exige une vérification OTP), et le
 * palier relève de la facturation.
 */
export const updateProfileSchema = z.object({
  firstName: z.string().max(60, 'Prénom trop long.').optional(),
  lastName: z.string().max(60, 'Nom trop long.').optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;