# AGENTS.md - Guidelines for AI Coding Agents

This file provides guidance for AI coding agents operating in this repository.

## Project Overview

**GG CODE** - A TypeScript CLI AI-powered code editing assistant. Connects to internal network chat API with autonomous code editing capabilities.

## Build/Lint/Test Commands

```bash
# Build and Compile
npm run build              # Compile TypeScript to dist/ (includes prompt packing)
npm run typecheck          # Type check without emitting files
npm run dev                # Run with ts-node

# Testing
npm test                   # Run all Jest tests
npm run test:watch         # Watch mode for development
npm run test:coverage      # Coverage report
npm run test:tools         # Quick tool system test
npm run test:validation    # Run specific validation tests: jest tests/tools-validation.test.ts

# Code Quality
npm run lint               # ESLint check
npm run lint:fix           # ESLint auto-fix
npm run format             # Prettier format all files
npm run format:check       # Check format without modifying

# Cleanup
npm run clean              # Clean all temp files
npm run clean:dist         # Clean only dist/ folder
```

## Code Style Guidelines

### TypeScript Configuration

- Target: ES2020
- Module: CommonJS
- Strict mode enabled
- Node.js >= 16.0.0

### Imports

- Use named imports: `import { func } from './utils'`
- Group imports: external → internal → relative
- No barrel exports from index files unless necessary

### Naming Conventions

- **Files**: camelCase for source files (e.g., `context-manager.ts`)
- **Classes/Interfaces**: PascalCase (e.g., `ContextManager`)
- **Functions/Variables**: camelCase (e.g., `getContext()`, `maxTokens`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `DEFAULT_TIMEOUT`)
- **Types/Enums**: PascalCase

### Types

- Use interfaces for object shapes, types for unions/primitives
- Avoid `any`; use `unknown` for truly unknown types
- Use Zod for runtime validation in tools
- Export types from `src/types/index.ts`

### Error Handling

- Use custom error classes extending `GGCodeError` from `src/errors/`
- Include error codes from `ErrorCode` enum
- API errors: `APIError` with status codes and response data
- Propagate errors to caller, don't silently catch

### Async/Await

- All I/O operations must be async
- Handle promise rejections with try/catch
- Use `AbortSignal` for cancellable operations

### File Organization

```
src/
├── core/         # Core business logic
├── commands commands
├── tools//     # CLI        # Tool definitions
├── types/        # TypeScript types
├── utils/        # Utilities
└── api/          # API adapters
```

### Tool System

- Tools defined using `defineTool()` with Zod schemas
- Parameter names: snake_case in API, converted to camelCase internally
- Support both `file_path` and `filePath` formats
- Tools must return `{ success, output, metadata? }`

### Context Management

- Support both `Message` and `EnhancedMessage` formats
- Use `ContextManager` for conversation history
- Token estimation: Chinese (2 chars/token), English (4 chars/token)

### API Patterns

- Internal API uses double JSON serialization
- Request format:

```typescript
{
  Data_cntnt: JSON.stringify({ user_id, messages, model_config }),
  Fst_Attr_Rmrk: access_key_id
}
```

### Security

- Tools classified by permission: `safe`, `local-modify`, `network`, `dangerous`
- Dangerous operations require user confirmation
- Never log secrets or API keys

### Testing

- Place tests in `tests/` directory
- Use Jest with ts-jest preset
- Match pattern: `**/?(*.)+(spec|test).ts`
