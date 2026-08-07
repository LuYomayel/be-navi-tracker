/**
 * Migra el negocio de impresion 3D desde los Google Sheets a NaviTracker.
 *
 * Carga los 12 productos del catalogo, los 8 filamentos comprados y los 5
 * movimientos de venta/muestra reales, ya leidos de los dos sheets vivos
 * ("Catalogo Marcelito v2" y "Seguimiento Luciano PRIVADO v2") el 2026-08-06.
 *
 * Idempotente: correrlo mas de una vez no duplica nada (matchea por nombre
 * de producto / marca+color+fecha+precio de filamento / fecha+producto+kind+
 * cantidad+montos de venta). Pensado para correr A MANO, nunca en el arranque
 * de la app.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register prisma/seed-printing.ts --email=<email>
 *   # o
 *   npx ts-node -r tsconfig-paths/register prisma/seed-printing.ts --userId=<id>
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  computePrintCost,
  computeSalePrice,
} from '../src/modules/printing/pricing';

const prisma = new PrismaClient();

// Parametros de costeo (B5/B6/B7/B8 del sheet privado).
const SETTINGS = {
  costPerGram: 20,
  wastePct: 0.15,
  powerPerHour: 12,
  defaultMarkup: 1.3,
  // Recargo de financiacion de las compras de filamento: NO se prorratea en
  // el $/g de ningun rollo puntual, se carga aparte (ver PLAN-navitracker-3d.md).
  financingSurcharge: 11776,
};

interface ProductSeed {
  name: string;
  author: string;
  makerworldId: string;
  grams: number;
  hours: number;
  colorsLabel: string;
  sizeMm: string | null;
  notes: string | null;
  publicPrice: number;
  licenseOk: boolean;
  markupOverride: number | null;
  expectedCost: number; // para verificar contra la formula al migrar
  expectedPriceToMarcelito: number;
}

const PRODUCTS: ProductSeed[] = [
  {
    name: 'Rompecabezas de numeros 1-10',
    author: 'Dprintas',
    makerworldId: '1215273',
    grams: 127,
    hours: 4.5,
    colorsLabel: '1',
    sizeMm: '165x165x6',
    notes: null,
    publicPrice: 11000,
    licenseOk: false,
    markupOverride: null,
    expectedCost: 3000,
    expectedPriceToMarcelito: 3900,
  },
  {
    name: 'Tabla motricidad y colores',
    author: 'viajante3d',
    makerworldId: '692286',
    grams: 133,
    hours: 3.7,
    colorsLabel: '1',
    sizeMm: '250x200x4',
    notes: null,
    publicPrice: 9000,
    licenseOk: false,
    markupOverride: null,
    expectedCost: 3100,
    expectedPriceToMarcelito: 4000,
  },
  {
    name: 'Bandejas ordenar numeros 1-6',
    author: 'Aimeeee',
    makerworldId: '1075059',
    grams: 393,
    hours: 9.4,
    colorsLabel: '7',
    sizeMm: '180x105x8',
    notes: 'Medida por bandeja (son 6 bandejas en el set)',
    publicPrice: 20000,
    licenseOk: false,
    markupOverride: null,
    expectedCost: 9200,
    expectedPriceToMarcelito: 12000,
  },
  {
    name: 'Rompecabezas apilable de formas',
    author: 'Stag3D',
    makerworldId: '2277895',
    grams: 146,
    hours: 4.6,
    colorsLabel: '5',
    sizeMm: '165x135x27',
    notes: null,
    publicPrice: 11000,
    licenseOk: false,
    markupOverride: null,
    expectedCost: 3400,
    expectedPriceToMarcelito: 4400,
  },
  {
    name: 'Numeros + bandeja de conteo',
    author: 'aurelija',
    makerworldId: '1164150',
    grams: 245,
    hours: 6.5,
    colorsLabel: '1',
    sizeMm: '188x200x5',
    notes: null,
    publicPrice: 15000,
    licenseOk: false,
    markupOverride: null,
    expectedCost: 5700,
    expectedPriceToMarcelito: 7400,
  },
  {
    name: 'Contar/ordenar 10 GIGANTE',
    author: 'xBased',
    makerworldId: '2085489',
    grams: 787,
    hours: 35.2,
    colorsLabel: 'multi',
    sizeMm: '540x110x15',
    notes: null,
    publicPrice: 42000,
    licenseOk: false,
    markupOverride: null,
    expectedCost: 18500,
    expectedPriceToMarcelito: 24100,
  },
  {
    name: 'Actividades numeros digitales',
    author: '3DPTK',
    makerworldId: '2289831',
    grams: 175,
    hours: 8.6,
    colorsLabel: '2',
    sizeMm: '162x142x20',
    notes: null,
    publicPrice: 12000,
    licenseOk: false,
    markupOverride: null,
    expectedCost: 4100,
    expectedPriceToMarcelito: 5300,
  },
  {
    name: 'TETRIS de equilibrio',
    author: 'fuxx',
    makerworldId: '1238708',
    grams: 494,
    hours: 14.3,
    colorsLabel: '7',
    sizeMm: 'base 80x220x20',
    notes: null,
    publicPrice: 30000,
    // fuxx tiene membresia comercial paga: unico autor con licencia OK hoy.
    licenseOk: true,
    markupOverride: 1.5,
    expectedCost: 11500,
    expectedPriceToMarcelito: 17300,
  },
  {
    name: 'Formas + tablero de letras',
    author: 'bd142',
    makerworldId: '781937',
    grams: 96,
    hours: 3.6,
    colorsLabel: '2',
    sizeMm: '130x160x10',
    notes: null,
    publicPrice: 9000,
    licenseOk: false,
    markupOverride: null,
    expectedCost: 2300,
    expectedPriceToMarcelito: 3000,
  },
  {
    name: 'Tablero numeros Montessori insert',
    author: '3DPTK',
    makerworldId: '2288359',
    grams: 113,
    hours: 6.2,
    colorsLabel: 'multi',
    sizeMm: '150x150x5',
    notes: null,
    publicPrice: 10000,
    licenseOk: false,
    markupOverride: null,
    expectedCost: 2700,
    expectedPriceToMarcelito: 3500,
  },
  {
    name: 'Juego de apilar formas 18m+',
    author: 'AU3D',
    makerworldId: '519917',
    grams: 281,
    hours: 8.3,
    colorsLabel: '3',
    sizeMm: '170x170x60',
    notes: null,
    publicPrice: 13000,
    licenseOk: false,
    markupOverride: null,
    expectedCost: 6600,
    expectedPriceToMarcelito: 8600,
  },
  {
    // OJO: en la planilla este producto figuraba mal como "TETRIS de
    // equilibrio" (nombre duplicado con el #8). El nombre correcto es este:
    // es la caja de almacenamiento del juego, no el juego en si.
    name: 'Caja almacenamiento TETR_S',
    author: 'fuxx',
    makerworldId: '2001384',
    grams: 451,
    hours: 8.6,
    colorsLabel: '1',
    sizeMm: null,
    notes: 'Color negro. Faltaba en el catalogo compartido con Marcelito (tenia 11 de 12 productos).',
    publicPrice: 30000,
    licenseOk: true,
    markupOverride: 1.5,
    expectedCost: 10500,
    expectedPriceToMarcelito: 15800,
  },
];

interface FilamentSeed {
  brand: string;
  material: string;
  color: string;
  pricePaid: number;
  purchasedAt: string;
  discarded: boolean;
  discardReason: string | null;
  notes: string | null;
}

const FILAMENTS: FilamentSeed[] = [
  {
    brand: 'Bambu Lab',
    material: 'PLA Lite',
    color: 'Rojo',
    pricePaid: 19969,
    purchasedAt: '2026-07-27',
    discarded: false,
    discardReason: null,
    notes: 'sin carrete',
  },
  {
    brand: 'Bambu Lab',
    material: 'PLA Lite',
    color: 'Cian',
    pricePaid: 19969,
    purchasedAt: '2026-07-27',
    discarded: false,
    discardReason: null,
    notes: 'sin carrete',
  },
  {
    brand: 'Bambu Lab',
    material: 'PLA Lite',
    color: 'Amarillo Girasol',
    pricePaid: 19969,
    purchasedAt: '2026-07-27',
    discarded: false,
    discardReason: null,
    notes: 'sin carrete',
  },
  {
    brand: 'GST3D',
    material: 'PLA+',
    color: 'Negro',
    pricePaid: 16946,
    purchasedAt: '2026-07-27',
    discarded: true,
    discardReason: 'mala calidad, no volver a comprar',
    notes: null,
  },
  {
    brand: 'Bambu Lab',
    material: 'PLA Lite',
    color: 'Naranja',
    pricePaid: 20572,
    purchasedAt: '2026-07-27',
    discarded: false,
    discardReason: null,
    notes: 'recarga',
  },
  {
    brand: 'Bambu Lab',
    material: 'PLA Lite',
    color: 'Negro',
    pricePaid: 26279,
    purchasedAt: '2026-08-03',
    discarded: false,
    discardReason: null,
    notes: 'con carrete',
  },
  {
    brand: 'Bambu Lab',
    material: 'PLA Lite',
    color: 'Negro',
    pricePaid: 21839,
    purchasedAt: '2026-08-04',
    discarded: false,
    discardReason: null,
    notes: 'sin carrete',
  },
  {
    brand: 'Bambu Lab',
    material: 'PLA Lite',
    color: 'Gris',
    pricePaid: 21839,
    purchasedAt: '2026-08-04',
    discarded: false,
    discardReason: null,
    notes: 'sin carrete',
  },
];

interface SaleSeed {
  date: string;
  productName: string;
  kind: 'venta' | 'muestra';
  qty: number;
  chargedUnit: number;
  costUnit: number;
  status: 'a_liquidar' | 'liquidado';
}

const SALES: SaleSeed[] = [
  {
    date: '2026-08-01',
    productName: 'Numeros + bandeja de conteo', // aurelija (#5)
    kind: 'muestra',
    qty: 1,
    chargedUnit: 0,
    costUnit: 5700,
    status: 'a_liquidar',
  },
  {
    date: '2026-08-01',
    productName: 'Rompecabezas de numeros 1-10', // Dprintas (#1)
    kind: 'muestra',
    qty: 1,
    chargedUnit: 0,
    costUnit: 3000,
    status: 'a_liquidar',
  },
  {
    date: '2026-08-01',
    productName: 'TETRIS de equilibrio', // fuxx (#8)
    kind: 'muestra',
    qty: 1,
    chargedUnit: 0,
    costUnit: 11500,
    status: 'a_liquidar',
  },
  {
    date: '2026-08-01',
    productName: 'TETRIS de equilibrio',
    kind: 'venta',
    qty: 2,
    chargedUnit: 17300,
    costUnit: 11500,
    status: 'a_liquidar',
  },
  {
    date: '2026-08-05',
    productName: 'TETRIS de equilibrio',
    kind: 'venta',
    qty: 2,
    chargedUnit: 17300,
    costUnit: 11500,
    status: 'a_liquidar',
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const email = args
    .find((a) => a.startsWith('--email='))
    ?.split('=')[1];
  const userId = args
    .find((a) => a.startsWith('--userId='))
    ?.split('=')[1];
  return { email, userId };
}

async function resolveUserId(): Promise<string> {
  const { email, userId } = parseArgs();
  if (userId) return userId;
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No existe un usuario con email ${email}`);
    return user.id;
  }
  throw new Error(
    'Falta el usuario a seedear. Usa --email=<email> o --userId=<id>.\n' +
      'Ejemplo: npx ts-node -r tsconfig-paths/register prisma/seed-printing.ts --email=vos@ejemplo.com',
  );
}

async function seedSettings(userId: string) {
  const existing = await prisma.printSettings.findUnique({ where: { userId } });
  if (existing) {
    await prisma.printSettings.update({
      where: { userId },
      data: {
        costPerGram: SETTINGS.costPerGram,
        wastePct: SETTINGS.wastePct,
        powerPerHour: SETTINGS.powerPerHour,
        defaultMarkup: SETTINGS.defaultMarkup,
        financingSurcharge: SETTINGS.financingSurcharge,
        // publicToken NO se toca: si Marcelito ya tiene el link, no lo rompemos.
      },
    });
    console.log('  Settings: actualizadas (token existente preservado).');
    return existing.publicToken;
  }
  const created = await prisma.printSettings.create({
    data: { userId, ...SETTINGS, publicToken: randomUUID() },
  });
  console.log(`  Settings: creadas. Token del catalogo publico: ${created.publicToken}`);
  return created.publicToken;
}

async function seedProducts(userId: string) {
  const idByName = new Map<string, string>();
  let created = 0;
  for (const p of PRODUCTS) {
    // Verificacion cruzada contra la formula pura antes de migrar: si algun
    // numero de la planilla no cierra con costPerGram/wastePct/powerPerHour
    // actuales, avisa en vez de migrar en silencio un dato inconsistente.
    const cost = computePrintCost({
      grams: p.grams,
      hours: p.hours,
      costPerGram: SETTINGS.costPerGram,
      wastePct: SETTINGS.wastePct,
      powerPerHour: SETTINGS.powerPerHour,
    });
    const priceToMarcelito = computeSalePrice(
      cost,
      p.markupOverride ?? SETTINGS.defaultMarkup,
    );
    if (cost !== p.expectedCost || priceToMarcelito !== p.expectedPriceToMarcelito) {
      console.warn(
        `  ⚠️  ${p.name}: formula da costo=${cost}/precio=${priceToMarcelito}, ` +
          `planilla decia costo=${p.expectedCost}/precio=${p.expectedPriceToMarcelito}`,
      );
    }

    const existing = await prisma.printProduct.findFirst({
      where: { userId, name: p.name },
    });
    if (existing) {
      idByName.set(p.name, existing.id);
      continue;
    }
    const row = await prisma.printProduct.create({
      data: {
        userId,
        name: p.name,
        author: p.author,
        makerworldUrl: `https://www.makerworld.com/es/models/${p.makerworldId}`,
        grams: p.grams,
        hours: p.hours,
        colorsLabel: p.colorsLabel,
        sizeMm: p.sizeMm,
        licenseOk: p.licenseOk,
        markupOverride: p.markupOverride,
        publicPrice: p.publicPrice,
        active: true,
        notes: p.notes,
      },
    });
    idByName.set(p.name, row.id);
    created++;
  }
  console.log(`  Productos: ${created} creados, ${PRODUCTS.length - created} ya existian.`);
  return idByName;
}

async function seedFilaments(userId: string) {
  const activeGoal = await prisma.goal.findFirst({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'desc' },
  });

  let created = 0;
  for (const f of FILAMENTS) {
    const existing = await prisma.filament.findFirst({
      where: {
        userId,
        brand: f.brand,
        color: f.color,
        purchasedAt: f.purchasedAt,
        pricePaid: f.pricePaid,
      },
    });
    if (existing) continue;

    const grams = 1000;
    const expense = await prisma.expense.create({
      data: {
        userId,
        date: f.purchasedAt,
        amount: f.pricePaid,
        description: `Filamento ${f.brand} ${f.material} ${f.color}`,
        source: 'printing',
        goalId: activeGoal?.id ?? null,
      },
    });
    await prisma.filament.create({
      data: {
        userId,
        brand: f.brand,
        material: f.material,
        color: f.color,
        pricePaid: f.pricePaid,
        grams,
        pricePerGram: f.pricePaid / grams,
        purchasedAt: f.purchasedAt,
        discarded: f.discarded,
        discardReason: f.discardReason,
        expenseId: expense.id,
        notes: f.notes,
      },
    });
    created++;
  }
  console.log(`  Filamentos: ${created} creados, ${FILAMENTS.length - created} ya existian.`);
}

async function seedSales(userId: string, idByName: Map<string, string>) {
  let created = 0;
  for (const s of SALES) {
    const productId = idByName.get(s.productName);
    if (!productId) {
      console.warn(`  ⚠️  Venta sin producto (no migrada): ${s.productName}`);
      continue;
    }
    const existing = await prisma.printSale.findFirst({
      where: {
        userId,
        date: s.date,
        productId,
        kind: s.kind,
        qty: s.qty,
        chargedUnit: s.chargedUnit,
        costUnit: s.costUnit,
      },
    });
    if (existing) continue;

    await prisma.printSale.create({
      data: {
        userId,
        date: s.date,
        productId,
        kind: s.kind,
        qty: s.qty,
        chargedUnit: s.chargedUnit,
        costUnit: s.costUnit,
        status: s.status,
      },
    });
    created++;
  }
  console.log(`  Ventas/muestras: ${created} creadas, ${SALES.length - created} ya existian.`);
}

async function printSummary(userId: string) {
  const [filaments, settings, sales] = await Promise.all([
    prisma.filament.findMany({ where: { userId } }),
    prisma.printSettings.findUnique({ where: { userId } }),
    prisma.printSale.findMany({ where: { userId } }),
  ]);
  const investedFilament =
    filaments.reduce((a, f) => a + f.pricePaid, 0) +
    (settings?.financingSurcharge ?? 0);
  const samples = sales.filter((s) => s.kind === 'muestra');
  const investedSamples = samples.reduce((a, s) => a + s.qty * s.costUnit, 0);
  const ventas = sales.filter((s) => s.kind === 'venta');
  const profitSalesTotal = ventas.reduce(
    (a, s) => a + s.qty * (s.chargedUnit - s.costUnit),
    0,
  );
  const result = profitSalesTotal - investedSamples;
  const missingToCoverFilament = Math.max(0, investedFilament - profitSalesTotal);

  console.log('\n── Balance del negocio 3D (post-migracion) ──');
  console.log(`  Invertido en filamento: $${investedFilament.toLocaleString('es-AR')}`);
  console.log(`  Invertido en muestras: $${investedSamples.toLocaleString('es-AR')}`);
  console.log(`  Ganancia de ventas (total): $${profitSalesTotal.toLocaleString('es-AR')}`);
  console.log(`  Resultado (ganancia - muestras): $${result.toLocaleString('es-AR')}`);
  console.log(
    `  Falta para cubrir el filamento: $${missingToCoverFilament.toLocaleString('es-AR')}`,
  );
}

async function main() {
  const userId = await resolveUserId();
  console.log(`Migrando negocio 3D para userId=${userId}...\n`);

  console.log('Settings:');
  const token = await seedSettings(userId);

  console.log('Productos:');
  const idByName = await seedProducts(userId);

  console.log('Filamentos:');
  await seedFilaments(userId);

  console.log('Ventas y muestras:');
  await seedSales(userId, idByName);

  await printSummary(userId);
  console.log(`\nCatalogo publico: /catalogo/${token}`);
  console.log('Listo.');
}

main()
  .catch((err) => {
    console.error('Error migrando el negocio 3D:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
