import { describe, expect, it } from "vitest";
import type { Database } from "../types";
import { HandoverService, isOpen } from "./service";

let clock = 0;
function makeService(db?: Database) {
  const database: Database = db ?? { orders: [], shifts: [] };
  const service = new HandoverService(database, {
    now: () => new Date(2026, 8, 29, 14, clock++).toISOString(),
    uuid: () => `id-${clock}-${Math.floor(Math.random() * 1e6)}`
  });
  return { service, database };
}

const cashItem = { kind: "cash" as const, title: "当班油款 ¥18,640", detail: "现金+电子支付", amount: 18640 };
const deviceItem = { kind: "device" as const, title: "3号枪键盘卡顿", detail: "已报修" };
const refundItem = { kind: "refund" as const, title: "顾客退款 ¥260", detail: "凭证待补", amount: 260 };

function fullLifecycle() {
  const ctx = makeService();
  ctx.service.currentActor = "王强";
  const order = ctx.service.createOrder({
    shiftDate: "2026-09-29",
    shiftSlot: "早班",
    outgoing: "王强",
    incoming: "李娜"
  });
  ctx.service.addItem(order.id, cashItem);
  ctx.service.addItem(order.id, deviceItem);
  ctx.service.addItem(order.id, refundItem);
  ctx.service.finalize(order.id);
  ctx.service.currentActor = "李娜";
  return { ...ctx, order };
}

describe("定稿前：交班人继续处理", () => {
  it("只有交班人能登记/删除草稿事项", () => {
    const { service } = makeService();
    service.currentActor = "王强";
    const order = service.createOrder({
      shiftDate: "2026-09-29",
      shiftSlot: "早班",
      outgoing: "王强",
      incoming: "李娜"
    });
    service.currentActor = "李娜";
    expect(() => service.addItem(order.id, cashItem)).toThrow("只有交班人");

    service.currentActor = "王强";
    const item = service.addItem(order.id, cashItem);
    service.removeItem(order.id, item.id);
    expect(order.items).toHaveLength(0);
  });

  it("空单不能定稿；定稿后不能再登记或删除", () => {
    const { service } = makeService();
    service.currentActor = "王强";
    const order = service.createOrder({
      shiftDate: "2026-09-29",
      shiftSlot: "早班",
      outgoing: "王强",
      incoming: "李娜"
    });
    expect(() => service.finalize(order.id)).toThrow("不能定稿空单");

    const item = service.addItem(order.id, cashItem);
    service.finalize(order.id);
    expect(order.status).toBe("finalized");
    expect(() => service.addItem(order.id, deviceItem)).toThrow("已定稿");
    expect(() => service.removeItem(order.id, item.id)).toThrow("已定稿");
    // 定稿由交班人操作，接棒人不能定稿
    service.currentActor = "李娜";
    const draft = service.createOrder({
      shiftDate: "2026-09-30",
      shiftSlot: "早班",
      outgoing: "王强",
      incoming: "李娜"
    });
    expect(() => service.finalize(draft.id)).toThrow("交班人");
  });
});

describe("定稿后：接棒人逐项接收或退回", () => {
  it("只有接棒人能接收/退回，且必须逐项处理完才能签收", () => {
    const { service, order } = fullLifecycle();
    // 交班人不能接收
    service.currentActor = "王强";
    expect(() => service.acceptItem(order.id, order.items[0].id, "")).toThrow("只有接棒人");

    service.currentActor = "李娜";
    service.acceptItem(order.id, order.items[0].id, "账实一致");
    expect(order.items[0].status).toBe("accepted");

    // 接收结果不可更改
    expect(() => service.rejectItem(order.id, order.items[0].id, "改主意")).toThrow("不可更改");

    // 退回必须填原因
    expect(() => service.rejectItem(order.id, order.items[2].id, " ")).toThrow("退回必须填写原因");
    service.rejectItem(order.id, order.items[2].id, "凭证不全");
    expect(order.items[2].status).toBe("rejected");

    // 还有待处理项，不能签收
    expect(() => service.sign(order.id, "")).toThrow("未接收/退回");

    service.acceptItem(order.id, order.items[1].id, "");
    service.sign(order.id, "整单无误");
    expect(order.status).toBe("signed");
    expect(order.events[order.events.length - 1].action).toBe("签收交接单");
  });

  it("退回项签收后仍归交班班次，交班人可随时闭环登记", () => {
    const { service, order } = fullLifecycle();
    service.currentActor = "李娜";
    service.rejectItem(order.id, order.items[2].id, "凭证不全");
    service.acceptItem(order.id, order.items[0].id, "");
    service.acceptItem(order.id, order.items[1].id, "");
    service.sign(order.id, "");

    // 接棒人不能闭环退回项
    expect(() => service.resolveRejected(order.id, order.items[2].id, "已退")).toThrow("交班人");
    service.currentActor = "王强";
    service.resolveRejected(order.id, order.items[2].id, "已联系顾客原路退回 ¥260");
    expect(order.items[2].resolved).toBe(true);
    // 原项状态仍是 rejected：责任没随签收转走
    expect(order.items[2].status).toBe("rejected");
  });
});

