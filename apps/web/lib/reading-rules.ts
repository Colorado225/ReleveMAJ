// Cohérence compteur / relevé — flow.md §9, §10 et §21.
//
// Le serveur accepte des combinaisons impossibles : un relevé `KWH` de type
// `CREDIT` sur un compteur SODECI, ou un `INDEX` en `M3` sur un compteur CIE.
// Le schéma Zod ne valide que la valeur : il ne connaît pas le compteur.
//
// Conséquence réelle : `addReading` créait une `ConsumptionPeriod` en eau pour
// un compteur électrique, et le dashboard pouvait l'interpréter comme une vraie
// donnée d'eau.
//
// Ce module pose la règle en un seul endroit, utilisable par la Server Action
// comme par l'API, et testable sans base de données.

export type MeterKind = 'ELECTRICITY' | 'WATER';

/** Unité attendue pour chaque type de compteur. */
export const UNIT_FOR_KIND: Record<MeterKind, 'KWH' | 'M3'> = {
  ELECTRICITY: 'KWH',
  WATER: 'M3',
};

/**
 * Types de relevés admis par compteur.
 *
 * - un compteur d'eau se lit à l'INDEX (le compteur relev) ;
 * - un compteur d'eau se lit à l'INDEX (le compteur relevé) ;
 * - un compteur CIE accepte l'INDEX (postpayé), le CRÉDIT et le kWh DISPONIBLE
 *   (prépayé) : les trois existent réellement ;
 * - l'eau n'a pas de notion de kWh disponibles, ni de crédit d'énergie.
 *
 * `UNKNOWN` reste admis partout : flow.md §10 impose de pouvoir noter « je ne
 * sais pas » plutôt que d'obliger à deviner.
 *
 * ⚠ Les types CIE listés ici sont volontairement permissifs. L'audit (instr.md
 * §10) suggérait de n'ouvrir une `ConsumptionPeriod` qu'à l'eau — mais cette
 * règle est énoncée comme conditionnelle, et un compteur CIE postpayé a un index
 * réel. Imposer ce refus supprimerait des données valides : on ne l'applique
 * pas ici.
 */
export const READING_TYPES_FOR_KIND: Record<MeterKind, readonly string[]> = {
  ELECTRICITY: ['INDEX', 'CREDIT', 'ENERGY_AVAILABLE', 'UNKNOWN'],
  WATER: ['INDEX', 'UNKNOWN'],
};

/**
 * Vérifie qu'un relevé est cohérent avec son compteur.
 *
 * @returns un message en français affichable tel quel, ou null si c'est valide.
 */
export function validateReadingAgainstMeter(input: {
  meterKind: MeterKind;
  unit: string;
  readingType: string;
}): string | null {
  const { meterKind, unit, readingType } = input;

  if (unit !== 'UNKNOWN' && unit !== UNIT_FOR_KIND[meterKind]) {
    const attendu = UNIT_FOR_KIND[meterKind] === 'KWH' ? 'kWh (KWH)' : 'm³ (M3)';
    return `Ce compteur est en ${attendu}, pas en ${unit}. Corrigez l’unité du relevé.`;
  }

  if (!READING_TYPES_FOR_KIND[meterKind].includes(readingType)) {
    return `Un relevé ${readingType} n’a pas de sens sur un compteur ${meterKind === 'WATER' ? 'SODECI' : 'CIE'}.`;
  }

  return null;
}

/**
 * Une période de consommation est un différentiel d'index, donc elle n'a de
 * sens que pour un relevé d'INDEX.
 *
 * On ne filtre PAS sur le type de compteur : un compteur CIE postpayé a un
 * index en kWh tout aussi réel que celui d'un SODECI, et refuser de calculer
 * ici supprimerait des périodes valides déjà produites. La cohérence
 * compteur/relevé est assurée plus haut, par `validateReadingAgainstMeter`.
 */
export function shouldComputeConsumptionPeriod(input: { readingType: string }): boolean {
  return input.readingType === 'INDEX';
}