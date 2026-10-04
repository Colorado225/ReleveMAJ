import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utilitaire de composition de classes — emplacement attendu par shadcn/ui
 * (`components.json` → aliases.utils). La fonction elle-même vit déjà dans
 * `components/ui.tsx` : on y délègue pour qu'il n'y ait qu'une seule
 * implémentation et qu'un import `cn` reste valide quel que soit le chemin.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}