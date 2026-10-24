// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../logger';

/** 身份表记录 */
export interface OrbitRecord {
  sid: string;
  轨: string;
  角色: 'orbit' | 'arbiter';
  任务名?: string;
  创建时点: string;
  状态: 'active' | 'deleted';
}

/** 身份表 —— sid → 轨道 映射，持久化到 JSON */
export class OrbitTable {
  private map = new Map<string, OrbitRecord>();
  private storePath: string;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        const records = JSON.parse(raw) as OrbitRecord[];
        for (const r of records) {
          // 兼容 v1.1.x 旧记录：无 角色 字段时视为普通轨道
          r.角色 = r.角色 ?? 'orbit';
          this.map.set(r.sid, r);
        }
        logger.info(`身份表已加载: ${this.map.size} 条记录`);
      }
    } catch (e) {
      logger.warn(`身份表加载失败，将重新创建: ${(e as Error).message}`);
    }
  }

  /** 原子写：先写临时文件再 rename */
  private save(): void {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const records = Array.from(this.map.values());
    const tmp = this.storePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8');
    fs.renameSync(tmp, this.storePath);
  }

  /** 新建或更新轨道记录 */
  upsert(sid: string, 轨: string): void {
    const now = new Date().toISOString();
    const existing = this.map.get(sid);
    this.map.set(sid, {
      sid,
      轨,
      角色: 'orbit',
      创建时点: existing?.创建时点 ?? now,
      状态: 'active',
    });
    this.save();
    logger.audit('orbit_upsert', { sid, 轨 });
  }

  /** 绑定仲裁者会话（同一时刻只保留一个） */
  bindArbiter(sid: string, 任务名: string): void {
    for (const r of this.map.values()) {
      if (r.角色 === 'arbiter' && r.状态 === 'active') {
        r.状态 = 'deleted';
      }
    }
    const existing = this.map.get(sid);
    this.map.set(sid, {
      sid,
      轨: '仲裁者',
      角色: 'arbiter',
      任务名,
      创建时点: existing?.创建时点 ?? new Date().toISOString(),
      状态: 'active',
    });
    this.save();
    logger.audit('orbit_bind_arbiter', { sid, 任务名 });
  }

  /** 读当前仲裁者记录 */
  getArbiter(): OrbitRecord | undefined {
    for (const r of this.map.values()) {
      if (r.角色 === 'arbiter' && r.状态 === 'active') return r;
    }
    return undefined;
  }

  /** 按 sid 查记录 */
  getBySid(sid: string): OrbitRecord | undefined {
    return this.map.get(sid);
  }

  /** 按轨号查记录 */
  getBy轨(轨: string): OrbitRecord | undefined {
    for (const r of this.map.values()) {
      if (r.轨 === 轨 && r.状态 === 'active' && r.角色 === 'orbit') return r;
    }
    return undefined;
  }

  /** 标记删除 */
  remove(sid: string): void {
    const r = this.map.get(sid);
    if (r) {
      r.状态 = 'deleted';
      this.save();
      logger.audit('orbit_remove', { sid, 轨: r.轨 });
    }
  }

  /** 列出所有 active 轨道记录（不含仲裁者） */
  list(): OrbitRecord[] {
    return Array.from(this.map.values()).filter(
      (r) => r.状态 === 'active' && r.角色 === 'orbit',
    );
  }
}
