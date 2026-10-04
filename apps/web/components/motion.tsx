'use client';

// Animations — flow.md §44.
//
// Principes appliqués :
// - parcimonie : on anime l'ENTRÉE d'un élément, jamais en boucle ;
// - durée courte : 150–300 ms ;
// - « éviter les animations permanentes » : aucune animation infinie ici ;
// - `prefers-reduced-motion` est respecté nativement par Framer Motion
//   (useReducedMotion) : le contenu apparaît instantanément, sans mouvement.

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/** Transition unique du produit : courte et EaseOut, jamais rebondie. */
export const TRANSITION = { duration: 0.22, ease: [0.16, 1, 0.3, 1] } as const;

/** Apparition d'une carte, décalée pour éviter l'effet « pavé ». */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** décalage en secondes, 0.04 s entre deux cartes */
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...TRANSITION, delay: reduce ? 0 : delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Valeur de KPI qui change.
 *
 * flow.md §44 « changement des KPI ». On anime UNIQUEMENT au changement de
 * valeur, jamais en boucle. Si la valeur n'a pas bougé, rien ne se passe.
 */
export function AnimatedValue({ value, className }: { value: string; className?: string }) {
  const reduce = useReducedMotion();

  return (
    <motion.span
      key={value}
      className={className}
      initial={reduce ? { opacity: 1 } : { opacity: 0.4, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : TRANSITION}
    >
      {value}
    </motion.span>
  );
}
