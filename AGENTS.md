# AGENTS.md

> Auto-generated documentation for AI coding assistants
> Generated: 2024-05-21

## 1. Project Overview

**GG CODE** - AI-Powered Code Editor CLI Tool

An AI-driven command-line interface tool based on an internal network chat API. It supports autonomous programming (similar to Claude Code), interactive dialogue, file context analysis, intelligent code editing, and code search capabilities.

**Tech Stack:**
- **Runtime:** Node.js >= 16.0.0
- **Language:** TypeScript (Target: ES2020, Module: CommonJS)
- **Testing:** Jest
- **Linting/Formatting:** ESLint, Prettier
- **Build Tool:** TypeScript Compiler (tsc)

## 2. Build and Test Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` and pack prompts |
| `npm run typecheck` | Type check without emitting files |
| `npm run dev` | Run directly with ts-node (Development mode) |
| `npm test` | Run all Jest tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Generate test coverage report |
| `npm run test:tools` | Quick tool system test |
| `npm run test:validation` | Run specific validation tests |
| `npm run lint` | Check code style with ESLint |
| `npm run lint:fix` | Auto-fix ESLint errors |
| `npm run format` | Format code with Prettier |
| `npm run clean` | Clean all temporary files and dist/ |
| `npm run link` | Build and link command globally (`ggcode`) |

## 3. Code Style Guide

### Import Order
1. Node.js built-in modules (e.g., `fs`, `path`)
2. Third-party libraries (e.g., `commander`, `chalk`)
3. Project internal modules (e.g., `./core`, `./utils`)

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `user-service.ts` |
| Classes | PascalCase | `AgentManager` |
| Interfaces/Types | PascalCase | `ConfigOptions` |
| Functions/Variables | camelCase | `executeCommand` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| Private Members | camelCase with `_` prefix | `_internalState` |

### TypeScript Standards
- **Strict Mode:** Enabled
- **Module System:** CommonJS
- **Imports:** Prefer named imports (`import { func } from 'module'`) over default imports where possible.
- **Types:** Explicitly define return types for public functions. Avoid `any`.

### Error Handling
- Use custom error classes located in the `src/errors/` directory.
- Always wrap async operations in try-catch blocks.
- Propagate errors with meaningful context messages.

## 4. Project Structure

```
src/
├── api/           # API client implementations (A4011LM01, OpenApi)
├── commands/      # CLI command definitions and handlers
├── config/        # Configuration loading and validation logic
├── core/          # Core business logic (Agent orchestration, loops)
├── errors/        # Custom error classes
├── index.ts       # Main application entry point
├── prompts/       # System prompts and prompt templates
├── tools/         # Tool implementations (file ops, search, edit)
├── types/         # Shared TypeScript type definitions
└── utils/         # Utility functions and helpers
```

## 5. Development Workflow

1. **Setup:** Run `npm install` to install dependencies.
2. **Development:**
   - Use `npm run dev` to run the CLI directly without building.
   - Make changes to source files in `src/`.
3. **Code Quality:**
   - Run `npm run lint:fix` and `npm run format` before committing.
   - Ensure `npm run typecheck` passes.
4. **Building:**
   - Run `npm run build`. This triggers `scripts/pack-prompts.js` then compiles TypeScript.
   - Verify output in the `dist/` directory.
5. **Local Testing:**
   - Run `npm run link` to test the `ggcode` command globally.
   - Execute `ggcode` in a separate terminal to verify functionality.
6. **Testing:**
   - Run `npm test` to ensure unit tests pass.
   - Use `npm run test:tools` for quick tool validation.
