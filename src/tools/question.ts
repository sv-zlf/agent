/**
 * Question Tool - 向用户提问工具
 * 允许 AI 在执行过程中向用户提问，收集偏好、澄清需求或获取决策
 */

import * as z from 'zod';
import { defineTool, ToolInfo } from './tool';
import { select, multiSelect, input } from '../utils/prompt';

/**
 * 问题选项
 */
export interface QuestionOption {
  label: string;      // 显示标签（1-5个词，简洁）
  description: string; // 选项说明
}

/**
 * 问题信息
 */
export interface QuestionInfo {
  question: string;             // 完整问题
  header: string;               // 简短标签（最多30字符）
  options: QuestionOption[];    // 可选选项
  multiple?: boolean;           // 是否允许多选
  custom?: boolean;             // 是否允许自定义输入（默认true）
}

/**
 * 答案类型 - 选项标签数组
 */
export type QuestionAnswer = string[];

/**
 * 用户取消错误
 */
export class QuestionCancelledError extends Error {
  constructor() {
    super('用户取消了问题');
    this.name = 'QuestionCancelled';
  }
}

/**
 * Question Tool 定义
 */
export const QuestionTool: ToolInfo<
  z.ZodType<{ questions: QuestionInfo[] }>,
  { answers?: QuestionAnswer[] }
> = defineTool('question', {
  description: '向用户提问工具，用于收集用户偏好、澄清需求或获取决策',

  parameters: z.object({
    questions: z
      .array(
        z
          .object({
            question: z.string().describe('完整的问题描述'),
            header: z.string().describe('简短的标签（最多30字符）'),
            options: z
              .array(
                z.object({
                  label: z.string().describe('显示标签（1-5个词，简洁）'),
                  description: z.string().describe('选项说明'),
                })
              )
              .describe('可选项列表'),
            multiple: z.boolean().optional().describe('是否允许多选'),
            custom: z.boolean().optional().describe('是否允许自定义输入（默认true）'),
          })
          .passthrough()
      )
      .describe('要问的问题列表'),
  }),

  async execute(params, _ctx) {
    const answers: QuestionAnswer[] = [];

    for (const q of params.questions) {
      try {
        const answer = await askSingleQuestion(q);
        answers.push(answer);
      } catch (error) {
        if (error instanceof QuestionCancelledError) {
          throw error;
        }
        // 其他错误，记录空答案
        answers.push([]);
      }
    }

    // 格式化输出 - 更友好的格式
    const formatted = params.questions.map((q, i) => {
      const answer = answers[i];

      if (!answer || answer.length === 0) {
        return `❓ ${q.question}: [未回答]`;
      }

      // 如果有选项，显示选项标签
      if (q.options && q.options.length > 0) {
        const selectedLabels = answer.join('、');
        return `✅ ${q.question}: ${selectedLabels}`;
      }

      // 文本输入
      return `✅ ${q.question}: ${answer.join(', ')}`;
    });

    const output = params.questions.length === 1
      ? formatted.join('\n')
      : `用户已回答您的问题：\n\n${formatted.join('\n\n')}\n\n您可以继续基于用户的答案进行操作。`;

    return {
      title: `已提问 ${params.questions.length} 个问题`,
      output,
      metadata: {
        answers,
      },
    };
  },
});

/**
 * 处理单个问题
 */
async function askSingleQuestion(info: QuestionInfo): Promise<QuestionAnswer> {
  const { question, options, multiple = false, custom = true } = info;

  // 如果没有选项，直接使用文本输入
  if (!options || options.length === 0) {
    const answer = await input(question);
    return answer ? [answer] : [];
  }

  // 准备选项列表
  const selectOptions = options.map((opt) => ({
    label: opt.label,
    value: opt.label,
    description: opt.description,
  }));

  // 如果允许自定义输入，添加"其他"选项
  if (custom) {
    selectOptions.push({
      label: 'Other',
      value: '__custom__',
      description: '输入自定义答案',
    });
  }

  try {
    if (multiple) {
      // 多选模式
      const selected = await multiSelect({
        message: question,
        options: selectOptions,
      });

      // 检查是否选择了"其他"
      if (selected.some((s) => s.value === '__custom__')) {
        const customAnswer = await input('请输入您的自定义答案');
        return selected.filter((s) => s.value !== '__custom__').map((s) => s.label).concat(customAnswer ? [customAnswer] : []);
      }

      return selected.map((s) => s.label);
    } else {
      // 单选模式
      const selected = await select({
        message: question,
        options: selectOptions,
      });

      // 检查是否选择了"其他"
      if (selected.value === '__custom__') {
        const customAnswer = await input('请输入您的自定义答案');
        return customAnswer ? [customAnswer] : [];
      }

      return [selected.label];
    }
  } catch (error: any) {
    if (error.name === 'UserCancelled') {
      throw new QuestionCancelledError();
    }
    throw error;
  }
}
