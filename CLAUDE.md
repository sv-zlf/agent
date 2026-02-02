# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **GG CODE** - a TypeScript CLI application that implements an AI-powered code editing assistant inspired by Claude Code and OpenCode. It connects to an internal network chat API and provides interactive chat with autonomous code editing capabilities.

**Key Technologies:**

- TypeScript (Node.js >= 16.0.0)
- Commander.js for CLI interface
- Custom internal network API with double JSON serialization
- Session-based conversation management with isolated histories
- Interactive TUI with keyboard shortcuts and P-key interrupt

## Common Commands

```bash
# Development and Building
npm run build               # Compile TypeScript to dist/ (includes prompt packing)
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

**Single test execution:** Run specific test file with `npm test -- path/to/test.test.ts`

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
    ├── SemanticCompactor   - Semantic-aware compression
    ├── SessionManager      - Multi-session isolation
    ├── AgentOrchestrator   - AI agent orchestration
    └── InterruptManager    - P-key interrupt handling
    ↓
API Layer (ChatAPIAdapter)
    ↓
Internal Network API (double JSON serialization)
```

### Tool System (`src/tools/`)

**Available Tools:**
- **File Operations**: `read`, `write`, `edit`, `multiedit`
- **Search**: `glob`, `grep`
- **Execution**: `bash`
- **Advanced**: `task`, `batch`, `question`, `todowrite/todoread/tododelete/todoclear`

**Tool Definition Pattern:**
```typescript
export const MyTool = defineTool('toolname', {
  description: 'Tool description',
  parameters: z.object({
    param: z.string().describe('Parameter description')
  }),
  async execute(args, ctx) {
    // Tool implementation
    return {
      title: 'Operation title',
      output: 'Result output',
      metadata: {}
    };
  }
});
```

**Tool Prompts:** Individual tool descriptions are in `src/tools/prompts/*.txt` and are packed into `src/utils/packed-prompts.ts` at build time by `scripts/pack-prompts.js`.

**Permission System:**
- `safe` - Auto-approved (Read, Glob, Grep, TodoRead, Batch)
- `local-modify` - Requires confirmation (Write, Edit, MultiEdit)
- `network` - Requires confirmation (Task)
- `dangerous` - Requires confirmation (Bash)

### Context Management

**Message Formats:**
- **Legacy** (`Message`): Simple role/content format for backward compatibility
- **Enhanced** (`EnhancedMessage`): Multi-part messages with parts (text, file, tool_call, tool_result, reasoning, system)

**Context Compression:** Two strategies:
1. **ContextCompactor**: Rule-based pruning, protects recent 4000 tokens of tool calls
2. **SemanticCompactor**: Semantic-aware compression with importance evaluation

Both preserve:
- System prompts
- Last 2 conversation rounds
- Recent tool call metadata

### Session Management (`src/core/session-manager.ts`)

- Multi-session support with isolated history files
- Session types: `default`, `explore`, `build`, `plan`
- Automatic title generation after first user message
- Session summary with code change statistics
- Inactive session cleanup (configurable age threshold)
- Auto-switch to another session when deleting current

**Session Storage:** `.agent-sessions/{sessionId}.json`

### API Layer (`src/api/`)

**Double JSON Serialization** (Internal API - A4011LM01):
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

**API Modes:**
- `A4011LM01` - Internal network API with double JSON
- `OpenApi` - Standard OpenAI-compatible API
- `MockApi` - Testing with predefined responses
- `RecordingApi` - Record/playback sessions

### Interactive System

**Slash Commands** (`src/commands/slash-commands.ts`):
- `/init` - Create/update project documentation (AGENTS.md)
- `/models [model]` - List or switch AI models
- `/session new/list/switch/delete/[id]` - Session management
- `/compress on/off/manual/status` - Context compression control
- `/tokens` - Display token usage statistics
- `/setting` - Interactive parameter configuration

**Keyboard Shortcuts** (`src/utils/prompt.ts`):
- **P key** - Interrupt AI thinking or tool execution
- **Ctrl+C** - Exit program
- **↑/↓** - Navigate interactive menus
- **1-9** - Quick select menu items
- **Space** - Toggle multi-select items
- **Enter** - Confirm selection
- **ESC** - Cancel/exit

**Interactive Prompts:**
- `select()` - Single-choice menu
- `multiSelect()` - Multi-choice with space toggle
- `input()` - Simple text input
- `textInput()` - Advanced text input with validation
- `confirm()` - Yes/no confirmation