describe("定稿后的补记/撤销/改派：重新发起，原记录保留", () => {
  it("补记生成修订单，走完流程签收后原单保留并追加事件", () => {
    const { service, database, order } = fullLifecycle();
    service.currentActor = "李娜";
    service.acceptItem(order.id, order.items[0].id, "");
    service.acceptItem(order.id, order.items[1].id, "");
    service.acceptItem(order.id, order.items[2].id, "");
    service.sign(order.id, "");

    // 草稿不能直接改：对已签收单只能发修订单
    const amendment = service.createAmendment({
      type: "supplement",
      sourceOrderId: order.id,
      outgoing: "李娜",
      incoming: "赵磊",
      reason: "夜间盘库发现少登记一笔退款",
      item: { kind: "refund", title: "补记：顾客刘师傅退款 ¥150", detail: "工号凭证 #88", amount: 150 }
    });
    expect(amendment.kind).toBe("amendment");
    expect(amendment.items[0].amendmentOf).toBe(order.id);

    // 原单仍保持已签收、原事项不变
    expect(order.status).toBe("signed");
    expect(order.items).toHaveLength(3);

    // 修订单要重新定稿 → 逐项接收 → 签收
    service.finalize(amendment.id);
    service.currentActor = "赵磊";
    service.acceptItem(amendment.id, amendment.items[0].id, "核实无误");
    service.sign(amendment.id, "补记接收");

    expect(order.events.some((e) => e.action === "补记修订单已签收")).toBe(true);
    expect(database.orders).toContain(order);
  });

  it("撤销/改派只能针对已接收事项；签收后在原记录打标且保留原文", () => {
    const { service, order } = fullLifecycle();
    service.currentActor = "李娜";
    service.acceptItem(order.id, order.items[0].id, "");
    service.rejectItem(order.id, order.items[1].id, "厂家未到无法交接");
    service.acceptItem(order.id, order.items[2].id, "");
    service.sign(order.id, "");

    // 退回项不能改派
    expect(() =>
      service.createAmendment({
        type: "reassign",
        sourceOrderId: order.id,
        sourceItemId: order.items[1].id,
        outgoing: "李娜",
        incoming: "赵磊",
        reason: "x",
        reassignTo: "赵磊"
      })
    ).toThrow("只有已接收");

    // 改派缺目标
    expect(() =>
      service.createAmendment({
        type: "reassign",
        sourceOrderId: order.id,
        sourceItemId: order.items[0].id,
        outgoing: "李娜",
        incoming: "赵磊",
        reason: "站长决定"
      })
    ).toThrow("改派必须填写目标");

    const reassign = service.createAmendment({
      type: "reassign",
      sourceOrderId: order.id,
      sourceItemId: order.items[0].id,
      outgoing: "李娜",
      incoming: "赵磊",
      reason: "站长决定",
      reassignTo: "赵磊/晚班"
    });
    service.finalize(reassign.id);
    service.currentActor = "赵磊";
    service.acceptItem(reassign.id, reassign.items[0].id, "接收");
    service.sign(reassign.id, "");

    const original = order.items[0];
    expect(original.reassignedTo).toBe("赵磊/晚班");
    expect(original.status).toBe("accepted"); // 原记录保留
    expect(original.title).toContain("油款");
    expect(original.reassignedByOrder).toBe(reassign.bizNo);

    // 撤销
    service.currentActor = "李娜";
    const revoke = service.createAmendment({
      type: "revoke",
      sourceOrderId: order.id,
      sourceItemId: order.items[2].id,
      outgoing: "李娜",
      incoming: "王强",
      reason: "重复登记"
    });
    service.finalize(revoke.id);
    service.currentActor = "王强";
    service.acceptItem(revoke.id, revoke.items[0].id, "确认重复");
    service.sign(revoke.id, "");
    expect(order.items[2].revokedAt).toBeTruthy();
    expect(order.items[2].detail).toContain("凭证待补"); // 原文保留
  });

  it("同类型修订单进行中不能重复发起", () => {
    const { service, order } = fullLifecycle();
    service.currentActor = "李娜";
    order.items.forEach((i) => service.acceptItem(order.id, i.id, ""));
    service.sign(order.id, "");
    service.createAmendment({
      type: "revoke",
      sourceOrderId: order.id,
      sourceItemId: order.items[0].id,
      outgoing: "李娜",
      incoming: "王强",
      reason: "第一次"
    });
    expect(() =>
      service.createAmendment({
        type: "revoke",
        sourceOrderId: order.id,
        sourceItemId: order.items[0].id,
        outgoing: "李娜",
        incoming: "王强",
        reason: "第二次"
      })
    ).toThrow("已有进行中的修订单");
  });
});

