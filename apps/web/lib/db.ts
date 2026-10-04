import { PrismaClient } from '@prisma/client';

// Singleton : évite d'ouvrir un nouveau pool de connexions à chaque hot-reload
// en développement (recommandation officielle Next.js + Prisma).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;