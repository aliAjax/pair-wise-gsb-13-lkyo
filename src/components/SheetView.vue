<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useStore } from "../store";
import { HandoverItem, HandoverSheet, ITEM_KINDS, ItemKind, ItemStatus, ReinitType } from "../types";
import { fmtDateTime, fmtMoney } from "../format";
import ReinitDialog from "./ReinitDialog.vue";

const props = defineProps<{ sheet: HandoverSheet }>();

const store = useStore();

/* ---------------- 新增事项（仅草稿） ---------------- */

const newItem = reactive<{ kind: ItemKind; title: string; amount: number | null; detail: string }>({
  kind: "油款",
  title: "",
  amount: null,
  detail: "",
});

function addItem() {
  if (!newItem.title.trim()) {
    ElMessage.warning("请填写事项标题");
    return;
  }
  store.addItem(props.sheet.id, { ...newItem });
  newItem.title = "";
  newItem.amount = null;
  newItem.detail = "";
  ElMessage.success("已加入交接单（定稿前交班人可继续处理）");
}

/* ---------------- 草稿期进展更新 ---------------- */

const editing = ref<Record<string, { status: ItemStatus; progressNote: string }>>({});

function startEdit(item: HandoverItem) {
  editing.value[item.id] = { status: item.status, progressNote: item.progressNote };
}

function saveEdit(item: HandoverItem) {
  const v = editing.value[item.id];
  if (!v) return;
  store.updateItemProgress(props.sheet.id, item.id, v.status, v.progressNote);
  delete editing.value[item.id];
  ElMessage.success("进展已保存");
}

function cancelEdit(item: HandoverItem) {
  delete editing.value[item.id];
}

function cancelDecide(item: HandoverItem) {
  delete deciding.value[item.id];
}

async function removeItem(item: HandoverItem) {
  try {
    await ElMessageBox.confirm(`移除事项「${item.title}」？仅定稿前可移除。`, "移除确认", { type: "warning" });
    store.removeDraftItem(props.sheet.id, item.id);
  } catch {
    /* 取消 */
  }
}

/* ---------------- 定稿 ---------------- */

async function finalize() {
  try {
    await ElMessageBox.confirm(
      "定稿后事项锁定，交班人停止处理；接棒人逐项接收或退回，全部处理完才能签收。定稿后如需补记/撤销/改派，将重新发起一张新单，原单保留。",
      "定稿确认",
      { confirmButtonText: "确认定稿", cancelButtonText: "再想想", type: "info" },
    );
  } catch {
    return;
  }
  const err = store.finalize(props.sheet.id);
  if (err) ElMessage.error(err);
  else ElMessage.success("交接单已定稿，等待接棒人逐项处理");
}

/* ---------------- 逐项接收 / 退回 ---------------- */

const deciding = ref<Record<string, { accept: boolean; note: string }>>({});

function startDecide(item: HandoverItem, accept: boolean) {
  deciding.value[item.id] = { accept, note: "" };
}

function submitDecide(item: HandoverItem) {
  const v = deciding.value[item.id];
  if (!v) return;
  if (!v.accept && !v.note.trim()) {
    ElMessage.warning("退回必须填写退回原因");
    return;
  }
  const err = store.decideItem(props.sheet.id, item.id, v.accept, v.note.trim());
  if (err) ElMessage.error(err);
  else {
    delete deciding.value[item.id];
    const text = v.accept ? acceptText.value : rejectText.value;
    ElMessage.success(`已${text}`);
  }
}

/* ---------------- 签收 ---------------- */

const counts = computed(() => {
  const c = { accepted: 0, returned: 0, pending: 0 };
  props.sheet.items.forEach((i) => {
    if (i.status === "已接收") c.accepted += 1;
    else if (i.status === "已退回") c.returned += 1;
    else c.pending += 1;
  });
  return c;
});

async function sign() {
  try {
    await ElMessageBox.confirm(
      `接收 ${counts.value.accepted} 项、退回 ${counts.value.returned} 项。签收后已接收事项责任正式转到新班次，原班次不再承担。`,
      "整单签收",
      { confirmButtonText: "确认签收", cancelButtonText: "取消", type: "success" },
    );
  } catch {
    return;
  }
  const err = store.sign(props.sheet.id);
  if (err) ElMessage.error(err);
  else ElMessage.success("签收完成，责任已转移到新班次");
}

/* ---------------- 重新发起（补记/撤销/改派/退回重交） ---------------- */

const reinitVisible = ref(false);
const reinitType = ref<ReinitType>("补记");

function openReinit(type: ReinitType) {
  reinitType.value = type;
  reinitVisible.value = true;
}

const kindTag: Record<ItemKind, string> = {
  油款: "warning",
  设备异常: "danger",
  顾客退款: "success",
  其他: "info",
};

