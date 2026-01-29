import * as fs from 'fs-extra';
import * as path from 'path';
import * as fg from 'fast-glob';
import type { CodeEdit, FileAnalysis, SearchOptions } from '../types';

/**
 * 代码操作器
 */
export class CodeOperator {
  private maxFileSize: number;

  constructor(maxFileSize: number = 1048576) {
    // 默认1MB
    this.maxFileSize = maxFileSize;
  }

  /**
   * 读取文件
   */
  async readFile(filePath: string): Promise<string> {
    try {
      const stats = await fs.stat(filePath);

      if (stats.size > this.maxFileSize) {
        throw new Error(`文件过大 (${(stats.size / 1024 / 1024).toFixed(2)}MB)，超过限制 (${this.maxFileSize / 1024 / 1024}MB)`);
      }

      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`读取文件失败 [${filePath}]: ${(error as Error).message}`);
    }
  }

  /**
   * 写入文件
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      // 确保目录存在
      await fs.ensureDir(path.dirname(filePath));

      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      throw new Error(`写入文件失败 [${filePath}]: ${(error as Error).message}`);
    }
  }

  /**
   * 编辑文件（精确替换）
   */
  async editFile(filePath: string, oldContent: string, newContent: string): Promise<void> {
    const content = await this.readFile(filePath);

    if (!content.includes(oldContent)) {
      throw new Error('未找到要替换的代码内容');
    }

    const newFileContent = content.replace(oldContent, newContent);
    await this.writeFile(filePath, newFileContent);
  }

  /**
   * 搜索代码
   */
  async searchCode(pattern: string, options?: SearchOptions): Promise<string[]> {
    const {
      filePattern = '**/*.{js,ts,jsx,tsx,py,java,go,rs,c,cpp,h,hpp}',
      caseSensitive = false,
      maxResults = 100,
    } = options || {};

    try {
      const files = await this.globFiles(filePattern);
      const results: string[] = [];
      const regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');

      for (const file of files) {
        if (results.length >= maxResults) break;

        try {
          const content = await this.readFile(file);
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
              if (results.length >= maxResults) break;
            }
          }
        } catch {
          // 跳过无法读取的文件
          continue;
        }
      }

      return results;
    } catch (error) {
      throw new Error(`搜索代码失败: ${(error as Error).message}`);
    }
  }

  /**
   * 分析文件
   */
  async analyzeFile(filePath: string): Promise<FileAnalysis> {
    try {
      const content = await this.readFile(filePath);
      const stats = await fs.stat(filePath);
      const ext = path.extname(filePath);
      const language = this.getLanguage(ext);

      const analysis: FileAnalysis = {
        path: filePath,
        language,
        lineCount: content.split('\n').length,
        size: stats.size,
      };

      // 简单提取函数和类（仅支持部分语言）
      if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
        analysis.functions = this.extractFunctions(content, language);
        analysis.classes = this.extractClasses(content, language);
      }

      return analysis;
    } catch (error) {
      throw new Error(`分析文件失败: ${(error as Error).message}`);
    }
  }

  /**
   * 获取语言类型
   */
  private getLanguage(ext: string): string {
    const languageMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.cs': 'csharp',
      '.php': 'php',
      '.rb': 'ruby',
      '.kt': 'kotlin',
      '.swift': 'swift',
    };

    return languageMap[ext] || 'text';
  }

  /**
   * 提取函数（简单的正则匹配）
   */
  private extractFunctions(content: string, language: string): string[] {
    const functions: string[] = [];

    // JavaScript/TypeScript
    if (['javascript', 'typescript'].includes(language)) {
      // function name() {}
      const funcRegex1 = /function\s+(\w+)\s*\(/g;
      // const name = () => {}
      const funcRegex2 = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
      // async name() {}
      const funcRegex3 = /async\s+(\w+)\s*\(/g;

      [funcRegex1, funcRegex2, funcRegex3].forEach((regex) => {
        let match;
        while ((match = regex.exec(content)) !== null) {
          functions.push(match[1]);
        }
      });
    }

    return [...new Set(functions)];
  }

  /**
   * 提取类（简单的正则匹配）
   */
  private extractClasses(content: string, language: string): string[] {
    const classes: string[] = [];

    if (['javascript', 'typescript'].includes(language)) {
      const classRegex = /class\s+(\w+)/g;
      let match;
      while ((match = classRegex.exec(content)) !== null) {
        classes.push(match[1]);
      }
    }

    return classes;
  }

  /**
   * 使用glob查找文件
   */
  private async globFiles(pattern: string): Promise<string[]> {
    try {
      return await fg.glob(pattern, { onlyFiles: true });
    } catch (error) {
      throw new Error(`查找文件失败: ${(error as Error).message}`);
    }
  }
}

/**
 * 创建代码操作器实例
 */
export function createCodeOperator(maxFileSize?: number): CodeOperator {
  return new CodeOperator(maxFileSize);
}
