/**
 * 交互式提示符系统
 * 参考 OpenCode 实现，提供命令行交互式选择功能
 */

import * as readline from 'readline';
import * as tty from 'tty';

/**
 * 选择选项
 */
export interface SelectOption {
  label: string;      // 显示标签
  value: string;      // 实际值
  description?: string; // 描述信息（可选）
}

/**
 * 选择器配置
 */
export interface SelectConfig {
  message: string;      // 提示消息
  options: SelectOption[]; // 选项列表
  default?: number;     // 默认选中的索引（从 0 开始）
}

/**
 * 创建交互式选择器
 * 使用上下键切换，回车确认
 */
export async function select(config: SelectConfig): Promise<SelectOption> {
  const { message, options, default: defaultIndex = 0 } = config;

  if (options.length === 0) {
    throw new Error('选项列表不能为空');
  }

  if (options.length === 1) {
    return options[0];
  }

  let selectedIndex = defaultIndex;
  let resolved = false;

  // 创建 readline 接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 设置 raw mode 以接收单个按键
  const stdin = process.stdin as tty.ReadStream;
  stdin.setRawMode(true);

  return new Promise<SelectOption>((resolve) => {
    // 显示初始选项
    renderOptions(message, options, selectedIndex);

    // 监听按键
    const onKeyPress = (key: any) => {
      if (resolved) return;

      // 上下键或 Ctrl+P/Ctrl+N
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        renderOptions(message, options, selectedIndex);
        return;
      }

      if (key.name === 'down' || (key.ctrl && key.name === 'n')) {
        selectedIndex = (selectedIndex + 1) % options.length;
        renderOptions(message, options, selectedIndex);
        return;
      }

      // 数字键快速选择（1-9）
      if (key.name >= '1' && key.name <= '9') {
        const index = parseInt(key.name) - 1;
        if (index < options.length) {
          selectedIndex = index;
          cleanup();
          resolve(options[selectedIndex]);
        }
        return;
      }

      // 回车确认
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(options[selectedIndex]);
        return;
      }

      // ESC 或 Ctrl+C 取消
      if (key.name === 'escape' || key.name === 'c' && key.ctrl) {
        cleanup();
        process.exit(0);
        return;
      }
    };

    const cleanup = () => {
      resolved = true;
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onKeyPress);
      rl.close();
    };

    stdin.on('data', onKeyPress);
    stdin.resume();
  });
}

/**
 * 渲染选项列表
 */
function renderOptions(message: string, options: SelectOption[], selectedIndex: number): void {
  // 清空当前行并上移
  const lines = options.length + 2; // 选项数 + 消息行 + 空行
  process.stdout.write('\x1b[' + lines + 'F'); // 上移到开始位置

  // 显示消息
  console.log(`\n${message}`);

  // 显示选项
  options.forEach((option, index) => {
    const isSelected = index === selectedIndex;
    const prefix = isSelected ? '❯ ' : '  ';
    const label = `${index + 1}. ${option.label}`;

    if (isSelected) {
      // 高亮显示
      process.stdout.write(`\x1b[36m${prefix}${label}\x1b[0m`); // 青色
      if (option.description) {
        process.stdout.write(` \x1b[90m- ${option.description}\x1b[0m`); // 灰色描述
      }
      process.stdout.write('\n');
    } else {
      console.log(`${prefix}${label}`);
    }
  });

  // 移动光标到最后
  process.stdout.write('\x1b[' + options.length + 'E'); // 下移
}

/**
 * 确认提示符
 */
export async function confirm(message: string, defaultValue: boolean = true): Promise<boolean> {
  const options: SelectOption[] = [
    { label: '是', value: 'yes' },
    { label: '否', value: 'no' },
  ];

  const result = await select({
    message,
    options,
    default: defaultValue ? 0 : 1, // 这里 default 是对象属性，不是变量名
  });

  return result.value === 'yes';
}

/**
 * 问答提示符 - 支持自定义输入
 */
export async function question(message: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const defaultText = defaultValue ? ` (默认: ${defaultValue})` : '';

  return new Promise((resolve) => {
    rl.question(`${message}${defaultText}: `, (answer: string) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed || defaultValue || '');
    });
  });
}

/**
 * 多选提示符
 */
export async function multiSelect(config: SelectConfig): Promise<SelectOption[]> {
  const { message, options, default: defaultIndex = 0 } = config;
  let selectedIndex = defaultIndex;
  const selected: Set<number> = new Set();
  let resolved = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const stdin = process.stdin as tty.ReadStream;
  stdin.setRawMode(true);

  return new Promise((resolve) => {
    renderMultiOptions(message, options, selectedIndex, selected);

    const onKeyPress = (key: any) => {
      if (resolved) return;

      // 上下键
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        renderMultiOptions(message, options, selectedIndex, selected);
        return;
      }

      if (key.name === 'down' || (key.ctrl && key.name === 'n')) {
        selectedIndex = (selectedIndex + 1) % options.length;
        renderMultiOptions(message, options, selectedIndex, selected);
        return;
      }

      // 空格键切换选择
      if (key.name === 'space') {
        if (selected.has(selectedIndex)) {
          selected.delete(selectedIndex);
        } else {
          selected.add(selectedIndex);
        }
        renderMultiOptions(message, options, selectedIndex, selected);
        return;
      }

      // 回车确认
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        const results = Array.from(selected).map(i => options[i]);
        resolve(results);
        return;
      }

      // ESC 取消
      if (key.name === 'escape' || (key.name === 'c' && key.ctrl)) {
        cleanup();
        process.exit(0);
        return;
      }
    };

    const cleanup = () => {
      resolved = true;
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onKeyPress);
      rl.close();
    };

    stdin.on('data', onKeyPress);
    stdin.resume();
  });
}

/**
 * 渲染多选选项列表
 */
function renderMultiOptions(
  message: string,
  options: SelectOption[],
  selectedIndex: number,
  selected: Set<number>
): void {
  const lines = options.length + 2;
  process.stdout.write('\x1b[' + lines + 'F');

  console.log(`\n${message}`);
  console.log('(使用 ↑↓ 选择，空格切换，回车确认)\n');

  options.forEach((option, index) => {
    const isSelected = index === selectedIndex;
    const isMarked = selected.has(index);
    const mark = isMarked ? '✓' : '○';
    const prefix = isSelected ? '❯ ' : '  ';

    if (isSelected) {
      process.stdout.write(`\x1b[36m${prefix}${mark} ${option.label}\x1b[0m\n`);
    } else {
      console.log(`${prefix}${mark} ${option.label}`);
    }
  });

  process.stdout.write('\x1b[' + (options.length + 2) + 'E');
}
