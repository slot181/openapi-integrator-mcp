# OpenAI Compatible API MCP 服务器

本项目是一个 Model Context Protocol (MCP) 服务器，集成了多种基于 OpenAI 兼容 API 和 SiliconFlow API 的工具，提供包括图片生成、图片编辑、语音合成、语音转录和视频生成在内的多种功能。

## 核心功能

-   **图片生成**: 使用 OpenAI 兼容 API (如 DALL-E 3, gpt-image-1 或其他 Stable Diffusion 模型) 生成图片。
-   **图片编辑**: 使用 OpenAI 兼容 API (如 gpt-image-1) 编辑图片。
-   **语音合成 (TTS)**: 使用 OpenAI 兼容 API 将文本转换为语音。
-   **语音转录 (STT)**: 使用 OpenAI 兼容 API 将音频文件转录为文本。
-   **视频生成**: 使用 SiliconFlow API 提交文本到视频或图片到视频的生成任务。
-   **后台任务处理**: 对于耗时较长的任务（如特定模型的图片生成/编辑、视频生成），服务器会接受任务并异步处理，通过配置的通知方式（OneBot 或 Telegram）在任务完成或失败时发送通知。
-   **文件上传**: 支持将生成的图片和视频上传到配置的基于 [MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 项目的 ImgBed 服务。
-   **本地保存**: 所有生成的媒体文件都会保存在本地。

## 前提条件

-   Node.js (建议版本 >= 18.x)
-   相关的 API 密钥 (OpenAI/兼容 API 密钥, SiliconFlow API 密钥等)

## 安装与构建

1.  **克隆项目** (如果尚未克隆):
    ```bash
    git clone <项目仓库地址>
    cd openapi-integrator-mcp
    ```

2.  **安装依赖**:
    ```bash
    npm install
    ```

3.  **构建项目**:
    ```bash
    npm run build
    ```
    构建产物将位于 `build` 目录。

## 配置

通过项目根目录下的 `.env` 文件配置环境变量。如果 `.env` 文件不存在，请根据 `.env.example` (如果提供) 或以下列表创建它。

### 关键环境变量:

-   `OPENAI_API_KEY`: (必需) 你的 OpenAI API 密钥或兼容 API 的密钥。
-   `OPENAI_API_BASE_URL`: (可选) OpenAI 兼容 API 的基础 URL。默认为 `https://api.openai.com`。
-   `REQUEST_TIMEOUT`: (可选) API 请求超时时间 (毫秒)。默认为 `180000` (3分钟)。
-   `OUTPUT_DIR`: (可选) 用于存储生成媒体文件的基础输出目录。默认为 `./output`。子目录如 `images`, `audio`, `video` 会在此目录下创建。

**图片生成/编辑默认模型配置:**
-   `DEFAULT_IMAGE_MODEL`: (可选) 默认图片生成模型。默认为 `dall-e-3`。
-   `DEFAULT_EDIT_IMAGE_MODEL`: (可选) 默认图片编辑模型。默认为 `gpt-image-1`。
-   `DEFAULT_IMAGE_WIDTH`: (可选) 默认图片宽度 (非 DALL-E 3/gpt-image-1 模型)。默认为 `1024`。
-   `DEFAULT_IMAGE_HEIGHT`: (可选) 默认图片高度 (非 DALL-E 3/gpt-image-1 模型)。默认为 `768`。
-   `DEFAULT_IMAGE_STEPS`: (可选) 默认图片生成步数 (非 DALL-E 3/gpt-image-1 模型)。默认为 `20`。

**语音默认配置:**
-   `DEFAULT_SPEECH_MODEL`: (可选) 默认语音合成模型。默认为 `tts-1`。
-   `DEFAULT_SPEECH_VOICE`: (可选) 默认语音合成声音。默认为 `alloy`。
-   `DEFAULT_SPEECH_SPEED`: (可选) 默认语音合成速度。默认为 `1.0`。
-   `DEFAULT_TRANSCRIPTION_MODEL`: (可选) 默认语音转录模型。默认为 `whisper-1`。

**SiliconFlow 视频生成配置:**
-   `SILICONFLOW_API_KEY`: (可选，若使用视频生成则必需) SiliconFlow API 密钥。
-   `SILICONFLOW_BASE_URL`: (可选) SiliconFlow API 基础 URL。默认为 `https://api.siliconflow.cn`。
-   `SILICONFLOW_VIDEO_MODEL`: (可选) 默认视频生成模型。默认为 `Wan-AI/Wan2.1-T2V-14B-Turbo`。

**通知配置 (至少配置一种以便接收后台任务结果):**
-   `ONEBOT_HTTP_URL`: (可选) OneBot HTTP 上报地址 (例如 `http://localhost:5700`)。
-   `ONEBOT_ACCESS_TOKEN`: (可选) OneBot Access Token (如果需要)。
-   `ONEBOT_MESSAGE_TYPE`: (可选) OneBot 消息类型 (`private` 或 `group`)。
-   `ONEBOT_TARGET_ID`: (可选) OneBot 目标用户 ID 或群组 ID。
-   `TELEGRAM_BOT_TOKEN`: (可选) Telegram Bot Token。
-   `TELEGRAM_CHAT_ID`: (可选) Telegram Chat ID。

**ImgBed 图床配置 (可选, 针对 `MarSeventh/CloudFlare-ImgBed`):**
-   `CF_IMGBED_UPLOAD_URL`: (可选) 你部署的 `CloudFlare-ImgBed` 实例的上传 URL (例如 `https://your-worker.your-domain.workers.dev/upload`)。
-   `CF_IMGBED_API_KEY`: (可选) 为你的 `CloudFlare-ImgBed` 实例配置的 `AUTH_KEY` (或在某些上下文中称为 `authCode`)。

## 运行服务

-   **生产模式**:
    ```bash
    npm start
    ```
    这将运行 `build` 目录中的 JavaScript 文件。

-   **开发模式** (使用 ts-node-dev 实现热重载):
    ```bash
    npm run dev
    ```

服务启动后，MCP 服务器将在标准输入/输出 (stdio) 上监听请求。

## 可用的 MCP 工具

### 1. `generate_image`

生成图片。

-   **功能**: 根据文本提示生成图片。支持多种模型，包括 DALL-E 3, gpt-image-1 及其他兼容模型。对于 DALL-E 3/gpt-image-1，任务将在后台处理并通过通知返回结果。其他模型同步返回结果。
-   **核心参数**:
    -   `prompt` (string, 必需): 图片描述。
    -   `model` (string, 可选): 使用的模型，默认为配置的 `DEFAULT_IMAGE_MODEL`。
    -   `n` (number, 可选): 生成图片数量。
    -   (DALL-E 3/gpt-image-1 特定参数): `quality`, `size`, `background`, `moderation`。
    -   (其他模型特定参数): `width`, `height`, `steps`。

### 2. `edit_image`

编辑图片。

-   **功能**: 根据文本提示编辑现有图片。支持的模型如 `gpt-image-1`。任务将在后台处理并通过通知返回结果。
-   **核心参数**:
    -   `image` (string, 必需): 要编辑的图片路径或 URL。
    -   `prompt` (string, 必需): 编辑指令。
    -   `model` (string, 可选): 使用的模型，默认为配置的 `DEFAULT_EDIT_IMAGE_MODEL`。
    -   `n` (number, 可选): 生成图片数量。
    -   `size` (string, 可选): 输出图片尺寸。

### 3. `generate_speech`

文本转语音。

-   **功能**: 将文本转换为语音文件 (MP3格式) 并保存到本地。
-   **核心参数**:
    -   `input` (string, 必需): 要转换为语音的文本。
    -   `voice` (string, 必需): 使用的声音。
    -   `model` (string, 可选): 使用的模型，默认为配置的 `DEFAULT_SPEECH_MODEL`。
    -   `speed` (number, 可选): 语速，默认为配置的 `DEFAULT_SPEECH_SPEED`。

### 4. `transcribe_audio`

语音转文本。

-   **功能**: 将音频文件转录为文本。
-   **核心参数**:
    -   `file` (string, 必需): 音频文件的本地路径或 URL。
    -   `model` (string, 可选): 使用的模型，默认为配置的 `DEFAULT_TRANSCRIPTION_MODEL`。

### 5. `generate_video`

生成视频。

-   **功能**: 提交视频生成任务到 SiliconFlow API。支持文本到视频和图片到视频。任务将在后台处理并通过通知返回结果。
-   **核心参数**:
    -   `prompt` (string, 必需): 视频描述。
    -   `image_size` (string, 必需): 视频尺寸/宽高比 (例如 "1280x720")。
    -   `model` (string, 可选): 使用的视频模型，默认为配置的 `SILICONFLOW_VIDEO_MODEL`。支持的模型包括: `Wan-AI/Wan2.1-T2V-14B`, `Wan-AI/Wan2.1-T2V-14B-Turbo`, `Wan-AI/Wan2.1-I2V-14B-720P`, `Wan-AI/Wan2.1-I2V-14B-720P-Turbo`。
    -   `image` (string, 可选): 当使用图片到视频模型时，提供图片 URL 或 Base64 数据。
    -   `negative_prompt` (string, 可选): 负面提示。
    -   `seed` (integer, 可选): 随机种子。

## 通知功能

对于后台处理的任务（如特定图片生成/编辑、视频生成），结果将通过以下配置的方式发送通知：

-   **OneBot**: 如果配置了 `ONEBOT_HTTP_URL`, `ONEBOT_MESSAGE_TYPE`, 和 `ONEBOT_TARGET_ID`。
-   **Telegram**: 如果配置了 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID`。

请确保至少配置一种通知方式以接收后台任务的结果。

## 许可证

本项目使用 MIT 许可证。详情请见 `LICENSE` 文件。
