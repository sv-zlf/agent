/**
 * GG CODE - 工具系统
 * 所有工具的统一导出和注册
 */

import * as z from 'zod';
import { ReadTool } from './read';
import { WriteTool } from './write';
import { EditTool } from './edit';
import { GlobTool } from './glob';
import { GrepTool } from './grep';
import { BashTool } from './bash';
import { TaskTool } from './task';
import { TodoWriteTool, TodoReadTool, TodoDeleteTool, TodoClearTool } from './todo';
import { BatchTool } from './batch';
import { MultiEditTool } from './multiedit';
import type { ToolDefinition } from '../types';

/**
 * 所有工具定义
 */
export const tools = {
  read: ReadTool,
  write: WriteTool,
  edit: EditTool,
  glob: GlobTool,
  grep: GrepTool,
  bash: BashTool,
  task: TaskTool,
  todowrite: TodoWriteTool,
  todoread: TodoReadTool,
  tododelete: TodoDeleteTool,
  todoclear: TodoClearTool,
  batch: BatchTool,
  multiedit: MultiEditTool,
};

/**
 * 获取参数的别名（snake_case → camelCase）
 */
function getParameterAliases(paramName: string): string[] {
  const aliases: Record<string, string[]> = {
    filePath: ['file_path'],
    oldString: ['old_string'],
    newString: ['new_string'],
    replaceAll: ['replace_all'],
  };
  return aliases[paramName] || [];
}

/**
 * 转换工具为 ToolDefinition 格式（兼容性）
 */
