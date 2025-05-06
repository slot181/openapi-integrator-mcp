// Define the type for the base configuration
export interface BaseDefaultConfig {
  width: number;
  height: number;
  steps: number;
  n: number;
}

// Type definitions for tool arguments
export interface GenerateSpeechArgs {
  input: string;
  model?: string;
  voice?: string;
  speed?: number;
}

export interface TranscribeAudioArgs {
  file: string; // Can be a local path or a URL
  model?: string;
}

// Type guards for tool arguments
export function isGenerateSpeechArgs(value: unknown): value is GenerateSpeechArgs {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.input !== 'string' || v.input.length > 4096) return false;
  if (v.voice !== undefined && typeof v.voice !== 'string') return false;
  if (v.model !== undefined && typeof v.model !== 'string') return false;
  if (v.speed !== undefined) {
    const speed = Number(v.speed);
    if (isNaN(speed) || speed < 0.25 || speed > 4.0) return false;
  }
  return true;
}

export function isTranscribeAudioArgs(value: unknown): value is TranscribeAudioArgs {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.file !== 'string') return false;
  if (v.model !== undefined && typeof v.model !== 'string') return false;
  return true;
}

// Configuration object type
export interface AppConfig {
  apiKey: string;
  apiUrl: string;
  defaultImageModel: string;
  defaultSpeechModel: string;
  defaultSpeechSpeed: number;
  audioOutputDir: string;
  defaultSpeechVoice: string;
  defaultTranscriptionModel: string;
  requestTimeout: number;
  tempDir: string; // Add tempDir to the config type
  defaultImageConfig: BaseDefaultConfig & { model: string };
  // WebDAV Configuration (Optional)
  webdavUrl?: string;
  webdavUsername?: string;
  webdavPassword?: string;
  // Cloudflare ImgBed Configuration (Optional)
  cfImgbedUploadUrl?: string;
  cfImgbedApiKey?: string;
  // Default Edit Image Model
  defaultEditImageModel: string;
}
