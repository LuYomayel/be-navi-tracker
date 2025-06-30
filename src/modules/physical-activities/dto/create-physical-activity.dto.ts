export class CreatePhysicalActivityDto {
  date: string; // '2025-06-30'
  steps?: number;
  distanceKm?: number;
  activeEnergyKcal?: number;
  exerciseMinutes?: number;
  standHours?: number;
  screenshotUrl?: string;
  source: string;
  aiConfidence?: number;
}
