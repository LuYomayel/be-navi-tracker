import { inferProject, normalizeProject, resolveProject } from './task-project';

describe('inferProject', () => {
  it.each([
    ['EaseTrain — Sumar a Enzo como tester', 'EaseTrain'],
    ['Stampia - Testear fudo', 'Stampia'],
    ['Pulpou — Beacon: abrir PR', 'Pulpou'],
    ['EMA: simulacro de mudanza real', 'EMA'],
    ['Piano – Tocar Someone Like You', 'Piano'],
  ])('saca el proyecto del prefijo de "%s"', (title, expected) => {
    expect(inferProject(title)).toBe(expected);
  });

  it('las tareas del roadmap con 🇳🇿 van al proyecto NZ', () => {
    expect(inferProject('🇳🇿 Tramitar la visa Working Holiday')).toBe('NZ');
  });

  it.each([
    'Incorporar nuevos sitios a la extensión de PLP Enforce',
    'Test de tasa de sudoracion en handball',
    'Auditoría de entorno: despejar escritorio + poner señales',
    'Inscribirme a Ingeniería en Informática - UNPAZ',
    '',
  ])('sin prefijo corto no inventa proyecto: "%s"', (title) => {
    expect(inferProject(title)).toBeNull();
  });
});

describe('normalizeProject', () => {
  it('recorta espacios; vacio queda vacio (= sin proyecto a proposito)', () => {
    expect(normalizeProject('  Stampia ')).toBe('Stampia');
    expect(normalizeProject('   ')).toBe('');
    expect(normalizeProject(null)).toBe('');
    expect(normalizeProject(undefined)).toBeUndefined();
  });
});

describe('resolveProject', () => {
  it('el proyecto guardado gana sobre el titulo', () => {
    expect(
      resolveProject({ project: 'PulpoU', title: 'EaseTrain — algo' }),
    ).toBe('PulpoU');
  });

  it('sin proyecto guardado lo infiere del titulo', () => {
    expect(resolveProject({ project: null, title: 'Stampia - algo' })).toBe(
      'Stampia',
    );
  });

  it('proyecto vacio guardado = sin proyecto, no se re-infiere', () => {
    expect(resolveProject({ project: '', title: 'EaseTrain — algo' })).toBe(
      null,
    );
  });
});
