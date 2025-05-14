import axios, { AxiosInstance } from 'axios'; // Keep AxiosInstance if needed elsewhere, otherwise just axios
import * as fs from 'fs';
import * as path from 'path';
import { mkdir, writeFile, unlink, readFile } from 'fs/promises'; // Add unlink, readFile
import { randomUUID } from 'crypto';
import FormData from 'form-data';
import TelegramBot from 'node-telegram-bot-api'; // Import TelegramBot
import { AppConfig } from '../types/index.js'; // Import AppConfig

// --- Helper to sanitize prompt for filename ---
function sanitizePromptForFilename(prompt: string, maxLength: number = 50): string {
  if (!prompt || typeof prompt !== 'string') {
    return 'no_prompt';
  }
  // Remove characters not allowed in filenames and replace spaces
  const sanitized = prompt
    .replace(/[^\w\s\-\.]/g, '') // Allow alphanumeric, whitespace, hyphen, dot
    .replace(/\s+/g, '_')       // Replace spaces with underscores
    .substring(0, maxLength);   // Truncate to maxLength
  return sanitized || 'prompt'; // Ensure not empty
}

// --- File System Helpers ---

export function isValidHttpUrl(string: string): boolean {
  let url;
  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

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

export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.promises.access(dirPath, fs.constants.F_OK);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

export async function saveImageToFile(imageBuffer: Buffer, outputDir: string, prefix: string): Promise<string> {
  await ensureDirectoryExists(outputDir);
  const filename = `${prefix}_${randomUUID()}.png`;
  const filePath = path.join(outputDir, filename);
  await writeFile(filePath, imageBuffer);
  console.info(`[openapi-integrator-mcp] Image saved locally to: ${filePath}`);
  return filePath;
}

// --- Markdown Escaping Helper for Telegram ---
// Escapes characters for Telegram's legacy Markdown mode.
// Note: For MarkdownV2, more characters need escaping: '_*[]()~`>#+ -=|{}.!'
function escapeTelegramMarkdown(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[_*[\]`]/g, '\\$&');
}

// --- Cloudflare ImgBed Upload ---

export async function uploadToCfImgbed(
  fileBuffer: Buffer, // Changed name to be more generic
  filename: string,
  uploadUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append('file', fileBuffer, { filename });

    console.info(`[openapi-integrator-mcp] Attempting Cloudflare ImgBed upload to: ${uploadUrl} with filename: ${filename}`);

    const separator = uploadUrl.includes('?') ? '&' : '?';
    const uploadUrlWithAuth = `${uploadUrl}${separator}authCode=${apiKey}`;

    const response = await axios.post(uploadUrlWithAuth, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (response.status === 200 && Array.isArray(response.data) && response.data.length > 0 && response.data[0]?.src) {
      const pathSegment = response.data[0].src;
      const parsedUploadUrl = new URL(uploadUrl);
      const baseUrlStr = `${parsedUploadUrl.protocol}//${parsedUploadUrl.host}`;
      const fullUrl = new URL(pathSegment, baseUrlStr).toString();
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

// --- Notification Helpers ---

export async function sendOneBotNotification(config: AppConfig, message: string): Promise<void> {
    if (!config.onebotHttpUrl || !config.onebotMessageType || !config.onebotTargetId) {
        return;
    }
    if (config.onebotMessageType !== 'private' && config.onebotMessageType !== 'group') {
        console.error(`[OneBot Notification] Invalid ONEBOT_MESSAGE_TYPE: '${config.onebotMessageType}'. Must be 'private' or 'group'.`);
        return;
    }
    console.log(`[OneBot Notification] Sending ${config.onebotMessageType} notification to target ${config.onebotTargetId} via ${config.onebotHttpUrl}...`);
    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.onebotAccessToken) {
            headers['Authorization'] = `Bearer ${config.onebotAccessToken}`;
        }
        const action = config.onebotMessageType === 'private' ? 'send_private_msg' : 'send_group_msg';
        const paramsKey = config.onebotMessageType === 'private' ? 'user_id' : 'group_id';
        const params = { [paramsKey]: parseInt(config.onebotTargetId, 10), message };
        const requestUrl = `${config.onebotHttpUrl.replace(/\/$/, '')}/${action}`;
        await axios.post(requestUrl, params, { headers, timeout: config.requestTimeout / 2 });
        console.log('[OneBot Notification] Notification sent successfully.');
    } catch (error: any) {
        console.error(`[OneBot Notification] Failed to send notification:`, error.response?.data || error.message || error);
    }
}

export async function sendTelegramNotification(config: AppConfig, message: string): Promise<void> {
    if (!config.telegramBotToken || !config.telegramChatId) {
        return;
    }
    console.log(`[Telegram Notification] Sending notification to Chat ID ${config.telegramChatId}...`);
    try {
        const bot = new TelegramBot(config.telegramBotToken, { polling: false }); // Explicitly disable polling
        await bot.sendMessage(config.telegramChatId, message, { parse_mode: 'Markdown' });
        console.log('[Telegram Notification] Notification sent successfully.');
    } catch (error: any) {
        console.error(`[Telegram Notification] Failed to send notification to Chat ID ${config.telegramChatId}:`);
        if (error.code === 'ETELEGRAM' && error.response && error.response.body) {
            console.error(`Telegram API Error Code: ${error.response.body.error_code}`);
            console.error(`Description: ${error.response.body.description}`);
        } else if (error.message) {
            console.error(`Error: ${error.message}`);
        } else {
            console.error(`Unknown error:`, error);
        }
    }
}

/**
 * Sends a notification message for successful image upload to Cloudflare ImgBed.
 */
export async function sendImageUploadNotification(
    config: AppConfig,
    filename: string,
    prompt: string, // Prompt used for generation/edit
    cloudflareUrl: string | null, // Can be null if only saved locally
    localPath: string | null, // Can be null if even local save failed (though error handled before)
    taskType: 'generation' | 'edit'
): Promise<void> {
    const taskNameChinese = taskType === 'generation' ? '图片生成' : '图片编辑';
    let oneBotMessage: string;
    let telegramMessage: string;

    // Construct message for OneBot (no Markdown escaping for URLs/paths)
    if (cloudflareUrl) {
        oneBotMessage = `🖼️ ${taskNameChinese}成功!\n文件名: ${filename}\n提示词: ${prompt}\n图床链接: ${cloudflareUrl}`;
        if (localPath) {
            oneBotMessage += `\n本地路径: ${localPath}`;
        }
    } else if (localPath) {
        oneBotMessage = `🖼️ ${taskNameChinese}已保存在本地。\n文件名: ${filename}\n提示词: ${prompt}\n本地路径: ${localPath}\n(图床上传未执行或失败)`;
    } else {
        oneBotMessage = `⚠️ ${taskNameChinese}处理状态未知 (${filename})。请检查日志。\n提示词: ${prompt}`;
    }

    // Construct message for Telegram (with Markdown escaping)
    if (cloudflareUrl) {
        telegramMessage = `🖼️ ${taskNameChinese}成功!\n文件名: ${escapeTelegramMarkdown(filename)}\n提示词: ${escapeTelegramMarkdown(prompt)}\n图床链接: ${escapeTelegramMarkdown(cloudflareUrl)}`;
        if (localPath) {
            telegramMessage += `\n本地路径: ${escapeTelegramMarkdown(localPath)}`;
        }
    } else if (localPath) {
        telegramMessage = `🖼️ ${taskNameChinese}已保存在本地。\n文件名: ${escapeTelegramMarkdown(filename)}\n提示词: ${escapeTelegramMarkdown(prompt)}\n本地路径: ${escapeTelegramMarkdown(localPath)}\n(图床上传未执行或失败)`;
    } else {
        telegramMessage = `⚠️ ${taskNameChinese}处理状态未知 (${escapeTelegramMarkdown(filename)})。请检查日志。\n提示词: ${escapeTelegramMarkdown(prompt)}`;
        console.warn(`[Notification] sendImageUploadNotification called with no cloudflareUrl and no localPath for ${filename}. This indicates a prior processing error.`);
    }

    console.log(`[Notification] Sending image ${taskType} success notification for ${filename}`); // Internal log in English
    // Send notifications concurrently
    await Promise.all([
        sendOneBotNotification(config, oneBotMessage),
        sendTelegramNotification(config, telegramMessage)
    ]);
}


// --- SiliconFlow Video Background Task ---

interface VideoStatusResult {
    status: 'Succeed' | 'InQueue' | 'InProgress' | 'Failed';
    reason?: string;
    results?: {
        videos: { url: string }[];
        timings?: { inference?: number };
        seed?: number;
    };
}

// Pass the full config object to get the base URL
async function checkVideoStatus(requestId: string, apiKey: string, config: AppConfig): Promise<VideoStatusResult> {
    const url = `${config.siliconflowBaseUrl}/v1/video/status`; // Use base URL from config
    console.log(`[SiliconFlow] Checking status for requestId: ${requestId} at ${url}`);
    try {
        const response = await axios.post<VideoStatusResult>(url, { requestId }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json', // Added Accept header
            },
            timeout: 30000 // Short timeout for status checks
        });
        console.log(`[SiliconFlow] Status for ${requestId}: ${response.data.status}`);
        return response.data;
    } catch (error: any) {
        console.error(`[SiliconFlow] Error checking status for ${requestId}:`, error.response?.data || error.message);
        // Return a synthetic Failed status to stop polling on error
        return { status: 'Failed', reason: `Error checking status: ${error.message}` };
    }
}

