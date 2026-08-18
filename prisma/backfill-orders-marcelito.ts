/**
 * Backfill: convierte las ventas historicas de Marcelito en pedidos
 * "entregado" LINKEADOS (PrintSale.orderId), para que su link publico
 * muestre todo el historial y la deuda real.
 *
 * Criterio: kind='venta', sin orderId y sin channel (las ventas directas,
 * ej "directa (Bruno)", NO son de Marcelito y quedan afuera). Se agrupan
 * por fecha: un pedido por dia de entrega, con una item por venta y el
 * precio realmente cobrado (chargedUnit) como snapshot.
 *
 * Idempotente: solo toca ventas con orderId null; re-correrlo no duplica.
 * Default DRY-RUN: sin --apply solo muestra lo que haria.
 *
 * Uso (en el droplet, /home/be-navi-tracker):
 *   npx ts-node -r tsconfig-paths/register prisma/backfill-orders-marcelito.ts --email=<email> [--apply] [--include-muestras]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}
const APPLY = process.argv.includes('--apply');
const INCLUDE_MUESTRAS = process.argv.includes('--include-muestras');

async function main() {
  const email = arg('email');
  const userId = arg('userId');
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : email
      ? await prisma.user.findUnique({ where: { email } })
      : null;
  if (!user) throw new Error('Usuario no encontrado (--email= o --userId=)');

  const sales = await prisma.printSale.findMany({
    where: {
      userId: user.id,
      orderId: null,
      channel: null, // channel con texto = venta directa/feria, no Marcelito
      ...(INCLUDE_MUESTRAS ? {} : { kind: 'venta' }),
    },
    include: { product: true },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  if (!sales.length) {
    console.log('Nada para backfillear (todas las ventas ya tienen pedido).');
    return;
  }

  // Un pedido por fecha de entrega, con las ventas de ese dia como items.
  const byDate = new Map<string, typeof sales>();
  for (const s of sales) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }

  console.log(
    `${APPLY ? 'APLICANDO' : 'DRY-RUN (sin --apply no escribe nada)'} — ${sales.length} ventas → ${byDate.size} pedidos:\n`,
  );

  for (const [date, daySales] of byDate) {
    const total = daySales.reduce((a, s) => a + s.qty * s.chargedUnit, 0);
    console.log(`📦 Pedido ${date} — entregado — $${total.toLocaleString('es-AR')}`);
    for (const s of daySales) {
      console.log(
        `   • ${s.qty}x ${s.product?.name ?? '?'} @ $${s.chargedUnit.toLocaleString('es-AR')} (${s.kind}, ${s.status})`,
      );
    }
    if (!APPLY) continue;

    const order = await prisma.printOrder.create({
      data: {
        userId: user.id,
        customerName: 'Marcelito',
        status: 'entregado',
        // createdAt = mediodia ART de la fecha de la venta, para que el
        // historial quede en orden cronologico real.
        createdAt: new Date(`${date}T12:00:00-03:00`),
        items: {
          create: daySales.map((s) => ({
            productId: s.productId,
            qty: s.qty,
            unitPrice: s.chargedUnit,
          })),
        },
      },
    });
    // El link venta↔pedido: sin esto el backfill no tiene sentido.
    for (const s of daySales) {
      await prisma.printSale.update({
        where: { id: s.id },
        data: { orderId: order.id, channel: 'pedido Marcelito' },
      });
    }
    console.log(`   ✔ creado ${order.id} y ${daySales.length} venta(s) linkeada(s)\n`);
  }

  if (APPLY) {
    // Verificacion post: ninguna venta de Marcelito sin pedido.
    const left = await prisma.printSale.count({
      where: {
        userId: user.id,
        orderId: null,
        channel: null,
        ...(INCLUDE_MUESTRAS ? {} : { kind: 'venta' }),
      },
    });
    console.log(`Ventas de Marcelito sin pedido restantes: ${left}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
