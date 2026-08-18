import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PhotosService } from './photos.service';
import { PrismaService } from '../../config/prisma.service';

// PNG 1x1 valido en base64
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('PhotosService', () => {
  let service: PhotosService;
  let prisma: any;
  let tmpDir: string;

  const userId = 'user-1';
  const product = { id: 'prod-1', userId, name: 'TETRIS' };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navi-photos-'));
    process.env.UPLOADS_DIR = tmpDir;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhotosService,
        {
          provide: PrismaService,
          useValue: {
            printProduct: { findFirst: jest.fn().mockResolvedValue(product) },
            printProductPhoto: {
              findFirst: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'ph-1', ...data }),
              ),
              update: jest.fn().mockResolvedValue({}),
              delete: jest.fn().mockResolvedValue({}),
            },
          },
        },
      ],
    }).compile();

    service = module.get(PhotosService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  it('guarda la foto en disco y crea la fila con orden incremental', async () => {
    prisma.printProductPhoto.count.mockResolvedValue(2);

    const photo = await service.addPhoto(userId, 'prod-1', PNG_1PX);

    expect(photo.order).toBe(2);
    expect(photo.path).toMatch(/^printing\/prod-1-.+\.png$/);
    const onDisk = fs.readFileSync(path.join(tmpDir, photo.path));
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it('rechaza un dataUrl que no es imagen', async () => {
    await expect(
      service.addPhoto(userId, 'prod-1', 'data:text/html;base64,PGI+aG9sYTwvYj4='),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza producto ajeno', async () => {
    prisma.printProduct.findFirst.mockResolvedValue(null);
    await expect(service.addPhoto(userId, 'otro', PNG_1PX)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('borra la foto de la base y del disco', async () => {
    const photo = await service.addPhoto(userId, 'prod-1', PNG_1PX);
    prisma.printProductPhoto.findFirst.mockResolvedValue({
      id: 'ph-1',
      userId,
      path: photo.path,
    });

    await service.deletePhoto(userId, 'ph-1');

    expect(prisma.printProductPhoto.delete).toHaveBeenCalledWith({
      where: { id: 'ph-1' },
    });
    expect(fs.existsSync(path.join(tmpDir, photo.path))).toBe(false);
  });

  it('reordena las fotos segun la lista de ids', async () => {
    prisma.printProductPhoto.findMany.mockResolvedValue([
      { id: 'a', productId: 'prod-1' },
      { id: 'b', productId: 'prod-1' },
    ]);

    await service.reorder(userId, 'prod-1', ['b', 'a']);

    expect(prisma.printProductPhoto.update).toHaveBeenCalledWith({
      where: { id: 'b' },
      data: { order: 0 },
    });
    expect(prisma.printProductPhoto.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { order: 1 },
    });
  });
});