export function handleSiliconFlowVideoGeneration(
    requestId: string,
    prompt: string, // Pass necessary info for notifications
    modelUsed: string,
    apiKey: string,
    config: AppConfig
): void {
    const pollInterval = 10000; // 10 seconds
    const maxTimeout = 24 * 60 * 60 * 1000; // 24 hours
    const startTime = Date.now();

    console.log(`[SiliconFlow] Starting background polling for video requestId: ${requestId}`);

    const poll = async () => {
        if (Date.now() - startTime > maxTimeout) {
            console.error(`[SiliconFlow] Polling timed out for requestId: ${requestId} after 24 hours.`);
            const timeoutMsg = `❌ 视频生成超时 (ID: ${requestId})\n模型: ${modelUsed}\n提示词: ${prompt}`;
            await sendOneBotNotification(config, timeoutMsg);
            await sendTelegramNotification(config, timeoutMsg);
            return;
        }

        // Pass config to checkVideoStatus
        const statusResult = await checkVideoStatus(requestId, apiKey, config);

        switch (statusResult.status) {
            case 'Succeed':
                console.log(`[SiliconFlow] Video generation succeeded for requestId: ${requestId}`);
                const videoUrl = statusResult.results?.videos?.[0]?.url;
                const inferenceTime = statusResult.results?.timings?.inference;
                const seed = statusResult.results?.seed;
                const completionTime = new Date().toISOString();

                if (!videoUrl) {
                    console.error(`[SiliconFlow] Success status but no video URL found for ${requestId}.`);
                    const errorMsg = `❌ 视频生成失败 (ID: ${requestId})\n模型: ${modelUsed}\n提示词: ${prompt}\n原因: API成功响应但未找到视频URL`;
                    await sendOneBotNotification(config, errorMsg);
                    await sendTelegramNotification(config, errorMsg);
                    return;
                }

                // Handle video download, save, upload, and notification
                try {
                    const videoDir = path.join(config.audioOutputDir, 'video'); // Save in video subdir
                    await ensureDirectoryExists(videoDir);
                    const sanitizedPromptVideoPart = sanitizePromptForFilename(prompt);
                    const videoFilename = `video_${sanitizedPromptVideoPart}_${requestId}_${randomUUID()}.mp4`; // Assume mp4
                    const localVideoPath = path.join(videoDir, videoFilename);

                    console.log(`[SiliconFlow] Downloading video from ${videoUrl} to ${localVideoPath}`);
                    await downloadFile(videoUrl, localVideoPath);
                    console.log(`[SiliconFlow] Video saved locally: ${localVideoPath}`);

                    let cfUploadMsg = "";
                    if (config.cfImgbedUploadUrl && config.cfImgbedApiKey) {
                        console.log(`[SiliconFlow] Attempting to upload video ${localVideoPath} to Cloudflare ImgBed...`);
                        const videoBuffer = await readFile(localVideoPath);
                        const cfVideoUrl = await uploadToCfImgbed(videoBuffer, videoFilename, config.cfImgbedUploadUrl, config.cfImgbedApiKey);
                        if (cfVideoUrl) {
                            cfUploadMsg = `\n图床链接: ${cfVideoUrl}`;
                            const cfNotifyMsg = `✅ 视频 ${videoFilename} 已成功上传到图床: ${cfVideoUrl}`;
                            await sendOneBotNotification(config, cfNotifyMsg);
                            await sendTelegramNotification(config, cfNotifyMsg);
                        } else {
                            cfUploadMsg = "\n图床上传失败";
                            const cfFailMsg = `❌ 视频 ${videoFilename} 上传到图床失败。`;
                            await sendOneBotNotification(config, cfFailMsg);
                            await sendTelegramNotification(config, cfFailMsg);
                        }
                    }

                    const successMsg = `✅ 视频生成成功!\n文件名: ${videoFilename}\n本地路径: ${localVideoPath}\n模型: ${modelUsed}\n提示词: ${prompt}\n源链接: ${videoUrl}\n耗时: ${inferenceTime ?? 'N/A'}s\nSeed: ${seed ?? 'N/A'}\n完成时间: ${completionTime}${cfUploadMsg}`;
                    await sendOneBotNotification(config, successMsg);
                    await sendTelegramNotification(config, successMsg);

                } catch (processingError: any) {
                    console.error(`[SiliconFlow] Error processing video for ${requestId}:`, processingError);
                    const processErrorMsg = `❌ 视频处理失败 (ID: ${requestId})\n模型: ${modelUsed}\n提示词: ${prompt}\n原因: ${processingError.message}`;
                    await sendOneBotNotification(config, processErrorMsg);
                    await sendTelegramNotification(config, processErrorMsg);
                }
                break; // Stop polling on success

            case 'Failed':
                console.error(`[SiliconFlow] Video generation failed for requestId: ${requestId}. Reason: ${statusResult.reason}`);
                const failMsg = `❌ 视频生成失败 (ID: ${requestId})\n模型: ${modelUsed}\n提示词: ${prompt}\n原因: ${statusResult.reason || '未知错误'}`;
                await sendOneBotNotification(config, failMsg);
                await sendTelegramNotification(config, failMsg);
                break; // Stop polling on failure

            case 'InQueue':
            case 'InProgress':
                // Continue polling
                setTimeout(poll, pollInterval);
                break;

            default:
                console.error(`[SiliconFlow] Unknown status received for ${requestId}: ${statusResult.status}`);
                // Optionally treat unknown status as failure or continue polling cautiously
                const unknownMsg = `视频生成状态未知 (ID: ${requestId})\n模型: ${modelUsed}\n提示词: ${prompt}\n状态: ${statusResult.status}`;
                 await sendOneBotNotification(config, unknownMsg);
                 await sendTelegramNotification(config, unknownMsg);
                // Decide whether to stop polling here or continue
                // setTimeout(poll, pollInterval);
                break;
        }
    };

    // Start the first poll
    setTimeout(poll, pollInterval);
}

