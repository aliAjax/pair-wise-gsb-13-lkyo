import type {
  Database,
  EventEntry,
  HandoverItem,
  NewAmendmentInput,
  NewItemInput,
  NewOrderInput,
  ShiftOrder
} from "../types";
import { ITEM_KIND_LABEL } from "../types";

export class HandoverError extends Error {}

interface Hooks {
  now: () => string;
  uuid: () => string;
}

const DEFAULT_HOOKS: Hooks = {
  now: () => new Date().toISOString(),
  uuid: () => crypto.randomUUID()
};

/** 进行中（未签收、未作废）的单据：重启后需要续接 */
export function isOpen(order: ShiftOrder): boolean {
  return order.status === "draft" || order.status === "finalized";
}

function ymd(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

/**
 * 交接单状态机服务。
 * 所有变更只通过本服务发生，并在每次操作后写入事件流（审计留痕）。
 */
export class HandoverService {
  constructor(
    private db: Database,
    private hooks: Hooks = DEFAULT_HOOKS
  ) {}

  private event(action: string, detail?: string): EventEntry {
    return { at: this.hooks.now(), by: this.actor(), action, detail };
  }

  /** 当前操作人由调用方注入（UI 顶栏切换身份） */
  currentActor = "";

  private actor(): string {
    if (!this.currentActor) throw new HandoverError("未选择当前操作人");
    return this.currentActor;
  }

  private requireOrder(id: string): ShiftOrder {
    const order = this.db.orders.find((item) => item.id === id);
    if (!order) throw new HandoverError("交接单不存在（可能已在其他终端处理）");
    return order;
  }

  private requireItem(order: ShiftOrder, itemId: string): HandoverItem {
    const item = order.items.find((entry) => entry.id === itemId);
    if (!item) throw new HandoverError("交接事项不存在");
    return item;
  }

  private normalOrder(date: string, slot: string): ShiftOrder | undefined {
    return this.db.orders.find(
      (order) =>
        order.kind === "normal" &&
        order.shiftDate === date &&
        order.shiftSlot === slot &&
        order.status !== "void"
    );
  }

  private nextBizNo(prefix: "HO" | "AM"): string {
    const day = ymd(this.hooks.now());
    const count = this.db.orders.filter((order) => order.bizNo.includes(day)).length;
    return `${prefix}-${day}-${String(count + 1).padStart(2, "0")}`;
  }

  private assertNoOpenAmendment(orderId: string, type: string, itemId?: string) {
    const dup = this.db.orders.find(
      (order) =>
        order.kind === "amendment" &&
        order.amendmentType === type &&
        order.sourceOrderId === orderId &&
        (itemId ? order.sourceItemId === itemId : true) &&
        isOpen(order)
    );
    if (dup) throw new HandoverError(`已有进行中的修订单 ${dup.bizNo}，请先完成或作废，不能重复发起`);
  }

  /** 新建交接单（含“补建”）；同一班次只允许一张有效常规单 */
  createOrder(input: NewOrderInput): ShiftOrder {
    const by = this.actor();
    const existing = this.normalOrder(input.shiftDate, input.shiftSlot);
    if (existing) {
      if (isOpen(existing)) {
        throw new HandoverError(`该班次已有进行中的交接单 ${existing.bizNo}，请直接续接，不能重开`);
      }
      throw new HandoverError(
        `该班次交接单 ${existing.bizNo} 已定稿/签收；定稿后事项请用“补记/撤销/改派”重新发起`
      );
    }

    const now = this.hooks.now();
    const order: ShiftOrder = {
      id: this.hooks.uuid(),
      bizNo: this.nextBizNo("HO"),
      shiftDate: input.shiftDate,
      shiftSlot: input.shiftSlot,
      outgoing: input.outgoing,
      incoming: input.incoming,
      status: "draft",
      kind: "normal",
      backfilled: input.backfilled,
      items: [],
      events: [],
      createdAt: now
    };
    order.events.push({
      at: now,
      by,
      action: input.backfilled ? "补建交接单" : "创建交接单",
      detail: `${input.shiftDate} ${input.shiftSlot}：${input.outgoing} → ${input.incoming}`
    });
    this.db.orders.push(order);

    const shiftExists = this.db.shifts.some(
      (shift) => shift.date === input.shiftDate && shift.slot === input.shiftSlot
    );
    if (!shiftExists) {
      this.db.shifts.push({
        date: input.shiftDate,
        slot: input.shiftSlot,
        outgoing: input.outgoing,
        incoming: input.incoming
      });
    }
    return order;
  }

  /** 定稿前：交班人继续登记/删除待办事项 */
  addItem(orderId: string, input: NewItemInput): HandoverItem {
    const by = this.actor();
    const order = this.requireOrder(orderId);
    if (order.status !== "draft") {
      throw new HandoverError("交接单已定稿，不能再补事项；请在定稿记录上发起“补记”修订单");
    }
    if (order.outgoing !== by) {
      throw new HandoverError("只有交班人在定稿前可以登记事项");
    }
    const item: HandoverItem = {
      id: this.hooks.uuid(),
      kind: input.kind,
      title: input.title.trim(),
      detail: input.detail.trim(),
      amount: input.amount,
      status: "pending",
      createdAt: this.hooks.now(),
      createdBy: by
    };
    if (!item.title) throw new HandoverError("事项标题不能为空");
    order.items.push(item);
    order.events.push(this.event("登记事项", `${ITEM_KIND_LABEL[item.kind]}：${item.title}`));
    return item;
  }

  removeItem(orderId: string, itemId: string): void {
    const by = this.actor();
    const order = this.requireOrder(orderId);
    if (order.status !== "draft") throw new HandoverError("已定稿，事项不可删除，请走退回/修订单");
    if (order.outgoing !== by) throw new HandoverError("只有交班人可以删除草稿事项");
    const item = this.requireItem(order, itemId);
    order.items = order.items.filter((entry) => entry.id !== itemId);
    order.events.push(this.event("删除草稿事项", item.title));
  }

  /** 定稿：未结事项锁定成单，交班人停止处理，等待逐项接收 */
  finalize(orderId: string): ShiftOrder {
    const by = this.actor();
    const order = this.requireOrder(orderId);
    if (order.status !== "draft") throw new HandoverError("只有草稿单可以定稿");
    if (order.outgoing !== by) throw new HandoverError("定稿由交班人操作");
    if (order.items.length === 0) throw new HandoverError("没有未结事项，不能定稿空单");
    order.status = "finalized";
    order.finalizedAt = this.hooks.now();
    order.events.push(this.event("定稿交接单", `共 ${order.items.length} 项，等待接棒人逐项接收/退回`));
    return order;
  }

  /** 接棒人逐项接收：接收后该事项责任即转到新班次，任何情况下不可回退 */
  acceptItem(orderId: string, itemId: string, note: string): HandoverItem {
    const by = this.actor();
    const order = this.requireOrder(orderId);
    if (order.status !== "finalized") throw new HandoverError("只有已定稿的单据可以逐项接收");
    if (order.incoming !== by) throw new HandoverError("只有接棒人可以接收/退回");
    const item = this.requireItem(order, itemId);
    if (item.status !== "pending") {
      throw new HandoverError(`该事项已${item.status === "accepted" ? "接收" : "退回"}，结果不可更改`);
    }
    item.status = "accepted";
    item.decisionNote = note.trim() || undefined;
    item.decidedAt = this.hooks.now();
    item.decidedBy = by;
    order.events.push(this.event("接收事项", item.title));
    return item;
  }

  /** 接棒人退回单项：该事项不随单转移，继续由交班班次负责 */
  rejectItem(orderId: string, itemId: string, reason: string): HandoverItem {
    const by = this.actor();
    const order = this.requireOrder(orderId);
    if (order.status !== "finalized") throw new HandoverError("只有已定稿的单据可以逐项接收");
    if (order.incoming !== by) throw new HandoverError("只有接棒人可以接收/退回");
    if (!reason.trim()) throw new HandoverError("退回必须填写原因");
    const item = this.requireItem(order, itemId);
    if (item.status !== "pending") {
      throw new HandoverError(`该事项已${item.status === "accepted" ? "接收" : "退回"}，结果不可更改`);
    }
    item.status = "rejected";
    item.decisionNote = reason.trim();
    item.decidedAt = this.hooks.now();
    item.decidedBy = by;
    order.events.push(this.event("退回事项", `${item.title}（原因：${reason.trim()}）`));
    return item;
  }

  /** 交班人对退回项闭环登记（定稿/签收后都可登记，责任始终留在交班班次） */
  resolveRejected(orderId: string, itemId: string, note: string): HandoverItem {
    const by = this.actor();
    const order = this.requireOrder(orderId);
    if (!["finalized", "signed"].includes(order.status)) {
      throw new HandoverError("退回项只存在于已定稿/已签收单据");
    }
    if (order.outgoing !== by) throw new HandoverError("退回项由交班人闭环处理");
    const item = this.requireItem(order, itemId);
    if (item.status !== "rejected") throw new HandoverError("只能登记退回项的处理结果");
    if (item.resolved) throw new HandoverError("已闭环，无需重复登记");
    item.resolved = true;
    item.resolvedNote = note.trim() || "已处理";
    item.resolvedAt = this.hooks.now();
    order.events.push(this.event("退回项闭环", `${item.title}：${item.resolvedNote}`));
    return item;
  }

  /** 逐项处理完后签收：接收项责任整体转到新班次；签收即终态，不能重开 */
  sign(orderId: string, signNote: string): ShiftOrder {
    const by = this.actor();
    const order = this.requireOrder(orderId);
    if (order.status !== "finalized") throw new HandoverError("只有已定稿单据可以签收");
    if (order.incoming !== by) throw new HandoverError("签收由接棒人操作");
    const pending = order.items.filter((item) => item.status === "pending");
    if (pending.length > 0) {
      throw new HandoverError(`还有 ${pending.length} 项未接收/退回，逐项处理完才能签收`);
    }
    order.status = "signed";
    order.signedAt = this.hooks.now();
    order.signNote = signNote.trim() || undefined;
    const accepted = order.items.filter((item) => item.status === "accepted").length;
    const rejected = order.items.filter((item) => item.status === "rejected").length;
    order.events.push(
      this.event("签收交接单", `接收 ${accepted} 项（责任转新班次），退回 ${rejected} 项（留交班班次）`)
    );

    // 修订单签收时，把效果落到原记录：原记录保留，仅追加标记与事件
    if (order.kind === "amendment" && order.sourceOrderId) {
      const source = this.db.orders.find((entry) => entry.id === order.sourceOrderId);
      if (source) {
        if (order.amendmentType === "supplement") {
          source.events.push({
            at: order.signedAt,
            by,
            action: "补记修订单已签收",
            detail: `${order.bizNo} 补入事项，责任随修订单转移`
          });
        }
        const target = order.sourceItemId
          ? source.items.find((item) => item.id === order.sourceItemId)
          : undefined;
        if (order.amendmentType === "revoke" && target) {
          target.revokedAt = order.signedAt;
          target.revokedByOrder = order.bizNo;
          source.events.push({
            at: order.signedAt,
            by,
            action: "原事项已撤销（原记录保留）",
            detail: `${target.title}，撤销单 ${order.bizNo}`
          });
        }
        if (order.amendmentType === "reassign" && target) {
          target.reassignedTo = order.items[0]?.title.includes("→")
            ? order.items[0].title.split("→").pop()?.trim()
            : undefined;
          target.reassignedAt = order.signedAt;
          target.reassignedByOrder = order.bizNo;
          source.events.push({
            at: order.signedAt,
            by,
            action: "原事项已改派（原记录保留）",
            detail: `${target.title} → ${target.reassignedTo ?? "?"}，改派单 ${order.bizNo}`
          });
        }
      }
    }
    return order;
  }

  /** 只有草稿可以作废；定稿/签收记录永久保留 */
  voidDraft(orderId: string, reason: string): ShiftOrder {
    const by = this.actor();
    const order = this.requireOrder(orderId);
    if (order.status !== "draft") throw new HandoverError("定稿后不能撤销单据，请发起修订单");
    order.status = "void";
    order.voidedAt = this.hooks.now();
    order.events.push(this.event("作废草稿", reason.trim() || "交班人作废"));
    return order;
  }

  /**
   * 定稿后的补记 / 撤销 / 改派：一律重新发起一张修订单，走完整流程
   * （草稿 → 定稿 → 逐项接收 → 签收），原记录继续保留。
   */
  createAmendment(input: NewAmendmentInput): ShiftOrder {
    const by = this.actor();
    const source = this.requireOrder(input.sourceOrderId);
    if (source.status === "draft") {
      throw new HandoverError("原单尚在草稿阶段，请直接在原单修改，无需发起修订单");
    }
    if (source.status === "void") throw new HandoverError("原单已作废，不能发起修订单");
    this.assertNoOpenAmendment(source.id, input.type, input.sourceItemId);

    let sourceItem: HandoverItem | undefined;
    if (input.sourceItemId) sourceItem = this.requireItem(source, input.sourceItemId);

    if (input.type === "revoke" || input.type === "reassign") {
      if (!sourceItem) throw new HandoverError(`${input.type === "revoke" ? "撤销" : "改派"}必须指定原事项`);
      if (sourceItem.status !== "accepted") {
        throw new HandoverError("只有已接收的事项可以撤销/改派（退回项仍归交班人，无需改派）");
      }
      if (sourceItem.revokedAt) throw new HandoverError("该事项已撤销");
      if (sourceItem.reassignedAt && input.type === "reassign") {
        throw new HandoverError("该事项已改派，如需再改请对最新记录重新发起");
      }
      if (input.type === "reassign" && !input.reassignTo?.trim()) {
        throw new HandoverError("改派必须填写目标人/班组");
      }
    }
    if (input.type === "supplement" && (!input.item || !input.item.title.trim())) {
      throw new HandoverError("补记必须填写事项内容");
    }
    if (!input.reason.trim()) throw new HandoverError("发起修订单必须填写原因");

    const now = this.hooks.now();
    const label =
      input.type === "supplement" ? "补记" : input.type === "revoke" ? "撤销" : "改派";
    const order: ShiftOrder = {
      id: this.hooks.uuid(),
      bizNo: this.nextBizNo("AM"),
      shiftDate: source.shiftDate,
      shiftSlot: source.shiftSlot,
      outgoing: input.outgoing,
      incoming: input.incoming,
      status: "draft",
      kind: "amendment",
      amendmentType: input.type,
      sourceOrderId: source.id,
      sourceItemId: input.sourceItemId,
      sourceSummary: sourceItem
        ? `${ITEM_KIND_LABEL[sourceItem.kind]}｜${sourceItem.title}`
        : `${source.bizNo} 补记`,
      items: [],
      events: [],
      createdAt: now
    };

    if (input.type === "supplement" && input.item) {
      order.items.push({
        id: this.hooks.uuid(),
        kind: input.item.kind,
        title: input.item.title.trim(),
        detail: input.item.detail.trim(),
        amount: input.item.amount,
        status: "pending",
        createdAt: now,
        createdBy: by,
        amendmentOf: source.id
      });
    } else if (sourceItem) {
      order.items.push({
        id: this.hooks.uuid(),
        kind: sourceItem.kind,
        title:
          input.type === "reassign"
            ? `改派：${sourceItem.title} → ${input.reassignTo!.trim()}`
            : `撤销：${sourceItem.title}`,
        detail: `原因：${input.reason.trim()}`,
        amount: sourceItem.amount,
        status: "pending",
        createdAt: now,
        createdBy: by,
        amendmentOf: source.id
      });
    }
    order.events.push({
      at: now,
      by,
      action: `发起${label}修订单`,
      detail: `关联原单 ${source.bizNo}${sourceItem ? ` / ${sourceItem.title}` : ""}；原因：${input.reason.trim()}`
    });
    source.events.push({
      at: now,
      by,
      action: `被发起${label}修订单`,
      detail: order.bizNo
    });
    this.db.orders.push(order);
    return order;
  }
}
