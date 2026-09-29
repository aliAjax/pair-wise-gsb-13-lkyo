import { defineStore } from "pinia";
import {
  AuditLog,
  HandoverItem,
  HandoverSheet,
  ItemKind,
  ItemStatus,
  PersistShape,
  ReinitType,
  ShiftInfo,
  ShiftSlot,
  SHIFT_SLOTS,
  SLOT_END,
  SLOT_START,
} from "./types";

const STORAGE_KEY = "gas-station-handover-v1";

let seq = 0;
export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 晚班跨零点：归到开始日（如 09-28 00:30 的晚班属于 09-27 晚班） */
export function shiftOf(date: Date): { date: string; slot: ShiftSlot } {
  const h = date.getHours();
  if (h < 8) {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    return { date: fmtDate(d), slot: "晚班" };
  }
  if (h < 16) return { date: fmtDate(date), slot: "早班" };
  return { date: fmtDate(date), slot: "中班" };
}

export function nextSlot(slot: ShiftSlot): ShiftSlot {
  const i = SHIFT_SLOTS.indexOf(slot);
  return SHIFT_SLOTS[(i + 1) % SHIFT_SLOTS.length];
}

function shiftLabel(s: ShiftInfo): string {
  return `${s.date} ${s.slot}（${SLOT_START[s.slot]}–${SLOT_END[s.slot]}）负责人 ${s.leader || "未指派"}`;
}

function sheetCode(index: number): string {
  return `HJ${new Date().getFullYear()}${String(index + 1).padStart(4, "0")}`;
}

function makeLog(role: AuditLog["role"], action: string, operator: string): AuditLog {
  return { id: uid("log"), at: nowIso(), operator: operator || role, role, action };
}

/* ---------------- 种子数据：覆盖“旧班次没有交接单”的场景 ---------------- */

function seed(): PersistShape {
  const today = new Date();
  const d1 = new Date(today);
  d1.setDate(d1.getDate() - 1);
  const d2 = new Date(today);

  const date1 = fmtDate(d1);
  const date2 = fmtDate(d2);

  const shifts: ShiftInfo[] = [
    { id: "s_seed_zao1", date: date1, slot: "早班", leader: "王强", note: "" },
    { id: "s_seed_zhong1", date: date1, slot: "中班", leader: "李芳", note: "" },
    { id: "s_seed_wan1", date: date1, slot: "晚班", leader: "赵磊", note: "3号油泵异响，已报修" },
    { id: "s_seed_zao2", date: date2, slot: "早班", leader: "王强", note: "" },
    { id: "s_seed_zhong2", date: date2, slot: "中班", leader: "李芳", note: "" },
  ];

  const t = nowIso();
  const items: HandoverItem[] = [
    {
      id: "i_seed_1",
      kind: "油款",
      title: "本班油款汇总待核对",
      amount: 28640,
      detail: "92# 18420 元 / 95# 10220 元，现金 8640 元已入保险柜，电子支付 20000 元",
      progressNote: "现金与系统已核对一致",
      status: "待接棒",
      createdAt: t,
      updatedAt: t,
      decisionNote: "",
      decidedAt: null,
      ownerShiftId: "s_seed_zao2",
    },
    {
      id: "i_seed_2",
      kind: "设备异常",
      title: "3号加油机油枪自封不灵",
      amount: null,
      detail: "加注偶有跳枪，夜班反馈一次，已贴暂停使用标识",
      progressNote: "已电话报修，厂家说今天上午到场",
      status: "处理中",
      createdAt: t,
      updatedAt: t,
      decisionNote: "",
      decidedAt: null,
      ownerShiftId: "s_seed_zao2",
    },
    {
      id: "i_seed_3",
      kind: "顾客退款",
      title: "会员尾号8821重复扣款退款",
      amount: 300,
      detail: "顾客称被重复扣款 300 元，凭证照片已留存，待门店主管审批",
      progressNote: "等待主管审批后原路退回",
      status: "待接棒",
      createdAt: t,
      updatedAt: t,
      decisionNote: "",
      decidedAt: null,
      ownerShiftId: "s_seed_zao2",
    },
  ];

  const sheets: HandoverSheet[] = [
    {
      id: "sh_seed_1",
      code: "HJ-SEED-0001",
      fromShiftId: "s_seed_zao2",
      toShiftId: "s_seed_zhong2",
      origin: "正常",
      status: "草稿",
      items,
      logs: [makeLog("交班人", "创建交接单，录入 3 项未结事项", "王强")],
      createdAt: t,
      finalizedAt: null,
      signedAt: null,
      parentId: null,
      reinitType: null,
      reinitNote: "",
      reassignedToShiftId: null,
    },
  ];

  return {
    version: 1,
    shifts,
    sheets,
    currentShiftId: "s_seed_zhong2",
    operatorName: "李芳",
    operatorRole: "接棒人",
    selectedSheetId: "sh_seed_1",
  };
}

