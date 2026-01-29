# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **TypeScript CLI application** called "internal-code-agent" (内网代码编辑助手) - an AI-powered code editing assistant that connects to an internal network chat API. It provides interactive chat capabilities with context-aware code editing features.

**Key Technologies:**
- TypeScript (Node.js >= 16.0.0)
- Commander.js for CLI interface
- Axios for API communication
- Custom internal network API with double JSON serialization

## Common Commands

```bash
# Development
npm run dev -- [command]    # Run with ts-node (e.g., npm run dev -- chat)
npm run build               # Compile TypeScript to dist/
npm run start               # Run compiled JavaScript

# Testing
npm test                    # Run Jest tests
npm run test:watch          # Run tests in watch mode

# Code Quality
npm run lint                # ESLint for TypeScript files
npm run format              # Prettier formatting

# CLI Commands (after npm link or npm run dev --)
agent config init           # Initialize configuration file
agent config validate       # Validate current configuration
agent config get <path>     # Get configuration value
agent config set <path>     # Set configuration value
agent chat                  # Start interactive chat mode
agent chat --context <file> # Chat with file context
agent chat --no-history     # Chat without saving history
```

## Architecture

### Layered Architecture

```
CLI Layer (Commander.js)
    ↓
Commands Layer (chat, config)
    ↓
Core Layer (ContextManager, CodeOperator)
    ↓
API Layer (ChatAPIAdapter)
    ↓
Utils Layer (Logger, Backup)
```

### Key Components

**API Layer** (`src/api/adapter.ts`)
- `ChatAPIAdapter` - Handles communication with internal network API
- Custom authentication headers: `Access_Key_Id`, `Tx_Code`, `Sec_Node_No`
- Double JSON serialization pattern: request body has `Data_cntnt` as JSON string
- Factory function: `createAPIAdapter(config)`

**Core Layer** (`src/core/`)
- `ContextManager` - Manages conversation history and context with token limits
- `CodeOperator` - Performs code operations with automatic backup
- Factory functions: `createContextManager()`, `createCodeOperator()`

**Config Layer** (`src/config/schema.ts`)
- Singleton `ConfigManager` instance
- Configuration priority: Environment variables > YAML config > defaults
- Validates and loads configuration from `./config/config.yaml`
- Exports `getConfig()` and `resetConfig()` functions

**Commands Layer** (`src/commands/`)
- `chat.ts` - Interactive chat with readline interface
- `config.ts` - Configuration management commands

### Configuration System

Configuration file location: `./config/config.yaml`

Key sections:
- `api` - API endpoint, authentication, model settings
- `agent` - Context limits, backup settings, file size limits
- `prompts` - Path to system prompt templates

Important: The API uses a custom request format with nested JSON structure:
```typescript
{
  Data_cntnt: JSON.stringify({
    user_id: string,
    messages: Message[],
    model_config: { model, temperature, top_p, top_k, repetition_penalty }
  }),
  Fst_Attr_Rmrk: access_key_id
}
```

### Code Patterns

**Factory Pattern**: Core components use factory functions (`create*()`) for instantiation rather than direct constructors.

**Singleton Pattern**: `ConfigManager` uses singleton with global `getConfig()` accessor.

**Context Management**: `ContextManager` maintains message history with:
- Message count limits (`maxHistory`)
- Token estimation for context window limits
- Automatic pruning of oldest messages
- History persistence to `.agent-history.json`

**Error Handling**: Custom `APIError` class with error codes and HTTP status codes.

**Backup System**: Automatic file backups before edits via `CodeOperator` with configurable backup directory.

### File Context Loading

When loading files as context:
- Files larger than `max_file_size` (default 1MB) are rejected
- Long files are truncated with middle section omitted
- Context includes file path and line number information
- Token estimation prevents exceeding context limits

## API Integration Details

The internal network API requires:
- Base URL configuration
- Authentication via custom headers
- Specific model identifier
- Double-serialized JSON requests
- Timeout configuration (default 30000ms)

Endpoint: `POST /ai-service/ainlpllm/chat`

## Chat Mode Flow

1. Load and validate configuration
2. Create API adapter and context manager
3. Load history from `.agent-history.json` (if enabled)
4. Load system prompt from `./prompts/system.txt` or use `--system` flag
5. Add file context if `--context` flag provided
6. Start interactive readline loop
7. Handle special commands: `exit`, `quit`, `clear`
8. Process user input through API adapter
9. Update context and save history

## TypeScript Configuration

- Strict mode enabled
- CommonJS module output
- Target: ES2018
- Source files: `src/`
- Output directory: `dist/`
