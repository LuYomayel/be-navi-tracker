export interface CreateWeightEntryDto {
  date: string;
  weight: number;
  bodyFatPercentage?: number;
  muscleMassPercentage?: number;
  bodyWaterPercentage?: number;
  bmi?: number;
  bfr?: number;
  score?: number;
  imageUrl?: string;
  source: 'manual' | 'photo' | 'scale';
  aiConfidence?: number;
  notes?: string;
}

export interface CreateWeightEntryImageDto {
  imageBase64: string;
}

export interface CreateWeightEntryManualDto {
  date: string;
  weight: number;
  bodyFatPercentage?: number;
  muscleMassPercentage?: number;
  bodyWaterPercentage?: number;
  bmi?: number;
  bfr?: number;
  source: 'manual';
  notes?: string;
}
