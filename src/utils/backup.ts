import * as fs from 'fs-extra';
import * as path from 'path';
import { createLogger } from './logger';

const logger = createLogger();

/**
 * 备份管理器
 */
export class BackupManager {
  private backupDir: string;

  constructor(backupDir: string = './backups') {
    this.backupDir = backupDir;
  }

  /**
   * 备份文件
   */
  async backupFile(filePath: string): Promise<string | null> {
    try {
      // 检查文件是否存在
      if (!(await fs.pathExists(filePath))) {
        logger.warning(`文件不存在，跳过备份: ${filePath}`);
        return null;
      }

      // 确保备份目录存在
      await fs.ensureDir(this.backupDir);

      // 生成备份文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const basename = path.basename(filePath);
      const backupFileName = `${basename}.${timestamp}.bak`;
      const backupPath = path.join(this.backupDir, backupFileName);

      // 复制文件
      await fs.copy(filePath, backupPath);

      logger.debug(`文件已备份到: ${backupPath}`);
      return backupPath;
    } catch (error) {
      logger.error(`备份失败: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * 恢复文件
   */
  async restoreFile(backupPath: string, targetPath: string): Promise<boolean> {
    try {
      if (!(await fs.pathExists(backupPath))) {
        logger.error(`备份文件不存在: ${backupPath}`);
        return false;
      }

      await fs.copy(backupPath, targetPath, { overwrite: true });
      logger.success(`文件已恢复: ${targetPath}`);
      return true;
    } catch (error) {
      logger.error(`恢复失败: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * 列出备份文件
   */
  async listBackups(filePath?: string): Promise<string[]> {
    try {
      await fs.ensureDir(this.backupDir);
      const files = await fs.readdir(this.backupDir);

      if (filePath) {
        // 只返回指定文件的备份
        const basename = path.basename(filePath);
        return files.filter((f) => f.startsWith(basename)).map((f) => path.join(this.backupDir, f));
      }

      return files.map((f) => path.join(this.backupDir, f));
    } catch (error) {
      logger.error(`列出备份失败: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * 清理旧备份
   */
  async cleanOldBackups(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    // 默认7天
    try {
      await fs.ensureDir(this.backupDir);
      const files = await fs.readdir(this.backupDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        const filePath = path.join(this.backupDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAge) {
          await fs.remove(filePath);
          cleaned++;
          logger.debug(`已删除旧备份: ${file}`);
        }
      }

      if (cleaned > 0) {
        logger.info(`已清理 ${cleaned} 个旧备份文件`);
      }

      return cleaned;
    } catch (error) {
      logger.error(`清理备份失败: ${(error as Error).message}`);
      return 0;
    }
  }

  /**
   * 清空所有备份
   */
  async clearAllBackups(): Promise<void> {
    try {
      await fs.emptyDir(this.backupDir);
      logger.success('已清空所有备份');
    } catch (error) {
      logger.error(`清空备份失败: ${(error as Error).message}`);
    }
  }
}

/**
 * 创建备份管理器实例
 */
export function createBackupManager(backupDir?: string): BackupManager {
  return new BackupManager(backupDir);
}
