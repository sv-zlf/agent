import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectPrompt, hasPackedPrompts, getToolPrompt } from '../utils/packed-prompts';

export interface PromptConfig {
  agentType: 'build' | 'explore' | 'plan';
  workingDirectory: string;
  allowedTools?: string[];
}

export interface PromptLoadOptions {
  includeTools?: boolean;
  includeEnvironment?: boolean;
  includeWorkflow?: boolean;
  includeSecurity?: boolean;
}

export class PromptBuilder {
  private promptsDir: string;
  private toolCache: Map<string, string> = new Map();
  private usePackedPrompts: boolean = false;

  constructor(promptsDir?: string) {
    this.promptsDir = promptsDir || path.join(process.cwd(), 'src/prompts');
    this.usePackedPrompts = hasPackedPrompts();
  }

  private async loadFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async loadBaseComponent(name: string): Promise<string> {
    if (this.usePackedPrompts) {
      const packed = getProjectPrompt(`_base/${name}`);
      if (packed) return packed;
    }
    const filePath = path.join(this.promptsDir, '_base', `${name}.txt`);
    return (await this.loadFile(filePath)) || '';
  }

  async loadAgentPrompt(agentType: string): Promise<string> {
    if (this.usePackedPrompts) {
      const packed = getProjectPrompt(`agents/${agentType}`);
      if (packed) return packed;
    }
    const filePath = path.join(this.promptsDir, 'agents', `${agentType}.txt`);
    const content = await this.loadFile(filePath);
    return content || `# ${agentType} Agent\n\nSpecialized agent for ${agentType} tasks.`;
  }

  async loadSystemPrompt(systemType: string): Promise<string> {
    if (this.usePackedPrompts) {
      const packed = getProjectPrompt(`system/${systemType}`);
      if (packed) return packed;
    }
    const filePath = path.join(this.promptsDir, 'system', `${systemType}.txt`);
    const content = await this.loadFile(filePath);
    return content || '';
  }

  async loadToolPrompt(toolName: string): Promise<string> {
    if (this.toolCache.has(toolName)) {
      return this.toolCache.get(toolName)!;
    }

    if (this.usePackedPrompts) {
      const packed = getToolPrompt(toolName);
      if (packed) {
        this.toolCache.set(toolName, packed);
        return packed;
      }
    }

    const filePath = path.join(this.promptsDir, '_tools', `${toolName}.txt`);
    let content = await this.loadFile(filePath);

    if (!content) {
      content = `## ${toolName}\n\nTool for ${toolName} operations.`;
    }

    this.toolCache.set(toolName, content);
    return content;
  }

  async buildToolsDescription(allowedTools?: string[]): Promise<string> {
    if (this.usePackedPrompts) {
      const tools: string[] = [];
      const toolFiles = [
        'read',
        'write',
        'edit',
        'multiedit',
        'glob',
        'grep',
        'bash',
        'batch',
        'task',
        'todo',
        'question',
      ];
      for (const t of toolFiles) {
        if (!allowedTools || allowedTools.includes(t)) {
          const prompt = await this.loadToolPrompt(t);
          tools.push(prompt);
        }
      }
      return `## Available Tools\n\n${tools.join('\n\n')}`;
    }

    const toolsDir = path.join(this.promptsDir, '_tools');
    let tools: string[] = [];

    try {
      const files = await fs.readdir(toolsDir);
      tools = files.filter((f) => f.endsWith('.txt')).map((f) => f.replace('.txt', ''));
    } catch {
      tools = [
        'read',
        'write',
        'edit',
        'multiedit',
        'glob',
        'grep',
        'bash',
        'batch',
        'task',
        'todo',
        'question',
      ];
    }

    const toolPromises = tools
      .filter((t) => !allowedTools || allowedTools.includes(t))
      .map((t) => this.loadToolPrompt(t));

    const loadedTools = await Promise.all(toolPromises);
    return `## Available Tools\n\n${loadedTools.join('\n\n')}`;
  }

  buildEnvironmentContext(workingDirectory: string): string {
    return [
      `Working Directory: ${workingDirectory}`,
      `Platform: ${process.platform}`,
      `Date: ${new Date().toISOString().split('T')[0]}`,
    ].join('\n');
  }

  async buildSystemPrompt(config: PromptConfig, options: PromptLoadOptions = {}): Promise<string> {
    const {
      includeTools = true,
      includeEnvironment = true,
      includeWorkflow = true,
      includeSecurity = true,
    } = options;

    const parts: string[] = [];

    parts.push(await this.loadAgentPrompt(config.agentType));

    if (includeTools) {
      const toolsDescription = await this.buildToolsDescription(config.allowedTools);
      parts.push(toolsDescription);
    }

    if (includeWorkflow) {
      const workflow = await this.loadBaseComponent('workflow');
      if (workflow) parts.push(workflow);
    }

    if (includeEnvironment) {
      parts.push(`## Environment\n\n${this.buildEnvironmentContext(config.workingDirectory)}`);
    }

    if (includeSecurity) {
      const security = await this.loadBaseComponent('security');
      if (security) parts.push(security);
    }

    return parts.filter(Boolean).join('\n\n---\n\n');
  }
}

let promptBuilderInstance: PromptBuilder | null = null;

export function getPromptBuilder(): PromptBuilder {
  if (!promptBuilderInstance) {
    promptBuilderInstance = new PromptBuilder();
  }
  return promptBuilderInstance;
}

export function resetPromptBuilder(): void {
  promptBuilderInstance = null;
}
