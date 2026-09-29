/** 班次交接领域模型 */

export type ShiftSlot = "早班" | "中班" | "晚班";

/** 油款 / 设备异常 / 顾客退款 */
export type ItemKind = "cash" | "device" | "refund";

/** 待接收 / 已接收 / 已退回 */
export type ItemStatus = "pending" | "accepted" | "rejected";

/**
 * 交接单状态：
 * draft 草稿（交班人处理中）→ finalized 已定稿（接棒人逐项接收/退回）
 * → signed 已签收（责任转到新班次）；void 已作废（仅草稿可作废，记录保留）
 */
export type OrderStatus = "draft" | "finalized" | "signed" | "void";

/** 定稿后修改一律重新发起：补记 / 撤销 / 改派 */
export type AmendmentType = "supplement" | "revoke" | "reassign";

export type OrderKind = "normal" | "amendment";

export interface HandoverItem {
  id: string;
  kind: ItemKind;
  title: string;
  detail: string;
  /** 油款或退款金额（元） */
  amount?: number;
  status: ItemStatus;
  createdAt: string;
  createdBy: string;
  /** 接棒人接收/退回意见 */
  decisionNote?: string;
  decidedAt?: string;
  decidedBy?: string;
  /** 退回项由交班人闭环处理的登记（定稿/签收后仍可登记，责任不随签收转移） */
  resolved?: boolean;
  resolvedNote?: string;
  resolvedAt?: string;
  /** 由补记修订单带入 */
  amendmentOf?: string;
  /** 已由修订单撤销/改派（原记录保留，仅打标） */
  revokedAt?: string;
  revokedByOrder?: string;
  reassignedTo?: string;
  reassignedAt?: string;
  reassignedByOrder?: string;
}

export interface EventEntry {
  at: string;
  by: string;
  action: string;
  detail?: string;
}

export interface ShiftRef {
  /** YYYY-MM-DD */
  date: string;
  slot: ShiftSlot;
  outgoing: string;
  incoming: string;
}

export interface ShiftOrder {
  id: string;
  bizNo: string;
  shiftDate: string;
  shiftSlot: ShiftSlot;
  outgoing: string;
  incoming: string;
  status: OrderStatus;
  kind: OrderKind;
  amendmentType?: AmendmentType;
  /** 修订单关联的原单/原事项 */
  sourceOrderId?: string;
  sourceItemId?: string;
  sourceSummary?: string;
  backfilled?: boolean;
  items: HandoverItem[];
  events: EventEntry[];
  createdAt: string;
  finalizedAt?: string;
  signedAt?: string;
  signNote?: string;
  voidedAt?: string;
}

export interface Database {
  orders: ShiftOrder[];
  shifts: ShiftRef[];
}

export interface NewItemInput {
  kind: ItemKind;
  title: string;
  detail: string;
  amount?: number;
}

export interface NewOrderInput {
  shiftDate: string;
  shiftSlot: ShiftSlot;
  outgoing: string;
  incoming: string;
  backfilled?: boolean;
}

export interface NewAmendmentInput {
  type: AmendmentType;
  sourceOrderId: string;
  sourceItemId?: string;
  /** 修订单的双方：通常是当前责任持有人 → 接收方 */
  outgoing: string;
  incoming: string;
  reason: string;
  /** 改派目标（人或班组） */
  reassignTo?: string;
  /** 补记的事项内容 */
  item?: NewItemInput;
}

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  cash: "油款",
  device: "设备异常",
  refund: "顾客退款"
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "草稿·交班处理中",
  finalized: "已定稿·逐项接收",
  signed: "已签收·责任已转移",
  void: "已作废"
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: "待接收",
  accepted: "已接收",
  rejected: "已退回"
};

export const AMENDMENT_LABEL: Record<AmendmentType, string> = {
  supplement: "补记",
  revoke: "撤销",
  reassign: "改派"
};
