/**
 * Datos de demostración: pnpm db:seed (si el local demo ya existe, no hace nada).
 * Super Chino (DEMO01): dueno@demo.com / demo1234 (PIN 0000) · empleados sofia (1234) y martin (5678).
 * Celu Control (DEMO02, con APP_FLAVOR=celulares): celus@demo.com / demo1234 · vendedor (1234), tecnico (2345), cadete (3456).
 */
import { prisma } from '../src/db';
import { env } from '../src/env';
import { DEMO_CODE, seedDemo } from '../src/services/demo';
import { PHONE_DEMO_CODE, seedPhoneDemo } from '../src/services/demoPhones';

if (env.APP_FLAVOR === 'celulares') {
  if (await prisma.store.findUnique({ where: { code: PHONE_DEMO_CODE } })) console.log('El local demo ya existe (código DEMO02).');
  else {
    const { sales } = await seedPhoneDemo();
    console.log(`Listo. Local DEMO02 · dueño celus@demo.com / demo1234 · vendedor (1234), tecnico (2345), cadete (3456). Ventas: ${sales}`);
  }
} else if (await prisma.store.findUnique({ where: { code: DEMO_CODE } })) {
  console.log('El local demo ya existe (código DEMO01).');
} else {
  const { sales } = await seedDemo();
  console.log(`Listo. Local DEMO01 · dueño dueno@demo.com / demo1234 · empleados sofia (1234) y martin (5678). Ventas: ${sales}`);
}
await prisma.$disconnect();
