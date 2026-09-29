<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useStore } from "../store";
import { ShiftInfo, ShiftSlot, SHIFT_SLOTS, SLOT_START, SLOT_END } from "../types";

const emit = defineEmits<{ done: [] }>();
const store = useStore();

const today = new Date();
const p = (n: number) => String(n).padStart(2, "0");

const form = reactive({
  date: `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`,
  slot: "早班" as ShiftSlot,
  leader: "",
  note: "",
});

const sortedShifts = computed<ShiftInfo[]>(() =>
  [...store.shifts].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return SHIFT_SLOTS.indexOf(b.slot) - SHIFT_SLOTS.indexOf(a.slot);
  }),
);

function createShift() {
  const exists = store.shifts.some((s) => s.date === form.date && s.slot === form.slot);
  if (exists) {
    ElMessage.warning("该班次已存在，直接在列表中选择即可");
    return;
  }
  store.ensureShift(form.date, form.slot, form.leader);
  const s = store.shifts.find((x) => x.date === form.date && x.slot === form.slot);
  if (s) {
    s.note = form.note;
    store.persist();
  }
  ElMessage.success("班次已创建");
  form.leader = "";
  form.note = "";
}

/** 旧班次没有交接单：为其补开一张草稿单 */
async function openMissing(s: ShiftInfo) {
  try {
    await ElMessageBox.confirm(
      `为「${s.date} ${s.slot}」补开交接单？\n补开的是草稿单，可补齐事项，在下次换班时交给下一班。`,
      "旧班次补开交接单",
      { confirmButtonText: "补开并打开", cancelButtonText: "取消", type: "info" },
    );
  } catch {
    return;
  }
  const sheet = store.openMissingSheet(s.id, null);
  ElMessage.success(`已补开草稿单 ${sheet.code}`);
  emit("done");
}

function setCurrent(s: ShiftInfo) {
  store.setCurrentShift(s.id);
  ElMessage.success(`当前登录班次切换为 ${s.date} ${s.slot}`);
}

function sheetStateOf(s: ShiftInfo): { draft: number; finalized: number; signed: number } {
  const related = store.sheets.filter((x) => x.fromShiftId === s.id);
  return {
    draft: related.filter((x) => x.status === "草稿").length,
    finalized: related.filter((x) => x.status === "定稿").length,
    signed: related.filter((x) => x.status === "已签收").length,
  };
}

function hasAnySheet(s: ShiftInfo): boolean {
  const c = sheetStateOf(s);
  return c.draft + c.finalized + c.signed > 0;
}
</script>

<template>
  <div class="shift-manager">
    <el-alert
      title="旧班次没有交接单也能打开：在下方找到该班次点“补开交接单”，生成草稿单补齐事项，下次换班时再交下一班。"
      type="info" :closable="false" show-icon style="margin-bottom: 14px" />

    <el-card shadow="never" style="margin-bottom: 16px; border-radius: 10px">
      <template #header><b>新建班次</b></template>
      <el-form label-width="72px" inline>
        <el-form-item label="日期">
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="时段">
          <el-select v-model="form.slot" style="width: 110px">
            <el-option v-for="slot in SHIFT_SLOTS" :key="slot" :label="slot" :value="slot" />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人">
          <el-input v-model="form.leader" placeholder="姓名" style="width: 140px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="createShift">创建班次</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <div class="shift-grid">
      <el-card v-for="s in sortedShifts" :key="s.id" shadow="never" class="shift-card"
        :class="{ current: s.id === store.currentShiftId }">
        <div class="shift-card-head">
          <b>{{ s.date }} {{ s.slot }}</b>
          <el-tag v-if="s.id === store.currentShiftId" type="success" size="small">当前班次</el-tag>
        </div>
        <div class="shift-line">时段：{{ SLOT_START[s.slot] }}–{{ SLOT_END[s.slot] }}</div>
        <div class="shift-line">负责人：{{ s.leader || "未指派" }}</div>
        <div v-if="s.note" class="shift-line muted">{{ s.note }}</div>
        <div class="shift-line">
          交接单：草稿 {{ sheetStateOf(s).draft }} / 定稿 {{ sheetStateOf(s).finalized }} / 已签收 {{ sheetStateOf(s).signed }}
        </div>
        <div class="shift-actions">
          <el-button size="small" type="primary" plain @click="setCurrent(s)">在此班次登录</el-button>
          <el-button size="small" @click="openMissing(s)"
            :disabled="hasAnySheet(s)">
            补开交接单
          </el-button>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.shift-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.shift-card { border-radius: 10px; }
.shift-card.current { border-color: #176b87; box-shadow: 0 0 0 2px rgba(23, 107, 135, .15); }
.shift-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.shift-line { font-size: 13.5px; color: #4b5870; line-height: 1.9; }
.shift-line.muted { color: #8492a6; }
.shift-actions { display: flex; gap: 8px; margin-top: 10px; }
</style>
