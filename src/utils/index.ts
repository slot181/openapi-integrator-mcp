import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import FormData from 'form-data';

// Helper function to check if a string is a valid URL
export function isValidHttpUrl(string: string): boolean {
  let url;
  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

// Helper function to download a file from a URL
export async function downloadFile(url: string, outputPath: string): Promise<void> {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Helper function to ensure directory exists
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    // Use fs.promises.access for async check
    await fs.promises.access(dirPath, fs.constants.F_OK);
  } catch {
    // Use fs.promises.mkdir for async creation
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Saves an image buffer to a file in the specified directory.
 * @param imageBuffer The image data as a Buffer.
 * @param outputDir The directory to save the image in.
 * @param prefix A prefix for the filename.
 * @returns The full path to the saved image file.
 */
export async function saveImageToFile(imageBuffer: Buffer, outputDir: string, prefix: string): Promise<string> {
  await ensureDirectoryExists(outputDir);
  const filename = `${prefix}_${randomUUID()}.png`; // Assuming PNG format
  const filePath = path.join(outputDir, filename);
  await writeFile(filePath, imageBuffer);
  console.info(`[openapi-integrator-mcp] Image saved locally to: ${filePath}`);
  return filePath;
}

/**
 * Uploads an image buffer to Cloudflare ImgBed.
 * @param imageBuffer The image data as a Buffer.
 * @param filename The desired filename for the uploaded image.
 * @param uploadUrl The Cloudflare ImgBed upload URL.
 * @param apiKey The Cloudflare ImgBed API key.
 * @returns The URL of the uploaded image, or null if upload fails.
 */
export async function uploadToCfImgbed(
  imageBuffer: Buffer,
  filename: string,
  uploadUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append('file', imageBuffer, { filename }); // Pass buffer directly

    console.info(`[openapi-integrator-mcp] Attempting Cloudflare ImgBed upload to: ${uploadUrl} with filename: ${filename}`);

    // Construct the upload URL with the API key as 'authCode' query parameter
    const separator = uploadUrl.includes('?') ? '&' : '?';
    const uploadUrlWithAuth = `${uploadUrl}${separator}authCode=${apiKey}`;

    const response = await axios.post(uploadUrlWithAuth, formData, {
      headers: {
        ...formData.getHeaders(), // Important for multipart/form-data
      },
      maxBodyLength: Infinity, 
      maxContentLength: Infinity,
    });

    // Check response based on typical ImgBed success structure from reference
    if (response.status === 200 && Array.isArray(response.data) && response.data.length > 0 && response.data[0]?.src) {
      const imagePathSegment = response.data[0].src;
      // Construct the full URL based on the upload URL's origin
      const parsedUploadUrl = new URL(uploadUrl); // Use the original uploadUrl for base
      const baseUrlStr = `${parsedUploadUrl.protocol}//${parsedUploadUrl.host}`;
      const fullUrl = new URL(imagePathSegment, baseUrlStr).toString();
      console.info(`[openapi-integrator-mcp] Cloudflare ImgBed upload successful: ${fullUrl}`);
      return fullUrl;
    } else {
      console.error(`[openapi-integrator-mcp] Cloudflare ImgBed upload failed or unexpected response format. Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
      return null;
    }
  } catch (error: any) {
    let errorMessage = 'Unknown error during Cloudflare ImgBed upload.';
    if (axios.isAxiosError(error)) {
      const responseInfo = error.response ? ` Status: ${error.response.status}. Data: ${JSON.stringify(error.response.data)}` : ' No response received.';
      errorMessage = `Axios error: ${error.message}.${responseInfo}`;
    } else if (error instanceof Error) {
      errorMessage = `Generic error: ${error.message}.`;
    } else {
      errorMessage = `Caught non-Error object: ${String(error)}`;
    }
    console.error(`[openapi-integrator-mcp] Error uploading to Cloudflare ImgBed: ${errorMessage}`);
    return null;
  }
}
