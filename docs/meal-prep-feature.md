# Meal Prep Feature — Documentación Completa

> Feature de planificación semanal de comidas para NaviTracker.
> Combina el plan del nutricionista (PDF) con SavedMeals, preferencias del usuario y generación con IA.

---

## Concepto General

Dos conceptos separados que trabajan juntos:

1. **Plan del Nutricionista** → El usuario importa el PDF de su nutricionista. OpenAI Vision lo parsea y extrae la estructura (qué comer cada día, cantidades, restricciones). Se guarda como "plan base".

2. **Meal Prep Semanal** → Cada semana el usuario genera su prep basándose en:
   - El plan del nutricionista (como guía)
   - Sus SavedMeals (comidas que ya tiene guardadas)
   - Slots fijos ("de lunes a viernes desayuno y meriendo lo mismo")
   - Contexto propio ("tengo pollo y arroz en la heladera, quiero incluir esta receta")
   - Sus goals de macros/calorías de UserPreferences
   - OpenAI genera el plan completo con análisis nutricional por comida

### Flujo Principal

```
PDF del nutri → OpenAI Vision → NutritionistPlan guardado
                                        ↓
"Generar meal prep" → OpenAI recibe: plan nutri + goals + savedMeals + contexto + slots fijos
                                        ↓
                                   MealPrep semanal (7×4 grid)
                                        ↓
                        Editás lo que quieras, fijás slots
                                        ↓
                   "Marcar como comido" → NutritionAnalysis → daily balance + XP
```

---

## Modelos de Datos (Prisma)

### NutritionistPlan

Almacena el plan importado del nutricionista. Solo uno activo por usuario a la vez.

```prisma
model NutritionistPlan {
  id           String   @id @default(cuid())
  userId       String
  name         String                      // "Plan nutricionista Marzo 2026"
  rawText      String?  @db.LongText       // Raw text extraido por AI para referencia
  parsedPlan   Json                        // Estructura semanal parseada (ver JSON schema abajo)
  weeklyNotes  String?  @db.Text           // Notas generales o restricciones del PDF
  pdfFilename  String?
  isActive     Boolean  @default(true)
  aiConfidence Float?
  aiCostUsd    Float?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  mealPreps MealPrep[]

  @@map("nutritionist_plans")
}
```

### MealPrep

Plan semanal generado. Contiene los 7 días × 4 comidas como JSON.

```prisma
model MealPrep {
  id                   String   @id @default(cuid())
  userId               String
  nutritionistPlanId   String?                   // Plan base usado (opcional)
  weekStartDate        String                    // YYYY-MM-DD del lunes
  weekEndDate          String                    // YYYY-MM-DD del domingo
  name                 String?                   // "Semana del 10 Mar"
  days                 Json                      // MealPrepWeek (ver JSON schema abajo)
  dailyTotals          Json                      // Record<DayKey, MacroSummary>
  weeklyTotals         Json                      // MacroSummary
  userContext          String?  @db.Text         // Input del usuario para la generación
  status               String   @default("active") // active | archived
  aiCostUsd            Float?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  user              User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  nutritionistPlan  NutritionistPlan? @relation(fields: [nutritionistPlanId], references: [id])

  @@map("meal_preps")
}
```

### Relaciones en User

Agregar al modelo User:

```prisma
nutritionistPlans  NutritionistPlan[]
mealPreps          MealPrep[]
```

---

## JSON Schemas (estructura de los campos Json)

### NutritionistPlan.parsedPlan

```typescript
interface ParsedNutritionistPlan {
  days: {
    monday: NutritionistDayPlan;
    tuesday: NutritionistDayPlan;
    wednesday: NutritionistDayPlan;
    thursday: NutritionistDayPlan;
    friday: NutritionistDayPlan;
    saturday: NutritionistDayPlan;
    sunday: NutritionistDayPlan;
  };
  generalNotes?: string;
  restrictions?: string[];        // ["sin lactosa", "sin gluten"]
  targetCalories?: number;
  targetMacros?: Macronutrients;
}

interface NutritionistDayPlan {
  breakfast?: NutritionistMealSlot;
  lunch?: NutritionistMealSlot;
  snack?: NutritionistMealSlot;      // merienda
  dinner?: NutritionistMealSlot;
}

interface NutritionistMealSlot {
  name: string;
  description?: string;
  foods: string[];              // Raw text: ["100g arroz integral", "150g pollo"]
  estimatedCalories?: number;
  notes?: string;
}
```

