import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../config/prisma.service';

// Limite del archivo decodificado (el body ya viene achicado por el cliente).
const MAX_BYTES = 8 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Directorio de uploads: fuera del repo en prod (UPLOADS_DIR), ./uploads en dev. */
export function uploadsDir(): string {
  return process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
}

/** URL publica relativa de una foto (el frontend antepone el host de la API). */
export function photoUrl(p: string): string {
  return `/uploads/${p}`;
}

/**
 * Fotos de productos del catalogo. El cliente manda un dataURL ya
 * redimensionado (canvas), aca solo se valida, se escribe a disco y se
 * guarda el path relativo. Nada de S3/CDN: disco del droplet, servido
 * estatico por el propio backend bajo /uploads.
 */
@Injectable()
export class PhotosService {
  constructor(private readonly prisma: PrismaService) {}

  async addPhoto(userId: string, productId: string, dataUrl: string) {
    const product = await this.prisma.printProduct.findFirst({
      where: { id: productId, userId },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(
      dataUrl ?? '',
    );
    if (!match) {
      throw new BadRequestException('La foto tiene que ser JPG, PNG o WebP');
    }
    const [, mime, base64] = match;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) throw new BadRequestException('La foto esta vacia');
    if (buffer.length > MAX_BYTES) {
      throw new BadRequestException('La foto es demasiado grande (max 8MB)');
    }

    const relPath = `printing/${productId}-${randomUUID()}.${EXT_BY_MIME[mime]}`;
    const absPath = path.join(uploadsDir(), relPath);
    await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
    await fs.promises.writeFile(absPath, buffer);

    const order = await this.prisma.printProductPhoto.count({
      where: { productId },
    });
    return this.prisma.printProductPhoto.create({
      data: { userId, productId, path: relPath, order },
    });
  }

  async deletePhoto(userId: string, photoId: string) {
    const photo = await this.prisma.printProductPhoto.findFirst({
      where: { id: photoId, userId },
    });
    if (!photo) throw new NotFoundException('Foto no encontrada');
    await fs.promises
      .unlink(path.join(uploadsDir(), photo.path))
      .catch(() => null); // si el archivo ya no esta, la fila se borra igual
    await this.prisma.printProductPhoto.delete({ where: { id: photoId } });
    return true;
  }

  /** Reordena: el primer id de la lista queda como portada (order 0). */
  async reorder(userId: string, productId: string, ids: string[]) {
    const photos = await this.prisma.printProductPhoto.findMany({
      where: { productId, userId },
    });
    const valid = new Set(photos.map((p: any) => p.id));
    let order = 0;
    for (const id of ids) {
      if (!valid.has(id)) continue;
      await this.prisma.printProductPhoto.update({
        where: { id },
        data: { order: order++ },
      });
    }
    return true;
  }
}
