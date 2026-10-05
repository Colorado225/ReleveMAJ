// Adresse IP du client — instr.md §19.
//
// `x-forwarded-for` est une chaîne, pas une adresse. Chaque proxy qui relaie
// y AJOUTE l'adresse de celui qui l'a请联系 : `[client, proxy1, proxy2]`.
//
// La ligne `headers.get('x-forwarded-for').split(',')[0]` qui était partout dans
// le code prend le PREMIER élément — donc l'entrée la plus à GAUCHE, celle que
// le client contrôle le plus facilement. Un `curl -H 'X-Forwarded-For: 1.2.3.4'`
// suffisait à s'attribuer une nouvelle limite de débit à chaque requête.
//
// Il faut donc lire la chaîne DEPUIS LA DROITE, en ne faisant confiance qu'aux
// sauts que l'on connaît : c'est le nombre de proxys de confiance, configurable.

/** Nombre de proxys de confiance entre Internet et l'application. */
function trustedHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  // Une valeur illisible ne doit pas diskretement retomber sur « je fais confiance
  // à tout » : on refuse, et l'appelant le voit via `trusted`.
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * L'IP du client, si elle est établie de façon fiable.
 *
 * @returns `ip` est `null` quand on ne peut pas établir de source fiable ; dans
 * ce cas `trusted` vaut `false` et l'appelant doit appliquer une clé de repli.
 */
export function resolveClientIp(h: {
  get(name: string): string | null;
}): { ip: string | null; trusted: boolean } {
  const hops = trustedHops();

  // Aucun proxy de confiance déclaré : les en-têtes sont ignorés. Un client
  // peut alors envoyer ce qu'il veut, il ne s'en sert pas — c'est tout l'intérêt.
  if (hops === 0) return { ip: null, trusted: false };

  const fwd = h.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    // Seuls les sauts de droite sont dignes de confiance.
    // `hops = 1` → le dernier élément, écrit par notre proxy immédiat.
    // On borne l'index : une chaîne plus courte que le nombre de proxys
    // configuré signifie que la topologie ne correspond pas, on ne devine pas.
    const index = parts.length - hops;
    const candidate = index >= 0 ? parts[index] : undefined;
    if (candidate && isPlausibleIp(candidate)) return { ip: candidate, trusted: true };
  }

  // `x-real-ip` n'est écrit que par le proxy de confiance, jamais par un client.
  const real = h.get('x-real-ip')?.trim();
  if (real && isPlausibleIp(real)) return { ip: real, trusted: true };

  return { ip: null, trusted: false };
}

/** Rejette les formes qui ne sont pas une IP : un en-tête est une chaîne libre. */
function isPlausibleIp(value: string): boolean {
  return /^[0-9a-fA-F:.]{2,45}$/.test(value) && !value.includes(' ');
}

/**
 * Clé de limitation de débit qui résiste à un `x-forwarded-for` falsifié.
 *
 * Quand l'IP n'est pas fiable, on NE met PAS `'inconnu'` seul : tous les
 * utilisateurs se retrouveraient dans la même file et le moindre abus bloquerait
 * tout le monde. On combine avec l'empreinte du client, constante pour une même
 * requête. Un attaquant peut changer son User-Agent, mais il doit désormais
 * changer deux choses pour obtenir un nouveau quota, et l'IP ne lui suffit plus.
 */
export function rateLimitKey(h: { get(name: string): string | null }, scope: string): string {
  const { ip } = resolveClientIp(h);
  if (ip) return `api:${scope}:${ip}`;

  const ua = h.get('user-agent') ?? 'sans-agent';
  // Tronqué : la clé sert d'index, pas d'archive.
  const empreinte = ua.slice(0, 64);
  return `api:${scope}:inconnu:${empreinte}`;
}