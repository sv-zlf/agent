/**
 * LS Tool - 列出目录内容
 * 列出指定路径的文件和目录，以树形结构展示
 */

import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool } from './tool';

/**
 * 默认忽略的目录和文件模式
 */
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/**',
  '__pycache__/**',
  '.git/**',
  'dist/**',
  'build/**',
  'target/**',
  'vendor/**',
  'bin/**',
  'obj/**',
  '.idea/**',
  '.vscode/**',
  '.zig-cache/**',
  'zig-out/**',
  '.coverage/**',
  'coverage/**',
  'tmp/**',
  'temp/**',
  '.cache/**',
  'cache/**',
  'logs/**',
  '.venv/**',
  'venv/**',
  'env/**',
];

/**
 * 文件或目录信息
 */
interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * LS Tool 定义
 */
export const ListTool = defineTool('ls', {
  description: '列出指定路径的文件和目录，以树形结构展示。支持自定义路径和忽略模式。',

  parameters: z.object({
    path: z.string().describe('要列出的目录路径（绝对路径，默认为当前目录）'),
    ignore: z
      .array(z.string())
      .optional()
      .describe('要忽略的 glob 模式列表（如 ["node_modules/**", ".git/**"]）'),
    maxDepth: z.coerce.number().optional().describe('最大递归深度（默认3，防止无限递归）'),
    limit: z.coerce.number().optional().describe('最大文件数量限制（默认100）'),
  }),

  async execute(params, _ctx) {
    // 解析路径
    const targetPath = path.resolve(params.path || '.');

    // 检查路径是否存在
    try {
      const stat = await fs.stat(targetPath);
      if (!stat.isDirectory()) {
        throw new Error(`路径不是目录: ${targetPath}`);
      }
    } catch (error: any) {
      throw new Error(`无法访问路径: ${targetPath} - ${error.message}`);
    }

    // 收集文件和目录
    const maxFiles = params.limit || 100;
    const maxDepth = params.maxDepth ?? 3;
    const ignorePatterns = params.ignore || DEFAULT_IGNORE_PATTERNS;

    const fileList: FileInfo[] = [];

    // 递归扫描目录
    async function scanDirectory(currentPath: string, depth: number): Promise<void> {
      if (depth > maxDepth) return;
      if (fileList.length >= maxFiles) return;

      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          // 检查是否应该忽略
          if (shouldIgnore(fullPath, ignorePatterns)) {
            continue;
          }

          const fileInfo: FileInfo = {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
          };

          fileList.push(fileInfo);

          // 如果是目录，递归扫描
          if (entry.isDirectory() && depth < maxDepth && fileList.length < maxFiles) {
            await scanDirectory(fullPath, depth + 1);
          }
        }
      } catch (error: any) {
        // 跳过无权限访问的目录
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
          throw error;
        }
      }
    }

    await scanDirectory(targetPath, 0);

    // 构建目录树
    const tree = buildTree(fileList, targetPath);

    // 生成输出
    const output = formatTree(tree, targetPath);

    // 计算统计信息
    const dirCount = fileList.filter((f) => f.isDirectory).length;
    const fileCount = fileList.filter((f) => !f.isDirectory).length;
    const truncated = fileList.length >= maxFiles;

    return {
      title: `列出目录: ${path.basename(targetPath)}`,
      output:
        output + (truncated ? `\n\n（已达到最大文件数量限制 ${maxFiles}，部分内容未显示）` : ''),
      metadata: {
        dirCount,
        fileCount,
        totalCount: fileList.length,
        truncated,
      },
    };
  },
});

/**
 * 检查路径是否应该被忽略
 */
function shouldIgnore(fullPath: string, ignorePatterns: string[]): boolean {
  const relativePath = fullPath.replace(/\\/g, '/');

  for (const pattern of ignorePatterns) {
    // 将 glob 模式转换为正则表达式
    const regexPattern = pattern
      .replace(/\*\*/g, '.*') // ** → .*
      .replace(/\*/g, '[^/]*') // *  → [^/]*
      .replace(/\./g, '\\.'); // . → \.

    const regex = new RegExp(`^${regexPattern}`);
    if (regex.test(relativePath)) {
      return true;
    }
  }

  return false;
}

/**
 * 构建目录树结构
 */
interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
}

function buildTree(files: FileInfo[], rootPath: string): TreeNode {
  const root: TreeNode = {
    name: path.basename(rootPath),
    path: rootPath,
    isDirectory: true,
    children: [],
  };

  const nodeMap = new Map<string, TreeNode>();
  nodeMap.set(rootPath, root);

  // 按路径排序（确保父目录先处理）
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    const dirPath = path.dirname(file.path);

    // 创建目录节点（如果不存在）
    if (!nodeMap.has(dirPath)) {
      createDirectoryNodes(dirPath, rootPath, nodeMap);
    }

    const parent = nodeMap.get(dirPath) || root;
    const node: TreeNode = {
      name: file.name,
      path: file.path,
      isDirectory: file.isDirectory,
      children: [],
    };

    nodeMap.set(file.path, node);
    parent.children.push(node);
  }

  // 排序：目录在前，文件在后
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => {
      // 目录优先
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      // 同类型按名称排序
      return a.name.localeCompare(b.name);
    });
  }

  return root;
}

/**
 * 创建目录节点（递归）
 */
function createDirectoryNodes(
  dirPath: string,
  rootPath: string,
  nodeMap: Map<string, TreeNode>
): void {
  if (dirPath === rootPath) {
    return;
  }

  const parentPath = path.dirname(dirPath);
  if (!nodeMap.has(parentPath)) {
    createDirectoryNodes(parentPath, rootPath, nodeMap);
  }

  const parent = nodeMap.get(parentPath);
  if (!parent) {
    return; // 安全检查
  }

  const node: TreeNode = {
    name: path.basename(dirPath),
    path: dirPath,
    isDirectory: true,
    children: [],
  };

  nodeMap.set(dirPath, node);
  parent.children.push(node);
}

/**
 * 格式化树形输出
 */
function formatTree(root: TreeNode, rootPath: string): string {
  const lines: string[] = [];

  function renderNode(node: TreeNode, depth: number, prefix: string, isLast: boolean): void {
    const connector = isLast ? '└── ' : '├── ';
    lines.push(`${prefix}${connector}${node.name}`);

    // 渲染子节点
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const isLastChild = i === children.length - 1;
      const childPrefix = isLast ? '    ' : '│   ';
      const nextPrefix = prefix + childPrefix;

      if (child.isDirectory) {
        renderNode(child, depth + 1, nextPrefix, isLastChild);
      } else {
        lines.push(`${nextPrefix}${child.name}`);
      }
    }
  }

  lines.push(path.basename(rootPath) + '/');

  // 渲染根目录的子节点
  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const isLastChild = i === children.length - 1;
    renderNode(child, 1, isLastChild ? '    ' : '│   ', isLastChild);
  }

  return lines.join('\n');
}