### MealPrep.days

```typescript
type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
type MealSlotKey = 'breakfast' | 'lunch' | 'snack' | 'dinner';

interface MealPrepWeek {
  days: Record<DayKey, MealPrepDay>;
}

interface MealPrepDay {
  slots: Record<MealSlotKey, MealPrepSlot>;
}

interface MealPrepSlot {
  name: string;
  foods: DetectedFood[];            // Reusar tipo existente DetectedFood
  totalCalories: number;
  macronutrients: Macronutrients;   // Reusar tipo existente
  notes?: string;
  savedMealId?: string;             // Si viene de un SavedMeal
  eatenAt?: string;                 // ISO datetime cuando se marcó como comido
  nutritionAnalysisId?: string;     // ID del NutritionAnalysis creado al comer
  isFixed?: boolean;                // True si el usuario fijó este slot
}

interface MacroSummary {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}
```

---

## Endpoints del Backend

### Nutritionist Plans

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/meal-prep/nutritionist-plan/import` | Importar PDF (array de imágenes base64) |
| `GET` | `/meal-prep/nutritionist-plan` | Obtener todos los planes del usuario |
| `GET` | `/meal-prep/nutritionist-plan/active` | Obtener el plan activo |
| `PUT` | `/meal-prep/nutritionist-plan/:id` | Actualizar nombre / setear como activo |
| `DELETE` | `/meal-prep/nutritionist-plan/:id` | Eliminar plan |

### Meal Preps

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/meal-prep` | Todos los preps (más reciente primero) |
| `GET` | `/meal-prep/active` | Prep activo de la semana actual |
| `POST` | `/meal-prep/generate` | Generar con IA |
| `POST` | `/meal-prep` | Crear manualmente (sin IA) |
| `PUT` | `/meal-prep/:id` | Editar prep completo |
| `PUT` | `/meal-prep/:id/slot` | Editar un slot específico |
| `POST` | `/meal-prep/:id/eat` | Marcar slot como comido → crea NutritionAnalysis |
| `DELETE` | `/meal-prep/:id` | Eliminar prep |

---

## Backend Module

### Estructura de archivos

```
backend/src/modules/meal-prep/
├── meal-prep.module.ts
├── meal-prep.controller.ts
├── meal-prep.service.ts
└── dto/
    └── index.ts
```

### DTOs

```typescript
class ImportNutritionistPlanDto {
  images: string[];       // array de base64, una por página del PDF
  name: string;
  pdfFilename?: string;
}

class UpdateNutritionistPlanDto {
  name?: string;
  isActive?: boolean;
}

class GenerateMealPrepDto {
  nutritionistPlanId?: string;      // cuál plan usar (defaults al activo)
  userContext?: string;             // "tengo pollo y arroz, evitar lácteos"
  weekStartDate: string;           // YYYY-MM-DD del lunes
  fixedSlots?: Array<{             // Slots que el usuario pre-fijó
    day: DayKey;
    mealType: MealSlotKey;
    savedMealId?: string;
    customSlot?: Partial<MealPrepSlot>;
  }>;
  savedMealPreferences?: string[]; // IDs de SavedMeals que la IA debería usar
}

class CreateMealPrepDto {
  weekStartDate: string;
  nutritionistPlanId?: string;
  name?: string;
  days: MealPrepWeek;
}

class UpdateMealPrepDto {
  name?: string;
  days?: MealPrepWeek;
  status?: 'active' | 'archived';
}

class UpdateSlotDto {
  day: DayKey;
  mealType: MealSlotKey;
  slot: Partial<MealPrepSlot>;
}

class MarkSlotEatenDto {
  day: DayKey;
  mealType: MealSlotKey;
  date: string;     // YYYY-MM-DD fecha real en que se comió
}
```

### Service Methods

