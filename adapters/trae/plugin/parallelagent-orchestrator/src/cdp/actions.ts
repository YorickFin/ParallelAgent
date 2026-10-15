// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import { CdpClient } from './cdpClient';
import { evalExpression, assertAnchor } from './dom';
import * as anchors from './anchors';
import { IdentityMismatch, AnchorNotFound } from '../errors';
import * as logger from '../logger';

// ── 辅助函数 ───────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 轮询直到谓词满足或超时 */
async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (v: T) => boolean,
  timeoutMs: number,
  intervalMs = 300,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll 超时 (${timeoutMs}ms)`);
}

// ── 公共动作 ───────────────────────────────────────────

/** 任务状态信息 */
export interface TaskStatus {
  state: 'running' | 'idle' | 'unknown';
  sid: string;
  title: string;
}

/**
 * status() — 读发送按钮 data-testid + 当前选中任务
 * 定稿 §8.3：arrow-up=idle / stop=running
 */
export async function status(client: CdpClient): Promise<TaskStatus> {
  const expr = `(()=>{
    const running=document.querySelector(${JSON.stringify(anchors.ANCHOR_SEND_RUNNING)});
    const idle=document.querySelector(${JSON.stringify(anchors.ANCHOR_SEND_IDLE)});
    const state=running?'running':(idle?'idle':'unknown');
    const sel=document.querySelector(${JSON.stringify(anchors.ANCHOR_TASK_SELECTED)});
    const wrapper=sel?sel.closest(${JSON.stringify(anchors.ANCHOR_TASK_ROW)}):null;
    const sid=wrapper?wrapper.getAttribute('data-session-id'):'';
    const titleEl=sel?sel.querySelector(${JSON.stringify(anchors.ANCHOR_TASK_TITLE)}):null;
    const title=titleEl?titleEl.textContent.trim():'';
    return {state,sid,title};
  })()`;
  const v = (await evalExpression(client, expr)) as TaskStatus;
  logger.audit('action_status', v);
  return v;
}

/**
 * navigateTo(sid) — 合成 click 切到目标 sid + 轮询确认切换完成
 */
export async function navigateTo(
  client: CdpClient,
  sid: string,
  timeoutMs = 5000,
): Promise<void> {
  await assertAnchor(client, anchors.ANCHOR_TASK_ROW, '任务行');

  // 合成 click
  const clickResult = (await evalExpression(client,
    `(()=>{const w=document.querySelector('.task-list-row-wrapper[data-session-id="${sid}"]');if(!w)return 'NOT_FOUND';const item=w.querySelector(${JSON.stringify(anchors.ANCHOR_TASK_ITEM)});if(!item)return 'NO_ITEM';item.scrollIntoView({block:'center'});item.click();return 'CLICKED';})()`,
  )) as string;

  if (clickResult !== 'CLICKED') {
    throw new AnchorNotFound(`navigate 失败: sid=${sid} result=${clickResult}`);
  }

  // 轮询确认 .taskItemSelected 所在 wrapper 的 sid 匹配
  await pollUntil(
    () => evalExpression(client,
      `(()=>{const sel=document.querySelector(${JSON.stringify(anchors.ANCHOR_TASK_SELECTED)});if(!sel)return '';const w=sel.closest(${JSON.stringify(anchors.ANCHOR_TASK_ROW)});return w?w.getAttribute('data-session-id'):'';})()`,
    ) as Promise<string>,
    (actual: string) => actual === sid,
    timeoutMs,
  );
  logger.audit('action_navigate', { sid });
}

/**
 * assertIdentity(sid) — 断言当前选中项 sid 匹配，否则 fail-stop
 */
export async function assertIdentity(
  client: CdpClient,
  sid: string,
): Promise<void> {
  const actual = (await evalExpression(client,
    `(()=>{const sel=document.querySelector(${JSON.stringify(anchors.ANCHOR_TASK_SELECTED)});if(!sel)return '';const w=sel.closest(${JSON.stringify(anchors.ANCHOR_TASK_ROW)});return w?w.getAttribute('data-session-id'):'';})()`,
  )) as string;

  if (actual !== sid) {
    throw new IdentityMismatch(sid, actual);
  }
  logger.audit('action_assertIdentity', { sid, ok: true });
}

/** focusInput() — 聚焦 Lexical 输入框 */
export async function focusInput(client: CdpClient): Promise<void> {
  await assertAnchor(client, anchors.ANCHOR_INPUT, '输入框');
  const result = (await evalExpression(client,
    `(()=>{const el=document.querySelector(${JSON.stringify(anchors.ANCHOR_INPUT)});if(!el)return 'MISS';el.focus();return document.activeElement===el?'FOCUSED':'FOCUS-FAIL';})()`,
  )) as string;
  if (result !== 'FOCUSED') {
    throw new AnchorNotFound(`focusInput 失败: ${result}`);
  }
  logger.debug('focusInput OK');
}

/** clearInput() — Ctrl+A 全选 + Delete 清空输入框 */
export async function clearInput(client: CdpClient): Promise<void> {
  await focusInput(client);
  // Ctrl+A (modifiers=2)
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
  });
  // Delete
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46,
  });
  logger.debug('clearInput OK');
}

/** insertText(text) — 通过 CDP Input.insertText 写入文本（中文无乱码） */
export async function insertText(
  client: CdpClient,
  text: string,
): Promise<void> {
  await focusInput(client);
  // 确认聚焦在输入框
  const activeClass = (await evalExpression(client,
    `document.activeElement?document.activeElement.className:''`,
  )) as string;
  logger.debug(`insertText: activeElement.class=${activeClass}`);

  await client.send('Input.insertText', { text });
  logger.audit('action_insertText', { length: text.length });
}

/** send() — 回车发送（rawKeyDown → char → keyUp） */
export async function send(client: CdpClient): Promise<void> {
  for (const ty of ['rawKeyDown', 'char', 'keyUp']) {
    const params: Record<string, unknown> = {
      type: ty, key: 'Enter', code: 'Enter',
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    };
    if (ty === 'char') params.text = '\r';
    await client.send('Input.dispatchKeyEvent', params);
  }
  logger.audit('action_send', {});
}

/**
 * newTask(projectName, phrase) — 点击项目分组行"新建任务"按钮 → 注入首条话术 → 发送 → 轮询新 sid
 * 用分组行入口而非面板顶部新建按钮：一步新建且自动挂该项目
 * 注意：点击后进入"草稿会话"（不进任务列表、无 sid），首条消息发出后 sid 才落库——
 * 所以必须先发送再等 sid，不能反过来。
 */
export async function newTask(
  client: CdpClient,
  projectName: string,
  phrase: string,
  timeoutMs = 15000,
): Promise<string> {
  // 记录当前 sid 集合
  const oldSids = (await evalExpression(client,
    `(()=>{const ws=document.querySelectorAll(${JSON.stringify(anchors.ANCHOR_TASK_ROW)});return Array.from(ws).map(w=>w.getAttribute('data-session-id'));})()`,
  )) as string[];

  // 定位项目分组行"新建任务"按钮坐标（文本匹配项目名，无纯 CSS 文本选择器）
  const coord = (await evalExpression(client,
    `(()=>{const names=Array.from(document.querySelectorAll(${JSON.stringify(anchors.ANCHOR_GROUP_NAME)}));const target=names.find(n=>n.textContent.trim()===${JSON.stringify(projectName)});if(!target)return null;const header=target.closest('.task-list-group-header');if(!header)return null;const btn=header.querySelector(${JSON.stringify(anchors.ANCHOR_GROUP_NEW_BTN)});if(!btn)return null;btn.scrollIntoView({block:'center'});const r=btn.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  )) as { x: number; y: number } | null;

  if (!coord) {
    throw new AnchorNotFound(
      `找不到项目分组 [${projectName}] 的"新建任务"按钮`,
    );
  }

  logger.debug(`newTask: 点击 [${projectName}] 分组新建按钮 at ${coord.x.toFixed(0)},${coord.y.toFixed(0)}`);

  // 真实点击（mouseMoved 自带 hover，按钮 CSS hover 态不影响事件命中）
  for (const ev of [
    { type: 'mouseMoved', x: coord.x, y: coord.y, buttons: 0 },
    { type: 'mousePressed', x: coord.x, y: coord.y, button: 'left', clickCount: 1, buttons: 0 },
    { type: 'mouseReleased', x: coord.x, y: coord.y, button: 'left', clickCount: 1, buttons: 0 },
  ]) {
    await client.send('Input.dispatchMouseEvent', ev);
  }

  // 等草稿会话输入框就绪（点击后自动聚焦）
  await pollUntil(
    () => evalExpression(client,
      `(()=>{const el=document.querySelector(${JSON.stringify(anchors.ANCHOR_INPUT)});return el&&document.activeElement===el?'ready':'';})()`,
    ) as Promise<string>,
    (s: string) => s === 'ready',
    5000,
  );

  // 注入首条话术并发送（草稿输入框为空，无需清空）
  await client.send('Input.insertText', { text: phrase });
  await send(client);
  logger.audit('action_newTask_sent', { projectName, length: phrase.length });

  // 轮询新 sid（首条消息落库后出现，不在旧集合中的）
  const newSid = await pollUntil(
    () => evalExpression(client,
      `(()=>{const ws=document.querySelectorAll(${JSON.stringify(anchors.ANCHOR_TASK_ROW)});return Array.from(ws).map(w=>w.getAttribute('data-session-id')).filter(s=>!${JSON.stringify(oldSids)}.includes(s));})()`,
    ) as Promise<string[]>,
    (arr: string[]) => arr.length > 0,
    timeoutMs,
  );

  const sid = newSid[0];
  logger.audit('action_newTask', { projectName, sid, oldCount: oldSids.length });
  return sid;
}