// --- Image Processing Background Tasks ---

async function completeImageProcessingAndNotify(
    imageBuffer: Buffer | null,
    localPath: string | null,
    filename: string,
    originalArgs: any, // To get the prompt
    config: AppConfig,
    taskType: 'generation' | 'edit' // To customize messages
): Promise<void> {
    let cloudflareUrl: string | null = null;
    // let cloudflareUploadSuccess = false; // Not directly used for return value anymore
    const taskNameEnglish = taskType === 'generation' ? 'generation' : 'editing'; // For internal logs
    const taskNameChinese = taskType === 'generation' ? '生成' : '编辑'; // For user-facing messages

    if (config.cfImgbedUploadUrl && config.cfImgbedApiKey && imageBuffer && localPath) {
        cloudflareUrl = await uploadToCfImgbed(imageBuffer, filename, config.cfImgbedUploadUrl, config.cfImgbedApiKey);
        // sendImageUploadNotification will construct appropriate messages for OneBot and Telegram
        await sendImageUploadNotification(config, filename, originalArgs.prompt, cloudflareUrl, localPath, taskType);
        // No separate notification here if upload failed, sendImageUploadNotification handles it
    } else if (config.cfImgbedUploadUrl && config.cfImgbedApiKey) { // CF configured, but upload skipped due to missing buffer/path
        console.warn(`[openapi-integrator-mcp BG] Skipping Cloudflare upload for ${taskNameEnglish} image ${filename} because local processing failed or buffer/path is missing.`);
        // If localPath exists, send notification about local save and skipped CF upload
        if (localPath) {
            await sendImageUploadNotification(config, filename, originalArgs.prompt, null, localPath, taskType);
        }
        // If localPath is also null, an error should have been sent by the caller.
    } else if (localPath) { // No Cloudflare config, but saved locally
        await sendImageUploadNotification(config, filename, originalArgs.prompt, null, localPath, taskType);
    }
    // If localPath is null (initial save/download failed), an error notification should have been sent by the caller.
}


