import axios from 'axios'; // Import axios itself
import * as fs from 'fs';
import * as path from 'path';
import { unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import FormData from 'form-data';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { isGenerateSpeechArgs, isTranscribeAudioArgs } from '../types/index.js';
// Import necessary utils including the new video handler and potentially the base URL constant
import { ensureDirectoryExists, isValidHttpUrl, downloadFile, 
// saveImageToFile, // Now part of background processing
uploadToCfImgbed, // Still needed by background processing, but not directly here
handleSiliconFlowVideoGeneration, // Still needed by background processing
processImageGenerationInBackground, // New import
processImageEditInBackground, // New import
// Removed imports for background image handlers as they are no longer used
 } from '../utils/index.js';
// The handler now returns the success result or throws an McpError
export async function handleToolCall({ toolName, args, axiosInstance, config }) {
    try {
        switch (toolName) {
            case 'generate_image': {
                if (!args || typeof args !== 'object' || !('prompt' in args) || typeof args.prompt !== 'string') {
                    throw new McpError(ErrorCode.InvalidParams, 'Prompt is required and must be a string');
                }
                const modelToUse = args.model || config.defaultImageModel;
                let requestBody = {
                    prompt: args.prompt,
                    model: modelToUse,
                };
                // Check if the model is dall-e-3 or gpt-image-1
                const isDallE3OrGptImage1 = modelToUse.includes('dall-e-3') || modelToUse.includes('gpt-image-1');
                if (isDallE3OrGptImage1) {
                    // Parameters for dall-e-3 or gpt-image-1
                    if (args.n)
                        requestBody.n = args.n;
                    if (args.quality)
                        requestBody.quality = args.quality;
                    if (args.size)
                        requestBody.size = args.size;
                    if (args.background)
                        requestBody.background = args.background;
                    if (args.moderation)
                        requestBody.moderation = args.moderation;
                    // dall-e-3 and gpt-image-1 default to b64_json and don't use width, height, steps
                    // response_format is implicitly b64_json for these models when not 'url'
                }
                else {
                    // Parameters for other models
                    requestBody = {
                        ...requestBody, // Keep prompt and model
                        ...config.defaultImageConfig, // Apply other defaults like width, height, steps
                        ...(args.width && { width: args.width }),
                        ...(args.height && { height: args.height }),
                        ...(args.steps && { steps: args.steps }),
                        ...(args.n && { n: args.n }),
                        response_format: "url", // Request URL for other models
                    };
                    // Remove dall-e-3/gpt-image-1 specific params if they were somehow passed
                    delete requestBody.size;
                    delete requestBody.quality;
                    delete requestBody.background;
                    delete requestBody.moderation;
                }
                const modelToUseForGen = args.model || config.defaultImageModel;
                const isSpecialModelGen = modelToUseForGen.includes('dall-e-3') || modelToUseForGen.includes('gpt-image-1');
                if (isSpecialModelGen) {
                    console.log(`[openapi-integrator-mcp] Model ${modelToUseForGen} is special. Starting background processing for generate_image.`);
                    processImageGenerationInBackground(args, config, axiosInstance)
                        .catch(bgError => {
                        console.error('[openapi-integrator-mcp] Critical unhandled error in processImageGenerationInBackground:', bgError);
                    });
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    status: 'processing_in_background',
                                    message: 'Image generation task for special model submitted. You will be notified upon completion.'
                                })
                            }]
                    };
                }
                else {
                    // Synchronous processing for other models
                    console.log(`[openapi-integrator-mcp] Model ${modelToUseForGen} is not special. Processing generate_image synchronously.`);
                    const { model: _, ...restOfDefaultConfig } = config.defaultImageConfig; // Exclude model from default config spread
                    const imageGenRequestBody = {
                        prompt: args.prompt,
                        ...restOfDefaultConfig, // Spread defaults without model property
                        model: modelToUseForGen, // Explicitly set the determined model
                        ...(args.width && { width: args.width }),
                        ...(args.height && { height: args.height }),
                        ...(args.steps && { steps: args.steps }),
                        ...(args.n && { n: args.n }),
                        response_format: "url", // Request URL for other models
                    };
                    // Remove dall-e-3/gpt-image-1 specific params if they were somehow passed
                    delete imageGenRequestBody.size;
                    delete imageGenRequestBody.quality;
                    delete imageGenRequestBody.background;
                    delete imageGenRequestBody.moderation;
                    console.log('[openapi-integrator-mcp SYNC] Image generation request body:', JSON.stringify(imageGenRequestBody, null, 2));
                    const response = await axiosInstance.post('/v1/images/generations', imageGenRequestBody, {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: config.requestTimeout,
                    });
                    const responseData = response.data?.data;
                    if (!responseData || !Array.isArray(responseData) || responseData.length === 0) {
                        throw new McpError(ErrorCode.InternalError, 'API response did not contain image data.');
                    }
                    const results = [];
                    const imagesOutputDir = path.join(config.audioOutputDir, 'images');
                    await ensureDirectoryExists(imagesOutputDir);
                    for (const item of responseData) {
                        let imageBuffer = null;
                        let localPath = null;
                        let cloudflareUrl = null;
                        let cloudflareUploadSuccess = false;
                        let saveError;
                        const filenamePrefix = 'generated_image_sync';
                        let filename = `${filenamePrefix}_${randomUUID()}.png`;
                        try {
                            if (item.url && isValidHttpUrl(item.url)) { // Non-special models return URL
                                const imageUrl = item.url;
                                const urlPath = new URL(imageUrl).pathname;
                                const ext = path.extname(urlPath) || '.png';
                                filename = `${filenamePrefix}_${randomUUID()}${ext}`;
                                localPath = path.join(imagesOutputDir, filename);
                                await downloadFile(imageUrl, localPath);
                                imageBuffer = await fs.promises.readFile(localPath);
                            }
                            else if (item.b64_json) { // Fallback if API behaves unexpectedly
                                imageBuffer = Buffer.from(item.b64_json, 'base64');
                                localPath = path.join(imagesOutputDir, filename);
                                await fs.promises.writeFile(localPath, imageBuffer);
                            }
                            else {
                                saveError = 'Missing image data (url or b64_json) in API response';
                            }
                        }
                        catch (err) {
                            console.error(`[openapi-integrator-mcp SYNC] Error processing image: ${err.message}`);
                            saveError = `Error processing image: ${err.message}`;
                        }
                        if (config.cfImgbedUploadUrl && config.cfImgbedApiKey && imageBuffer && localPath) {
                            cloudflareUrl = await uploadToCfImgbed(imageBuffer, filename, config.cfImgbedUploadUrl, config.cfImgbedApiKey);
                            if (cloudflareUrl) {
                                cloudflareUploadSuccess = true;
                                // For sync, notification is optional or could be part of a different flow if desired.
                                // Here, we assume direct response is primary, notification is secondary.
                                // You might choose to send notifications even for sync tasks if that's the requirement.
                                // await sendImageUploadNotification(config, filename, args.prompt, cloudflareUrl, localPath, 'generation');
                            }
                        }
                        results.push({ local_path: localPath, cloudflare_url: cloudflareUrl, cloudflareUploadSuccess, error: saveError });
                    }
                    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
                }
            }
            case 'generate_speech': {
                if (!isGenerateSpeechArgs(args)) {
                    throw new McpError(ErrorCode.InvalidParams, 'Invalid parameters for generate_speech');
                }
                const requestBody = {
                    input: args.input,
                    model: args.model || config.defaultSpeechModel, // Use config object
                    voice: args.voice || config.defaultSpeechVoice, // Use config object
                    speed: args.speed ?? config.defaultSpeechSpeed, // Use config object
                    response_format: 'mp3',
                };
                const speechOutputDir = path.join(config.audioOutputDir, 'audio'); // Create 'audio' subdirectory path
                await ensureDirectoryExists(speechOutputDir); // Ensure 'audio' subdirectory exists
                // Set Content-Type and responseType specifically for this request
                const response = await axiosInstance.post('/v1/audio/speech', requestBody, {
                    headers: { 'Content-Type': 'application/json' },
                    responseType: 'arraybuffer',
                });
                const audioBuffer = Buffer.from(response.data);
                const outputPath = path.join(speechOutputDir, `speech_${randomUUID()}.mp3`); // Save to 'audio' subdirectory
                await fs.promises.writeFile(outputPath, audioBuffer);
                let webdavUploadStatus = 'skipped'; // Default status if WebDAV is not configured or fails
                // --- WebDAV Upload Logic ---
                if (config.webdavUrl && config.webdavUsername && config.webdavPassword) {
                    const webdavUploadUrl = `${config.webdavUrl.replace(/\/$/, '')}/${path.basename(outputPath)}`; // Ensure no double slash
                    console.error(`Attempting WebDAV upload to: ${webdavUploadUrl}`);
                    try {
                        const fileStream = fs.createReadStream(outputPath);
                        const response = await axiosInstance.put(webdavUploadUrl, fileStream, {
                            headers: {
                                'Content-Type': 'audio/mpeg', // Assuming mp3 output
                                // Add Content-Length if required by the server, axios might handle this automatically with streams
                            },
                            auth: {
                                username: config.webdavUsername,
                                password: config.webdavPassword,
                            },
                            // Set maxBodyLength and maxContentLength to prevent potential issues with large files
                            maxBodyLength: Infinity,
                            maxContentLength: Infinity,
                        });
                        // Check response status (201 Created or 204 No Content are typical success codes for PUT)
                        if (response.status === 201 || response.status === 204 || response.status === 200) {
                            webdavUploadStatus = 'success';
                            console.error(`WebDAV upload successful to ${webdavUploadUrl}`);
                        }
                        else {
                            webdavUploadStatus = 'failed';
                            console.error(`WebDAV upload failed with status ${response.status} to ${webdavUploadUrl}`);
                        }
                    }
                    catch (webdavError) {
                        webdavUploadStatus = 'failed';
                        console.error(`WebDAV upload error to ${webdavUploadUrl}:`, webdavError.message);
                        if (axios.isAxiosError(webdavError)) {
                            console.error('WebDAV Axios error details:', {
                                status: webdavError.response?.status,
                                data: webdavError.response?.data,
                            });
                        }
                    }
                }
                else {
                    console.error('WebDAV configuration missing, skipping upload.');
                }
                // --- End WebDAV Upload Logic ---
                // Return result including WebDAV status
                return { content: [{ type: 'text', text: JSON.stringify([{ path: outputPath, webdavUploadStatus: webdavUploadStatus }]) }] };
            }
            case 'edit_image': {
                if (!args || typeof args !== 'object' || !args.image || typeof args.image !== 'string' || !args.prompt || typeof args.prompt !== 'string') {
                    throw new McpError(ErrorCode.InvalidParams, 'Parameters "image" (string) and "prompt" (string) are required for edit_image.');
                }
                const modelToUseForEdit = args.model || config.defaultEditImageModel;
                const isSpecialModelEdit = modelToUseForEdit.includes('dall-e-3') || modelToUseForEdit.includes('gpt-image-1'); // Assuming same models for edit
                if (isSpecialModelEdit) {
                    console.log(`[openapi-integrator-mcp] Model ${modelToUseForEdit} is special. Starting background processing for edit_image.`);
                    processImageEditInBackground(args, config, axiosInstance)
                        .catch(bgError => {
                        console.error('[openapi-integrator-mcp] Critical unhandled error in processImageEditInBackground:', bgError);
                    });
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    status: 'processing_in_background',
                                    message: 'Image editing task for special model submitted. You will be notified upon completion.'
                                })
                            }]
                    };
                }
                else {
                    // Synchronous processing for other edit models (if any, current default is gpt-image-1 which is special)
                    // This path might be less common if defaultEditImageModel is always a "special" one.
                    console.log(`[openapi-integrator-mcp] Model ${modelToUseForEdit} is not special. Processing edit_image synchronously.`);
                    let imagePath = args.image;
                    let cleanupTempFile = false;
                    const tempDir = config.tempDir;
                    await ensureDirectoryExists(tempDir);
                    if (isValidHttpUrl(args.image)) {
                        const tempImageFilename = `edit_input_sync_${randomUUID()}${path.extname(new URL(args.image).pathname) || '.png'}`;
                        const tempImagePath = path.join(tempDir, tempImageFilename);
                        try {
                            await downloadFile(args.image, tempImagePath);
                            imagePath = tempImagePath;
                            cleanupTempFile = true;
                        }
                        catch (downloadError) {
                            throw new McpError(ErrorCode.InternalError, `Failed to download image for editing: ${downloadError.message}`);
                        }
                    }
                    else {
                        try {
                            await fs.promises.access(imagePath, fs.constants.R_OK);
                        }
                        catch (accessError) {
                            throw new McpError(ErrorCode.InvalidParams, `Cannot access local image file for editing: ${imagePath}`);
                        }
                    }
                    const formData = new FormData();
                    try {
                        const imageBuffer = await fs.promises.readFile(imagePath);
                        formData.append('image', imageBuffer, path.basename(imagePath));
                    }
                    catch (readError) {
                        if (cleanupTempFile)
                            await unlink(imagePath).catch(console.error);
                        throw new McpError(ErrorCode.InternalError, `Failed to read image file for editing: ${readError.message}`);
                    }
                    formData.append('prompt', args.prompt);
                    formData.append('model', modelToUseForEdit); // This model is NOT dall-e-3 or gpt-image-1 here
                    if (args.n)
                        formData.append('n', String(args.n));
                    // For non-dall-e-3/gpt-image-1 edit models, 'size' might behave differently or not be supported.
                    // OpenAI's standard edit endpoint (not DALL-E 2 via images/edits) primarily uses 'b64_json' or 'url' for response_format.
                    // Assuming 'b64_json' for consistency if this path were to be used by a non-special model.
                    formData.append('response_format', 'b64_json');
                    if (args.size)
                        formData.append('size', args.size);
                    let editedImageData;
                    try {
                        const editResponse = await axiosInstance.post('/v1/images/edits', formData, {
                            headers: formData.getHeaders(),
                            timeout: config.requestTimeout,
                        });
                        editedImageData = editResponse.data?.data;
                        if (!editedImageData || !Array.isArray(editedImageData) || editedImageData.length === 0) {
                            throw new McpError(ErrorCode.InternalError, 'API response for image edit did not contain image data.');
                        }
                    }
                    finally {
                        if (cleanupTempFile)
                            await unlink(imagePath).catch(console.error);
                    }
                    const results = [];
                    const imagesOutputDir = path.join(config.audioOutputDir, 'images');
                    await ensureDirectoryExists(imagesOutputDir);
                    for (const item of editedImageData) {
                        let imageBuffer = null;
                        let localPath = null;
                        let cloudflareUrl = null;
                        let cloudflareUploadSuccess = false;
                        let saveError;
                        const filenamePrefix = 'edited_image_sync';
                        const filename = `${filenamePrefix}_${randomUUID()}.png`;
                        try {
                            if (item.b64_json) {
                                imageBuffer = Buffer.from(item.b64_json, 'base64');
                                localPath = path.join(imagesOutputDir, filename);
                                await fs.promises.writeFile(localPath, imageBuffer);
                            }
                            else {
                                saveError = 'Missing b64_json in API edit response for sync model';
                            }
                        }
                        catch (err) {
                            console.error(`[openapi-integrator-mcp SYNC] Error saving edited image: ${err.message}`);
                            saveError = `Error saving edited image: ${err.message}`;
                        }
                        if (config.cfImgbedUploadUrl && config.cfImgbedApiKey && imageBuffer && localPath) {
                            cloudflareUrl = await uploadToCfImgbed(imageBuffer, filename, config.cfImgbedUploadUrl, config.cfImgbedApiKey);
                            if (cloudflareUrl)
                                cloudflareUploadSuccess = true;
                            // Optional: send notification for sync tasks too
                            // await sendImageUploadNotification(config, filename, args.prompt, cloudflareUrl, localPath, 'edit');
                        }
                        results.push({ local_path: localPath, cloudflare_url: cloudflareUrl, cloudflareUploadSuccess, error: saveError });
                    }
                    return { content: [{ type: 'text', text: JSON.stringify(results) }] };
                }
            }
            case 'generate_video': {
                // --- Notification Configuration Check ---
                const isOneBotConfigured = !!(config.onebotHttpUrl && config.onebotMessageType && config.onebotTargetId);
                const isTelegramConfigured = !!(config.telegramBotToken && config.telegramChatId);
                if (!isOneBotConfigured && !isTelegramConfigured) {
                    throw new McpError(ErrorCode.InvalidRequest, // Use InvalidRequest as it's a setup issue
                    'Video generation requires at least one notification method (OneBot or Telegram) to be configured to receive results.');
                }
                // --- End Notification Check ---
                // Validate required parameters first
                if (!args || typeof args !== 'object' || !args.prompt || typeof args.prompt !== 'string' || !args.image_size || typeof args.image_size !== 'string') {
                    throw new McpError(ErrorCode.InvalidParams, 'Parameters "prompt" (string) and "image_size" (string) are required for generate_video.');
                }
                const modelToUseForVideo = args.model || config.siliconflowVideoModel;
                // Validate the model name
                const supportedVideoModels = ["Wan-AI/Wan2.1-T2V-14B", "Wan-AI/Wan2.1-T2V-14B-Turbo", "Wan-AI/Wan2.1-I2V-14B-720P", "Wan-AI/Wan2.1-I2V-14B-720P-Turbo"];
                if (!supportedVideoModels.includes(modelToUseForVideo)) {
                    throw new McpError(ErrorCode.InvalidParams, `Invalid model for generate_video: "${modelToUseForVideo}". Supported models are: ${supportedVideoModels.join(', ')}.`);
                }
                const isImageToVideoModel = modelToUseForVideo.includes('I2V'); // Check if it's an Image-to-Video model
                // Validate 'image' parameter based on model type
                if (isImageToVideoModel && (!args.image || typeof args.image !== 'string')) {
                    throw new McpError(ErrorCode.InvalidParams, `Parameter "image" (string URL or base64 data) is required when using an Image-to-Video model like "${modelToUseForVideo}".`);
                }
                if (!isImageToVideoModel && args.image) {
                    console.warn(`[openapi-integrator-mcp] Parameter "image" was provided but the selected model "${modelToUseForVideo}" is a Text-to-Video model. The "image" parameter will be ignored.`);
                    // We don't throw an error, just ignore the image param for T2V models
                }
                // Construct the request body for SiliconFlow /v1/video/submit
                const videoRequestBody = {
                    model: modelToUseForVideo,
                    prompt: args.prompt,
                    image_size: args.image_size,
                };
                if (args.negative_prompt)
                    videoRequestBody.negative_prompt = args.negative_prompt;
                if (args.seed)
                    videoRequestBody.seed = args.seed;
                // Only include image if it's an I2V model and image was provided
                if (isImageToVideoModel && args.image)
                    videoRequestBody.image = args.image;
                // Check for SiliconFlow API Key
                if (!config.siliconflowApiKey) {
                    throw new McpError(ErrorCode.InvalidRequest, 'SiliconFlow API Key (SILICONFLOW_API_KEY) is not configured.');
                }
                try {
                    console.log('[openapi-integrator-mcp] Submitting video generation job to SiliconFlow:', JSON.stringify(videoRequestBody, null, 2));
                    // Use base URL from config
                    const submitUrl = `${config.siliconflowBaseUrl}/v1/video/submit`;
                    const submitResponse = await axios.post(submitUrl, videoRequestBody, {
                        headers: {
                            'Authorization': `Bearer ${config.siliconflowApiKey}`,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                        },
                        timeout: config.requestTimeout, // Use standard request timeout for submission
                    });
                    const requestId = submitResponse.data?.requestId;
                    if (!requestId || typeof requestId !== 'string') {
                        console.error('[openapi-integrator-mcp] SiliconFlow submit response missing requestId:', submitResponse.data);
                        throw new McpError(ErrorCode.InternalError, 'Failed to submit video generation job: Invalid response from SiliconFlow API.');
                    }
                    console.log(`[openapi-integrator-mcp] Video generation job submitted successfully. Request ID: ${requestId}`);
                    // Start background polling - DO NOT await this
                    handleSiliconFlowVideoGeneration(requestId, args.prompt, modelToUseForVideo, config.siliconflowApiKey, config // Pass the whole config object
                    );
                    // Return immediate success response to the AI
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    status: 'submitted',
                                    message: `Video generation job submitted successfully with Request ID: ${requestId}. You will be notified upon completion.`,
                                    requestId: requestId
                                })
                            }]
                    };
                }
                catch (error) {
                    console.error(`[openapi-integrator-mcp] Error submitting video generation job:`, error.response?.data || error.message);
                    let errorMessage = 'Failed to submit video generation job.';
                    let mcpErrorCode = ErrorCode.InternalError;
                    if (axios.isAxiosError(error)) {
                        errorMessage = `SiliconFlow API Error: ${error.response?.data?.message || error.message}`;
                        if (error.response?.status === 401)
                            mcpErrorCode = ErrorCode.InvalidRequest; // Unauthorized
                        if (error.response?.status === 400)
                            mcpErrorCode = ErrorCode.InvalidParams; // Bad request likely due to params
                    }
                    else if (error instanceof Error) {
                        errorMessage = error.message;
                    }
                    throw new McpError(mcpErrorCode, errorMessage);
                }
            }
            case 'transcribe_audio': {
                if (!isTranscribeAudioArgs(args)) {
                    throw new McpError(ErrorCode.InvalidParams, 'Invalid parameters for transcribe_audio');
                }
                let audioFilePath = args.file;
                let cleanupRequired = false;
                // Check if the file input is a URL
                if (isValidHttpUrl(args.file)) {
                    await ensureDirectoryExists(config.tempDir); // Use config object
                    const tempFileName = `download_${randomUUID()}${path.extname(new URL(args.file).pathname) || '.audio'}`;
                    const tempFilePath = path.join(config.tempDir, tempFileName); // Use config object
                    console.error(`Downloading audio from ${args.file} to ${tempFilePath}`);
                    try {
                        await downloadFile(args.file, tempFilePath);
                        audioFilePath = tempFilePath;
                        cleanupRequired = true;
                        console.error(`Download complete: ${tempFilePath}`);
                    }
                    catch (downloadError) {
                        console.error(`Failed to download file: ${downloadError}`);
                        throw new McpError(ErrorCode.InternalError, `Failed to download audio file from URL: ${args.file}`);
                    }
                }
                else {
                    // Verify local file exists
                    try {
                        await fs.promises.access(audioFilePath, fs.constants.R_OK);
                        console.error(`Using local file: ${audioFilePath}`);
                    }
                    catch (accessError) {
                        throw new McpError(ErrorCode.InvalidParams, `Cannot access local audio file: ${audioFilePath}`);
                    }
                }
                const formData = new FormData();
                formData.append('file', fs.createReadStream(audioFilePath));
                formData.append('model', args.model || config.defaultTranscriptionModel); // Use config object
                try {
                    // Make the API call with multipart/form-data
                    const response = await axiosInstance.post('/v1/audio/transcriptions', formData, {
                        headers: formData.getHeaders(), // Use headers from form-data library
                    });
                    const transcriptionText = response.data?.text;
                    if (typeof transcriptionText !== 'string') {
                        console.error('API response did not contain valid text:', response.data);
                        throw new McpError(ErrorCode.InternalError, 'API response did not contain valid transcription text.');
                    }
                    // Return transcription text in the consistent JSON style
                    return { content: [{ type: 'text', text: JSON.stringify([{ text: transcriptionText }]) }] };
                }
                finally {
                    // Cleanup temporary file if it was downloaded
                    if (cleanupRequired) {
                        try {
                            await unlink(audioFilePath);
                            console.error(`Cleaned up temporary file: ${audioFilePath}`);
                        }
                        catch (cleanupError) {
                            console.error(`Failed to clean up temporary file ${audioFilePath}: ${cleanupError}`);
                        }
                    }
                }
            }
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
        }
    }
    catch (error) {
        console.error(`Error calling tool ${toolName}:`, error);
        // If it's already an McpError, re-throw it
        if (error instanceof McpError) {
            throw error;
        }
        let errorMessage = `Error processing tool ${toolName}`;
        let mcpErrorCode = ErrorCode.InternalError;
        // Handle Axios errors specifically
        if (axios.isAxiosError(error)) {
            console.error('Axios error details:', {
                message: error.message,
                url: error.config?.url,
                method: error.config?.method,
                status: error.response?.status,
                data: error.response?.data,
            });
            let apiErrorMessage = error.message;
            if (error.response?.data instanceof ArrayBuffer || Buffer.isBuffer(error.response?.data)) {
                try {
                    const errorJson = JSON.parse(Buffer.from(error.response.data).toString('utf-8'));
                    apiErrorMessage = errorJson?.error?.message || apiErrorMessage;
                }
                catch (parseError) { /* Ignore */ }
            }
            else {
                apiErrorMessage = error.response?.data?.error?.message || error.response?.data?.message || apiErrorMessage;
            }
            errorMessage = `API Error: ${apiErrorMessage}`;
            // You might want to map HTTP status codes to McpError codes here
            // For now, use InternalError or InvalidParams based on status?
            if (error.response?.status && error.response.status >= 400 && error.response.status < 500) {
                mcpErrorCode = ErrorCode.InvalidParams; // Or a more specific code
            }
            else {
                mcpErrorCode = ErrorCode.InternalError;
            }
        }
        else if (error instanceof Error) {
            // Use the message from standard errors
            errorMessage = error.message;
        }
        // Throw an McpError for the server to handle
        throw new McpError(mcpErrorCode, errorMessage);
    }
}
