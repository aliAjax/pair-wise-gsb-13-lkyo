// 核心交接流程冒烟：定稿 → 逐项接收/退回 → 签收 → 补记/撤销/改派 → 断电续接
import { createPinia, setActivePinia } from "pinia";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const mem = new MemStorage();
(globalThis as any).localStorage = mem;

const { useStore } = await import("../src/store.ts");

let pass = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error("FAIL: " + name);
  console.log("PASS:", name);
  pass++;
}

setActivePinia(createPinia());
const store = useStore();

// 种子：sh_seed_1 草稿，3 个事项
const sh0 = store.selectedSheet!;
check("种子单为草稿", sh0.status === "草稿");
check("种子单有3个事项", sh0.items.length === 3);

// 草稿期交班人继续处理
store.addItem(sh0.id, { kind: "其他", title: "测试新增事项", amount: 10, detail: "x" });
check("草稿可继续新增事项", sh0.items.length === 4);

// 定稿
let err = store.finalize(sh0.id);
check("定稿无错误", err === null);
check("定稿成功", sh0.status === "定稿");
check("未决定事项变为待接棒", sh0.items.every((i) => i.status === "待接棒"));

// 定稿后不能再改进展/新增
store.addItem(sh0.id, { kind: "其他", title: "不该存在", amount: 1, detail: "" });
check("定稿后不能新增", sh0.items.length === 4);

// 逐项：接收前2，退回1，新补记的也接收
const ids = sh0.items.map((i) => i.id);
err = store.decideItem(sh0.id, ids[0], true, "清楚");
check("接收第1项无错误", err === null);
err = store.decideItem(sh0.id, ids[1], true, "");
check("接收第2项无错误", err === null);
err = store.decideItem(sh0.id, ids[2], false, "凭证不足");
check("退回第3项无错误", err === null);
err = store.decideItem(sh0.id, ids[3], false, "");
check("退回不填原因被拒绝", err !== null);
err = store.decideItem(sh0.id, ids[3], true, "");
check("改为接收成功", err === null);

check("第1项责任转到新班次", sh0.items[0].ownerShiftId === sh0.toShiftId);
check("退回项责任留原班次", sh0.items[2].ownerShiftId === sh0.fromShiftId);
check("已接收项不能重复操作", store.decideItem(sh0.id, ids[0], true, "") !== null);

// 还有0项待处理才能签收
err = store.sign(sh0.id);
check("签收无错误", err === null);
check("状态已签收", sh0.status === "已签收");
check("签收时间有记录", sh0.signedAt !== null);

// 补记 → 新单
const add = store.reinit(sh0.id, "补记", { newItems: [{ kind: "油款", title: "漏记的油款", amount: 500, detail: "" }], note: "" });
check("补记返回新单对象", typeof add !== "string");
const addSheet = add as any;
check("补记单为定稿状态", addSheet.status === "定稿");
check("补记单指向原单", addSheet.parentId === sh0.id && addSheet.reinitType === "补记");
check("原单仍为已签收且记录保留", sh0.status === "已签收" && sh0.items.length === 4);

// 撤销：只能选已接收项
const revoke = store.reinit(sh0.id, "撤销", { itemIds: [ids[2]], note: "x" });
check("撤销已退回项被拒绝", typeof revoke === "string");
const revoke2 = store.reinit(sh0.id, "撤销", { itemIds: [ids[0]], note: "错收" });
check("撤销已接收项成功", typeof revoke2 !== "string");
const revokeSheet = revoke2 as any;
// 接棒人同意撤销 → 事项回到原班次
store.decideItem(revokeSheet.id, revokeSheet.items[0].id, true, "同意");
check("同意撤销后事项回到原班次", revokeSheet.items[0].ownerShiftId === sh0.fromShiftId);

// 改派：目标班次不能是原交班班次
const rep = store.reinit(sh0.id, "改派", { itemIds: [ids[1]], toShiftId: sh0.fromShiftId, note: "x" });
check("改派给自己班次被拒绝", typeof rep === "string");
const other = store.ensureShift("2099-01-01", "早班", "新人");
const rep2 = store.reinit(sh0.id, "改派", { itemIds: [ids[1]], toShiftId: other.id, note: "设备问题归维修班" });
check("改派成功", typeof rep2 !== "string");
check("改派单目标班次更新", (rep2 as any).toShiftId === other.id);

// 退回重交
const back = store.reinit(sh0.id, "退回重交", { itemIds: [ids[2]], note: "补充凭证已上传" });
check("退回重交成功", typeof back !== "string");

// 断电续接：重新从 localStorage 装载（模拟关机重开）
setActivePinia(createPinia());
const store2 = useStore();
const resumed = store2.sheets.find((s) => s.id === addSheet.id)!;
check("重开后补记单仍在且仍为定稿", !!resumed && resumed.status === "定稿");
const signed = store2.sheets.find((s) => s.id === sh0.id)!;
check("重开后已签收单及其已接收项保留", signed.status === "已签收" && signed.items[0].status === "已接收");
check("已接收项的责任方没有丢失", signed.items[0].ownerShiftId === signed.toShiftId);

// 同一交班班次再发起 → 续接而不是重开（有定稿单时）
const again = store2.createDraftSheet(sh0.fromShiftId, sh0.toShiftId);
check("再次发起时续接已有未完成单（不重开）", again.resumed === true && again.sheet!.status === "定稿");

// 旧班次补录：从未开过单的班次
const old = store2.ensureShift("2020-02-02", "早班", "老员工");
const miss = store2.openMissingSheet(old.id, null);
check("旧班次可补开草稿单", miss.status === "草稿" && miss.origin === "补录");
check("补录单自动带出下一班（次日早班→中班同日）", miss.toShiftId !== miss.fromShiftId);

console.log(`\n全部 ${pass} 项冒烟检查通过`);
