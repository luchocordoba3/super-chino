/**
 * Datos de demostración: pnpm db:seed (si el local DEMO01 ya existe, no hace nada).
 * Dueño: dueno@demo.com / demo1234 (PIN 0000) · Empleados: sofia (PIN 1234), martin (PIN 5678) · Código de local: DEMO01
 */
import { prisma } from '../src/db';
import { DEMO_CODE, seedDemo } from '../src/services/demo';

if (await prisma.store.findUnique({ where: { code: DEMO_CODE } })) {
  console.log('El local demo ya existe (código DEMO01).');
} else {
  const { sales } = await seedDemo();
  console.log(`Listo. Local DEMO01 · dueño dueno@demo.com / demo1234 · empleados sofia (1234) y martin (5678). Ventas: ${sales}`);
}
await prisma.$disconnect();
