<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useStore } from "../store";
import { HandoverSheet, ITEM_KINDS, ItemKind, ReinitType } from "../types";
import { fmtMoney } from "../format";
import ShiftPicker from "./ShiftPicker.vue";

const props = defineProps<{ visible: boolean; sheet: HandoverSheet; type: ReinitType }>();
const emit = defineEmits<{ "update:visible": [v: boolean] }>();

const store = useStore();

const TYPE_INFO: Record<ReinitType, { title: string; desc: string; confirmText: string; needNote: boolean }> = {
  补记: {
    title: "补记交接（重新发起新单）",
    desc: "定稿/签收后新发现的未结事项，补记后生成一张新的定稿单交同一接棒班次；原单不动，记录继续保留。",
    confirmText: "重新发起补记单",
    needNote: false,
  },
  撤销: {
    title: "撤销已接收事项（重新发起新单）",
    desc: "对已被接棒人接收的事项发起撤销，撤销后事项回到原班次。新单仍需接棒人确认；原单记录保留。",
    confirmText: "重新发起撤销单",
    needNote: true,
  },
  改派: {
    title: "改派接棒班次（重新发起新单）",
    desc: "把选定事项改派给另一个班次接收；原单及已接收记录继续保留。",
    confirmText: "重新发起改派单",
    needNote: true,
  },
  退回重交: {
    title: "退回事项重新交接",
    desc: "接棒人退回的事项，交班人补充说明后重新发起交接；原退回记录保留。",
    confirmText: "重新发起交接",
    needNote: false,
  },
};

const form = reactive<{
  itemIds: string[];
  note: string;
  toShiftId: string;
  newItems: { kind: ItemKind; title: string; amount: number | null; detail: string }[];
}>({
  itemIds: [],
  note: "",
  toShiftId: "",
  newItems: [],
});

watch(
  () => [props.visible, props.type, props.sheet.id],
  ([vis]) => {
    if (!vis) return;
    form.itemIds = [];
    form.note = "";
    form.toShiftId = props.sheet.toShiftId;
    form.newItems = props.type === "补记"
      ? [{ kind: "油款", title: "", amount: null, detail: "" }]
      : [];
  },
);

const selectableItems = computed(() => {
  if (props.type === "撤销") return props.sheet.items.filter((i) => i.status === "已接收");
  if (props.type === "退回重交") return props.sheet.items.filter((i) => i.status === "已退回");
  return props.sheet.items; // 改派
});

function addRow() {
  form.newItems.push({ kind: "油款", title: "", amount: null, detail: "" });
}
function removeRow(idx: number) {
  form.newItems.splice(idx, 1);
}

function submit() {
  if (props.type === "补记") {
    const rows = form.newItems.filter((r) => r.title.trim());
    if (rows.length === 0) {
      ElMessage.warning("请至少填写一条补记事项");
      return;
    }
    const result = store.reinit(props.sheet.id, "补记", { newItems: rows.map((r) => ({ ...r })), note: form.note });
    if (typeof result === "string") {
      ElMessage.error(result);
      return;
    }
  } else {
    if (form.itemIds.length === 0) {
      ElMessage.warning("请先勾选要处理的事项");
      return;
    }
    if (TYPE_INFO[props.type].needNote && !form.note.trim()) {
      ElMessage.warning("请填写原因说明");
      return;
    }
    if (props.type === "改派" && (!form.toShiftId || form.toShiftId === props.sheet.fromShiftId)) {
      ElMessage.error("请选择改派目标班次（不能是原交班班次）");
      return;
    }
    const result = store.reinit(props.sheet.id, props.type, {
      itemIds: [...form.itemIds],
      toShiftId: form.toShiftId,
      note: form.note,
    });
    if (typeof result === "string") {
      ElMessage.error(result);
      return;
    }
  }
  ElMessage.success("已重新发起新单，原单记录完整保留");
  emit("update:visible", false);
}
</script>

<template>
  <el-dialog :model-value="visible" :title="TYPE_INFO[type].title" width="640px"
    @update:model-value="(v: boolean) => emit('update:visible', v)">
    <el-alert :title="TYPE_INFO[type].desc" type="warning" :closable="false" show-icon style="margin-bottom: 14px" />

    <!-- 补记：录入新事项 -->
    <template v-if="type === '补记'">
      <div v-for="(row, idx) in form.newItems" :key="idx" class="new-row">
        <div class="new-row-head">
          <el-select v-model="row.kind" style="width: 120px">
            <el-option v-for="k in ITEM_KINDS" :key="k" :label="k" :value="k" />
          </el-select>
          <el-input v-model="row.title" placeholder="事项标题" />
          <el-input-number v-model="row.amount" :min="0" :precision="2" controls-position="right"
            placeholder="金额可空" style="width: 150px" />
          <el-button v-if="form.newItems.length > 1" type="danger" link @click="removeRow(idx)">删除</el-button>
        </div>
        <el-input v-model="row.detail" type="textarea" :rows="2" placeholder="详情（涉及金额、设备、凭证等）" />
      </div>
      <el-button type="primary" link @click="addRow">+ 再加一条</el-button>

      <el-input v-model="form.note" type="textarea" :rows="2" style="margin-top: 10px"
        placeholder="补记原因（可选）" />
    </template>

    <!-- 撤销 / 改派 / 退回重交：勾选事项 -->
    <template v-else>
      <el-empty v-if="selectableItems.length === 0"
        :description="type === '撤销' ? '本单没有已接收事项可撤销' : type === '退回重交' ? '本单没有被退回的事项' : '没有可选事项'" />
      <el-checkbox-group v-else v-model="form.itemIds" class="pick-list">
        <el-checkbox v-for="item in selectableItems" :key="item.id" :value="item.id" border class="pick-item">
          <div class="pick-line">
            <el-tag size="small">{{ item.kind }}</el-tag>
            <b>{{ item.title }}</b>
            <span v-if="item.amount !== null">{{ fmtMoney(item.amount) }}</span>
            <el-tag size="small" :type="item.status === '已接收' ? 'success' : 'danger'">{{ item.status }}</el-tag>
          </div>
          <div v-if="type === '退回重交'" class="pick-sub">原退回原因：{{ item.decisionNote || "（未填写）" }}</div>
        </el-checkbox>
      </el-checkbox-group>

      <el-form label-width="84px" style="margin-top: 12px">
        <el-form-item v-if="type === '改派'" label="改派给">
          <ShiftPicker v-model="form.toShiftId" />
        </el-form-item>
        <el-form-item :label="type === '退回重交' ? '补充说明' : '原因说明'">
          <el-input v-model="form.note" type="textarea" :rows="2"
            :placeholder="type === '退回重交' ? '针对退回原因的补充（可选）' : '必填：说明为什么要' + type" />
        </el-form-item>
      </el-form>
    </template>

    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="warning" :disabled="type !== '补记' && selectableItems.length === 0" @click="submit">
        {{ TYPE_INFO[type].confirmText }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.new-row { border: 1px solid #e0e8f2; border-radius: 8px; padding: 10px; margin-bottom: 10px; }
.new-row-head { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; flex-wrap: wrap; }
.pick-list { display: grid; gap: 8px; width: 100%; }
.pick-item { width: 100%; height: auto; margin-right: 0; padding: 10px 12px; border-radius: 8px; }
.pick-line { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.pick-sub { color: #8492a6; font-size: 12.5px; margin-top: 4px; }
</style>
