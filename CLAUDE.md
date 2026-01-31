# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **GG CODE** - a TypeScript CLI application that implements an AI-powered code editing assistant inspired by Claude Code and OpenCode. It connects to an internal network chat API and provides interactive chat with autonomous code editing capabilities.

**Key Technologies:**
- TypeScript (Node.js >= 16.0.0)
- Commander.js for CLI interface
- Custom internal network API with double JSON serialization
- Session-based conversation management
- Interactive TUI with keyboard shortcuts

## Common Commands

```bash
# Development and Building
npm run build               # Compile TypeScript to dist/
npm run typecheck           # Type check without emitting files
npm run agent               # Run the main agent CLI
npm run agent -- -y         # Auto-approve all tool calls
npm run agent -- -a explore # Use read-only explore agent
npm run agent -- -a build   # Use build agent
npm run agent -- --no-history # Don't save conversation history

# Testing
npm test                     # Run Jest tests
npm run test:watch           # Watch mode
npm run test:coverage        # Coverage report
npm run test:tools           # Quick tool system test

# Code Quality
npm run lint                 # ESLint check
npm run lint:fix             # ESLint auto-fix
npm run format               # Prettier format
npm run format:check         # Check format

# Cleanup
npm run clean                # Clean all temp files
npm run clean:dist            # Clean only dist/
```

## Code Architecture

### Core System Architecture

```
CLI Layer (Commander.js)
    ↓
Agent Command (src/commands/agent.ts)
    ↓
Core Components:
    ├── ToolEngine          - Tool registration and execution
    ├── ContextManager      - Conversation history with token limits
    ├── ContextCompactor    - Smart context compression
    ├── SessionManager      - Multi-session isolation
    ├── AgentOrchestrator   - AI agent orchestration
    └── InterruptManager    - P-key interrupt handling
    ↓
API Layer (ChatAPIAdapter)
    ↓
Internal Network API (double JSON serialization)
```

### Key Components

**Tool Engine** (`src/core/tool-engine.ts`)
- Central registry for all tools (Read, Edit, Write, Glob, Grep, Bash, etc.)
- Tool permission levels: `safe`, `local-modify`, `network`, `dangerous`
- Tools with `safe` permission auto-execute without confirmation
- Default timeout: 30s, max: 120s
- Enhanced tools include smart features (file suggestions, binary detection)

**Context Management** (`src/core/context-manager.ts`)
- Dual message format support: legacy `Message` and enhanced `EnhancedMessage`
- Session-isolated history files (`.agent-history-{sessionId}.json`)
- System prompt tracking with `systemPromptSet` flag
- Token estimation for context management
- Automatic pruning when exceeding limits

**Context Compactor** (`src/core/context-compactor.ts`)
- Intelligent pruning: protects recent 4000 tokens of tool calls
- Two-stage compression: trim tool outputs, then remove old messages
- Preserves last 2 conversation rounds completely
- Protects certain tools from being pruned
- Configurable compression thresholds

**Session Manager** (`src/core/session-manager.ts`)
- Multi-session support with isolated histories
- Session persistence in `.agent-sessions/` directory
- Session types: default, explore, build, plan
- Auto-switch to another session when deleting current
- Inactive session cleanup (configurable age threshold)

**Interrupt Manager** (`src/core/interrupt.ts`)
- P-key interrupt support during AI thinking or tool execution
- Graceful cleanup with readline recreation
- Global singleton pattern

**Agent Orchestrator** (`src/core/agent.ts`)
- Multi-agent coordination (default, explore, build, plan, general)
- Permission-based tool approval workflow
- Session state management
- Iterative tool calling until completion or max iterations

**Slash Commands** (`src/commands/slash-commands.ts`)
- `/init` - Create/update project documentation (AGENTS.md)
- `/models [model]` - List or switch AI models
- `/session new/list/switch/delete` - Session management
- `/compress on/off/manual/status` - Context compression control
- `/tokens` - Display token usage statistics
- `/test` - Test interactive selection features

**Interactive Prompts** (`src/utils/prompt.ts`)
- `select()` - Single-choice menu with arrow key navigation
- `multiSelect()` - Multi-choice with space toggle
- `confirm()` - Yes/no confirmation dialog
- `question()` - Text input with default value
- Raw mode keyboard handling (↑↓, Enter, ESC, 1-9 shortcuts)

### Configuration System

Configuration file: `./config/config.yaml` or `.ggrc.json`

Key sections:
- `api` - API endpoint, auth headers, model settings
- `agent` - Context limits, backup settings, file size limits, max iterations
- `prompts` - System prompt template paths

**Critical: Double JSON Serialization**
The internal API requires nested JSON:
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

### Tool Permission System

Four permission levels determine auto-approval behavior:

1. **`safe`** - Auto-approved (Read, Glob, Grep)
2. **`local-modify`** - Requires confirmation (Write, Edit, MakeDirectory)
3. **`network`** - Requires confirmation (network operations)
4. **`dangerous`** - Requires confirmation (Bash)

User can approve: once, all (for session), or reject.

### Message System

**Legacy Format** (backward compatible):
```typescript
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
```

**Enhanced Format** (new, multi-part messages):
```typescript
interface EnhancedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];  // Multiple parts per message
  timestamp: number;
  agent?: string;
}
```

Message parts can be: text, file, tool_call, tool_result, reasoning, system

### Code Patterns

**Factory Pattern**: Core components use `create*()` factory functions
**Singleton Pattern**: ConfigManager, InterruptManager, AgentManager
**Event-Driven**: Bus-based event system for cross-component communication
**Async/Await**: All I/O operations are async
**Error Handling**: Custom error types with error codes

### Agent Flow

1. Initialize session manager, load or create session
2. Load session-specific history with `contextManager.setSessionId()`
3. Set system prompt from agent template
4. Display interactive banner with available commands
5. Enter readline loop with raw mode for single-key detection
6. On user input:
   - Check for slash commands
   - Check for special commands (exit, clear, tools)
   - Otherwise, treat as user message
7. Multi-round tool execution loop:
   - Call AI API with context
   - Parse tool calls from response
   - For each tool: check permission → ask user if needed → execute
   - Feed results back to AI
   - Repeat until no tool calls or max iterations
8. Save history to session-specific file

### Keyboard Shortcuts

- **P key** - Interrupt AI thinking or tool execution
- **Ctrl+C** - Exit program
- **↑/↓** - Navigate interactive menus
- **1-9** - Quick select menu items
- **Space** - Toggle multi-select items
- **Enter** - Confirm selection
- **ESC** - Cancel/exit

### File Structure Highlights

- `src/core/` - All core business logic components
- `src/commands/` - CLI command implementations (agent.ts is main entry)
- `src/tools/` - Built-in and enhanced tool definitions
- `src/types/message.ts` - Enhanced message system with parts
- `src/utils/prompt.ts` - Interactive TUI prompts
- `prompts/` - Agent system prompt templates
- `.agent-sessions/` - Session data (gitignored)

### Important Implementation Details

1. **Session Isolation**: Each conversation gets unique history file, preventing cross-contamination
2. **Context Compression**: Automatically triggered when approaching token limits, intelligently prunes old tool outputs
3. **Permission Caching**: User's "approve all" choice persists for session duration
4. **Tool Timeout**: Each tool call has configurable timeout with abort signal support
5. **Interrupt Handling**: Cleanly stops mid-operation, recreates readline to clear buffer
6. **Token Estimation**: Separate estimators for Chinese (2 chars/token) vs English (4 chars/token)
