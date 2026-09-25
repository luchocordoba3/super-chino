import { Prisma, PrismaClient } from './generated/prisma/index.js';
import { env } from './env';

// Los Decimal de Prisma se envían como número en el JSON de las respuestas.
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function (this: Prisma.Decimal) {
  return this.toNumber();
};

export const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
export { Prisma };
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** Decimal | null -> number */
export const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
