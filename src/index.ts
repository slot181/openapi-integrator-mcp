#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  // CallToolArgumentsSchema, // Removed unused import
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';

// Import refactored modules
import config from './config/index.js';
import toolDefinitions from './tools/definitions.js';
import { handleToolCall } from './tools/handlers.js';
import { ensureDirectoryExists } from './utils/index.js';
import { AppConfig } from './types/index.js'; // Import AppConfig if needed for type hints

class OpenAIIntegrationServer {
  public readonly server: Server;
  private readonly config: AppConfig; // Store the config object
  private axiosInstance: AxiosInstance;

  constructor(appConfig: AppConfig) {
    this.config = appConfig; // Use the passed config

    if (!this.config.apiKey) {
      // This check is technically redundant due to config loading logic, but good practice
      throw new Error('API_KEY is required');
    }

    // Create Axios instance using config
    this.axiosInstance = axios.create({
      baseURL: this.config.apiUrl,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      timeout: this.config.requestTimeout,
    });

    // Create MCP Server instance
    this.server = new Server(
      {
        name: 'openapi-integrator-mcp',
        version: '2.1.3', // Consider making version dynamic or part of config
      },
      {
        capabilities: {
          tools: {}, // Capabilities might be dynamically determined or empty initially
        },
      }
    );

    // Set up handlers
    this.setupToolHandlers();
    this.server.onerror = (error) => console.error('[MCP Error]', error);
  }

  // Simplified handler setup
  private setupToolHandlers() {
    // List Tools Handler - directly returns the imported definitions
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: toolDefinitions,
    }));

    // Call Tool Handler - delegates to the imported handler function
    // Add explicit return type Promise<{ content: { type: string; text: string }[] }>
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<{ content: { type: string; text: string }[] }> => {
        const toolName = request.params.name;
        const args = request.params.arguments;

        // Call the refactored handler function
        const result = await handleToolCall({
            toolName,
            args,
            axiosInstance: this.axiosInstance,
            config: this.config,
        });

        // Return the result from the handler
        return result;
    });
  }

  // Optional: Method to start the server connection
  async start() {
    // Ensure directories exist before starting
    try {
        await ensureDirectoryExists(this.config.audioOutputDir);
        await ensureDirectoryExists(this.config.tempDir);
    } catch (dirError) {
        console.error(`Failed to ensure directories exist: ${dirError}`);
        process.exit(1); // Exit if directories can't be created/accessed
    }


    const transport = new StdioServerTransport();
    try {
        await this.server.connect(transport);
        console.error('OpenAI Integration MCP server running on stdio');
        console.error(`Using API URL: ${this.config.apiUrl}`);
        console.error(`Default Image Model: ${this.config.defaultImageConfig.model}`);
        console.error(`Default Speech Model: ${this.config.defaultSpeechModel}`);
        console.error(`Default Speech Voice: ${this.config.defaultSpeechVoice}`);
        console.error(`Default Transcription Model: ${this.config.defaultTranscriptionModel}`);
        console.error(`Audio Output Directory: ${this.config.audioOutputDir}`); // Already resolved in config
        console.error(`Temporary Directory: ${this.config.tempDir}`); // Already resolved in config
        console.error(`Request Timeout: ${this.config.requestTimeout}ms`);
        // Log WebDAV status
        if (this.config.webdavUrl && this.config.webdavUsername && this.config.webdavPassword) {
            console.error(`WebDAV Upload: Enabled (URL: ${this.config.webdavUrl}, User: ${this.config.webdavUsername})`);
        } else {
            console.error('WebDAV Upload: Disabled (Configuration missing)');
        }
    } catch (err) {
        console.error('Failed to connect server transport:', err);
        process.exit(1);
    }
  }
}


// --- Main Execution ---
try {
  // config is loaded automatically when imported
  const serverInstance = new OpenAIIntegrationServer(config);
  serverInstance.start(); // Start the server
} catch (error) {
  console.error('Failed to initialize server:', error);
  process.exit(1);
}
