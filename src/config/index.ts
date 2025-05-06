import * as path from 'path';
import { AppConfig, BaseDefaultConfig } from '../types/index.js'; // Import AppConfig type

// --- Argument Parsing ---
function parseCliArgs(argv: string[]): { [key: string]: string } {
  const args = argv.slice(2);
  const parsed: { [key: string]: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-e' && i + 2 < args.length) {
      const key = args[i + 1];
      const value = args[i + 2];
      parsed[key] = value;
      i += 2;
    }
  }
  return parsed;
}

const cliArgs = parseCliArgs(process.argv);

// --- Configuration Loading ---
const API_KEY = cliArgs.API_KEY || process.env.API_KEY;
const API_URL = cliArgs.API_URL || process.env.API_URL || 'https://api.openai.com';
const DEFAULT_IMAGE_MODEL = cliArgs.DEFAULT_IMAGE_MODEL || process.env.DEFAULT_IMAGE_MODEL || 'dall-e-3';
const DEFAULT_SPEECH_MODEL = cliArgs.DEFAULT_SPEECH_MODEL || process.env.DEFAULT_SPEECH_MODEL || 'tts-1';
const DEFAULT_SPEECH_SPEED = parseFloat(cliArgs.DEFAULT_SPEECH_SPEED || process.env.DEFAULT_SPEECH_SPEED || '1.0');
const DEFAULT_OUTPUT_PATH = cliArgs.DEFAULT_OUTPUT_PATH || process.env.DEFAULT_OUTPUT_PATH || './output'; // Renamed variable
const DEFAULT_SPEECH_VOICE = cliArgs.DEFAULT_SPEECH_VOICE || process.env.DEFAULT_SPEECH_VOICE || 'alloy';
const DEFAULT_TRANSCRIPTION_MODEL = cliArgs.DEFAULT_TRANSCRIPTION_MODEL || process.env.DEFAULT_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe';
const REQUEST_TIMEOUT = parseInt(cliArgs.REQUEST_TIMEOUT || process.env.REQUEST_TIMEOUT || '180000', 10);

// --- WebDAV Configuration Loading ---
const WEBDAV_URL = cliArgs.WEBDAV_URL || process.env.WEBDAV_URL;
const WEBDAV_USERNAME = cliArgs.WEBDAV_USERNAME || process.env.WEBDAV_USERNAME;
const WEBDAV_PASSWORD = cliArgs.WEBDAV_PASSWORD || process.env.WEBDAV_PASSWORD;

// --- Cloudflare ImgBed Configuration Loading ---
const CF_IMGBED_UPLOAD_URL = cliArgs.CF_IMGBED_UPLOAD_URL || process.env.CF_IMGBED_UPLOAD_URL;
const CF_IMGBED_API_KEY = cliArgs.CF_IMGBED_API_KEY || process.env.CF_IMGBED_API_KEY;

// --- Default Edit Image Model Configuration ---
const DEFAULT_EDIT_IMAGE_MODEL = cliArgs.DEFAULT_EDIT_IMAGE_MODEL || process.env.DEFAULT_EDIT_IMAGE_MODEL || 'gpt-image-1'; // Changed default model


if (!API_KEY) {
  console.error('Error: API_KEY environment variable or -e API_KEY <value> argument is required');
  process.exit(1); // Exit if API key is missing
}

const baseDefaultConfig: BaseDefaultConfig = {
  width: 1024,
  height: 768,
  steps: 1,
  n: 1,
};

const config: AppConfig = {
  apiKey: API_KEY,
  apiUrl: API_URL,
  defaultImageModel: DEFAULT_IMAGE_MODEL,
  defaultSpeechModel: DEFAULT_SPEECH_MODEL,
  defaultSpeechSpeed: DEFAULT_SPEECH_SPEED,
  audioOutputDir: path.resolve(DEFAULT_OUTPUT_PATH), // Resolve path here using renamed variable
  defaultSpeechVoice: DEFAULT_SPEECH_VOICE,
  defaultTranscriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
  requestTimeout: REQUEST_TIMEOUT,
  tempDir: path.join(path.resolve(DEFAULT_OUTPUT_PATH), 'temp'), // Resolve and join temp dir using renamed variable
  defaultImageConfig: {
    ...baseDefaultConfig,
    model: DEFAULT_IMAGE_MODEL,
  },
  // Add WebDAV config to the exported object
  webdavUrl: WEBDAV_URL,
  webdavUsername: WEBDAV_USERNAME,
  webdavPassword: WEBDAV_PASSWORD,
  // Add Cloudflare ImgBed config to the exported object
  cfImgbedUploadUrl: CF_IMGBED_UPLOAD_URL,
  cfImgbedApiKey: CF_IMGBED_API_KEY,
  // Add Default Edit Image Model to the exported object
  defaultEditImageModel: DEFAULT_EDIT_IMAGE_MODEL,
};

export default config;