const statusTag: Record<ItemStatus, string> = {
  待处理: "info",
  处理中: "warning",
  待接棒: "primary",
  已接收: "success",
  已退回: "danger",
};

const draftStatuses: ItemStatus[] = ["待处理", "处理中", "待接棒"];

function shiftShort(id: string) {
  const s = store.shiftById(id);
  return s ? `${s.date.slice(5)} ${s.slot} ${s.leader || ""}` : "—";
}

const parentSheet = computed(() =>
  props.sheet.parentId ? store.sheets.find((s) => s.id === props.sheet.parentId) : null,
);

const isOutgoing = computed(() => store.operatorRole === "交班人");
const isIncoming = computed(() => store.operatorRole === "接棒人");
const isRevokeSheet = computed(() => props.sheet.reinitType === "撤销");

const acceptText = computed(() => (isRevokeSheet.value ? "同意撤销" : "接收"));
const rejectText = computed(() => (isRevokeSheet.value ? "拒绝撤销" : "退回"));

const reinitBadge: Record<ReinitType, string> = {
  补记: "补记单",
  撤销: "撤销单",
  改派: "改派单",
  退回重交: "重交单",
};
</script>

<template>
  <div class="sheet-view">
    <!-- 单据头 -->
    <div class="sheet-head">
      <div>
        <div class="sheet-code">
          <span class="code">{{ sheet.code }}</span>
          <el-tag :type="sheet.status === '草稿' ? 'info' : sheet.status === '定稿' ? 'warning' : 'success'" size="large">
            {{ sheet.status }}
          </el-tag>
          <el-tag v-if="sheet.origin === '补录'" type="info" effect="plain">旧班次补录</el-tag>
          <el-tag v-if="sheet.reinitType" type="warning" effect="dark">{{ reinitBadge[sheet.reinitType] }}</el-tag>
        </div>
        <p class="route">
          交班：<b>{{ shiftShort(sheet.fromShiftId) }}</b>
          <span class="arrow">→</span>
          接棒：<b>{{ shiftShort(sheet.toShiftId) }}</b>
        </p>
        <p class="meta">
          创建 {{ fmtDateTime(sheet.createdAt) }} · 定稿 {{ fmtDateTime(sheet.finalizedAt) }} · 签收 {{ fmtDateTime(sheet.signedAt) }}
        </p>
        <el-alert
          v-if="parentSheet"
          :title="`本单由 ${parentSheet.code} 通过「${sheet.reinitType}」重新发起，原单及记录完整保留`"
          type="warning"
          :closable="false"
          show-icon
          style="margin-top: 8px"
        />
      </div>
    </div>

    <!-- 阶段提示条 -->
    <el-alert
      v-if="sheet.status === '草稿'"
      title="草稿阶段：交班人继续处理油款、设备异常和退款，可随时新增事项、更新进展；定稿前责任仍在本班。"
      type="info"
      :closable="false"
      show-icon
      style="margin: 12px 0"
    />
    <el-alert
      v-else-if="sheet.status === '定稿'"
      :title="isRevokeSheet
        ? `撤销阶段：接棒人逐项${acceptText}或${rejectText}（待处理 ${counts.pending} 项 / ${acceptText} ${counts.accepted} 项 / ${rejectText} ${counts.returned} 项），全部处理后整单签收。`
        : `定稿阶段：请接棒人逐项接收或退回（待处理 ${counts.pending} 项 / 已接收 ${counts.accepted} 项 / 已退回 ${counts.returned} 项），全部处理完毕后整单签收，责任转到新班次。`"
      type="warning"
      :closable="false"
      show-icon
      style="margin: 12px 0"
    />
    <el-alert
      v-else
      :title="`已签收：已接收 ${counts.accepted} 项责任在新班次，已退回 ${counts.returned} 项留原班次。任何补记、撤销或改派都会重新发起新单，本单永久保留。`"
      type="success"
      :closable="false"
      show-icon
      style="margin: 12px 0"
    />
    <el-alert
      v-if="(sheet.status === '草稿' && !isOutgoing) || (sheet.status === '定稿' && !isIncoming)"
      :title="sheet.status === '草稿'
        ? '当前以接棒人身份查看：草稿阶段由交班人处理，定稿后你才能逐项接收/退回。'
        : '当前以交班人身份查看：定稿后由接棒人逐项接收/退回并签收，你可以发起补记、撤销或改派（重新发起新单）。'"
      type="error"
      :closable="false"
      show-icon
      style="margin: 0 0 12px"
    />

    <!-- 事项列表 -->
    <div class="items">
      <el-empty v-if="sheet.items.length === 0" description="还没有未结事项，先在下方添加" />
      <el-card v-for="item in sheet.items" :key="item.id" class="item-card" shadow="never">
        <div class="item-head">
          <div class="item-title">
            <el-tag :type="kindTag[item.kind]" size="small">{{ item.kind }}</el-tag>
            <span>{{ item.title }}</span>
            <el-tag v-if="item.amount !== null" size="small" effect="plain">{{ fmtMoney(item.amount) }}</el-tag>
          </div>
          <el-tag :type="statusTag[item.status]">{{ item.status }}</el-tag>
        </div>

        <p v-if="item.detail" class="item-detail">{{ item.detail }}</p>

        <!-- 草稿期：交班人处理区 -->
        <div v-if="sheet.status === '草稿' && editing[item.id]" class="decide-box">
          <el-select v-model="editing[item.id].status" size="small" style="width: 130px">
            <el-option v-for="st in draftStatuses" :key="st" :label="st" :value="st" />
          </el-select>
          <el-input v-model="editing[item.id].progressNote" size="small" type="textarea" :rows="2"
            placeholder="交班进展：如油款已核对、厂家报修中、等主管审批…" />
          <div class="decide-actions">
            <el-button size="small" type="primary" @click="saveEdit(item)">保存进展</el-button>
            <el-button size="small" @click="cancelEdit(item)">取消</el-button>
          </div>
        </div>
        <div v-else class="item-progress">
          <span v-if="item.progressNote" class="progress-text">进展：{{ item.progressNote }}</span>
          <span v-else class="progress-text muted">暂无进展记录</span>
        </div>

        <!-- 处置结论 -->
        <div v-if="item.status === '已接收' || item.status === '已退回'" class="decision">
          <el-tag :type="item.status === '已接收' ? 'success' : 'danger'" size="small">
            {{ item.status === "已接收" ? "接棒人已接收" : "接棒人退回" }}
          </el-tag>
          <span>{{ item.decisionNote || "（无说明）" }}</span>
          <span class="muted">{{ fmtDateTime(item.decidedAt) }} · 现责任方：{{ shiftShort(item.ownerShiftId) }}</span>
        </div>

        <!-- 逐项接收/退回操作区 -->
        <div v-if="sheet.status === '定稿' && deciding[item.id]" class="decide-box">
          <el-input
            v-model="deciding[item.id].note"
            :type="deciding[item.id].accept ? 'text' : 'textarea'"
            :rows="2"
            :placeholder="isRevokeSheet
              ? (deciding[item.id].accept ? '同意撤销说明（可选）' : '拒绝撤销原因（必填）')
              : (deciding[item.id].accept ? '接收备注（可选）' : '请填写退回原因（必填）')"
          />
          <div class="decide-actions">
            <el-button size="small" :type="deciding[item.id].accept ? 'success' : 'danger'"
              @click="submitDecide(item)">
              确认{{ deciding[item.id].accept ? acceptText : rejectText }}
            </el-button>
            <el-button size="small" @click="cancelDecide(item)">取消</el-button>
          </div>
        </div>

        <div class="item-actions">
          <template v-if="sheet.status === '草稿'">
            <template v-if="isOutgoing">
              <el-button size="small" @click="startEdit(item)">更新进展</el-button>
              <el-button size="small" type="danger" plain @click="removeItem(item)">移除</el-button>
            </template>
          </template>
          <template v-else-if="sheet.status === '定稿' && item.status === '待接棒' && isIncoming">
            <el-button size="small" type="success" @click="startDecide(item, true)">{{ acceptText }}</el-button>
            <el-button size="small" type="danger" plain @click="startDecide(item, false)">{{ rejectText }}</el-button>
          </template>
        </div>
      </el-card>
    </div>

    <!-- 草稿期：添加事项 -->
    <el-card v-if="sheet.status === '草稿' && isOutgoing" class="add-card" shadow="never">
      <template #header><b>新增未结事项</b></template>
      <el-form label-width="84px" @submit.prevent>
        <div class="add-grid">
          <el-form-item label="类型">
            <el-select v-model="newItem.kind">
              <el-option v-for="k in ITEM_KINDS" :key="k" :label="k" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item label="标题" required>
            <el-input v-model="newItem.title" placeholder="如：本班油款核对 / 3号机油枪异常 / 顾客退款300元" />
          </el-form-item>
          <el-form-item label="金额(元)">
            <el-input-number v-model="newItem.amount" :min="0" :precision="2" controls-position="right"
              placeholder="无金额留空" style="width: 100%" />
          </el-form-item>
          <el-form-item label="详情">
            <el-input v-model="newItem.detail" type="textarea" :rows="2"
              placeholder="涉及油枪/金额/凭证/联系人等" />
          </el-form-item>
        </div>
        <el-button type="primary" @click="addItem">加入交接单</el-button>
      </el-form>
    </el-card>

    <!-- 底部操作栏 -->
    <div class="footer-bar">
      <template v-if="sheet.status === '草稿'">
        <el-button v-if="isOutgoing" type="primary" size="large" @click="finalize">定稿交接单</el-button>
        <span class="footer-hint">定稿后交班人停止处理，转为接棒人逐项接收/退回</span>
      </template>
      <template v-else-if="sheet.status === '定稿'">
        <el-button v-if="isIncoming" type="success" size="large" :disabled="counts.pending > 0" @click="sign">
          整单签收{{ counts.pending > 0 ? `（还有${counts.pending}项未处理）` : "" }}
        </el-button>
        <el-button v-if="isOutgoing" size="large" @click="openReinit('补记')">补记事项</el-button>
        <el-button v-if="isOutgoing" size="large" @click="openReinit('撤销')">撤销已接收</el-button>
        <el-button v-if="isOutgoing" size="large" @click="openReinit('改派')">改派班次</el-button>
        <span class="footer-hint">
          {{ isIncoming
            ? "请逐项接收或退回，全部处理后签收；定稿后改动需交班人重新发起"
            : "定稿后补记/撤销/改派都会重新发起新单，本单记录保留" }}
        </span>
      </template>
      <template v-else>
        <el-button v-if="isOutgoing" size="large" @click="openReinit('补记')">补记事项</el-button>
        <el-button v-if="isOutgoing" size="large" @click="openReinit('撤销')">撤销已接收</el-button>
        <el-button v-if="isOutgoing" size="large" @click="openReinit('改派')">改派班次</el-button>
        <el-button v-if="isOutgoing && counts.returned > 0" size="large" @click="openReinit('退回重交')">退回事项重交</el-button>
        <span class="footer-hint">本单已签收归档，任何变更均重新发起，原记录继续保留</span>
      </template>
    </div>

    <!-- 流转日志 -->
    <el-card class="log-card" shadow="never">
      <template #header><b>交接记录（留痕，不可删除）</b></template>
      <el-timeline>
        <el-timeline-item v-for="log in [...sheet.logs].reverse()" :key="log.id"
          :timestamp="fmtDateTime(log.at)" placement="top" :type="log.role === '接棒人' ? 'success' : log.role === '系统' ? 'info' : 'primary'">
          <el-tag size="small" :type="log.role === '接棒人' ? 'success' : log.role === '系统' ? 'info' : 'warning'" effect="plain">
            {{ log.role }}
          </el-tag>
          <span class="log-operator">{{ log.operator }}</span>
          {{ log.action }}
        </el-timeline-item>
      </el-timeline>
    </el-card>

    <ReinitDialog :visible="reinitVisible" :sheet="sheet" :type="reinitType"
      @update:visible="(v: boolean) => (reinitVisible = v)" />
  </div>
