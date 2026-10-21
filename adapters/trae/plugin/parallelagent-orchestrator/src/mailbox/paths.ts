// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as path from 'path';

/** 信箱路径解析 —— 定稿 §9.1 目录结构 */
export class MailboxPaths {
  constructor(public readonly root: string) {}

  /** 转达/ */
  get relayDir(): string {
    return path.join(this.root, '转达');
  }

  /** 回执/ */
  get receiptDir(): string {
    return path.join(this.root, '回执');
  }

  /** 信号/ */
  get signalDir(): string {
    return path.join(this.root, '信号');
  }

  /** 交接手册/ */
  get handoverDir(): string {
    return path.join(this.root, '交接手册');
  }

  /** 就绪/ */
  get readyDir(): string {
    return path.join(this.root, '就绪');
  }

  /** 就绪回执：就绪/T-X.md（启动/回到待命时由轨道写） */
  readyFile(orbit: string): string {
    return path.join(this.readyDir, `${orbit}.md`);
  }

  /** 快照.md */
  get snapshotFile(): string {
    return path.join(this.root, '快照.md');
  }

  /** 契约块.md */
  get contractFile(): string {
    return path.join(this.root, '契约块.md');
  }

  /** 轨道启动手册.md */
  get startupManualFile(): string {
    return path.join(this.root, '轨道启动手册.md');
  }

  /** 转达轮次目录：转达/第N轮/ */
  relayRoundDir(round: number): string {
    return path.join(this.relayDir, `第${round}轮`);
  }

  /** 回执轮次目录：回执/第N轮/ */
  receiptRoundDir(round: number): string {
    return path.join(this.receiptDir, `第${round}轮`);
  }

  /** 转达单路径：转达/第N轮/T-X-v{M}.md（orbit 含 T- 前缀，如 "T-A"） */
  relayFile(round: number, orbit: string, version: number): string {
    return path.join(this.relayRoundDir(round), `${orbit}-v${version}.md`);
  }

  /** 回执路径：回执/第N轮/T-X-v{M}.md（与转达版本号对齐） */
  receiptFile(round: number, orbit: string, version: number): string {
    return path.join(this.receiptRoundDir(round), `${orbit}-v${version}.md`);
  }

  /** 信号文件路径 */
  signalFile(name: string): string {
    return path.join(this.signalDir, name);
  }

  // ── 固定信号文件名 ────────────────────────────────

  get dispatchSignal(): string {
    return this.signalFile('dispatch.signal');
  }
  get dispatchAck(): string {
    return this.signalFile('dispatch.ack');
  }
  get watchAck(): string {
    return this.signalFile('watch.ack');
  }
  get alertSignal(): string {
    return this.signalFile('alert.signal');
  }
  get pingSignal(): string {
    return this.signalFile('ping.signal');
  }
  get pingAck(): string {
    return this.signalFile('ping.ack');
  }
}
