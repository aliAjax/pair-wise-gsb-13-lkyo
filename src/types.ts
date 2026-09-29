export type ShiftSlot = "早班" | "中班" | "晚班";
export const SHIFT_SLOTS: readonly ShiftSlot[] = ["早班", "中班", "晚班"] as const;
export const SLOT_START: Record<ShiftSlot, string> = {
  早班: "08:00",
  中班: "16:00",
  晚班: "00:00",
};
export const SLOT_END: Record<ShiftSlot, string> = {
  早班: "16:00",
  中班: "24:00",
  晚班: "08:00",
};

export type ItemKind = "油款" | "设备异常" | "顾客退款" | "其他";
export const ITEM_KINDS: readonly ItemKind[] = ["油款", "设备异常", "顾客退款", "其他"] as const;

/** 事项在交接单内的状态 */
export type ItemStatus = "待处理" | "处理中" | "待接棒" | "已接收" | "已退回";

/** 交接单状态：草稿（交班人继续处理）→ 定稿（逐项接收/退回）→ 签收（责任转移） */
export type SheetStatus = "草稿" | "定稿" | "已签收";

/** 定稿后的补记 / 撤销 / 改派 / 退回重交：一律重新发起一张新单 */
export type ReinitType = "补记" | "撤销" | "改派" | "退回重交";

export interface HandoverItem {
  id: string;
  kind: ItemKind;
  title: string;
  /** 金额（元），油款/退款类使用 */
  amount: number | null;
  detail: string;
  /** 交班人在定稿前持续跟进的进展 */
  progressNote: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  /** 已接收 / 已退回 的处置说明 */
  decisionNote: string;
  decidedAt: string | null;
  /** 事项责任方班次 id：签收后已接收→新班次，已退回→原班次 */
  ownerShiftId: string;
}

export interface AuditLog {
  id: string;
  at: string;
  operator: string;
  role: "交班人" | "接棒人" | "系统";
  action: string;
}

export interface HandoverSheet {
  id: string;
  code: string;
  fromShiftId: string;
  toShiftId: string;
  /** 发起类型：正常交接 / 补录（给旧班次补开） */
  origin: "正常" | "补录";
  status: SheetStatus;
  items: HandoverItem[];
  logs: AuditLog[];
  createdAt: string;
  finalizedAt: string | null;
  signedAt: string | null;
  /** 补记/撤销/改派/退回重交 重新发起时，指向来源单（原记录继续保留） */
  parentId: string | null;
  reinitType: ReinitType | null;
  reinitNote: string;
  /** 改派时指向新的接棒班次（与 toShiftId 相同，保留语义字段） */
  reassignedToShiftId: string | null;
}

export interface PersistShape {
  version: number;
  shifts: ShiftInfo[];
  sheets: HandoverSheet[];
  currentShiftId: string;
  operatorName: string;
  operatorRole: "交班人" | "接棒人";
  selectedSheetId: string | null;
}

export interface ShiftInfo {
  id: string;
  date: string;
  slot: ShiftSlot;
  leader: string;
  note: string;
}
