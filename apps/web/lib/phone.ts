/**
 * Normalisation du numéro ivoirien (flow.md §40).
 *
 * Le serveur valide strictement `+225` suivi de 10 chiffres (`requestOtpSchema`).
 * Une personne tape pourtant « 07 00 00 00 00 », « 2250700000000 » ou
 * « +225 07 00 00 00 00 ». On nettoie donc AVANT l'envoi pour que le refus ne
 * porte que sur une vraie erreur de saisie, jamais sur un format cosmétique.
 *
 * Cette fonction ne contourne aucune règle métier : elle produit exactement la
 * forme attendue par le schéma, ou `null` si le numéro est réellement invalide.
 */

/** Préfixe ivoirien attendu par `requestOtpSchema`. */
export const CIV_PREFIX = '+225';

/** 10 chiffres après l'indicatif : 2 préfixes opérateur + 8 chiffres. */
const LOCAL_LENGTH = 10;

function strip(raw: string): string {
  // on ne garde que les chiffres et un éventuel « + » de tête
  return raw.replace(/[^\d+]/g, '');
}

/**
 * Renvoie le numéro au format canonique `+225XXXXXXXXXX`, ou `null` si la
 * saisie ne peut pas devenir un numéro ivoirien valide.
 */
export function normalizeCivPhone(raw: string): string | null {
  const cleaned = strip(raw);
  if (!cleaned) return null;

  let digits: string;

  if (cleaned.startsWith('+')) {
    // « +225… » ou « +… » : on retire l'indicatif international si présent
    const withoutPlus = cleaned.slice(1);
    if (withoutPlus.startsWith('225')) {
      digits = withoutPlus.slice(3);
    } else {
      // indicatif pays différent : hors périmètre de la V1 (flow.md §40)
      return null;
    }
  } else if (cleaned.startsWith('00225')) {
    digits = cleaned.slice(5);
  } else if (cleaned.startsWith('225')) {
    digits = cleaned.slice(3);
  } else if (cleaned.startsWith('0')) {
    // numéro local mobile « 0700000000 »
    digits = cleaned;
  } else if (cleaned.startsWith('2')) {
    // numéro local fixe « 2721234567 » (2xx = fixe abidjanais). Le cas « 225… »
    // a déjà été traité ci-dessus, donc un « 2 » ici est bien un fixe.
    digits = cleaned;
  } else {
    return null;
  }

  if (digits.length !== LOCAL_LENGTH) return null;
  if (!/^\d+$/.test(digits)) return null;
  // le format national ivoirien commence par 0 (mobile) ou 2 (fixe)
  if (digits[0] !== '0' && digits[0] !== '2') return null;

  return `${CIV_PREFIX}${digits}`;
}

/** Vrai si la saisie peut déjà être envoyée (évite une erreur serveur inutile). */
export function isCivPhoneComplete(raw: string): boolean {
  return normalizeCivPhone(raw) !== null;
}

/**
 * Affichage lisible : « +225 07 00 00 00 00 ».
 * Utilisé pour rappeler à l'utilisateur le numéro pendant la saisie du code.
 */
export function formatCivPhone(canonical: string): string {
  const digits = canonical.startsWith(CIV_PREFIX) ? canonical.slice(CIV_PREFIX.length) : canonical;
  if (digits.length !== LOCAL_LENGTH) return canonical;
  return `${CIV_PREFIX} ${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`;
}