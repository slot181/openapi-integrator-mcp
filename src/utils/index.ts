import axios, { AxiosInstance } from 'axios'; // Keep AxiosInstance if needed elsewhere, otherwise just axios
import * as fs from 'fs';
import * as path from 'path';
import { mkdir, writeFile, unlink, readFile } from 'fs/promises'; // Add unlink, readFile
import { randomUUID } from 'crypto';
import FormData from 'form-data';
import TelegramBot from 'node-telegram-bot-api'; // Import TelegramBot
import { AppConfig } from '../types/index.js'; // Import AppConfig

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
        const bot = new TelegramBot(config.telegramBotToken);
        await bot.sendMessage(config.telegramChatId, message, { parse_mode: 'Markdown' });
        console.log('[Telegram Notification] Notification sent successfully.');
    } catch (error: any) {
        console.error(`[Telegram Notification] Failed to send notification:`, error.response?.body || error.message || error);
    }
}

/**
 * Sends a notification message for successful image upload to Cloudflare ImgBed.
 */
export async function sendImageUploadNotification(
    config: AppConfig,
    filename: string,
    prompt: string, // Prompt used for generation/edit
    cloudflareUrl: string
): Promise<void> {
    const message = `🖼️ 图片上传成功!\n文件名: ${filename}\n提示词: ${prompt}\n图床链接: ${cloudflareUrl}`;
    console.log(`[Notification] Sending image upload success notification for ${filename}`);
    // Send notifications concurrently
    await Promise.all([
        sendOneBotNotification(config, message),
        sendTelegramNotification(config, message)
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
                    const videoFilename = `video_${requestId}_${randomUUID()}.mp4`; // Assume mp4
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
