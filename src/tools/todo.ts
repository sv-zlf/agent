/**
 * GG CODE - Todo 工具
 * 任务管理工具 - 跟踪待办事项
 */

import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { defineTool } from './tool';
import { FileOperationError, ErrorCode } from '../errors';

/**
 * Todo 任务项接口
 */
export interface TodoItem {
  id: string;
  content: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 任务存储文件路径
 */
function getTodoFilePath(): string {
  return path.join(os.homedir(), '.ggcode', 'todos.json');
}

/**
 * 加载任务列表
 */
async function loadTodos(): Promise<TodoItem[]> {
  try {
    const filePath = getTodoFilePath();
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data.todos || [];
  } catch (error) {
    // 文件不存在或解析失败，返回空列表
    return [];
  }
}

/**
 * 保存任务列表
 */
async function saveTodos(todos: TodoItem[]): Promise<void> {
  try {
    const filePath = getTodoFilePath();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const data = {
      version: 1,
      todos,
      lastUpdated: Date.now(),
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    throw new FileOperationError(
      `Failed to save todos: ${(error as Error).message}`,
      ErrorCode.FILE_WRITE_ERROR,
      { filePath: getTodoFilePath(), error }
    );
  }
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 格式化任务列表显示
 */
function formatTodoList(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return '当前没有任务';
  }

  const lines = [`任务列表 (${todos.length} 个任务):\n`];
  const completedCount = todos.filter((t) => t.done).length;

  todos.forEach((todo, index) => {
    const status = todo.done ? '✓' : '○';
    const prefix = todo.done ? chalk.gray('~~') : chalk.yellow(`  `);
    const strikethrough = todo.done ? '~~' : '';

    lines.push(
      `${prefix}${index + 1}. [${todo.id.substring(0, 8)}] ${status} ${strikethrough}${todo.content}${strikethrough}~~`
    );
  });

  if (completedCount > 0) {
    lines.push(`\n已完成 ${completedCount}/${todos.length} 个任务`);
  }

  return lines.join('\n');
}

import chalk from 'chalk';

/**
 * TodoWrite 工具 - 创建或更新任务
 */
export const TodoWriteTool = defineTool('todowrite', {
  description: '创建或更新任务列表，帮助追踪待办事项',
  parameters: z.object({
    todos: z
      .array(
        z.object({
          id: z.string().optional().describe('任务 ID（可选，不提供则自动生成）'),
          content: z.string().describe('任务内容'),
          done: z.boolean().optional().describe('是否完成（默认 false）'),
        })
      )
      .min(1)
      .describe('至少需要一个任务'),
  }),
  async execute(args, _ctx) {
    const existingTodos = await loadTodos();

    // 创建或更新任务
    const updatedTodos: TodoItem[] = [...existingTodos];
    const newTodos: TodoItem[] = [];
    const now = Date.now();

    for (const todo of args.todos) {
      if (todo.id) {
        // 更新现有任务
        const index = updatedTodos.findIndex((t) => t.id === todo.id);
        if (index !== -1) {
          updatedTodos[index] = {
            ...updatedTodos[index],
            content: todo.content,
            done: todo.done ?? updatedTodos[index].done,
            updatedAt: now,
          };
        } else {
          // ID 不存在，创建新任务
          newTodos.push({
            id: todo.id,
            content: todo.content,
            done: todo.done ?? false,
            createdAt: now,
            updatedAt: now,
          });
          updatedTodos.push(newTodos[newTodos.length - 1]);
        }
      } else {
        // 没有 ID，创建新任务
        const newTodo: TodoItem = {
          id: generateId(),
          content: todo.content,
          done: todo.done ?? false,
          createdAt: now,
          updatedAt: now,
        };
        newTodos.push(newTodo);
        updatedTodos.push(newTodo);
      }
    }

    await saveTodos(updatedTodos);

    const completedCount = updatedTodos.filter((t) => t.done).length;

    return {
      title: `已更新任务列表`,
      output: formatTodoList(updatedTodos),
      metadata: {
        total: updatedTodos.length,
        completed: completedCount,
        added: newTodos.length,
        updated: newTodos.length,
      },
    };
  },
});

/**
 * TodoRead 工具 - 读取任务列表
 */
export const TodoReadTool = defineTool('todoread', {
  description: '读取当前任务列表，查看所有待办事项',
  parameters: z.object({
    filter: z
      .string()
      .optional()
      .describe('过滤条件：all（全部）/pending（未完成）/completed（已完成）'),
  }),
  async execute(args, _ctx) {
    const todos = await loadTodos();

    let filteredTodos = todos;
    if (args.filter === 'pending') {
      filteredTodos = todos.filter((t) => !t.done);
    } else if (args.filter === 'completed') {
      filteredTodos = todos.filter((t) => t.done);
    }

    return {
      title: `任务列表 (${filteredTodos.length} 个任务)`,
      output: formatTodoList(filteredTodos),
      metadata: {
        total: todos.length,
        pending: todos.filter((t) => !t.done).length,
        completed: todos.filter((t) => t.done).length,
      },
    };
  },
});

/**
 * TodoDelete 工具 - 删除任务
 */
export const TodoDeleteTool = defineTool('tododelete', {
  description: '删除指定的任务',
  parameters: z.object({
    id: z.string().describe('要删除的任务 ID'),
  }),
  async execute(args, _ctx) {
    const todos = await loadTodos();
    const index = todos.findIndex((t) => t.id === args.id);

    if (index === -1) {
      return {
        title: '任务未找到',
        output: `未找到 ID 为 ${args.id} 的任务`,
        metadata: { error: true },
      };
    }

    const deletedTodo = todos[index];
    todos.splice(index, 1);

    await saveTodos(todos);

    return {
      title: '任务已删除',
      output: `已删除任务: "${deletedTodo.content}"`,
      metadata: {
        deletedId: args.id,
        remaining: todos.length,
      },
    };
  },
});

/**
 * TodoClear 工具 - 清空所有任务
 */
export const TodoClearTool = defineTool('todoclear', {
  description: '清空所有任务',
  parameters: z.object({}),
  async execute(_args, _ctx) {
    const todos = await loadTodos();
    const count = todos.length;

    await saveTodos([]);

    return {
      title: '任务列表已清空',
      output: `已删除 ${count} 个任务`,
      metadata: {
        deletedCount: count,
      },
    };
  },
});
