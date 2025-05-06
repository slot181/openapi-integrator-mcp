import config from '../config/index.js'; // Import the config object

// Define the tool definitions using the config values
const toolDefinitions = [
  {
    name: 'generate_image',
    description: 'Generates an image using an OpenAI compatible API and returns a direct URL to the result. It is recommended to format the output URL using Markdown for better display.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text prompt for image generation' },
        model: { type: 'string', description: `Model to use for generation (default: ${config.defaultImageConfig.model})` },
        width: { type: 'number', description: 'Image width (default: 1024, ignored if model is dall-e-3 or gpt-image-1)', minimum: 128, maximum: 2048 },
        height: { type: 'number', description: 'Image height (default: 768, ignored if model is dall-e-3 or gpt-image-1)', minimum: 128, maximum: 2048 },
        steps: { type: 'number', description: 'Number of inference steps (default: 1, ignored if model is dall-e-3 or gpt-image-1)', minimum: 1, maximum: 100 },
        n: { type: 'number', description: 'Number of images to generate (default: 1)', minimum: 1, maximum: 10 }, // Max 10 for dall-e-3/gpt-image-1
        // New parameters for dall-e-3 / gpt-image-1
        background: { type: 'string', enum: ['transparent', 'opaque', 'auto'], description: 'Background transparency (dall-e-3/gpt-image-1 only). Default: auto' },
        moderation: { type: 'string', enum: ['low', 'auto'], description: 'Content moderation level (dall-e-3/gpt-image-1 only). Default: auto' },
        size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536', 'auto'], description: 'Image size (dall-e-3/gpt-image-1 only). Default: auto' },
        quality: { type: 'string', enum: ['auto', 'high', 'medium', 'low'], description: 'Image quality (dall-e-3/gpt-image-1 only). Default: auto' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_speech',
    description: 'Generates audio from text using an OpenAI compatible API and saves it to a local file.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'The text to generate audio for. Max 4096 characters.', maxLength: 4096 },
        model: { type: 'string', description: `Model to use (default: ${config.defaultSpeechModel}). Options: tts-1, tts-1-hd, gpt-4o-mini-tts.` },
        voice: { type: 'string', description: `Voice to use (default: ${config.defaultSpeechVoice}).` },
        speed: { type: 'number', description: `Audio speed (default: ${config.defaultSpeechSpeed}). Range: 0.25 to 4.0.`, minimum: 0.25, maximum: 4.0 },
      },
      required: ['input', 'voice'], // Note: Original code had 'voice' required here, keeping it consistent
    },
  },
  {
    name: 'transcribe_audio',
    description: 'Transcribes audio to text using an OpenAI compatible API.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Path to the local audio file or a URL to the audio file to transcribe (formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm).',
        },
        model: {
          type: 'string',
          description: `Model to use for transcription (default: ${config.defaultTranscriptionModel}). Options: gpt-4o-transcribe, gpt-4o-mini-transcribe, whisper-1.`,
        },
        // Add other potential parameters like language, prompt, response_format, temperature if needed later
      },
      required: ['file'],
    },
  },
  {
    name: 'edit_image',
    description: 'Edits an image using an OpenAI compatible API based on a text prompt. Supports local file paths or URLs as image input.',
    inputSchema: {
      type: 'object',
      properties: {
        image: {
          type: 'string', // For simplicity, SDK might handle single string for one image
          description: 'The image(s) to edit. Can be a file path, URL, or an array of paths/URLs.',
        },
        prompt: {
          type: 'string',
          description: 'A text description of the desired image(s). Maximum length is 32000 characters.',
          maxLength: 32000,
        },
        model: {
          type: 'string',
          description: `Model to use for editing (default: ${config.defaultEditImageModel}).`, // Updated description
        },
        n: {
          type: 'number',
          description: 'Number of images to generate (default: 1).',
          minimum: 1,
          maximum: 10, // As per OpenAI docs for edits
        },
        size: {
          type: 'string',
          description: 'The size of the generated images. Supported sizes depend on the model. (Default: auto)',
          enum: ['1024x1024', '1536x1024', '1024x1536', 'auto'], // Combined list
        },
      },
      required: ['image', 'prompt'],
    },
  },
];

export default toolDefinitions;