/**
 * deleteTask(sid) — 菜单序列删除任务
 * 路径：navigate → 合成 click 更多菜单 → 删除项 → 弹窗确认
 * 注意：taskMoreBtn 常态 display:none（hover 才显示），CDP 坐标点击会点空，
 * 必须用合成 click（React onClick 对 display:none 元素照样响应）。
 */
export async function deleteTask(
  client: CdpClient,
  sid: string,
  timeoutMs = 8000,
): Promise<void> {
  // 1. 切到目标
  await navigateTo(client, sid);

  // 2. 合成 click "更多"菜单按钮（display:none 也可触发）
  const moreResult = (await evalExpression(client,
    `(()=>{const row=document.querySelector('.task-list-row-wrapper[data-session-id="${sid}"]');const more=row&&row.querySelector(${JSON.stringify(anchors.ANCHOR_TASK_MORE_BTN)});if(!more)return 'NO_BTN';more.click();return 'CLICKED';})()`,
  )) as string;
  if (moreResult !== 'CLICKED') {
    throw new AnchorNotFound(`deleteTask: 更多菜单按钮 ${moreResult}`);
  }

  // 3. 轮询菜单出现
  await pollUntil(
    () => evalExpression(client,
      `document.querySelectorAll(${JSON.stringify(anchors.ANCHOR_MENU_ITEM)}).length`,
    ) as Promise<number>,
    (n: number) => n > 0,
    timeoutMs,
  );

  // 4. 合成 click "删除任务"菜单项（按文本匹配）
  const delResult = (await evalExpression(client,
    `(()=>{const items=Array.from(document.querySelectorAll(${JSON.stringify(anchors.ANCHOR_MENU_ITEM)}));const del=items.find(m=>m.textContent.trim()==='删除任务');if(!del)return 'NO_ITEM';del.click();return 'CLICKED';})()`,
  )) as string;
  if (delResult !== 'CLICKED') {
    throw new AnchorNotFound(`deleteTask: 删除菜单项 ${delResult}`);
  }

  // 5. 轮询弹窗出现
  await pollUntil(
    () => evalExpression(client,
      `(()=>{const t=Array.from(document.querySelectorAll('*')).find(e=>e.children.length===0&&e.textContent.trim()==='确认删除');return t?1:0;})()`,
    ) as Promise<number>,
    (n: number) => n === 1,
    timeoutMs,
  );

  // 6. 合成 click 弹窗内"删除"确认按钮（按文本匹配，避免依赖哈希 class）
  const confirmResult = (await evalExpression(client,
    `(()=>{const title=Array.from(document.querySelectorAll('*')).find(e=>e.children.length===0&&e.textContent.trim()==='确认删除');if(!title)return 'NO_DIALOG';let cur=title,box=null;for(let i=0;i<10&&cur;i++){const c=(cur.className||'').toString();if(/dialog|modal|overlay|popup/i.test(c)){box=cur;break;}cur=cur.parentElement;}const scope=box||document;const del=Array.from(scope.querySelectorAll('button')).find(b=>b.textContent.trim()==='删除');if(!del)return 'NO_BTN';del.click();return 'CLICKED';})()`,
  )) as string;
  if (confirmResult !== 'CLICKED') {
    throw new AnchorNotFound(`deleteTask: 弹窗确认按钮 ${confirmResult}`);
  }

  // 7. 轮询 sid 消失
  await pollUntil(
    () => evalExpression(client,
      `document.querySelector('.task-list-row-wrapper[data-session-id="${sid}"]')?1:0`,
    ) as Promise<number>,
    (n: number) => n === 0,
    timeoutMs,
  );

  logger.audit('action_deleteTask', { sid });
}

/** detectDialog() — 扫描非预期弹窗（按"确认删除"标题文本，不依赖哈希 class） */
export async function detectDialog(client: CdpClient): Promise<'present' | 'absent'> {
  const result = (await evalExpression(client,
    `(()=>{const t=Array.from(document.querySelectorAll('*')).find(e=>e.children.length===0&&e.textContent.trim()==='确认删除');return t?'present':'absent';})()`,
  )) as 'present' | 'absent';
  logger.debug(`detectDialog: ${result}`);
  return result;
}
