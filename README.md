# OpenAI Image Generation MCP Server

A Model Context Protocol (MCP) server that enables seamless generation of high-quality images using OpenAI compatible APIs. This server provides a standardized interface to specify image generation parameters.

<a href="https://glama.ai/mcp/servers/y6qfizhsja">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/y6qfizhsja/badge" alt="Image Generation Server MCP server" />
</a>

## Features

- High-quality image generation powered by OpenAI compatible APIs
- Support for customizable dimensions (width and height)
- Clear error handling for prompt validation and API issues
- Easy integration with MCP-compatible clients
- Returns a direct URL to the generated image

## Installation

```bash
npm install openai-image-mcp
```

Or run directly:

```bash
npx openai-image-mcp@latest
```

### Configuration

Add to your MCP server configuration:

<summary>Configuration Example</summary>

```json
{
  "mcpServers": {
    "openai-image-gen": {
      "command": "npx",
      "args": ["openai-image-mcp@latest -y"],
      "env": {
        "OPENAI_API_KEY": "<YOUR_API_KEY>",
        "OPENAI_API_URL": "<OPTIONAL_API_ENDPOINT_URL>", // Optional: Defaults to OpenAI standard endpoint if not provided
        "DEFAULT_MODEL": "<OPTIONAL_DEFAULT_MODEL_NAME>" // Optional: Defaults to 'black-forest-labs/FLUX.1-schnell-Free' if not provided
      }
    }
  }
}
```

## Usage

The server provides one tool: `generate_image`

### Using generate_image

This tool requires a `prompt`. Other parameters like `model`, `width`, `height`, `steps`, and `n` are optional and use defaults if not provided. It returns a direct URL to the generated image.

#### Parameters

```typescript
{
  // Required
  prompt: string;          // Text description of the image to generate

  // Optional with defaults
  model?: string;          // Default: "black-forest-labs/FLUX.1-schnell-Free"
  width?: number;          // Default: 1024 (min: 128, max: 2048)
  height?: number;         // Default: 768 (min: 128, max: 2048)
  steps?: number;          // Default: 1 (min: 1, max: 100)
  n?: number;             // Default: 1 (max: 4)
  // response_format is always "url"
  // image_path is removed
}
```

#### Minimal Request Example

Only the prompt is required:

```json
{
  "name": "generate_image",
  "arguments": {
    "prompt": "A serene mountain landscape at sunset"
  }
}
```

#### Full Request Example

Override defaults:

```json
{
  "name": "generate_image",
  "arguments": {
    "prompt": "A futuristic cityscape at night",
    "model": "dall-e-3", // Example model
    "width": 1024,
    "height": 1024,
    "steps": 50,
    "n": 1
  }
}
```

#### Response Format

The response will be a simple text string containing the direct URL to the generated image.

Example Response:
```text
https://image-provider.com/path/to/generated/image.png
```
It is recommended that clients display this URL as a clickable link or directly render the image using Markdown, e.g., `![Generated Image](URL)`.

(Response format details updated above)

### Default Values

If not specified in the request, these defaults are used:

- model: "black-forest-labs/FLUX.1-schnell-Free"
- width: 1024
- height: 768
- steps: 1
- n: 1
- response_format: "url" (This is now fixed and cannot be changed)

### Important Notes

1. Only the `prompt` parameter is required
2. All optional parameters use defaults if not provided
3. When provided, parameters must meet their constraints (e.g., width/height ranges)
4. The server now always returns a direct URL to the image.
5. Image saving to disk is no longer supported by this server.

## Prerequisites

- Node.js >= 16
- OpenAI compatible API key (`OPENAI_API_KEY`)
- Optional: OpenAI API URL (`OPENAI_API_URL`) if using a non-standard endpoint (e.g., self-hosted or alternative provider). If not provided, defaults to the standard OpenAI API endpoint.
- Optional: Default Model Name (`DEFAULT_MODEL`) to override the built-in default (`black-forest-labs/FLUX.1-schnell-Free`).

## Dependencies

```json
{
  "@modelcontextprotocol/sdk": "0.6.0",
  "axios": "^1.6.7"
}
```

## Development

Clone and build the project:

```bash
git clone https://github.com/your-username/openai-image-mcp
cd openai-image-mcp
npm install
npm run build
```

### Available Scripts

- `npm run build` - Build the TypeScript project
- `npm run watch` - Watch for changes and rebuild
- `npm run inspector` - Run MCP inspector

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a new branch (`feature/my-new-feature`)
3. Commit your changes
4. Push the branch to your fork
5. Open a Pull Request

Feature requests and bug reports can be submitted via GitHub Issues. Please check existing issues before creating a new one.

For significant changes, please open an issue first to discuss your proposed changes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.