```typescript
// Nutritionist Plan
importNutritionistPlan(images: string[], name: string, filename: string | undefined, userId: string): Promise<NutritionistPlan>
getAllNutritionistPlans(userId: string): Promise<NutritionistPlan[]>
getActiveNutritionistPlan(userId: string): Promise<NutritionistPlan | null>
updateNutritionistPlan(id: string, data: UpdateNutritionistPlanDto, userId: string): Promise<NutritionistPlan>
deleteNutritionistPlan(id: string, userId: string): Promise<boolean>

// Meal Prep
getAllMealPreps(userId: string): Promise<MealPrep[]>
getActiveMealPrep(userId: string): Promise<MealPrep | null>
generateMealPrep(dto: GenerateMealPrepDto, userId: string): Promise<MealPrep>
createMealPrep(dto: CreateMealPrepDto, userId: string): Promise<MealPrep>
updateMealPrep(id: string, dto: UpdateMealPrepDto, userId: string): Promise<MealPrep>
updateSlot(id: string, dto: UpdateSlotDto, userId: string): Promise<MealPrep>
markSlotEaten(id: string, dto: MarkSlotEatenDto, userId: string): Promise<{ mealPrep: MealPrep; nutritionAnalysis: NutritionAnalysis }>
deleteMealPrep(id: string, userId: string): Promise<boolean>

// Private helpers
private parsePdfWithAI(images: string[]): Promise<ParsedNutritionistPlan>
private generateWeeklyPrepWithAI(context, activePlan, savedMeals, preferences): Promise<MealPrepWeek>
private computeTotals(days: MealPrepWeek): { dailyTotals, weeklyTotals }
```

### Module Dependencies

```typescript
@Module({
  imports: [AICostModule, SavedMealsModule, NutritionModule],
  controllers: [MealPrepController],
  providers: [MealPrepService, PrismaService],
})
export class MealPrepModule {}
```

---

## OpenAI Prompts

### 1. PDF Nutritionist Plan Parser

- **Modelo**: gpt-4o
- **Temperature**: 0.1
- **Max tokens**: 4000
- **Patrón**: Igual que skin-fold.service.ts (imágenes como `image_url` content parts con `detail: 'high'`)

```
Eres un nutricionista experto. Analiza estas imágenes de un plan nutricional de un profesional
(PDF escaneado) y extrae la estructura completa del plan.

El plan puede contener:
- Plan semanal con días de la semana
- Comidas del día: desayuno, almuerzo, merienda, cena
- Alimentos con cantidades específicas
- Calorías estimadas por comida o totales diarios
- Restricciones alimentarias o notas generales
- Objetivos calóricos y de macronutrientes

INSTRUCCIONES:
1. Extrae los alimentos con sus cantidades exactas tal como aparecen
2. Si un día/comida no aparece, usa null
3. Si el plan repite días (ej: 'Lunes a Viernes igual'), duplica para cada día
4. estimatedCalories puede ser null si no aparece en el PDF

Responde ÚNICAMENTE con un JSON válido (sin bloques de código markdown):
{
  "days": {
    "monday": {
      "breakfast": { "name": string, "description": string|null, "foods": string[],
                     "estimatedCalories": number|null, "notes": string|null } | null,
      "lunch": { ... } | null,
      "snack": { ... } | null,
      "dinner": { ... } | null
    },
    ... (tuesday a sunday)
  },
  "generalNotes": string|null,
  "restrictions": string[],
  "targetCalories": number|null,
  "targetMacros": { "protein": number|null, "carbs": number|null,
                    "fat": number|null, "fiber": number|null } | null
}
```

### 2. Meal Prep Generation

- **Modelo**: gpt-4o
- **Temperature**: 0.3
- **Max tokens**: 6000