</template>

<style scoped>
.sheet-head { display: flex; justify-content: space-between; align-items: flex-start; }
.sheet-code { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.code { font-size: 20px; font-weight: 800; letter-spacing: 1px; color: #176b87; }
.route { margin: 10px 0 4px; font-size: 15px; color: #33415c; }
.route .arrow { margin: 0 10px; color: #90a0b8; }
.meta { margin: 0; color: #8492a6; font-size: 12.5px; }

.items { display: grid; gap: 10px; margin: 14px 0; }
.item-card { border-radius: 10px; background: #fbfcfe; }
.item-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.item-title { display: flex; gap: 8px; align-items: center; font-weight: 700; flex-wrap: wrap; }
.item-detail { margin: 10px 0 6px; color: #4b5870; font-size: 14px; line-height: 1.6; }
.item-progress { margin: 6px 0; font-size: 13.5px; color: #4b5870; }
.progress-text { background: #eef5fb; border-radius: 6px; padding: 6px 10px; display: inline-block; }
.muted { color: #93a0b5; }
.decision { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; background: #f3f8f5; border-radius: 6px; padding: 8px 10px; font-size: 13.5px; color: #37504a; margin: 6px 0; }
.decide-box { display: grid; gap: 8px; margin: 8px 0; padding: 10px; background: #fff; border: 1px dashed #c8d4e3; border-radius: 8px; }
.decide-actions { display: flex; gap: 8px; }
.item-actions { display: flex; gap: 8px; margin-top: 8px; }

.add-card { margin-bottom: 14px; border-radius: 10px; }
.add-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 0 12px; }
@media (max-width: 720px) { .add-grid { grid-template-columns: 1fr; } }

.footer-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 14px 0; border-top: 1px solid #e4ebf3; }
.footer-hint { color: #8492a6; font-size: 13px; }

.log-card { margin-top: 14px; border-radius: 10px; }
.log-operator { font-weight: 700; margin: 0 6px 0 8px; color: #33415c; }
</style>
