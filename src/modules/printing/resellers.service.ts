import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../config/prisma.service';

export interface CreateResellerDto {
  name: string;
}

export interface UpdateResellerDto {
  name?: string;
  active?: boolean;
}

/** ¿Este producto esta oculto para ese revendedor puntual? (hiddenFor = ids) */
export function isHiddenForReseller(
  product: { hiddenFor?: unknown },
  resellerId: string,
): boolean {
  return (
    Array.isArray(product.hiddenFor) && product.hiddenFor.includes(resellerId)
  );
}

// El catalogo publico nacio con un unico link (PrintSettings.publicToken) que
// era el de Marcelito: al migrar, ese link pasa a ser su revendedor.
const LEGACY_RESELLER_NAME = 'Marcelito';

/**
 * Revendedores del catalogo publico. Cada uno entra con su propio link
 * (token) y ve solo sus pedidos y su deuda; el precio de reventa es el mismo
 * para todos.
 */
@Injectable()
export class ResellersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Migracion perezosa del link unico: si el dueno todavia no tiene
   * revendedores, se crea "Marcelito" con el publicToken de siempre (su link
   * sigue andando) y se le asignan los pedidos que ya estaban a su nombre.
   */
  private async ensureDefault(settings: { userId: string; publicToken: string }) {
    const existing = await this.prisma.printReseller.count({
      where: { userId: settings.userId },
    });
    if (existing > 0) return null;

    const reseller = await this.prisma.printReseller.create({
      data: {
        userId: settings.userId,
        name: LEGACY_RESELLER_NAME,
        token: settings.publicToken,
      },
    });
    await this.prisma.printOrder.updateMany({
      where: {
        userId: settings.userId,
        resellerId: null,
        customerName: LEGACY_RESELLER_NAME,
      },
      data: { resellerId: reseller.id },
    });
    return reseller;
  }

  /** Token del link publico -> revendedor + parametros de costeo del dueno. */
  async resolveToken(token: string) {
    const reseller = await this.prisma.printReseller.findUnique({
      where: { token },
    });
    if (reseller) {
      if (!reseller.active) throw new NotFoundException('Catalogo no encontrado');
      const settings = await this.prisma.printSettings.findUnique({
        where: { userId: reseller.userId },
      });
      if (!settings) throw new NotFoundException('Catalogo no encontrado');
      return { reseller, settings };
    }

    // Link viejo: solo sirve para migrar. Con revendedores ya creados no
    // resuelve nada, asi rotar el token de Marcelito revoca de verdad.
    const settings = token
      ? await this.prisma.printSettings.findUnique({
          where: { publicToken: token },
        })
      : null;
    const migrated = settings ? await this.ensureDefault(settings) : null;
    if (!settings || !migrated) {
      throw new NotFoundException('Catalogo no encontrado');
    }
    return { reseller: migrated, settings };
  }

  async list(userId: string) {
    const settings = await this.prisma.printSettings.findUnique({
      where: { userId },
    });
    if (settings) await this.ensureDefault(settings);
    return this.prisma.printReseller.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async findOwned(userId: string, id: string) {
    const reseller = await this.prisma.printReseller.findFirst({
      where: { id, userId },
    });
    if (!reseller) throw new NotFoundException('Revendedor no encontrado');
    return reseller;
  }

  /** Revendedor del dueno o NotFound (para validar un resellerId que llega de afuera). */
  async getOwned(userId: string, id: string) {
    return this.findOwned(userId, id);
  }

  private async assertNameFree(userId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.printReseller.findFirst({
      where: { userId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (clash) {
      throw new BadRequestException('Ya hay un revendedor con ese nombre');
    }
  }

  async create(userId: string, dto: CreateResellerDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Falta el nombre del revendedor');
    await this.list(userId); // migra el link viejo antes de sumar otro
    await this.assertNameFree(userId, name);
    return this.prisma.printReseller.create({
      data: { userId, name, token: randomUUID() },
    });
  }

  async update(userId: string, id: string, dto: UpdateResellerDto) {
    await this.findOwned(userId, id);
    const data: { name?: string; active?: boolean } = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Falta el nombre del revendedor');
      await this.assertNameFree(userId, name, id);
      data.name = name;
    }
    if (dto.active !== undefined) data.active = !!dto.active;
    return this.prisma.printReseller.update({ where: { id }, data });
  }

  /** Rota el token: el link que tenia ese revendedor deja de funcionar. */
  async regenerateToken(userId: string, id: string) {
    await this.findOwned(userId, id);
    return this.prisma.printReseller.update({
      where: { id },
      data: { token: randomUUID() },
    });
  }
}