```
System: "Eres un nutricionista y chef experto en meal prep. Tu tarea es crear un plan de comidas
semanal estructurado, nutritivo y práctico. Las comidas deben ser realistas, variadas y alineadas
con el plan base del nutricionista cuando se proporcione."

User (construido dinámicamente):
"Crea un plan semanal de meal prep para la semana que comienza el {weekStartDate}.

{if nutritionistPlan}
PLAN BASE DEL NUTRICIONISTA:
{JSON.stringify(nutritionistPlan.parsedPlan)}
{endif}

OBJETIVOS DEL USUARIO:
- Calorías diarias objetivo: {dailyCalorieGoal} kcal
- Proteínas: {proteinGoal}g | Carbohidratos: {carbsGoal}g | Grasas: {fatGoal}g

{if userContext}
CONTEXTO DEL USUARIO:
{userContext}
{endif}

{if savedMeals.length > 0}
COMIDAS GUARDADAS DISPONIBLES:
{savedMeals.map(m => `- ${m.name} (${m.mealType}): ${m.totalCalories} kcal,
  P:${m.macronutrients.protein}g C:${m.macronutrients.carbs}g G:${m.macronutrients.fat}g`)}
{endif}

{if fixedSlots.length > 0}
SLOTS FIJOS (no modificar):
{fixedSlots.map(s => `- ${s.day} ${s.mealType}: ${s.slotName}`)}
{endif}

Para cada comida incluye alimentos con cantidades en gramos, calorías y macronutrientes.
Si una comida guardada es apropiada, úsala (indica savedMealId).

Responde ÚNICAMENTE con un JSON válido:
{
  "days": {
    "monday": {
      "slots": {
        "breakfast": {
          "name": string,
          "foods": [{ "name": string, "quantity": string, "calories": number,
                      "confidence": 0.85,
                      "macronutrients": { "protein": n, "carbs": n, "fat": n,
                                          "fiber": n, "sugar": n, "sodium": n },
                      "category": string }],
          "totalCalories": number,
          "macronutrients": { "protein": n, "carbs": n, "fat": n, "fiber": n,
                              "sugar": n, "sodium": n },
          "notes": string|null,
          "savedMealId": string|null
        },
        "lunch": { ... },
        "snack": { ... },
        "dinner": { ... }
      }
    },
    ... (tuesday a sunday)
  }
}
```

**Nota sobre token budget**: Si `nutritionistPlan.parsedPlan` excede 3000 caracteres, resumir a solo
targetCalories, targetMacros y generalNotes para no exceder el límite de tokens.

---

## Frontend Components

### Nuevos archivos

| Archivo | Descripción |
|---------|-------------|
| `types/mealPrep.ts` | Interfaces TypeScript (todos los tipos de arriba) |
| `hooks/useMealPrep.ts` | Hook custom con API calls y estado local del meal prep |
| `components/nutrition/MealPrepWidget.tsx` | Widget compacto en la vista principal (comidas de hoy) |
| `components/nutrition/MealPrepView.tsx` | Grid semanal completo (7 cols × 4 rows) |
| `components/nutrition/MealPrepSlotCard.tsx` | Card individual de cada slot (nombre, calorías, macros, botón comer) |
| `components/nutrition/GenerateMealPrepDialog.tsx` | Dialog para generar prep con IA |
| `components/nutrition/ImportNutritionistPlanDialog.tsx` | Dialog para importar PDF del nutri |

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `types/index.ts` | Agregar `export * from './mealPrep'` |
| `lib/api-client.ts` | Agregar namespace `mealPrep` con todos los endpoints |
| `app/(app)/nutrition/page.tsx` | Agregar tab "Meal Prep" + MealPrepWidget en overview |

### API Client

```typescript
mealPrep: {
  // Nutritionist plans
  importPlan: (data) => apiClient.post('/meal-prep/nutritionist-plan/import', data),
  getAllPlans: () => apiClient.get('/meal-prep/nutritionist-plan'),
  getActivePlan: () => apiClient.get('/meal-prep/nutritionist-plan/active'),
  updatePlan: (id, data) => apiClient.put(`/meal-prep/nutritionist-plan/${id}`, data),
  deletePlan: (id) => apiClient.delete(`/meal-prep/nutritionist-plan/${id}`),
  // Meal preps
  getAll: () => apiClient.get('/meal-prep'),
  getActive: () => apiClient.get('/meal-prep/active'),
  generate: (data) => apiClient.post('/meal-prep/generate', data),
  create: (data) => apiClient.post('/meal-prep', data),
  update: (id, data) => apiClient.put(`/meal-prep/${id}`, data),
  updateSlot: (id, data) => apiClient.put(`/meal-prep/${id}/slot`, data),
  eatSlot: (id, data) => apiClient.post(`/meal-prep/${id}/eat`, data),
  delete: (id) => apiClient.delete(`/meal-prep/${id}`),
},
```

### Hook useMealPrep

```typescript
// Estado
activeMealPrep: MealPrep | null
allPreps: MealPrep[]
activePlan: NutritionistPlan | null
isLoading: boolean
isGenerating: boolean

// Métodos
loadActiveMealPrep()
loadAllMealPreps()
importPlan(files, name)
generatePrep(dto)
eatSlot(prepId, day, mealType, date)
updateSlot(prepId, dto)
archivePrep(id)
```

