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

  const stdin = process.stdin as tty.ReadStream;

  // 保存当前状态
  const wasRawMode = stdin.isRaw;

  return new Promise<SelectOption>((resolve) => {
    // 显示初始选项
    renderOptions(message, options, selectedIndex);

    // 设置 raw mode 以接收单个按键
    stdin.setRawMode(true);
    stdin.resume();

    const onKeyPress = (buffer: Buffer) => {
      if (resolved) return;

      // 将 Buffer 转换为按键对象
      const key = parseKeyPress(buffer);

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
      if (key.name === 'escape' || (key.name === 'c' && key.ctrl)) {
        cleanup();
        process.exit(0);
        return;
      }
    };

    const cleanup = () => {
      resolved = true;

      // 移除监听器
      stdin.removeListener('data', onKeyPress);

      // 恢复之前的状态
      if (!wasRawMode) {
        stdin.setRawMode(false);
      }
      // 不暂停 stdin，让调用者管理
    };

    stdin.on('data', onKeyPress);
  });
}

/**
 * 解析按键 Buffer
 */
function parseKeyPress(buffer: Buffer): any {
  const str = buffer.toString('utf8');
  const code = buffer[0];

  const key: any = {
    name: undefined,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    sequence: str,
  };

  // 检测 Ctrl 组合键
  if (code < 32 || (code === 127 && str.length === 1)) {
    if (code === 127) {
      key.name = 'backspace';
    } else if (code === 3) {
      key.ctrl = true;
      key.name = 'c';
    } else if (code === 13) {
      key.name = 'return';
    } else if (code === 27) {
      // ESC 或转义序列
      if (buffer.length >= 3 && buffer[1] === 91) {
        // ANSI 转义序列
        const lastCode = buffer[2];
        if (lastCode === 65) {
          key.name = 'up';
        } else if (lastCode === 66) {
          key.name = 'down';
        } else if (lastCode === 67) {
          key.name = 'right';
        } else if (lastCode === 68) {
          key.name = 'left';
        }
      } else {
        key.name = 'escape';
      }
    } else {
      key.ctrl = true;
      key.name = String.fromCharCode(code + 64);
    }
  } else if (str.length === 1) {
    // 常规按键
    if (code === 32) {
      key.name = 'space';
      key.sequence = ' ';
    } else {
      key.name = str.toLowerCase();
      if (str.length === 1 && str !== str.toLowerCase()) {
        key.shift = true;
      }
    }
  }

  return key;
}

/**
 * 渲染选项列表
 */
function renderOptions(message: string, options: SelectOption[], selectedIndex: number): void {
  // 使用 ANSI 转义序列重绘
  process.stdout.write('\x1b[H'); // 移动光标到左上角
  process.stdout.write('\x1b[2J'); // 清空屏幕

  // 渲染消息
  process.stdout.write(`\n${message}\n`);

  // 渲染选项
  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const isSelected = i === selectedIndex;
    const prefix = isSelected ? '❯ ' : '  ';
    const label = `${i + 1}. ${option.label}`;

    if (isSelected) {
      // 高亮显示
      process.stdout.write(`\x1b[36m${prefix}${label}\x1b[0m`); // 青色
      if (option.description) {
        process.stdout.write(` \x1b[90m- ${option.description}\x1b[0m`); // 灰色描述
      }
      process.stdout.write('\n');
    } else {
      process.stdout.write(`${prefix}${label}\n`);
    }
  }
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
    default: defaultValue ? 0 : 1,
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

  const stdin = process.stdin as tty.ReadStream;

  return new Promise((resolve) => {
    renderMultiOptions(message, options, selectedIndex, selected);

    stdin.setRawMode(true);
    stdin.resume();

    const onKeyPress = (buffer: Buffer) => {
      if (resolved) return;

      const key = parseKeyPress(buffer);

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
      // 不暂停 stdin，让调用者管理
      stdin.removeListener('data', onKeyPress);
    };

    stdin.on('data', onKeyPress);
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
  process.stdout.write('\x1b[H'); // 移动光标到左上角
  process.stdout.write('\x1b[2J'); // 清空屏幕

  process.stdout.write(`\n${message}\n`);
  process.stdout.write('(使用 ↑↓ 选择，空格切换，回车确认)\n\n');

  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const isSelected = i === selectedIndex;
    const isMarked = selected.has(i);
    const mark = isMarked ? '✓' : '○';
    const prefix = isSelected ? '❯ ' : '  ';
    const label = `${prefix}${mark} ${option.label}`;

    if (isSelected) {
      process.stdout.write(`\x1b[36m${label}\x1b[0m\n`);
    } else {
      process.stdout.write(`${label}\n`);
    }
  }
}

/**
 * 获取配置文件路径
 */
export function getConfigPath(workingDir: string): string {
  const configPath = require('path').join(workingDir, '.ggrc.json');
  return configPath;
}