export async function processImageGenerationInBackground(
    args: any,
    config: AppConfig,
    axiosInstance: AxiosInstance,
    // toolCallStartTime: number // No longer needed here as client response is immediate
): Promise<void> {
    const modelToUse = args.model || config.defaultImageModel;
    let requestBody: any = { prompt: args.prompt, model: modelToUse };
    const isDallE3OrGptImage1 = modelToUse.includes('dall-e-3') || modelToUse.includes('gpt-image-1');

    if (isDallE3OrGptImage1) {
        if (args.n) requestBody.n = args.n;
        if (args.quality) requestBody.quality = args.quality;
        if (args.size) requestBody.size = args.size;
        if (args.background) requestBody.background = args.background;
        if (args.moderation) requestBody.moderation = args.moderation;
    } else {
        requestBody = {
            ...requestBody, ...config.defaultImageConfig,
            ...(args.width && { width: args.width }),
            ...(args.height && { height: args.height }),
            ...(args.steps && { steps: args.steps }),
            ...(args.n && { n: args.n }),
            response_format: "url",
        };
        delete requestBody.size; delete requestBody.quality;
        delete requestBody.background; delete requestBody.moderation;
    }

    console.log('[openapi-integrator-mcp BG] Image generation request body:', JSON.stringify(requestBody, null, 2));
    let responseData;
    try {
        const response = await axiosInstance.post('/v1/images/generations', requestBody, {
            headers: { 'Content-Type': 'application/json' },
            timeout: config.requestTimeout, // Use the general request timeout for the API call itself
        });
        responseData = response.data?.data;
        if (!responseData || !Array.isArray(responseData) || responseData.length === 0) {
            throw new Error('API response did not contain image data.'); // Internal error in English
        }
    } catch (apiError: any) {
        console.error('[openapi-integrator-mcp BG] Image generation API call failed:', apiError.message); // Internal log in English
        const userMessage = `❌ 图片生成失败 (API请求错误): ${escapeTelegramMarkdown(apiError.message)}\n提示词: ${escapeTelegramMarkdown(args.prompt)}`;
        await sendOneBotNotification(config, userMessage);
        await sendTelegramNotification(config, userMessage);
        return;
    }

    const imagesOutputDir = path.join(config.audioOutputDir, 'images');
    await ensureDirectoryExists(imagesOutputDir);

    const sanitizedPromptPart = sanitizePromptForFilename(args.prompt);

    for (const item of responseData) {
        let imageBuffer: Buffer | null = null;
        let localPath: string | null = null;
        const filenamePrefix = 'generated_image';
        // Incorporate sanitized prompt into filename
        let filename = `${filenamePrefix}_${sanitizedPromptPart}_${randomUUID()}.png`;
        // let processingError: Error | null = null; // Not used directly for notification here

        try {
            if (item.b64_json) {
                imageBuffer = Buffer.from(item.b64_json, 'base64');
                // filename is already set with prompt and .png extension
                localPath = path.join(imagesOutputDir, filename);
                await fs.promises.writeFile(localPath, imageBuffer);
                console.info(`[openapi-integrator-mcp BG] Image saved locally from b64_json to: ${localPath}`);
            } else if (item.url && isValidHttpUrl(item.url)) {
                const imageUrl = item.url;
                const urlPath = new URL(imageUrl).pathname;
                const ext = path.extname(urlPath) || '.png';
                // Reconstruct filename with extension and prompt
                filename = `${filenamePrefix}_${sanitizedPromptPart}_${randomUUID()}${ext}`;
                localPath = path.join(imagesOutputDir, filename);
                console.log(`[openapi-integrator-mcp BG] Downloading image from ${imageUrl} to ${localPath}`);
                await downloadFile(imageUrl, localPath);
                console.log(`[openapi-integrator-mcp BG] Image downloaded: ${localPath}`);
                imageBuffer = await fs.promises.readFile(localPath);
            } else {
                throw new Error('API response item missing b64_json or valid url data.');
            }
        } catch (err: any) {
            console.error(`[openapi-integrator-mcp BG] Error processing image (save/download/read): ${err.message}`);
            // processingError = err; // Not used directly for notification here
            imageBuffer = null; // Ensure buffer is null on error
            localPath = null; // Ensure path is null on error
            const userMessage = `❌ 图片处理失败 (保存/下载错误): ${escapeTelegramMarkdown(err.message)}\n提示词: ${escapeTelegramMarkdown(args.prompt)}`;
            await sendOneBotNotification(config, userMessage);
            await sendTelegramNotification(config, userMessage);
            // Continue to next item if one fails
            continue;
        }
        // If no processing error, proceed to complete and notify
        await completeImageProcessingAndNotify(imageBuffer, localPath, filename, args, config, 'generation');
    }
}