interface State {
  shifts: ShiftInfo[];
  sheets: HandoverSheet[];
  currentShiftId: string;
  operatorName: string;
  operatorRole: "交班人" | "接棒人";
  selectedSheetId: string | null;
}

export const useStore = defineStore("handover", {
  state: (): State => loadState(),

  getters: {
    currentShift(state): ShiftInfo | undefined {
      return state.shifts.find((s) => s.id === state.currentShiftId);
    },
    selectedSheet(state): HandoverSheet | undefined {
      return state.sheets.find((s) => s.id === state.selectedSheetId) ?? state.sheets[0];
    },
  },

  actions: {
    persist() {
      const data: PersistShape = {
        version: 1,
        shifts: this.shifts,
        sheets: this.sheets,
        currentShiftId: this.currentShiftId,
        operatorName: this.operatorName,
        operatorRole: this.operatorRole,
        selectedSheetId: this.selectedSheetId,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },

    shiftById(id: string): ShiftInfo | undefined {
      return this.shifts.find((s) => s.id === id);
    },

    shiftLabelOf(id: string): string {
      const s = this.shiftById(id);
      return s ? shiftLabel(s) : "（班次不存在）";
    },

    /* ---------------- 班次管理 ---------------- */

    ensureShift(date: string, slot: ShiftSlot, leader = ""): ShiftInfo {
      const found = this.shifts.find((s) => s.date === date && s.slot === slot);
      if (found) return found;
      const s: ShiftInfo = { id: uid("s"), date, slot, leader, note: "" };
      this.shifts.push(s);
      this.persist();
      return s;
    },

    /** 新建交接单草稿；交班班次已有未完成单（草稿或定稿待签收）时不重开，直接续接 */
    createDraftSheet(fromShiftId: string, toShiftId: string): { sheet?: HandoverSheet; error?: string; resumed?: boolean } {
      const existing =
        this.sheets.find((s) => s.fromShiftId === fromShiftId && s.status === "草稿") ??
        this.sheets.find((s) => s.fromShiftId === fromShiftId && s.status === "定稿");
      if (existing) {
        this.selectedSheetId = existing.id;
        this.persist();
        return { sheet: existing, resumed: true };
      }
      if (!toShiftId || toShiftId === fromShiftId) return { error: "请先选择交班班次和接棒班次" };
      const sheet: HandoverSheet = {
        id: uid("sh"),
        code: sheetCode(this.sheets.length),
        fromShiftId,
        toShiftId,
        origin: "正常",
        status: "草稿",
        items: [],
        logs: [makeLog("交班人", "创建交接单，开始录入未结事项（定稿前由交班人继续处理）", this.operatorName)],
        createdAt: nowIso(),
        finalizedAt: null,
        signedAt: null,
        parentId: null,
        reinitType: null,
        reinitNote: "",
        reassignedToShiftId: null,
      };
      this.sheets.unshift(sheet);
      this.selectedSheetId = sheet.id;
      this.persist();
      return { sheet };
    },

    /** 旧班次没有交接单：补开一张草稿单，下次换班时可补齐后交下一班 */
    openMissingSheet(fromShiftId: string, toShiftId: string | null): HandoverSheet {
      const existing = this.sheets.find((s) => s.fromShiftId === fromShiftId && s.status !== "已签收");
      if (existing) {
        this.selectedSheetId = existing.id;
        this.persist();
        return existing;
      }
      let toId = toShiftId;
      if (!toId) {
        const from = this.shiftById(fromShiftId);
        if (from) {
          const ns = nextSlot(from.slot);
          // 晚班的下一班是次日早班
          const nd =
            from.slot === "晚班"
              ? fmtDate(new Date(new Date(`${from.date}T12:00:00`).getTime() + 86400000))
              : from.date;
          toId = this.ensureShift(nd, ns).id;
        }
      }
      const sheet: HandoverSheet = {
        id: uid("sh"),
        code: sheetCode(this.sheets.length),
        fromShiftId,
        toShiftId: toId ?? fromShiftId,
        origin: "补录",
        status: "草稿",
        items: [],
        logs: [makeLog("系统", "为历史无单班次补开交接单（旧班次没有交接单也能打开，下次换班补齐）", this.operatorName)],
        createdAt: nowIso(),
        finalizedAt: null,
        signedAt: null,
        parentId: null,
        reinitType: null,
        reinitNote: "",
        reassignedToShiftId: null,
      };
      this.sheets.unshift(sheet);
      this.selectedSheetId = sheet.id;
      this.persist();
      return sheet;
    },

    setCurrentShift(id: string) {
      this.currentShiftId = id;
      this.persist();
    },

    setOperator(name: string, role: "交班人" | "接棒人") {
      this.operatorName = name;
      this.operatorRole = role;
      this.persist();
    },

    selectSheet(id: string) {
      this.selectedSheetId = id;
      this.persist();
    },

    /* ---------------- 草稿阶段：交班人继续处理 ---------------- */

    addItem(sheetId: string, data: { kind: ItemKind; title: string; amount: number | null; detail: string }) {
      const sheet = this.sheets.find((s) => s.id === sheetId);
      if (!sheet || sheet.status !== "草稿") return;
      const t = nowIso();
      const item: HandoverItem = {
        id: uid("i"),
        kind: data.kind,
        title: data.title,
        amount: data.amount,
        detail: data.detail,
        progressNote: "",
        status: "待处理",
        createdAt: t,
        updatedAt: t,
        decisionNote: "",
        decidedAt: null,
        ownerShiftId: sheet.fromShiftId,
      };
      sheet.items.push(item);
      sheet.logs.push(makeLog("交班人", `新增事项「${data.title}」`, this.operatorName));
      this.persist();
    },

    updateItemProgress(sheetId: string, itemId: string, status: ItemStatus, progressNote: string) {
      const sheet = this.sheets.find((s) => s.id === sheetId);
      if (!sheet || sheet.status !== "草稿") return;
      const item = sheet.items.find((i) => i.id === itemId);
      if (!item) return;
      // 已接收/已退回只存在于定稿后；草稿阶段只能在未决定状态间更新
      if (item.status === "已接收" || item.status === "已退回") return;
      item.status = status;
      item.progressNote = progressNote;
      item.updatedAt = nowIso();
      this.persist();
    },

    /** 定稿前交班人可以删除（尚未定稿，无留痕要求） */
    removeDraftItem(sheetId: string, itemId: string) {
      const sheet = this.sheets.find((s) => s.id === sheetId);
      if (!sheet || sheet.status !== "草稿") return;
      const item = sheet.items.find((i) => i.id === itemId);
      if (!item) return;
      sheet.items = sheet.items.filter((i) => i.id !== itemId);
      sheet.logs.push(makeLog("交班人", `草稿阶段移除事项「${item.title}」`, this.operatorName));
      this.persist();
    },

    /** 定稿：未结事项锁定为交接单，交班人停止处理，等待逐项接收/退回 */
    finalize(sheetId: string): string | null {
      const sheet = this.sheets.find((s) => s.id === sheetId);
      if (!sheet) return "交接单不存在";
      if (sheet.status !== "草稿") return "只有草稿状态可以定稿";
      if (sheet.items.length === 0) return "没有未结事项，不能定稿空单";
      if (!sheet.toShiftId || sheet.toShiftId === sheet.fromShiftId) return "请先选择接棒班次";
      sheet.items.forEach((i) => {
        if (i.status !== "已接收" && i.status !== "已退回") {
          i.status = "待接棒";
          i.ownerShiftId = sheet.fromShiftId;
          i.updatedAt = nowIso();
        }
      });
      sheet.status = "定稿";
      sheet.finalizedAt = nowIso();
      sheet.logs.push(makeLog("交班人", `交接单定稿，锁定 ${sheet.items.length} 项未结事项，等待接棒人逐项接收/退回`, this.operatorName));
      this.persist();
      return null;
    },

    /* ---------------- 定稿阶段：接棒人逐项接收或退回 ---------------- */

    decideItem(sheetId: string, itemId: string, accept: boolean, note: string): string | null {
      const sheet = this.sheets.find((s) => s.id === sheetId);
      if (!sheet) return "交接单不存在";
      if (sheet.status !== "定稿") return "只有定稿后的交接单才能接收/退回";
      const item = sheet.items.find((i) => i.id === itemId);
      if (!item) return "事项不存在";
      if (item.status === "已接收" || item.status === "已退回") return "该事项已处理，如需变更请重新发起（撤销/改派/退回重交）";
      if (!accept && !note.trim()) return "退回必须填写原因，交班人才能据此继续处理或重新发起";
      item.status = accept ? "已接收" : "已退回";
      item.decisionNote = note;
      item.decidedAt = nowIso();
      item.updatedAt = item.decidedAt;
      // 普通单：接收→责任转新班次，退回→留原班次；
      // 撤销单：同意撤销→事项退回原班次，拒绝撤销→继续留新班次
      const isRevoke = sheet.reinitType === "撤销";
      item.ownerShiftId = accept
        ? isRevoke ? sheet.fromShiftId : sheet.toShiftId
        : isRevoke ? sheet.toShiftId : sheet.fromShiftId;
      const actionText = isRevoke
        ? `${accept ? "同意撤销" : "拒绝撤销"}事项「${item.title}」${accept ? "，事项退回原班次" : "，事项继续留新班次"}${note ? "：" + note : ""}`
        : `${accept ? "接收" : "退回"}事项「${item.title}」${note ? "：" + note : ""}`;
      sheet.logs.push(makeLog("接棒人", actionText, this.operatorName));
      this.persist();
      return null;
    },

    /** 签收：逐项处理完毕，整单签收，责任整体转到新班次（退回项除外，退回项留原班次） */
    sign(sheetId: string): string | null {
      const sheet = this.sheets.find((s) => s.id === sheetId);
      if (!sheet) return "交接单不存在";
      if (sheet.status !== "定稿") return "只有定稿单可以签收";
      const pending = sheet.items.filter((i) => i.status === "待接棒" || i.status === "待处理" || i.status === "处理中");
      if (pending.length > 0) return `还有 ${pending.length} 项未逐项接收或退回，不能签收`;
      const accepted = sheet.items.filter((i) => i.status === "已接收").length;
      const returned = sheet.items.filter((i) => i.status === "已退回").length;
      sheet.status = "已签收";
      sheet.signedAt = nowIso();
      sheet.logs.push(
        makeLog("接棒人", `整单签收：接收 ${accepted} 项（责任转至新班次），退回 ${returned} 项（留原班次继续处理）`, this.operatorName),
      );
      this.persist();
      return null;
    },

    /* ---------------- 定稿后的补记 / 撤销 / 改派：重新发起，原记录保留 ---------------- */

    /**
     * 重新发起一张交接单（原单及全部记录继续保留，不可改动）
     * - 补记：新事项补交给同一接棒班次
     * - 撤销：撤回已交接的事项（仅可选择已接收项）
     * - 改派：把事项改派给另一个接棒班次
     * - 退回重交：接棒人退回的事项整理后重新交接
     */
    reinit(
      sourceSheetId: string,
      type: ReinitType,
      payload: { itemIds?: string[]; newItems?: { kind: ItemKind; title: string; amount: number | null; detail: string }[]; toShiftId?: string; note?: string },
    ): string | HandoverSheet {
      const src = this.sheets.find((s) => s.id === sourceSheetId);
      if (!src) return "来源交接单不存在";
      if (src.status === "草稿") return "草稿单可直接修改，无需重新发起";
      const note = payload.note?.trim() || "";

      let toShiftId = src.toShiftId;
      if (type === "改派") {
        if (!payload.toShiftId || payload.toShiftId === src.fromShiftId) return "请选择改派目标班次";
        toShiftId = payload.toShiftId;
      }

      const t = nowIso();
      const copied: HandoverItem[] = [];
      const pickIds = payload.itemIds ?? [];

      if (type === "补记") {
        (payload.newItems ?? []).forEach((d) => {
          copied.push({
            id: uid("i"),
            kind: d.kind,
            title: d.title,
            amount: d.amount,
            detail: d.detail,
            progressNote: "",
            status: "待接棒",
            createdAt: t,
            updatedAt: t,
            decisionNote: "",
            decidedAt: null,
            ownerShiftId: src.fromShiftId,
          });
        });
        if (copied.length === 0) return "请填写至少一条补记事项";
      } else {
        const selectable = src.items.filter((i) => {
          if (!pickIds.includes(i.id)) return false;
          if (type === "撤销") return i.status === "已接收";
          if (type === "退回重交") return i.status === "已退回";
          return true; // 改派
        });
        if (selectable.length === 0) {
          if (type === "撤销") return "没有可撤销的已接收事项";
          if (type === "退回重交") return "没有已退回的事项需要重交";
          return "请选择要改派的事项";
        }
        selectable.forEach((i) => {
          copied.push({
            ...i,
            id: uid("i"),
            status: "待接棒",
            decisionNote: "",
            decidedAt: null,
            progressNote: type === "退回重交" ? `退回原因：${i.decisionNote || "（未填写）"}` : i.progressNote,
            createdAt: t,
            updatedAt: t,
            ownerShiftId: src.fromShiftId,
          });
        });
      }

      const typeText: Record<ReinitType, string> = {
        补记: "补记交接",
        撤销: "撤销已交接事项",
        改派: "改派接棒班次",
        退回重交: "退回事项重新交接",
      };

      const sheet: HandoverSheet = {
        id: uid("sh"),
        code: sheetCode(this.sheets.length),
        fromShiftId: src.fromShiftId,
        toShiftId,
        origin: src.origin,
        status: "定稿",
        items: copied,
        logs: [
          makeLog("系统", `基于 ${src.code} 重新发起（${typeText[type]}）；原单记录完整保留，不可改动`, this.operatorName),
          ...(note ? [makeLog("交班人", `重新发起说明：${note}`, this.operatorName)] : []),
        ],
        createdAt: t,
        finalizedAt: t,
        signedAt: null,
        parentId: src.id,
        reinitType: type,
        reinitNote: note,
        reassignedToShiftId: type === "改派" ? toShiftId : null,
      };
      this.sheets.unshift(sheet);
      this.selectedSheetId = sheet.id;
      this.persist();
      return sheet;
    },
  },
});

/* ---------------- 持久化：关机重开后续接未完成交接单，不重开/不丢已接收项 ---------------- */

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as PersistShape;
      if (data && Array.isArray(data.sheets) && Array.isArray(data.shifts)) {
        return {
          shifts: data.shifts,
          sheets: data.sheets,
          currentShiftId: data.currentShiftId || data.shifts[0]?.id || "",
          operatorName: data.operatorName || "当班员工",
          operatorRole: data.operatorRole || "接棒人",
          selectedSheetId: data.selectedSheetId ?? data.sheets[0]?.id ?? null,
        };
      }
    }
  } catch {
    // 数据损坏时回落到种子数据
  }
  return seed();
}
