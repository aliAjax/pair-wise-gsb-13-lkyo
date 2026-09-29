import type { Database, NewItemInput, ShiftOrder } from "../types";
import { HandoverService, isOpen } from "./service";

const STORAGE_KEY = "gas-station-handover-v1";

/** 预置数据：含一张“定稿中、逐项接收了一半”的单 —— 刷新/重启后应续接而非重开 */
export function seedDatabase(): Database {
  const today = new Date().toISOString().slice(0, 10);
  const iso = (hour: number, minute = 0) =>
    new Date(`${today}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).toISOString();

  const morningOrder: ShiftOrder = {
    id: "seed-morning-order",
    bizNo: `HO-${today.replace(/-/g, "")}-01`,
    shiftDate: today,
    shiftSlot: "早班",
    outgoing: "王强",
    incoming: "李娜",
    status: "finalized",
    kind: "normal",
    items: [
      {
        id: "seed-item-cash",
        kind: "cash",
        title: "交班营业油款 ¥18,640",
        detail: "现金 7,200 + 电子支付 11,440，备用金 1,000 元在保险柜。",
        amount: 18640,
        status: "accepted",
        createdAt: iso(13, 50),
        createdBy: "王强",
        decidedAt: iso(14, 2),
        decidedBy: "李娜",
        decisionNote: "账实一致，已入柜"
      },
      {
        id: "seed-item-device",
        kind: "device",
        title: "3号加油机键盘 5 号键卡顿",
        detail: "高峰时偶发无响应，已报修，等厂家下午到场。",
        status: "pending",
        createdAt: iso(13, 52),
        createdBy: "王强"
      },
      {
        id: "seed-item-refund",
        kind: "refund",
        title: "顾客张师傅退款 ¥260 待处理",
        detail: "95# 油枪跳枪少加油，顾客已留电话 138****2211，需核实后原路退回。",
        amount: 260,
        status: "rejected",
        createdAt: iso(13, 55),
        createdBy: "王强",
        decidedAt: iso(14, 5),
        decidedBy: "李娜",
        decisionNote: "退款凭证不全，需顾客补支付截图"
      }
    ],
    events: [
      { at: iso(13, 40), by: "王强", action: "创建交接单", detail: `${today} 早班：王强 → 李娜` },
      { at: iso(13, 58), by: "王强", action: "定稿交接单", detail: "共 3 项，等待接棒人逐项接收/退回" },
      { at: iso(14, 2), by: "李娜", action: "接收事项", detail: "交班营业油款 ¥18,640" },
      { at: iso(14, 5), by: "李娜", action: "退回事项", detail: "顾客张师傅退款 ¥260 待处理（原因：退款凭证不全）" }
    ],
    createdAt: iso(13, 40),
    finalizedAt: iso(13, 58)
  };

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const yesterdayOrder: ShiftOrder = {
    id: "seed-yesterday-order",
    bizNo: `HO-${yesterday.replace(/-/g, "")}-01`,
    shiftDate: yesterday,
    shiftSlot: "晚班",
    outgoing: "赵磊",
    incoming: "王强",
    status: "signed",
    kind: "normal",
    items: [
      {
        id: "seed-item-2",
        kind: "device",
        title: "1号机油气回收胶管裂纹已更换",
        detail: "备件号 HJ-09，维修单已存档。",
        status: "accepted",
        createdAt: new Date(`${yesterday}T21:40:00`).toISOString(),
        createdBy: "赵磊",
        decidedAt: new Date(`${yesterday}T22:05:00`).toISOString(),
        decidedBy: "王强"
      }
    ],
    events: [
      {
        at: new Date(`${yesterday}T22:10:00`).toISOString(),
        by: "王强",
        action: "签收交接单",
        detail: "接收 1 项（责任转新班次），退回 0 项（留交班班次）"
      }
    ],
    createdAt: new Date(`${yesterday}T21:30:00`).toISOString(),
    finalizedAt: new Date(`${yesterday}T21:55:00`).toISOString(),
    signedAt: new Date(`${yesterday}T22:10:00`).toISOString()
  };

  return {
    orders: [morningOrder, yesterdayOrder],
    shifts: [
      { date: today, slot: "早班", outgoing: "王强", incoming: "李娜" },
      { date: today, slot: "中班", outgoing: "李娜", incoming: "赵磊" },
      { date: today, slot: "晚班", outgoing: "赵磊", incoming: "王强" },
      { date: yesterday, slot: "晚班", outgoing: "赵磊", incoming: "王强" },
      { date: yesterday, slot: "中班", outgoing: "李娜", incoming: "赵磊" }
    ]
  };
}

export interface LoadResult {
  db: Database;
  recovered: boolean;
  corrupted: boolean;
}

/**
 * 开机/刷新续接：localStorage 里的未完成单原样恢复。
 * 已接收项绝不丢失或重置；解析失败也不覆盖旧数据。
 */
export function loadDatabase(): LoadResult {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDatabase();
    persistDatabase(seeded);
    return { db: seeded, recovered: seeded.orders.some(isOpen), corrupted: false };
  }
  try {
    const db = JSON.parse(raw) as Database;
    if (!Array.isArray(db.orders) || !Array.isArray(db.shifts)) throw new Error("bad shape");
    const recovered = db.orders.some(isOpen);
    return { db, recovered, corrupted: false };
  } catch {
    // 数据损坏：保留原始串，另存备份，不静默吞掉
    localStorage.setItem(`${STORAGE_KEY}.corrupt-${Date.now()}`, raw);
    const seeded = seedDatabase();
    persistDatabase(seeded);
    return { db: seeded, recovered: true, corrupted: true };
  }
}

export function persistDatabase(db: Database): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

export function resetDatabase(): Database {
  const seeded = seedDatabase();
  persistDatabase(seeded);
  return seeded;
}

/** 缺交接单的班次（旧班次没单也能打开，下次换班时据此提示补齐） */
export function shiftsWithoutOrder(db: Database): { date: string; slot: string; outgoing: string; incoming: string }[] {
  return db.shifts
    .filter(
      (shift) =>
        !db.orders.some(
          (order) =>
            order.kind === "normal" &&
            order.shiftDate === shift.date &&
            order.shiftSlot === shift.slot &&
            order.status !== "void"
        )
    )
    .map((shift) => ({ ...shift }))
    .sort((a, b) => (a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date)));
}

export { HandoverService, isOpen };
export type { NewItemInput };
