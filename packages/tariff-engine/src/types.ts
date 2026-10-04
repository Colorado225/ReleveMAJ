// Domain types — alignés sur flow.md §25/§26/§27/§50
export type Provider = 'CIE' | 'SODECI';
export type UtilityType = 'ELECTRICITY' | 'WATER';
export type PaymentMode = 'PREPAID' | 'POSTPAID' | 'UNKNOWN';
export type Unit = 'KWH' | 'M3' | 'FCFA' | 'UNKNOWN';
export type ReadingType = 'INDEX' | 'CREDIT' | 'ENERGY_AVAILABLE' | 'UNKNOWN';
export type DataSource = 'MANUAL' | 'PHOTO' | 'OCR' | 'IMPORT' | 'SYSTEM';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type TariffCategory = 'DOMESTIC_SOCIAL' | 'DOMESTIC_GENERAL';
export type PaymentMethod = 'ORANGE_MONEY' | 'MTN_MOMO' | 'MOOV_MONEY' | 'WAVE' | 'CASH' | 'OTHER';

/** Statut d'une valeur affichée — flow.md §1 et §51 */
export type ValueStatus =
  | 'REAL'
  | 'ESTIMATE'
  | 'FORECAST'
  | 'USER_ENTERED'
  | 'UNKNOWN'
  /** résultat déterministe du moteur tarifaire, jamais une facture officielle */
  | 'CALCULATED';

export type TariffTaxes = {
  ruralPerBimonthly: number;
  ruralPerKwh: number;
  RTIPerKwh: number;
  garbageAbidjanPerKwh: number;
  garbageOtherPerKwh: number;
};

export type TariffRules = {
  /** Prime fixe bimestrielle TTC */
  fixedBimonthlyTtc: number;
  tier1: { priceTtc: number; /** seuil explicite en kWh/bimestre */ thresholdKwh?: number; /** sinon seuil = multiplierHours × puissance × 0.22 */ multiplierHours?: number };
  tier2: { priceTtc: number };
  taxes: TariffTaxes;
};

/** TariffSource — flow.md §50 */
export type TariffSource = {
  sourceUrl: string;
  sourceName: string;
  documentReference: string;
  verifiedAt: string;
};

/** TariffScheme versionné — flow.md §14 et §50. Ne jamais modifier une version publiée. */
export type TariffScheme = {
  code: string;
  version: number;
  provider: Provider;
  category: TariffCategory;
  /** Puissance souscrite visée, en ampères */
  subscribedPower: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  source: TariffSource;
  rules: TariffRules;
};

export type EligibilityInput = {
  subscribedPower: number;
  usageType: 'DOMESTIC' | 'COMMERCIAL' | 'OTHER';
  /** kWh consommés par mois, calculés depuis l'historique réel */
  averageMonthlyConsumption?: number;
  /** jours d'historique réellement observés */
  observationDays?: number;
  /** seuil réglementaire de la grille, en kWh/bimestre */
  thresholdKwh?: number;
  /** durée minimale d'observation exigée, en jours */
  minimumObservationPeriodDays?: number;
};

export type EligibilityStatus = 'ELIGIBLE' | 'ABOVE_THRESHOLD' | 'INSUFFICIENT_DATA' | 'UNKNOWN_SCHEME';

export type EligibilityResult = {
  status: EligibilityStatus;
  /** message utilisateur — ne doit JAMAIS affirmer un changement officiel de tarif (§17) */
  message: string;
  averageMonthlyConsumption?: number;
  thresholdKwh?: number;
};

export type BillBreakdown = {
  schemeCode: string;
  schemeVersion: number;
  kwh: number;
  thresholdKwh: number;
  tier1Kwh: number;
  tier2Kwh: number;
  energyTtc: number;
  fixedTtc: number;
  taxesTtc: number;
  totalTtc: number;
  /** coût effectif observé — ce n'est PAS le prix réglementaire du kWh (§18) */
  effectiveCostPerKwh: number;
  /** toujours null pour SODECI tant que la grille n'est pas vérifiée (§23) */
  status: ValueStatus;
  source: TariffSource;
};

export type KwhEstimate = {
  kwh: number;
  confidence: Confidence;
  status: 'ESTIMATE';
  assumption: string;
};

export type AmountEstimate = {
  amountTtc: number;
  confidence: Confidence;
  status: 'ESTIMATE';
};