### PDF a imágenes en el frontend

Usar `pdfjs-dist` para convertir cada página del PDF a imagen base64:

```typescript
import * as pdfjsLib from 'pdfjs-dist';

const extractImages = async (file: File): Promise<string[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({
      canvasContext: canvas.getContext('2d')!,
      viewport
    }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
  }
  return images;
};
```

---

## Data Flows Detallados

### Flow 1: Importar PDF del Nutricionista

```
1. Usuario selecciona archivo PDF en ImportNutritionistPlanDialog
2. pdfjs-dist convierte cada página a canvas → base64 JPEG
3. POST /api/meal-prep/nutritionist-plan/import
   body: { images: string[], name: string, pdfFilename?: string }
4. MealPrepService.importNutritionistPlan():
   a. openai.chat.completions.create({ model: 'gpt-4o', images como content parts })
   b. aiCostService.logFromCompletion(userId, 'meal-prep-pdf-import', completion)
   c. cleanOpenAIResponse() → JSON.parse() → ParsedNutritionistPlan
   d. prisma.nutritionistPlan.updateMany({ where: { userId }, data: { isActive: false } })
   e. prisma.nutritionistPlan.create({ parsedPlan, isActive: true })
5. Frontend: cierra dialog, carga getActivePlan(), toast success
```

### Flow 2: Generar Meal Prep

```
1. Usuario llena GenerateMealPrepDialog:
   - Elige plan nutricionista (o ninguno)
   - Escribe contexto ("tengo pollo y arroz...")
   - Selecciona SavedMeals para incluir
   - Fija slots ("desayuno L-V = Avena clásica")
   - Elige fecha de inicio (lunes)
2. POST /api/meal-prep/generate con GenerateMealPrepDto
3. MealPrepService.generateMealPrep():
   a. Fetch en paralelo: nutritionistPlan, savedMeals, userPreferences
   b. generateWeeklyPrepWithAI(dto, activePlan, savedMeals, preferences)
      - openai.chat.completions.create({ model: 'gpt-4o', max_tokens: 6000 })
      - aiCostService.logFromCompletion(userId, 'meal-prep-generate', completion)
      - JSON.parse() → MealPrepWeek
   c. Aplicar fixedSlots sobre el plan generado
   d. computeTotals(days) → { dailyTotals, weeklyTotals }
   e. Archivar prep activo de la misma semana si existe
   f. prisma.mealPrep.create({ days, dailyTotals, weeklyTotals, ... })
4. Frontend: cierra dialog, muestra plan en MealPrepView, toast success
```

### Flow 3: Marcar Slot como Comido

```
1. Usuario clickea "Marcar como comido" en MealPrepSlotCard
2. POST /api/meal-prep/:id/eat
   body: { day: 'monday', mealType: 'lunch', date: '2026-03-15' }
3. MealPrepService.markSlotEaten():
   a. Buscar MealPrep: prisma.mealPrep.findFirst({ where: { id, userId } })
   b. Extraer slot: days.days[dto.day].slots[dto.mealType]
   c. Verificar que slot.eatenAt no exista (evitar doble log)
   d. nutritionService.create({
        userId, date: dto.date, mealType: dto.mealType,
        foods: slot.foods, totalCalories: slot.totalCalories,
        macronutrients: slot.macronutrients,
        context: `Meal prep: ${slot.name}`,
        savedMealId: slot.savedMealId,
      }, userId)
   e. Actualizar slot en el JSON:
        slot.eatenAt = new Date().toISOString()
        slot.nutritionAnalysisId = nutritionAnalysis.id
   f. prisma.mealPrep.update({ where: { id }, data: { days: updatedDays } })
4. Frontend:
   - Actualiza activeMealPrep en el hook (slot muestra estado "comido")
   - Llama api.xp.addNutritionXp() → +15 XP
   - Refresca daily balance widget
   - toast.success("+15 XP - Comida registrada")
```

---

## Integraciones con Módulos Existentes