describe("作废与唯一性", () => {
  it("只有草稿可作废；同班次有效常规单唯一；旧班次可补建", () => {
    const { service } = makeService();
    service.currentActor = "王强";
    const order = service.createOrder({
      shiftDate: "2026-09-28",
      shiftSlot: "晚班",
      outgoing: "王强",
      incoming: "赵磊"
    });
    service.addItem(order.id, cashItem);
    service.finalize(order.id);
    expect(() => service.voidDraft(order.id, "错了")).toThrow("定稿后不能撤销");

    // 定稿/签收中的班次不能重开
    expect(() =>
      service.createOrder({
        shiftDate: "2026-09-28",
        shiftSlot: "晚班",
        outgoing: "王强",
        incoming: "赵磊"
      })
    ).toThrow("已有进行中的交接单");

    // 另一个从无单据的旧班次可以补建
    const backfill = service.createOrder({
      shiftDate: "2026-09-25",
      shiftSlot: "中班",
      outgoing: "李娜",
      incoming: "赵磊",
      backfilled: true
    });
    expect(backfill.backfilled).toBe(true);
    expect(backfill.status).toBe("draft");

    // 草稿作废后同班次可以再开（记录仍保留）
    const draft2 = service.createOrder({
      shiftDate: "2026-09-29",
      shiftSlot: "早班",
      outgoing: "王强",
      incoming: "李娜"
    });
    service.voidDraft(draft2.id, "开错了");
    expect(draft2.status).toBe("void");
    const again = service.createOrder({
      shiftDate: "2026-09-29",
      shiftSlot: "早班",
      outgoing: "王强",
      incoming: "李娜"
    });
    expect(again.status).toBe("draft");
  });
});

describe("电脑中途关机重开：续接未完成单，不重开不丢项", () => {
  it("序列化重建后：已接收项保留、待处理项可继续、已签收终态不动", () => {
    const { service, database, order } = fullLifecycle();
    service.currentActor = "李娜";
    service.acceptItem(order.id, order.items[0].id, "账实一致");
    service.rejectItem(order.id, order.items[2].id, "凭证不全");
    // 此时模拟关机：只持久化，未签收
    expect(isOpen(order)).toBe(true);
    const snapshot = JSON.stringify(database);

    // ---- 重开：同一份数据恢复 ----
    const restored: Database = JSON.parse(snapshot);
    const ctx2 = makeService(restored);
    const resumed = ctx2.database.orders.find((o) => o.id === order.id)!;
    expect(isOpen(resumed)).toBe(true);
    expect(resumed.status).toBe("finalized");
    expect(resumed.items[0].status).toBe("accepted"); // 已接收项没丢、没重置
    expect(resumed.items[0].decisionNote).toBe("账实一致");
    expect(resumed.items[2].status).toBe("rejected");
    expect(resumed.items[1].status).toBe("pending"); // 可继续处理

    // 不能重开一张新单
    ctx2.service.currentActor = "李娜";
    expect(() =>
      ctx2.service.createOrder({
        shiftDate: resumed.shiftDate,
        shiftSlot: resumed.shiftSlot,
        outgoing: resumed.outgoing,
        incoming: resumed.incoming
      })
    ).toThrow("请直接续接");

    // 续接收尾
    ctx2.service.acceptItem(resumed.id, resumed.items[1].id, "继续接收");
    ctx2.service.sign(resumed.id, "重启后签收");
    expect(resumed.status).toBe("signed");
  });
});