export async function processImageEditInBackground(
    args: any,
    config: AppConfig,
    axiosInstance: AxiosInstance,
    // toolCallStartTime: number // No longer needed here
): Promise<void> {
    let imagePath = args.image;
    let cleanupTempFile = false;
    const tempDir = config.tempDir;
    await ensureDirectoryExists(tempDir);
    let originalImageFilename = path.basename(imagePath); // For notification

    try {
        if (isValidHttpUrl(args.image)) {
            const tempImageFilename = `edit_input_${randomUUID()}${path.extname(new URL(args.image).pathname) || '.png'}`;
            originalImageFilename = tempImageFilename; // Update for notification
            const tempImagePath = path.join(tempDir, tempImageFilename);
            console.info(`[openapi-integrator-mcp BG] Downloading image for editing from ${args.image} to ${tempImagePath}`); // Log in English
            await downloadFile(args.image, tempImagePath);
            imagePath = tempImagePath;
            cleanupTempFile = true;
        } else {
            await fs.promises.access(imagePath, fs.constants.R_OK);
        }
    } catch (accessOrDownloadError: any) {
        console.error('[openapi-integrator-mcp BG] Failed to access/download image for editing:', accessOrDownloadError.message); // Log in English
        const oneBotErrorMessage = `❌ 图片编辑预处理失败 (无法访问/下载原图): ${accessOrDownloadError.message}\n原图: ${args.image}\n提示词: ${args.prompt}`;
        const telegramErrorMessage = `❌ 图片编辑预处理失败 (无法访问/下载原图): ${escapeTelegramMarkdown(accessOrDownloadError.message)}\n原图: ${escapeTelegramMarkdown(args.image)}\n提示词: ${escapeTelegramMarkdown(args.prompt)}`;
        await sendOneBotNotification(config, oneBotErrorMessage);
        await sendTelegramNotification(config, telegramErrorMessage);
        if (cleanupTempFile && fs.existsSync(imagePath)) await unlink(imagePath).catch(e => console.error(`[BG] Failed to cleanup temp edit image ${imagePath}: ${e.message}`));
        return;
    }

    const formData = new FormData();
    try {
        const imageBuffer = await fs.promises.readFile(imagePath);
        formData.append('image', imageBuffer, path.basename(imagePath));
    } catch (readError: any) {
        console.error('[openapi-integrator-mcp BG] Failed to read image for editing:', readError.message); // Log in English
        const oneBotErrorMessage = `❌ 图片编辑预处理失败 (无法读取原图): ${readError.message}\n原图: ${args.image}\n提示词: ${args.prompt}`;
        const telegramErrorMessage = `❌ 图片编辑预处理失败 (无法读取原图): ${escapeTelegramMarkdown(readError.message)}\n原图: ${escapeTelegramMarkdown(args.image)}\n提示词: ${escapeTelegramMarkdown(args.prompt)}`;
        await sendOneBotNotification(config, oneBotErrorMessage);
        await sendTelegramNotification(config, telegramErrorMessage);
        if (cleanupTempFile) await unlink(imagePath).catch(e => console.error(`[BG] Failed to cleanup temp edit image ${imagePath}: ${e.message}`));
        return;
    }

    formData.append('prompt', args.prompt);
    const modelToUseForEdit = args.model || config.defaultEditImageModel;
    formData.append('model', modelToUseForEdit);
    if (args.n) formData.append('n', String(args.n));
    if (args.size) formData.append('size', args.size);
    formData.append('response_format', 'b64_json');

    let editedImageData;
    try {
        console.info(`[openapi-integrator-mcp BG] Sending image edit request with model ${modelToUseForEdit}.`);
        const editResponse = await axiosInstance.post('/v1/images/edits', formData, {
            headers: formData.getHeaders(),
            timeout: config.requestTimeout, // Use general request timeout
        });
        editedImageData = editResponse.data?.data;
        if (!editedImageData || !Array.isArray(editedImageData) || editedImageData.length === 0) {
            throw new Error('API response for image edit did not contain image data.'); // Internal error in English
        }
    } catch (apiError: any) {
        console.error('[openapi-integrator-mcp BG] Image edit API call failed:', apiError.message); // Log in English
        const oneBotErrorMessage = `❌ 图片编辑失败 (API请求错误): ${apiError.message}\n原图: ${originalImageFilename}\n提示词: ${args.prompt}`;
        const telegramErrorMessage = `❌ 图片编辑失败 (API请求错误): ${escapeTelegramMarkdown(apiError.message)}\n原图: ${escapeTelegramMarkdown(originalImageFilename)}\n提示词: ${escapeTelegramMarkdown(args.prompt)}`;
        await sendOneBotNotification(config, oneBotErrorMessage);
        await sendTelegramNotification(config, telegramErrorMessage);
        if (cleanupTempFile) await unlink(imagePath).catch(e => console.error(`[BG] Failed to cleanup temp edit image ${imagePath}: ${e.message}`));
        return;
    } finally {
        if (cleanupTempFile) await unlink(imagePath).catch(e => console.error(`[BG] Failed to cleanup temp edit image ${imagePath}: ${e.message}`));
    }

    const imagesOutputDir = path.join(config.audioOutputDir, 'images');
    await ensureDirectoryExists(imagesOutputDir);

    const sanitizedPromptPartEdit = sanitizePromptForFilename(args.prompt);

    for (const item of editedImageData) {
        if (!item.b64_json) {
            console.warn('[openapi-integrator-mcp BG] API edit response item missing b64_json data.'); // Log in English
            const oneBotErrorMessage = `❌ 图片编辑部分失败 (API响应缺少图像数据)\n原图: ${originalImageFilename}\n提示词: ${args.prompt}`;
            const telegramErrorMessage = `❌ 图片编辑部分失败 (API响应缺少图像数据)\n原图: ${escapeTelegramMarkdown(originalImageFilename)}\n提示词: ${escapeTelegramMarkdown(args.prompt)}`;
            await sendOneBotNotification(config, oneBotErrorMessage);
            await sendTelegramNotification(config, telegramErrorMessage);
            continue;
        }

        const imageBuffer = Buffer.from(item.b64_json, 'base64');
        let localPath: string | null = null;
        const filenamePrefix = 'edited_image';
        // Incorporate sanitized prompt into filename
        const filename = `${filenamePrefix}_${sanitizedPromptPartEdit}_${randomUUID()}.png`;
        // let processingError: Error | null = null; // Not used directly for notification here

        try {
            localPath = path.join(imagesOutputDir, filename);
            await fs.promises.writeFile(localPath, imageBuffer);
            console.info(`[openapi-integrator-mcp BG] Edited image saved locally to: ${localPath}`);
        } catch (err: any) {
            console.error(`[openapi-integrator-mcp BG] Error saving edited image locally: ${err.message}`);
            // processingError = err; // Not used directly for notification here
            localPath = null; // Ensure path is null on error
            const oneBotErrorMessage = `❌ 图片编辑部分失败 (保存错误): ${err.message}\n原图: ${originalImageFilename}\n提示词: ${args.prompt}`;
            const telegramErrorMessage = `❌ 图片编辑部分失败 (保存错误): ${escapeTelegramMarkdown(err.message)}\n原图: ${escapeTelegramMarkdown(originalImageFilename)}\n提示词: ${escapeTelegramMarkdown(args.prompt)}`;
            await sendOneBotNotification(config, oneBotErrorMessage);
            await sendTelegramNotification(config, telegramErrorMessage);
            continue;
        }
        await completeImageProcessingAndNotify(imageBuffer, localPath, filename, args, config, 'edit');
    }
}
