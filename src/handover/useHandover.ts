import { computed, reactive } from "vue";
import { ElMessage } from "element-plus";
import type {
  Database,
  NewAmendmentInput,
  NewItemInput,
  NewOrderInput
} from "../types";
import { HandoverService, isOpen } from "./service";
import { loadDatabase, persistDatabase, resetDatabase, shiftsWithoutOrder } from "./store";

/** 单例式组合：整个应用共用一份持久化数据库 */
const load = loadDatabase();
const db = reactive<Database>(load.db) as Database;
const recoveredOnBoot = load.recovered;
const corruptedOnBoot = load.corrupted;

const service = new HandoverService(db);

function run<T>(action: () => T, success?: string): T | undefined {
  try {
    const result = action();
    persistDatabase(db);
    if (success) ElMessage.success(success);
    return result;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    ElMessage.error(text);
    return undefined;
  }
}

export function useHandover() {
  const orders = computed(() =>
    [...db.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );

  const openOrders = computed(() => orders.value.filter(isOpen));

  const missingShifts = computed(() => shiftsWithoutOrder(db));

  function setActor(name: string) {
    service.currentActor = name;
  }

  return {
    db,
    orders,
    openOrders,
    missingShifts,
    recoveredOnBoot,
    corruptedOnBoot,

    setActor,

    createOrder: (input: NewOrderInput) =>
      run(() => service.createOrder(input), input.backfilled ? "已补建交接单（旧班次）" : "已创建交接单"),
    addItem: (orderId: string, input: NewItemInput) => run(() => service.addItem(orderId, input), "事项已登记（定稿前交班人继续处理）"),
    removeItem: (orderId: string, itemId: string) => run(() => service.removeItem(orderId, itemId), "草稿事项已删除"),
    finalize: (orderId: string) => run(() => service.finalize(orderId), "已定稿：等待接棒人逐项接收/退回"),
    acceptItem: (orderId: string, itemId: string, note: string) =>
      run(() => service.acceptItem(orderId, itemId, note), "已接收，责任转到新班次"),
    rejectItem: (orderId: string, itemId: string, reason: string) =>
      run(() => service.rejectItem(orderId, itemId, reason), "已退回，责任留交班班次"),
    resolveRejected: (orderId: string, itemId: string, note: string) =>
      run(() => service.resolveRejected(orderId, itemId, note), "退回项已闭环"),
    sign: (orderId: string, note: string) => run(() => service.sign(orderId, note), "已签收，交接责任已转移"),
    voidDraft: (orderId: string, reason: string) => run(() => service.voidDraft(orderId, reason), "草稿已作废（记录保留）"),
    createAmendment: (input: NewAmendmentInput) =>
      run(() => service.createAmendment(input), "修订单已发起：需重新定稿、逐项接收并签收"),

    /** 演示“电脑中途关机重开”：重走加载流程，续接未完成单 */
    simulateReboot() {
      const next = loadDatabase();
      db.orders.splice(0, db.orders.length, ...next.db.orders);
      db.shifts.splice(0, db.shifts.length, ...next.db.shifts);
      return next;
    },

    resetAll() {
      const seeded = resetDatabase();
      db.orders.splice(0, db.orders.length, ...seeded.orders);
      db.shifts.splice(0, db.shifts.length, ...seeded.shifts);
      ElMessage.success("已恢复演示数据");
    }
  };
}
