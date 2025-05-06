import axios from 'axios'; // Import axios itself
import * as fs from 'fs';
import * as path from 'path';
import { unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import FormData from 'form-data';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { isGenerateSpeechArgs, isTranscribeAudioArgs } from '../types/index.js';
import { ensureDirectoryExists, isValidHttpUrl, downloadFile, saveImageToFile, uploadToCfImgbed } from '../utils/index.js';
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
                        response_format: "b64_json", // Explicitly request b64_json for other models
                    };
                    // Remove dall-e-3/gpt-image-1 specific params if they were somehow passed
                    delete requestBody.size;
                    delete requestBody.quality;
                    delete requestBody.background;
                    delete requestBody.moderation;
                }
                console.log('[openapi-integrator-mcp] Image generation request body:', JSON.stringify(requestBody, null, 2));
                // Set Content-Type specifically for this request
                const response = await axiosInstance.post('/v1/images/generations', requestBody, {
                    headers: { 'Content-Type': 'application/json' }
                });
                const responseData = response.data?.data;
                if (!responseData || !Array.isArray(responseData) || responseData.length === 0) {
                    throw new McpError(ErrorCode.InternalError, 'API response did not contain image data.');
                }
                const results = [];
                const imagesOutputDir = path.join(config.audioOutputDir, 'images'); // Define images output directory
                await ensureDirectoryExists(imagesOutputDir);
                for (const item of responseData) {
                    if (!item.b64_json) {
                        console.warn('[openapi-integrator-mcp] API response item missing b64_json data.');
                        results.push({ local_path: null, cloudflare_url: null, cloudflareUploadSuccess: false, error: 'Missing image data in API response' });
                        continue;
                    }
                    const imageBuffer = Buffer.from(item.b64_json, 'base64');
                    let localPath = null;
                    let cloudflareUrl = null;
                    let cloudflareUploadSuccess = false;
                    let saveError;
                    try {
                        localPath = await saveImageToFile(imageBuffer, imagesOutputDir, 'generated_image');
                    }
                    catch (err) {
                        console.error(`[openapi-integrator-mcp] Error saving image locally: ${err.message}`);
                        saveError = err.message;
                    }
                    if (config.cfImgbedUploadUrl && config.cfImgbedApiKey && localPath) {
                        const filename = path.basename(localPath);
                        cloudflareUrl = await uploadToCfImgbed(imageBuffer, filename, config.cfImgbedUploadUrl, config.cfImgbedApiKey);
                        if (cloudflareUrl) {
                            cloudflareUploadSuccess = true;
                        }
                    }
                    else if (config.cfImgbedUploadUrl && config.cfImgbedApiKey && !localPath) {
                        // Attempt upload even if local save failed, using a generic name
                        const randomFilename = `generated_image_${randomUUID()}.png`;
                        cloudflareUrl = await uploadToCfImgbed(imageBuffer, randomFilename, config.cfImgbedUploadUrl, config.cfImgbedApiKey);
                        if (cloudflareUrl) {
                            cloudflareUploadSuccess = true;
                        }
                    }
                    results.push({
                        local_path: localPath,
                        cloudflare_url: cloudflareUrl,
                        cloudflareUploadSuccess: cloudflareUploadSuccess,
                        error: saveError
                    });
                }
                // Return result in the expected format
                return { content: [{ type: 'text', text: JSON.stringify(results) }] };
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
                // Validate required parameters
                if (!args || typeof args !== 'object' || !args.image || typeof args.image !== 'string' || !args.prompt || typeof args.prompt !== 'string') {
                    throw new McpError(ErrorCode.InvalidParams, 'Parameters "image" (string) and "prompt" (string) are required for edit_image.');
                }
                let imagePath = args.image;
                let cleanupTempFile = false;
                const tempDir = config.tempDir; // Use configured temp directory
                await ensureDirectoryExists(tempDir);
                // Handle URL input for image
                if (isValidHttpUrl(args.image)) {
                    const tempImageFilename = `edit_input_${randomUUID()}${path.extname(new URL(args.image).pathname) || '.png'}`;
                    const tempImagePath = path.join(tempDir, tempImageFilename);
                    try {
                        console.info(`[openapi-integrator-mcp] Downloading image for editing from ${args.image} to ${tempImagePath}`);
                        await downloadFile(args.image, tempImagePath); // downloadFile is already in utils
                        imagePath = tempImagePath;
                        cleanupTempFile = true;
                    }
                    catch (downloadError) {
                        throw new McpError(ErrorCode.InternalError, `Failed to download image from URL "${args.image}": ${downloadError.message}`);
                    }
                }
                else {
                    // Verify local file exists
                    try {
                        await fs.promises.access(imagePath, fs.constants.R_OK);
                    }
                    catch (accessError) {
                        throw new McpError(ErrorCode.InvalidParams, `Cannot access local image file: ${imagePath}`);
                    }
                }
                const formData = new FormData();
                try {
                    const imageBuffer = await fs.promises.readFile(imagePath);
                    formData.append('image', imageBuffer, path.basename(imagePath));
                }
                catch (readError) {
                    if (cleanupTempFile) {
                        await unlink(imagePath).catch(e => console.error(`[openapi-integrator-mcp] Failed to cleanup temp edit image ${imagePath}: ${e.message}`));
                    }
                    throw new McpError(ErrorCode.InternalError, `Failed to read image file "${imagePath}": ${readError.message}`);
                }
                formData.append('prompt', args.prompt);
                const modelToUseForEdit = args.model || config.defaultEditImageModel; // Use user's model or default
                formData.append('model', modelToUseForEdit);
                // Directly append optional parameters if provided by the user/AI
                if (args.n)
                    formData.append('n', String(args.n));
                if (args.size)
                    formData.append('size', args.size); // Pass size directly if provided
                // Always request b64_json for processing
                formData.append('response_format', 'b64_json');
                let editedImageData;
                try {
                    console.info(`[openapi-integrator-mcp] Sending image edit request with model ${modelToUseForEdit}.`); // Simplified log
                    const editResponse = await axiosInstance.post('/v1/images/edits', formData, {
                        headers: formData.getHeaders(),
                    });
                    editedImageData = editResponse.data?.data;
                    if (!editedImageData || !Array.isArray(editedImageData) || editedImageData.length === 0) {
                        throw new McpError(ErrorCode.InternalError, 'API response for image edit did not contain image data.');
                    }
                }
                finally {
                    if (cleanupTempFile) {
                        await unlink(imagePath).catch(e => console.error(`[openapi-integrator-mcp] Failed to cleanup temp edit image ${imagePath}: ${e.message}`));
                    }
                }
                const results = [];
                const imagesOutputDir = path.join(config.audioOutputDir, 'images'); // Consistent with generate_image
                await ensureDirectoryExists(imagesOutputDir);
                for (const item of editedImageData) {
                    if (!item.b64_json) {
                        console.warn('[openapi-integrator-mcp] API edit response item missing b64_json data.');
                        results.push({ local_path: null, cloudflare_url: null, cloudflareUploadSuccess: false, error: 'Missing image data in API edit response' });
                        continue;
                    }
                    const imageBuffer = Buffer.from(item.b64_json, 'base64');
                    let localPath = null;
                    let cloudflareUrl = null;
                    let cloudflareUploadSuccess = false;
                    let saveError;
                    try {
                        localPath = await saveImageToFile(imageBuffer, imagesOutputDir, 'edited_image');
                    }
                    catch (err) {
                        console.error(`[openapi-integrator-mcp] Error saving edited image locally: ${err.message}`);
                        saveError = err.message;
                    }
                    if (config.cfImgbedUploadUrl && config.cfImgbedApiKey && localPath) {
                        const filename = path.basename(localPath);
                        cloudflareUrl = await uploadToCfImgbed(imageBuffer, filename, config.cfImgbedUploadUrl, config.cfImgbedApiKey);
                        if (cloudflareUrl) {
                            cloudflareUploadSuccess = true;
                        }
                    }
                    else if (config.cfImgbedUploadUrl && config.cfImgbedApiKey && !localPath) {
                        const randomFilename = `edited_image_${randomUUID()}.png`;
                        cloudflareUrl = await uploadToCfImgbed(imageBuffer, randomFilename, config.cfImgbedUploadUrl, config.cfImgbedApiKey);
                        if (cloudflareUrl) {
                            cloudflareUploadSuccess = true;
                        }
                    }
                    results.push({
                        local_path: localPath,
                        cloudflare_url: cloudflareUrl,
                        cloudflareUploadSuccess: cloudflareUploadSuccess,
                        error: saveError,
                    });
                }
                return { content: [{ type: 'text', text: JSON.stringify(results) }] };
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
