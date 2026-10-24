// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import type { CdpClient } from './cdpClient';
import * as actions from './actions';
import * as anchors from './anchors';
import { evalExpression } from './dom';
import type { NotifyOutcome, NotifyRequest } from '../mailbox/watchJob';
import { writeSignal } from '../mailbox/signalIo';
import * as logger from '../logger';

/**
 * 回执通知器 —— v1.2.0 设计 §7
 *
 * 只做一件事：在「有待处理回执 + 仲裁者空闲 + 输入框为空」时，
 * 向仲裁者会话注入固定话术，把它从结束的回合里唤醒。
 * 不携带任务内容，不解析回执，失败即 fail-stop。
 */

export interface NotifierDeps {
  getCdp: () => CdpClient | null;
  getArbiterSid: () => string | null;
  /** 固定话术生成（只含轮次/版本/job id/文件指针） */
  buildPhrase: (req: NotifyRequest) => string;
  alertSignalPath: string;
}

/** 两次注入的最小间隔 */
const MIN_INJECT_GAP_MS = 3000;

export class Notifier {
  private lastInjectAt = 0;

  constructor(private readonly deps: NotifierDeps) {}

  async notify(req: NotifyRequest): Promise<NotifyOutcome> {
    // 降级路径：只弹本地气泡，不再动会话
    if (req.降级) {
      this.degrade(req, '通知重发未获 ack');
      return 'sent';
    }

    const client = this.deps.getCdp();
    if (!client || !client.isConnected()) {
      logger.warn('通知跳过：CDP 未连接');
      return 'skipped';
    }

    const arbiterSid = this.deps.getArbiterSid();
    if (!arbiterSid) {
      logger.warn('通知跳过：未绑定仲裁者会话');
      return 'skipped';
    }

    try {
      // L1：无侵入预筛——任务行有运行图标就直接跳过，不切会话
      const l1 = await rowRunningState(client, arbiterSid);
      if (l1 === 'no-row') {
        this.writeAlert(req, 'arbiter_sid_not_found');
        logger.warn(`通知失败：仲裁者会话 ${arbiterSid} 不在任务列表中`);
        return 'failed';
      }
      if (l1 === 'running') {
        logger.debug(`通知跳过：仲裁者 ${arbiterSid} 正在运行（任务行图标）`);
        return 'skipped';
      }

      // 记录用户当前会话，注入后切回，减少打扰
      const before = await actions.status(client);

      // L2：切到仲裁者做最终确认
      await actions.navigateTo(client, arbiterSid);
      await actions.assertIdentity(client, arbiterSid);

      const state = await actions.status(client);
      if (state.state !== 'idle') {
        logger.debug(`通知跳过：仲裁者状态 ${state.state}`);
        return 'skipped';
      }

      // 输入框有草稿 → 绝不注入，避免清掉用户正在写的内容
      const draft = await inputText(client);
      if (draft.length > 0) {
        logger.debug('通知跳过：仲裁者输入框有草稿');
        return 'skipped';
      }

      const now = Date.now();
      if (now - this.lastInjectAt < MIN_INJECT_GAP_MS) {
        logger.debug('通知跳过：注入冷却中');
        return 'skipped';
      }

      await actions.insertText(client, this.deps.buildPhrase(req));
      await actions.send(client);
      this.lastInjectAt = now;
      logger.audit('notify_injected', {
        job: req.jobId,
        轨: req.轨,
        类型: req.类型,
      });

      // 切回用户原来的会话（仲裁者新回合在后台继续执行）
      if (before.sid && before.sid !== arbiterSid) {
        try {
          await actions.navigateTo(client, before.sid);
        } catch (e) {
          logger.warn(`切回原会话失败: ${(e as Error).message}`);
        }
      }

      return 'sent';
    } catch (e) {
      const msg = (e as Error).message;
      logger.error(`通知注入失败: ${msg}`);
      this.writeAlert(req, 'notify_inject_failed', msg);
      return 'failed';
    }
  }

  /** 降级通知：VS Code 气泡 + alert.signal，不再注入 */
  private degrade(req: NotifyRequest, reason: string): void {
    const text = `ParallelAgent：${req.轨.join('/')} 的回执待处理（第${req.轮次}轮 v${req.版本}，job ${req.jobId}）`;
    void vscode.window.showWarningMessage(text, '知道了');
    this.writeAlert(req, reason);
    logger.warn(`通知降级：${reason} job=${req.jobId} 轨=${req.轨.join(',')}`);
  }

  private writeAlert(req: NotifyRequest, reason: string, detail?: string): void {
    writeSignal(this.deps.alertSignalPath, {
      job: req.jobId,
      轮次: req.轮次,
      版本: req.版本,
      轨: req.轨,
      reason,
      detail,
      ts: new Date().toISOString(),
    });
  }
}

/** L1 预筛：读任务行内是否有运行图标（不切会话） */
async function rowRunningState(
  client: CdpClient,
  sid: string,
): Promise<'running' | 'not-running' | 'no-row'> {
  const rowSelector = JSON.stringify(
    `.task-list-row-wrapper[data-session-id="${sid}"]`,
  );
  const iconSelector = JSON.stringify(anchors.ANCHOR_RUNNING_ICON);
  const expr = `(()=>{
    const row=document.querySelector(${rowSelector});
    if(!row) return 'no-row';
    return row.querySelector(${iconSelector})?'running':'not-running';
  })()`;
  const v = (await evalExpression(client, expr)) as string;
  if (v === 'running' || v === 'no-row') return v;
  return 'not-running';
}

/** 读当前会话输入框文本（用于判空） */
async function inputText(client: CdpClient): Promise<string> {
  const expr = `(()=>{
    const el=document.querySelector('.chat-input-v2-input-box-editable');
    return el?(el.innerText||'').trim():'';
  })()`;
  const v = await evalExpression(client, expr);
  return typeof v === 'string' ? v : '';
}