async function toolToDefinition(tool: any): Promise<ToolDefinition> {
  const info = await tool.init();

  // 解析 Zod schema 获取参数信息
  const parameters: Record<string, any> = {};
  const schema = info.parameters as any;

  if (schema && schema.shape) {
    for (const [key, value] of Object.entries(schema.shape)) {
      const unwrapped = value instanceof z.ZodOptional ? value._def : value;
      const typeName = getZodTypeName(unwrapped);
      const description = (unwrapped as any).description || '';

      // 添加别名到描述中，让 AI 知道可以使用 snake_case
      let finalDescription = description;
      const aliases = getParameterAliases(key);
      if (aliases.length > 0) {
        finalDescription = `${description} (also accepts: ${aliases.join(', ')})`;
      }

      parameters[key] = {
        type: typeName,
        description: finalDescription,
        required: !(value instanceof z.ZodOptional),
      };
    }
  }

  // 创建 ToolDefinition 兼容格式
  return {
    name: formatToolName(tool.id),
    description: info.description,
    category: getCategory(tool.id),
    permission: getPermission(tool.id),
    parameters,
    handler: async (args: Record<string, unknown>) => {
      try {
        const adaptedArgs = adaptParameters(args);
        const ctx: any = {
          sessionID: 'default',
          messageID: 'msg',
          agent: 'default',
          metadata: () => {},
        };
        const result = await info.execute(adaptedArgs, ctx);
        return {
          success: true,
          output: result.output,
          metadata: result.metadata,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    },
  };
}

/**
 * 导出所有工具（V2 框架）
 */
export * from './read';
export * from './write';
export * from './edit';
export * from './glob';
export * from './grep';
export * from './bash';
export * from './tool';
export * from './todo';
export * from './batch';
export * from './multiedit';

/**
 * 获取所有工具信息
 */
export async function getAllToolInfos() {
  const infos = [];

  for (const tool of Object.values(tools)) {
    const info = await tool.init();
    infos.push({
      id: tool.id,
      description: info.description,
      parameters: info.parameters,
      execute: info.execute,
    });
  }

  return infos;
}

/**
 * 生成工具描述（用于系统提示词）
 * 从外部文件加载的工具描述已经是完整的使用说明
 */
export async function generateToolsDescription(): Promise<string> {
  const infos = await getAllToolInfos();
  const lines: string[] = [];

  for (const info of infos) {
    // 工具描述已经从 prompts/tools/*.txt 加载
    // 如果描述较短，补充参数信息
    const hasExternalPrompt = info.description.includes('\n');

    if (hasExternalPrompt) {
      // 外部文件已经包含完整说明
      lines.push(`## ${formatToolName(info.id)}\n`);
      lines.push(info.description);
      lines.push('');
    } else {
      // 回退到简短描述 + 参数列表
      lines.push(`## ${formatToolName(info.id)}`);
      lines.push(`${info.description}\n`);
      lines.push('**Parameters**:');

      const schema = info.parameters as any;
      const keys = schema ? Object.keys(schema.shape || {}) : [];

      if (keys.length === 0) {
        lines.push('  (None)');
      } else {
        keys.forEach((key: string) => {
          const fieldSchema = schema.shape[key];
          const isOptional = fieldSchema?.isOptional?.();
          const description = (fieldSchema as any).description || '';

          let typeName = 'unknown';
          if (fieldSchema instanceof z.ZodString) typeName = 'string';
          else if (fieldSchema instanceof z.ZodNumber) typeName = 'number';
          else if (fieldSchema instanceof z.ZodBoolean) typeName = 'boolean';
          else if (fieldSchema instanceof z.ZodOptional) typeName = 'any';

          const optional = isOptional ? ' [optional]' : ' [required]';
          lines.push(`  - \`${key}\` (${typeName})${optional}: ${description}`);
        });
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 默认导出所有工具
 */
export default tools;

/**
 * 获取工具的兼容格式定义
 */
export async function getBuiltinTools(): Promise<ToolDefinition[]> {
  const definitions: ToolDefinition[] = [];

  for (const tool of Object.values(tools)) {
    const def = await toolToDefinition(tool);
    definitions.push(def);
  }

  return definitions;
}

function formatToolName(toolId: string): string {
  return toolId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function adaptParameters(args: Record<string, unknown>): Record<string, unknown> {
  const adapted = { ...args };
  if ('file_path' in adapted) {
    (adapted as any).filePath = adapted['file_path'];
    delete adapted['file_path'];
  }
  if ('old_string' in adapted) {
    (adapted as any).oldString = adapted['old_string'];
    delete adapted['old_string'];
  }
  if ('new_string' in adapted) {
    (adapted as any).newString = adapted['new_string'];
    delete adapted['new_string'];
  }
  if ('replace_all' in adapted) {
    (adapted as any).replaceAll = adapted['replace_all'];
    delete adapted['replace_all'];
  }
  return adapted;
}

function getZodTypeName(schema: any): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodOptional) return getZodTypeName(schema.unwrap());
  return 'string';
}

function getCategory(toolId: string): ToolDefinition['category'] {
  const categories: Record<string, ToolDefinition['category']> = {
    read: 'file',
    write: 'file',
    edit: 'file',
    multiedit: 'file',
    glob: 'search',
    grep: 'search',
    bash: 'command',
    task: 'system',
    todowrite: 'system',
    todoread: 'system',
    tododelete: 'system',
    todoclear: 'system',
    batch: 'system',
  };
  return categories[toolId] || 'system';
}

function getPermission(toolId: string): ToolDefinition['permission'] {
  const permissions: Record<string, ToolDefinition['permission']> = {
    read: 'safe',
    glob: 'safe',
    grep: 'safe',
    write: 'local-modify',
    edit: 'local-modify',
    multiedit: 'local-modify',
    bash: 'dangerous',
    task: 'network',
    todowrite: 'safe',
    todoread: 'safe',
    tododelete: 'local-modify',
    todoclear: 'local-modify',
    batch: 'safe',
  };
  return permissions[toolId] || 'safe';
}

/**
 * 允许外部覆盖工具权限配置
 * 用于从配置文件或 PermissionManager 动态设置权限
 */
export function overrideToolPermission(
  toolId: string,
  permission: ToolDefinition['permission']
): void {
  const permissions: Record<string, ToolDefinition['permission']> = {
    read: 'safe',
    glob: 'safe',
    grep: 'safe',
    write: 'local-modify',
    edit: 'local-modify',
    multiedit: 'local-modify',
    bash: 'dangerous',
    task: 'network',
    todowrite: 'safe',
    todoread: 'safe',
    tododelete: 'local-modify',
    todoclear: 'local-modify',
    batch: 'safe',
  };
  permissions[toolId] = permission;
}

/**
 * 批量覆盖工具权限
 */
export function overrideToolPermissions(
  permissions: Record<string, ToolDefinition['permission']>
): void {
  Object.entries(permissions).forEach(([toolId, permission]) => {
    overrideToolPermission(toolId, permission);
  });
}
