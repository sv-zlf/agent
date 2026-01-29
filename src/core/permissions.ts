/**
 * 权限系统 - 参考 opencode 的细粒度权限控制
 */

/**
 * 权限动作类型
 */
export enum PermissionAction {
  ALLOW = 'allow',   // 允许
  DENY = 'deny',     // 拒绝
  ASK = 'ask',       // 询问用户
}

/**
 * 权限规则
 */
export interface PermissionRule {
  tool: string;          // 工具名或 '*' (所有工具)
  pattern: string;       // 路径模式 (如 '*', 'src/**/*.ts', '*.json')
  action: PermissionAction; // 权限动作
}

/**
 * 权限检查结果
 */
export interface PermissionCheckResult {
  action: PermissionAction;
  rule?: PermissionRule; // 匹配的规则
  reason?: string;      // 原因说明
}

/**
 * 权限请求
 */
export interface PermissionRequest {
  tool: string;
  path?: string;
  params?: Record<string, unknown>;
}

/**
 * 权限管理器
 */
export class PermissionManager {
  private rules: PermissionRule[] = [];
  private defaultAction: PermissionAction = PermissionAction.ALLOW;

  /**
   * 添加权限规则
   */
  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  /**
   * 批量添加权限规则
   */
  addRules(rules: PermissionRule[]): void {
    this.rules.push(...rules);
  }

  /**
   * 移除所有规则
   */
  clearRules(): void {
    this.rules = [];
  }

  /**
   * 获取所有规则
   */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  /**
   * 设置默认动作
   */
  setDefaultAction(action: PermissionAction): void {
    this.defaultAction = action;
  }

  /**
   * 检查权限
   */
  checkPermission(request: PermissionRequest): PermissionCheckResult {
    const { tool, path } = request;

    // 遍历规则，找到最匹配的
    for (const rule of this.rules) {
      // 检查工具是否匹配
      const toolMatches = rule.tool === '*' || rule.tool === tool;

      if (!toolMatches) {
        continue;
      }

      // 检查路径是否匹配（如果有路径）
      if (rule.pattern !== '*') {
        if (!path) {
          // 规则需要路径匹配，但请求没有路径
          continue;
        }

        if (!this.matchPattern(path, rule.pattern)) {
          continue;
        }
      }

      // 找到匹配的规则
      return {
        action: rule.action,
        rule,
        reason: this.getReason(rule, request),
      };
    }

    // 没有匹配的规则，使用默认动作
    return {
      action: this.defaultAction,
      reason: `使用默认权限: ${this.defaultAction}`,
    };
  }

  /**
   * 快速检查是否允许（不询问）
   */
  isAllowed(request: PermissionRequest): boolean {
    const result = this.checkPermission(request);
    return result.action === PermissionAction.ALLOW;
  }

  /**
   * 快速检查是否需要询问
   */
  requiresAsk(request: PermissionRequest): boolean {
    const result = this.checkPermission(request);
    return result.action === PermissionAction.ASK;
  }

  /**
   * 匹配通配符模式
   */
  private matchPattern(path: string, pattern: string): boolean {
    // 转换 glob 模式到正则表达式
    // 支持 *, **, ?
    const regexPattern = pattern
      .replace(/\./g, '\\.')  // 转义点
      .replace(/\*/g, '.*')   // * 匹配任意字符
      .replace(/\?/g, '.');   // ? 匹配单个字符

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(path);
  }

  /**
   * 获取权限原因
   */
  private getReason(rule: PermissionRule, request: PermissionRequest): string {
    const { tool, path } = request;

    switch (rule.action) {
      case PermissionAction.ALLOW:
        return `允许 ${tool}${path ? ` 操作 ${path}` : ''}`;
      case PermissionAction.DENY:
        return `拒绝 ${tool}${path ? ` 操作 ${path}` : ''}`;
      case PermissionAction.ASK:
        return `需要确认 ${tool}${path ? ` 操作 ${path}` : ''}`;
      default:
        return '未知权限';
    }
  }

  /**
   * 从配置对象加载规则
   */
  loadFromConfig(config: Record<string, PermissionAction | string[]>): void {
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        // 简单格式: { "Read": "allow" }
        this.addRule({
          tool: key,
          pattern: '*',
          action: value as PermissionAction,
        });
      } else if (Array.isArray(value)) {
        // 数组格式: { "Read": ["src/**/*.ts", "allow"] }
        for (let i = 0; i < value.length; i += 2) {
          const pattern = value[i];
          const action = value[i + 1] as PermissionAction;
          if (action) {
            this.addRule({
              tool: key,
              pattern,
              action,
            });
          }
        }
      }
    }
  }

  /**
   * 导出规则为配置对象
   */
  exportToConfig(): Record<string, PermissionAction | string[]> {
    const config: Record<string, PermissionAction | string[]> = {};

    // 按工具分组
    const grouped = new Map<string, PermissionRule[]>();
    for (const rule of this.rules) {
      if (!grouped.has(rule.tool)) {
        grouped.set(rule.tool, []);
      }
      grouped.get(rule.tool)!.push(rule);
    }

    // 转换为配置格式
    for (const [tool, rules] of grouped.entries()) {
      if (rules.length === 1 && rules[0].pattern === '*') {
        // 简单格式
        config[tool] = rules[0].action;
      } else {
        // 数组格式
        const patterns: string[] = [];
        for (const rule of rules) {
          patterns.push(rule.pattern, rule.action);
        }
        config[tool] = patterns;
      }
    }

    return config;
  }
}

/**
 * 预定义的权限配置模板
 */
export const PermissionPresets = {
  /**
   * 只读模式 - 只允许读取操作
   */
  readOnly: [
    { tool: 'Read', pattern: '*', action: PermissionAction.ALLOW },
    { tool: 'Glob', pattern: '*', action: PermissionAction.ALLOW },
    { tool: 'Grep', pattern: '*', action: PermissionAction.ALLOW },
    { tool: '*', pattern: '*', action: PermissionAction.DENY },
  ],

  /**
   * 探索模式 - 类似只读，但允许询问
   */
  explore: [
    { tool: 'Read', pattern: '*', action: PermissionAction.ALLOW },
    { tool: 'Glob', pattern: '*', action: PermissionAction.ALLOW },
    { tool: 'Grep', pattern: '*', action: PermissionAction.ALLOW },
    { tool: '*', pattern: '*', action: PermissionAction.ASK },
  ],

  /**
   * 安全模式 - 危险操作需要确认
   */
  safe: [
    { tool: 'Bash', pattern: 'rm *', action: PermissionAction.DENY },
    { tool: 'Bash', pattern: 'git reset --hard', action: PermissionAction.DENY },
    { tool: 'Write', pattern: '*.json', action: PermissionAction.ASK },
    { tool: '*', pattern: '*', action: PermissionAction.ALLOW },
  ],

  /**
   * 完全开放 - 所有操作都允许
   */
  allowAll: [
    { tool: '*', pattern: '*', action: PermissionAction.ALLOW },
  ],

  /**
   * 询问所有 - 所有操作都需要确认
   */
  askAll: [
    { tool: '*', pattern: '*', action: PermissionAction.ASK },
  ],
};

/**
 * 全局权限管理器实例
 */
let globalPermissionManager: PermissionManager | null = null;

/**
 * 获取全局权限管理器
 */
export function getGlobalPermissionManager(): PermissionManager {
  if (!globalPermissionManager) {
    globalPermissionManager = new PermissionManager();
  }
  return globalPermissionManager;
}

/**
 * 重置全局权限管理器
 */
export function resetGlobalPermissionManager(): void {
  globalPermissionManager = null;
}
