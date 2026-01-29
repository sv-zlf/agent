import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { getConfig } from '../config';
import { createLogger } from '../utils';

const logger = createLogger();

/**
 * config命令
 */
export const configCommand = new Command('config')
  .description('配置管理')
  .action(async () => {
    // 如果没有子命令，显示当前配置
    await showConfig();
  });

// 显示当前配置
async function showConfig(): Promise<void> {
  const config = getConfig();
  await config.load();

  logger.title('当前配置');

  const apiConfig = config.getAPIConfig();
  console.log('\nAPI配置:');
  console.log(`  基础URL: ${apiConfig.base_url}`);
  console.log(`  模型: ${apiConfig.model}`);
  console.log(`  超时: ${apiConfig.timeout || 30000}ms`);

  const agentConfig = config.getAgentConfig();
  console.log('\nAgent配置:');
  console.log(`  最大上下文: ${agentConfig.max_context_tokens} tokens`);
  console.log(`  备份目录: ${agentConfig.backup_dir}`);
  console.log(`  最大文件大小: ${(agentConfig.max_file_size / 1024 / 1024).toFixed(2)}MB`);
  console.log(`  最大历史: ${agentConfig.max_history} 轮`);
}

// 初始化配置
configCommand
  .command('init')
  .description('初始化配置文件')
  .option('-f, --force', '覆盖已存在的配置文件')
  .action(async (options) => {
    const configPath = './config/config.yaml';
    const config = getConfig(configPath);

    // 检查配置文件是否已存在
    if (await fs.pathExists(configPath)) {
      if (!options.force) {
        logger.warning(`配置文件已存在: ${configPath}`);
        logger.info('使用 --force 选项覆盖现有配置');
        return;
      }
    }

    try {
      await config.save();
      logger.success(`配置文件已创建: ${configPath}`);
      logger.info('你可以根据需要修改配置文件');
    } catch (error) {
      logger.error(`创建配置文件失败: ${(error as Error).message}`);
    }
  });

// 验证配置
configCommand
  .command('validate')
  .description('验证配置文件')
  .action(async () => {
    const config = getConfig();

    try {
      await config.load();
      const validation = config.validate();

      if (validation.valid) {
        logger.success('配置文件有效');
      } else {
        logger.error('配置文件存在以下问题:');
        validation.errors.forEach((err) => {
          console.log(chalk.red(`  • ${err}`));
        });
      }
    } catch (error) {
      logger.error(`验证配置失败: ${(error as Error).message}`);
    }
  });

// 设置配置项
configCommand
  .command('set <key> <value>')
  .description('设置配置项 (例如: agent.max_history 20)')
  .action(async (key, value) => {
    const config = getConfig();

    try {
      await config.load();

      // 解析key路径 (例如: api.timeout)
      const keys = key.split('.');
      const target = keys.reduce((obj: any, k: string) => obj?.[k], config.get() as any);

      if (target === undefined) {
        logger.error(`无效的配置项: ${key}`);
        return;
      }

      // 尝试解析value类型
      let parsedValue: any = value;
      if (value === 'true') parsedValue = true;
      else if (value === 'false') parsedValue = false;
      else if (!isNaN(Number(value))) parsedValue = Number(value);

      // 设置值 (这里简化处理，只支持顶层修改)
      const [section, field] = keys;
      const sectionConfig = config.get(section as any);
      if (sectionConfig && typeof sectionConfig === 'object') {
        (sectionConfig as any)[field] = parsedValue;
        await config.save();
        logger.success(`配置已更新: ${key} = ${parsedValue}`);
      }
    } catch (error) {
      logger.error(`设置配置失败: ${(error as Error).message}`);
    }
  });

// 获取配置项
configCommand
  .command('get <key>')
  .description('获取配置项')
  .action(async (key) => {
    const config = getConfig();

    try {
      await config.load();

      const keys = key.split('.');
      const value = keys.reduce((obj: any, k: string) => obj?.[k], config.get());

      if (value !== undefined) {
        console.log(JSON.stringify(value, null, 2));
      } else {
        logger.warning(`配置项不存在: ${key}`);
      }
    } catch (error) {
      logger.error(`获取配置失败: ${(error as Error).message}`);
    }
  });
