<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowRight } from "@element-plus/icons-vue";
import { useStore } from "../store";
import { HandoverSheet, SheetStatus } from "../types";
import { fmtDateTime } from "../format";

const store = useStore();
const emit = defineEmits<{ open: [id: string] }>();

const keyword = ref("");
const statusFilter = ref<SheetStatus | "全部">("全部");

const sheets = computed<HandoverSheet[]>(() => {
  return store.sheets.filter((s) => {
    if (statusFilter.value !== "全部" && s.status !== statusFilter.value) return false;
    if (keyword.value.trim()) {
      const kw = keyword.value.trim();
      const from = store.shiftLabelOf(s.fromShiftId);
      const to = store.shiftLabelOf(s.toShiftId);
      const blob = `${s.code} ${from} ${to} ${s.items.map((i) => i.title).join(" ")}`;
      if (!blob.includes(kw)) return false;
    }
    return true;
  });
});

function counts(s: HandoverSheet) {
  return {
    accepted: s.items.filter((i) => i.status === "已接收").length,
    returned: s.items.filter((i) => i.status === "已退回").length,
    pending: s.items.filter((i) => i.status !== "已接收" && i.status !== "已退回").length,
  };
}

const statusType: Record<SheetStatus, "info" | "warning" | "success"> = {
  草稿: "info",
  定稿: "warning",
  已签收: "success",
};
</script>

<template>
  <div class="sheet-list">
    <div class="list-toolbar">
      <el-radio-group v-model="statusFilter" size="small">
        <el-radio-button label="全部">全部</el-radio-button>
        <el-radio-button label="草稿">草稿（交班中）</el-radio-button>
        <el-radio-button label="定稿">定稿（待接收）</el-radio-button>
        <el-radio-button label="已签收">已签收归档</el-radio-button>
      </el-radio-group>
      <el-input v-model="keyword" placeholder="搜索单号/班次/事项" clearable style="width: 240px" />
    </div>

    <el-empty v-if="sheets.length === 0" description="没有匹配的交接单" />

    <div
      v-for="s in sheets"
      :key="s.id"
      class="sheet-row"
      :class="{ active: store.selectedSheetId === s.id }"
      @click="store.selectSheet(s.id); emit('open', s.id)"
    >
      <div class="row-main">
        <div class="row-head">
          <span class="row-code">{{ s.code }}</span>
          <el-tag :type="statusType[s.status]" size="small">{{ s.status }}</el-tag>
          <el-tag v-if="s.origin === '补录'" size="small" type="info" effect="plain">补录</el-tag>
          <el-tag v-if="s.reinitType" size="small" type="warning" effect="dark">{{ s.reinitType }}</el-tag>
          <el-tag v-if="s.parentId" size="small" type="warning" effect="plain">重发单</el-tag>
        </div>
        <div class="row-route">
          {{ store.shiftLabelOf(s.fromShiftId) }}
          <span class="arrow">→</span>
          {{ store.shiftLabelOf(s.toShiftId) }}
        </div>
        <div class="row-meta">
          共 {{ s.items.length }} 项 · 已接收 {{ counts(s).accepted }} · 已退回 {{ counts(s).returned }} ·
          待处理 {{ counts(s).pending }} · 更新 {{ fmtDateTime(s.finalizedAt ?? s.createdAt) }}
        </div>
      </div>
      <el-icon class="row-chevron"><ArrowRight /></el-icon>
    </div>
  </div>
</template>

<style scoped>
.list-toolbar { display: flex; gap: 10px; justify-content: space-between; flex-wrap: wrap; margin-bottom: 12px; }
.sheet-row {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid #dfe7f1; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 10px; cursor: pointer; background: #fbfcfe;
  transition: border-color .15s, box-shadow .15s;
}
.sheet-row:hover { border-color: #176b87; }
.sheet-row.active { border-color: #176b87; box-shadow: 0 0 0 2px rgba(23, 107, 135, .15); background: #fff; }
.row-main { flex: 1; min-width: 0; }
.row-head { display: flex; gap: 8px; align-items: center; }
.row-code { font-weight: 800; color: #176b87; }
.row-route { margin: 6px 0 2px; font-size: 13.5px; color: #33415c; }
.row-route .arrow { margin: 0 8px; color: #9aa8bd; }
.row-meta { color: #8492a6; font-size: 12.5px; }
.row-chevron { color: #9aa8bd; }
</style>
