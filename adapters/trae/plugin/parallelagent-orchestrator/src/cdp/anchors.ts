// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Work 页面 DOM 锚点常量 —— 定稿 §8.4 全部选择器
 * 2026-10-15 实测稳定
 */

/** 输入框（Lexical contenteditable） */
export const ANCHOR_INPUT =
  '.chat-input-v2-input-box-editable';

/** 发送按钮 */
export const ANCHOR_SEND_BUTTON =
  '.chat-input-v2-send-button';

/** 发送空闲态（可发） */
export const ANCHOR_SEND_IDLE =
  'span[data-testid="chat-icon-arrow-up"]';

/** 发送运行态（在跑） */
export const ANCHOR_SEND_RUNNING =
  'span[data-testid="chat-icon-stop"]';

/** 任务行 wrapper，data-session-id 为 24 位 hex */
export const ANCHOR_TASK_ROW =
  '.task-list-row-wrapper[data-session-id]';

/** 当前选中行（全页唯一） */
export const ANCHOR_TASK_SELECTED =
  '.taskItemSelected';

/** 任务项（合成 click 切换有效） */
export const ANCHOR_TASK_ITEM =
  '.taskItem';

/** 任务标题 */
export const ANCHOR_TASK_TITLE =
  '.taskText';

/** 更多菜单按钮 */
export const ANCHOR_TASK_MORE_BTN =
  '.taskMoreBtn';

/** 菜单项 */
export const ANCHOR_MENU_ITEM =
  '.task-list-menu-item';

/**
 * 运行态图标。
 * 注意：该图标仅在会话「未被选中」时显示；切进该会话后即隐藏，
 * 因此「无图标」不能作为空闲依据，只能作为「忙」的排除条件。
 */
export const ANCHOR_RUNNING_ICON =
  '.taskStatusIcon .session-status-icon-progress svg.trae-icon-TaskState_running';

/** 项目分组行名称（文本即项目名，如 "ParallelAgent"） */
export const ANCHOR_GROUP_NAME =
  '.task-list-group-name';

/** 项目分组行"新建任务"按钮（hover 显示但常驻 DOM，点击后自动挂该项目） */
export const ANCHOR_GROUP_NEW_BTN =
  '.task-list-group-new-btn';

/** Lexical 段落（注入后结构） */
export const ANCHOR_LEXICAL_PARAGRAPH =
  '.chat-input-v2__paragraph';
