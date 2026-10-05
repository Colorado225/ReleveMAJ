// Helpers de l'API REST — flow.md §38 et §40.
//
// L'API ne réimplémente aucune règle métier : elle valide, délègue aux services
// existants et sérialise. Toute réponse d'erreur porte un message en français
// simple, utilisable directement dans l'interface (§52).
import { NextResponse } from 'next/server';
import { verifyAccessToken, type SessionUser } from './auth-core';
import { checkRateLimit, purgeExpiredRateLimits } from './rate-limit';
import { rateLimitKey } from './client-ip';

export type ApiError = { error: string; field?: string };

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data as object, { status });
}

/** Erreur applicative : le message est destiné à l'utilisateur final. */
export function fail(message: string, status = 400, field?: string): NextResponse {
  return NextResponse.json({ error: message, ...(field ? { field } : {}) }, { status });
}

export function unauthorized(message = 'Authentification requise.'): NextResponse {
  return fail(message, 401);
}

export function forbidden(message = 'Accès refusé.'): NextResponse {
  return fail(message, 403);
}

export function notFound(message = 'Ressource introuvable.'): NextResponse {
  return fail(message, 404);
}

/**
 * Authentifie la requête.
 *
 * Deux modes, tous deux fondés sur le même JWT (flow.md §40) :
 * - `Authorization: Bearer <token>` pour les clients mobiles / tiers ;
 * - le cookie de session httpOnly pour le front lui-même.
 */
export async function authenticate(request: Request): Promise<SessionUser | null> {
  const header = request.headers.get('authorization');
  const bearer = header?.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : null;

  if (bearer) return verifyAccessToken(bearer);

  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)consoci_session=([^;]+)/);
  if (match) return verifyAccessToken(decodeURIComponent(match[1]));

  return null;
}

/** Limitation de débit appliquée aux endpoints d'écriture. */
export async function guardRateLimit(request: Request, scope: string, limit: number, windowMs: number) {
  // purification best-effort : la table RateLimit grossit à chaque appel
  await purgeExpiredRateLimits().catch(() => undefined);

  return checkRateLimit(rateLimitKey(request.headers, scope), limit, windowMs);
}

export function firstIssue(error: { issues: { message: string; path?: (string | number)[] }[] }): ApiError {
  const issue = error.issues[0];
  return {
    error: issue?.message ?? 'Données invalides.',
    field: issue?.path?.join('.'),
  };
}

/** Résultat de validation unifié, indépendant de la lib de schéma utilisée. */
export type ParseResult<T> = { success: true; data: T } | { success: false; error: ApiError };

/**
 * Lit et valide un corps JSON.
 *
 * L'erreur est convertie ici une seule fois pour toutes les routes : le
 * validateur (Zod) ne fuit jamais au client, il n'expose qu'un message français.
 */
export async function parseBody<T>(
  request: Request,
  validate: (input: unknown) => ParseResult<T>,
): Promise<{ data: T; error: null } | { data: null; error: ApiError }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { data: null, error: { error: 'Corps de requête JSON invalide.' } };
  }

  const result = validate(raw);
  if (result.success) return { data: result.data, error: null };
  return { data: null, error: result.error };
}

/** Raccourci : parse un schéma Zod et renvoie un ParseResult. */
export function parse<T>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string; path?: (string | number)[] }[] } } },
  input: unknown,
): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: firstIssue(result.error) };
}

/**
 * Lit le corps JSON une seule fois.
 *
 * Un `Request` ne peut être lu qu'une fois : les routes qui ont besoin
 * d'inspecter un champ avant de valider (ex. le `meterId`) doivent passer par
 * ici plutôt que d'appeler `request.json()` puis `parseBody`.
 */
export async function readJson(request: Request): Promise<{ raw: Record<string, unknown> } | { raw: null; error: ApiError }> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { raw: null, error: { error: 'Corps de requête JSON invalide.' } };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { raw: null, error: { error: 'Corps de requête JSON attendu sous forme d’objet.' } };
  }
  return { raw: parsed as Record<string, unknown> };
}