| Módulo | Integración |
|--------|------------|
| **UserPreferences** | Lee goals de calorías/macros para validar y generar el plan |
| **SavedMeals** | Biblioteca de comidas para armar el prep (seleccionables en la UI) |
| **NutritionAnalysis** | Al marcar "comí esto" se crea un registro real que alimenta el daily balance |
| **getDailyNutritionBalance** | Refleja las comidas del prep marcadas como comidas |
| **AICostService** | Loggea costo de parsear PDF (`meal-prep-pdf-import`) y generar prep (`meal-prep-generate`) |
| **XP System** | +15 XP al marcar cada comida (NUTRITION_LOG, misma acción existente) |
| **Body Analysis** | La IA puede usar el body type/goals para personalizar recomendaciones |

---

## Consideraciones Técnicas

### Active Meal Prep Query

```typescript
const today = new Date().toISOString().split('T')[0];
return prisma.mealPrep.findFirst({
  where: {
    userId,
    status: 'active',
    weekStartDate: { lte: today },
    weekEndDate: { gte: today },
  },
  orderBy: { createdAt: 'desc' },
});
```

Si no hay prep activo para la semana actual, el widget muestra "Crear plan para esta semana".

### Ownership y Concurrency

- Toda query de mutation usa `findFirst({ where: { id, userId } })` nunca `findUnique`
- `generateMealPrep` archiva el prep activo existente de la misma semana antes de crear uno nuevo
- `markSlotEaten` verifica `slot.eatenAt` antes de crear NutritionAnalysis (evita doble log)

### Token Budget

Si `nutritionistPlan.parsedPlan` excede 3000 chars, resumir a targetCalories + targetMacros + generalNotes.
Solo pasar la estructura completa por día cuando no exceda el límite.

### Error Handling en métodos AI

Mismo patrón que skin-fold.service.ts:
- `if (!this.openai)` → `throw new BadRequestException('OpenAI API key no configurada')`
- JSON parse failure se catchea y loggea con raw response para debug
- `BadRequestException` se re-lanza, todo lo demás se wrappea en un mensaje user-friendly

---

## Fases de Implementación

### Fase 1: Schema + Backend CRUD (~1 sesión)
- [ ] Agregar modelos `NutritionistPlan` y `MealPrep` al schema.prisma
- [ ] Agregar relaciones en modelo `User`
- [ ] `npx prisma migrate dev --name add-meal-prep`
- [ ] Crear `dto/index.ts` con todos los DTOs
- [ ] Crear `meal-prep.service.ts` (CRUD, sin IA)
- [ ] Crear `meal-prep.controller.ts`
- [ ] Crear `meal-prep.module.ts`
- [ ] Registrar `MealPrepModule` en `app.module.ts`
- [ ] Verificar endpoints CRUD con REST client

### Fase 2: IA Backend (~1 sesión)
- [ ] Implementar `parsePdfWithAI()` — testear con PDF real
- [ ] Implementar `generateWeeklyPrepWithAI()` — testear con datos reales
- [ ] Wire `aiCostService.logFromCompletion()` en ambos métodos AI
- [ ] Implementar `markSlotEaten()` con inyección de NutritionService
- [ ] Agregar `@Throttle` a endpoints AI (3/min)

### Fase 3: Frontend Types + API (~30 min)
- [ ] Crear `types/mealPrep.ts`
- [ ] Agregar export en `types/index.ts`
- [ ] Agregar namespace `mealPrep` en `lib/api-client.ts`

### Fase 4: Frontend Components (~2 sesiones)
- [ ] Crear hook `useMealPrep.ts`
- [ ] Crear `MealPrepSlotCard.tsx`
- [ ] Crear `MealPrepWidget.tsx`
- [ ] Instalar `pdfjs-dist` y crear `ImportNutritionistPlanDialog.tsx`
- [ ] Crear `GenerateMealPrepDialog.tsx`
- [ ] Crear `MealPrepView.tsx` (grid semanal completo)
- [ ] Agregar `MealPrepWidget` al overview de nutrición
- [ ] Agregar tab "Meal Prep" en la página de nutrición

### Fase 5: Integración + Testing (~1 sesión)
- [ ] Test flujo completo: importar PDF → generar → comer
- [ ] Verificar XP al marcar comida
- [ ] Verificar daily balance refleja comidas del prep
- [ ] Verificar AICost widget muestra servicios de meal-prep
- [ ] Actualizar CLAUDE.md con el nuevo módulo
- [ ] Actualizar Notion
