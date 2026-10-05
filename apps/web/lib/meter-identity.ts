// Identité d'un compteur — instr.md §11.
//
// Un compteur porte deux données qui décrivent la MÊME chose : `provider` et
// `utilityType`. Le CIE est l'électricité, le SODECI l'eau. Rien ne les
// liait, donc `CIE` + `WATER` était acceptable, et un compteur pouvait passer
// de l'eau à l'électricité en cours de vie.
//
// Ce second point est le plus grave depuis qu'un relevé doit être cohérent avec
// son compteur (reading-rules) : un compteur ayant 200 relevés en m³ passé en
// `ELECTRICITY` rend ces 200 relevés illisibles — ils ne repasseraient plus la
// règle, et l'unité du compteur passerait à KWH alors que l'historique est en
// m³.
//
// La correction n'est PAS une interdiction absolue. Corriger un compteur
// ajouté par erreur est un besoin réel : on bloque seulement lorsqu'il y a un
// historique à réécrire. Un compteur sans donnée n'a rien à invalider.

import { db } from './db';

export type MeterKind = 'ELECTRICITY' | 'WATER';
export type MeterProvider = 'CIE' | 'SODECI';

/** Le fournisseur est déterminé par le type : CIE = électricité, SODECI = eau. */
export const PROVIDER_FOR_KIND: Record<MeterKind, MeterProvider> = {
  ELECTRICITY: 'CIE',
  WATER: 'SODECI',
};

/**
 * Vérifie que `provider` et `utilityType` décrivent bien le même réseau.
 *
 * @returns un message affichable, ou null si c'est cohérent.
 */
export function checkMeterCoherence(input: {
  provider: string;
  utilityType: string;
}): string | null {
  const attendu = PROVIDER_FOR_KIND[input.utilityType as MeterKind];
  if (!attendu) return null;
  if (input.provider !== attendu) {
    const reseau = attendu === 'CIE' ? 'CIE (électricité)' : 'SODECI (eau)';
    return `Un compteur ${input.utilityType === 'WATER' ? 'eau' : 'électrique'} est rattaché au réseau ${reseau}, pas à ${input.provider}.`;
  }
  return null;
}

/**
 * Autorise-t-on à réécrire l'identité d'un compteur ?
 *
 * @param actuel les valeurs enregistrées
 * @param demande les valeurs demandées, absentes = non modifiées
 * @param aDesDonnees le compteur porte-t-il des mesures, factures ou recharges
 * @returns un message expliquant le refus, ou null si la modification est permise
 */
export function checkMeterIdentityChange(input: {
  actuel: { provider: string; utilityType: string };
  demande: { provider?: string; utilityType?: string };
  aDesDonnees: boolean;
}): string | null {
  const { actuel, demande, aDesDonnees } = input;

  const nouveauType = demande.utilityType;
  if (nouveauType && nouveauType !== actuel.utilityType && aDesDonnees) {
    return `Ce compteur porte déjà des mesures : on ne peut pas le passer de ${
      actuel.utilityType === 'WATER' ? 'eau' : 'électrique'
    } à ${nouveauType === 'WATER' ? 'eau' : 'électrique'}, cela rendrait son historique illisible. Créez un second compteur, ou supprimez celui-ci s’il n’a pas servi.`;
  }

  const nouveauProvider = demande.provider;
  if (nouveauProvider && nouveauProvider !== actuel.provider && aDesDonnees) {
    return `Ce compteur est rattaché à ${actuel.provider} depuis son enregistrement et porte déjà des mesures : son réseau ne peut plus être modifié.`;
  }

  // Même sans historique, les deux champs doivent rester d'accord entre eux.
  const type = nouveauType ?? actuel.utilityType;
  const provider = nouveauProvider ?? actuel.provider;

  // Un compteur DÉJÀ incohérent (créé avant cette règle) ne doit pas le rester
  // indéfiniment : on ne compare que ce qui change, sinon le garde-fou
  // empêcherait de rattraper ce qu'il visait précisément à empêcher.
  const typeChange = nouveauType !== undefined && nouveauType !== actuel.utilityType;
  const providerChange = nouveauProvider !== undefined && nouveauProvider !== actuel.provider;
  if (!typeChange && !providerChange) return null;

  return checkMeterCoherence({ provider, utilityType: type });
}

/**
 * Un compteur porte-t-il quelque chose qui rend son identité non modifiable ?
 *
 * On compte TOUTES les tables rattachées au compteur, pas seulement les relevés :
 * une facture SODECI ou une recharge CIE est déjà un document financier, même
 * sans aucune mesure d'index. Ne compter que `meterReading` laisserait passer
 * la réécriture d'un compteur déjà facturé.
 *
 * Les tables sont comptées en parallèle plutôt qu'en série : la vérification est
 * appelée sur chaque `PATCH`.
 */
export async function meterHasHistory(meterId: string): Promise<boolean> {
  const [lectures, periodes, recharges, factures, propositions] = await Promise.all([
    db.meterReading.count({ where: { meterId } }),
    db.consumptionPeriod.count({ where: { meterId } }),
    db.electricityPurchase.count({ where: { meterId } }),
    db.waterBill.count({ where: { meterId } }),
    db.draftExtraction.count({ where: { meterId } }),
  ]);

  return lectures + periodes + recharges + factures + propositions > 0;
}