### Configuration

**Config Files:** `~/.ggcode/config.json` or `.ggrc.json`

**Key Sections:**
```json
{
  "api": {
    "mode": "A4011LM01",
    "base_url": "http://...",
    "model": "model-name"
  },
  "agent": {
    "max_context_tokens": 8000,
    "max_history": 20,
    "max_iterations": 20,
    "auto_approve": false
  },
  "prompts": {
    "system": "path/to/system.txt",
    "agents": {
      "default": "path/to/default.txt",
      "explore": "path/to/explore.txt"
    }
  }
}
```

### Important Implementation Details

**Prompt Packing:**
- Tool prompts in `src/tools/prompts/*.txt`
- Project prompts in `src/prompts/*.txt` (deleted, now packed)
- Both packed into `src/utils/packed-prompts.ts` by `scripts/pack-prompts.js`
- Build process: `npm run build` runs `pack-prompts.js && tsc`

**Session Isolation:**
- Each conversation gets unique session ID
- History file: `.agent-history-{sessionId}.json`
- Sessions stored in `~/.ggcode/sessions/` directory

**Token Estimation:**
- Chinese: 2 characters/token
- English: 4 characters/token

**Interrupt Handling:**
- Global singleton `InterruptManager`
- P-key during AI thinking or tool execution
- Graceful cleanup with readline recreation

### Code Patterns

**Factory Pattern:** Core components use `create*()` functions:
- `createToolEngine()`
- `createContextManager()`
- `createSessionManager()`

**Singleton Pattern:**
- `ConfigManager`
- `InterruptManager`
- `AgentManager`

**Event-Driven:** Bus-based event system for cross-component communication

### Agent Types

**Available Agents:**
- `default` - General-purpose coding assistant
- `explore` - Read-only codebase exploration
- `build` - Build specialist
- `plan` - Planning mode (experimental)

### Tool Registration

Tools are defined in `src/tools/*.ts` and registered in `src/tools/index.ts`. The `ToolEngine` handles:
- Permission checking
- Auto-approval caching
- Timeout management (default 30s, max 120s)
- Output truncation for large results

### File Structure

```
src/
├── api/                    # API adapters (ChatAPIAdapter, etc.)
├── commands/               # CLI commands
│   ├── agent.ts           # Main agent command
│   └── slash-commands.ts  # Slash command handlers
├── config/                 # Configuration management
├── core/                   # Core business logic
│   ├── agent.ts           # Agent orchestration
│   ├── context-manager.ts
│   ├── context-compactor.ts
│   ├── semantic-compactor.ts
│   ├── session-manager.ts
│   ├── tool-engine.ts
│   └── interrupt.ts
├── prompts/                # Project-level prompt templates
│   └── init.txt           # Initialization template
├── tools/                  # Tool definitions
│   ├── *.ts               # Tool implementations
│   └── prompts/           # Tool description files
├── types/                  # Type definitions
│   └── message.ts         # Message formats
└── utils/                  # Utility functions
    ├── prompt.ts          # Interactive prompts
    ├── packed-prompts.ts # Auto-generated prompt pack
    └── tool-prompt-loader.ts
```

### Recent Changes

**Question Tool (`src/tools/question.ts`):**
- New tool for AI to ask users questions during execution
- Supports single-choice, multi-choice, and text input
- Marked as `safe` permission (auto-executes without pre-approval)

**Prompt System Refactor:**
- `question()` → `input()` for simple text input
- `input()` → `textInput()` for advanced input with validation
- Clearer naming: `input` for simple cases, `textInput` for complex ones

**System Prompt Updates:**
- Added `question` tool to available tools list
- Updated tool permission classifications
- Enhanced user confirmation rules

### Testing

**Test Files:**
- `tests/tools.test.ts` - Tool system tests
- `tests/tools-validation.test.ts` - Tool validation tests
- `tests/tools/prompt-loader.test.ts` - Prompt loading tests

**Run single test:** `npm test -- tools.test.ts`
**Watch mode:** `npm run test:watch`

### Development Workflow

1. Make changes to source files
2. Run `npm run typecheck` to verify types
3. Run `npm run build` to compile (includes prompt packing)
4. Run `npm test` to verify tests
5. Test manually with `npm run agent`

**Important:** Always run `npm run build` after modifying `.txt` prompt files to regenerate `packed-prompts.ts`.
