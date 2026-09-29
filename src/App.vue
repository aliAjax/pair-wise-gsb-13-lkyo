<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useStore, nextSlot, fmtDate } from "./store";
import SheetView from "./components/SheetView.vue";
import SheetList from "./components/SheetList.vue";
import ShiftManager from "./components/ShiftManager.vue";
import ShiftPicker from "./components/ShiftPicker.vue";

const store = useStore();

const tab = ref<"work" | "list" | "shift">("work");

/* ---------------- 新建 / 续接交接单 ---------------- */

const createVisible = ref(false);
const createForm = reactive({ fromShiftId: "", toShiftId: "" });

function openCreate() {
  createForm.fromShiftId = store.currentShiftId;
  const cur = store.currentShift;
  if (cur) {
    const nd =
      cur.slot === "晚班"
        ? fmtDate(new Date(new Date(`${cur.date}T12:00:00`).getTime() + 86400000))
        : cur.date;
    createForm.toShiftId = store.ensureShift(nd, nextSlot(cur.slot)).id;
  } else {
    createForm.toShiftId = "";
  }
  createVisible.value = true;
}

function confirmCreate() {
  const result = store.createDraftSheet(createForm.fromShiftId, createForm.toShiftId);
  if (result.error) {
    ElMessage.error(result.error);
    return;
  }
  createVisible.value = false;
  if (result.resumed) ElMessage.success("已续接本班未完成的交接单（未重开，已接收项保留）");
  else ElMessage.success("交接单已创建，交班人可继续处理并添加未结事项");
}

/* 关机重开后的自动续接提示：进入时若存在未完成单，提示续接（本次会话内可关闭） */
const recoveredSheet = computed(() => {
  const s = store.selectedSheet;
  if (s && s.status !== "已签收") return s;
  return store.sheets.find((x) => x.status === "定稿") ?? null;
});

const dismissRecover = ref(false);

function continueRecovered() {
  if (recoveredSheet.value) {
    store.selectSheet(recoveredSheet.value.id);
    dismissRecover.value = true;
    tab.value = "work";
    ElMessage.success(`已续接 ${recoveredSheet.value.code}，已接收的事项不会重开或丢失`);
  }
}

/* ---------------- 操作员 / 角色 ---------------- */

const opName = ref(store.operatorName);
const opRole = ref(store.operatorRole);

watch([opName, opRole], () => {
  store.setOperator(opName.value.trim() || "当班员工", opRole.value);
});

watch(
  () => store.currentShiftId,
  () => {
    // 切换班次后，自动选择该班次相关的未完成单
    const related = store.sheets.find(
      (s) => (s.fromShiftId === store.currentShiftId || s.toShiftId === store.currentShiftId) && s.status !== "已签收",
    );
    if (related) store.selectSheet(related.id);
  },
);

/* ---------------- 指标 ---------------- */

const metrics = computed(() => {
  const active = store.sheets.filter((s) => s.status !== "已签收");
  const pendingItems = store.sheets
    .flatMap((s) => s.items)
    .filter((i) => i.status !== "已接收" && i.status !== "已退回").length;
  const acceptedItems = store.sheets
    .flatMap((s) => s.items)
    .filter((i) => i.status === "已接收").length;
  return {
    active: active.length,
    pendingItems,
    acceptedItems,
    signed: store.sheets.filter((s) => s.status === "已签收").length,
  };
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">加油站 · 班次交接</p>
          <h1>油站交接班管理</h1>
          <p class="subtitle">
            油款、设备异常、顾客退款一次性定稿成交接单；接棒人逐项接收或退回，签收后责任转到新班次。
            定稿后的补记、撤销、改派均重新发起，原记录保留；关机重开自动续接，旧班次可补录。
          </p>
        </div>
        <div class="operator">
          <el-input v-model="opName" placeholder="当前操作员姓名" size="default" style="width: 150px" />
          <el-radio-group v-model="opRole" size="default">
            <el-radio-button label="交班人">交班人</el-radio-button>
            <el-radio-button label="接棒人">接棒人</el-radio-button>
          </el-radio-group>
        </div>
      </header>

      <section class="metrics">
        <article class="metric"><span>进行中交接单</span><strong>{{ metrics.active }}</strong></article>
        <article class="metric"><span>待处理事项</span><strong>{{ metrics.pendingItems }}</strong></article>
        <article class="metric"><span>已接收事项</span><strong>{{ metrics.acceptedItems }}</strong></article>
        <article class="metric"><span>已签收归档</span><strong>{{ metrics.signed }}</strong></article>
      </section>

      <!-- 关机重开续接条 -->
      <el-alert
        v-if="recoveredSheet && !dismissRecover"
        class="recover-bar"
        type="warning"
        show-icon
        :closable="true"
        @close="dismissRecover = true"
      >
        <template #title>
          检测到未完成的交接单「{{ recoveredSheet.code }}」（{{ recoveredSheet.status }}），
          电脑重启后已为你保留全部进度，已接收的事项不会重开或丢失。
          <el-button type="warning" size="small" style="margin-left: 10px" @click="continueRecovered">立即续接</el-button>
        </template>
      </el-alert>

      <section class="main-grid">
        <!-- 左：班次 + 单据列表 -->
        <aside class="side">
          <el-card shadow="never" class="side-card">
            <template #header><b>当前班次</b></template>
            <ShiftPicker :model-value="store.currentShiftId"
              @update:model-value="(v: string) => store.setCurrentShift(v)" />
            <el-button type="primary" plain style="width: 100%; margin-top: 10px" @click="openCreate">
              发起 / 续接本班交接单
            </el-button>
          </el-card>

          <el-card shadow="never" class="side-card list-card">
            <template #header><b>交接单（点击续接/查看）</b></template>
            <SheetList @open="tab = 'work'" />
          </el-card>
        </aside>

        <!-- 右：工作区 -->
        <section class="content">
          <div class="content-tabs">
            <el-radio-group v-model="tab" size="default">
              <el-radio-button label="work">当前交接单</el-radio-button>
              <el-radio-button label="list">全部单据</el-radio-button>
              <el-radio-button label="shift">班次管理 / 旧班次补录</el-radio-button>
            </el-radio-group>
          </div>

          <SheetView v-if="tab === 'work' && store.selectedSheet" :key="store.selectedSheet.id"
            :sheet="store.selectedSheet" />
          <el-empty v-else-if="tab === 'work'" description="还没有交接单，点击左上方“发起/续接本班交接单”">
            <el-button type="primary" @click="openCreate">发起交接单</el-button>
          </el-empty>
          <SheetList v-else-if="tab === 'list'" @open="tab = 'work'" />
          <ShiftManager v-else @done="tab = 'work'" />
        </section>
      </section>
    </div>

    <!-- 新建交接单 -->
    <el-dialog v-model="createVisible" title="发起交接单" width="460px">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 14px"
        title="若交班班次已有未签收草稿单，将直接续接，不会重开。" />
      <el-form label-width="84px">
        <el-form-item label="交班班次">
          <ShiftPicker v-model="createForm.fromShiftId" />
        </el-form-item>
        <el-form-item label="接棒班次">
          <ShiftPicker v-model="createForm.toShiftId" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmCreate">创建 / 续接</el-button>
      </template>
    </el-dialog>
  </main>
</template>

<style scoped>
.topbar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 20px;
  align-items: end;
  margin-bottom: 18px;
}
.eyebrow { margin: 0 0 8px; color: #176b87; font-weight: 700; font-size: 13px; }
h1 { margin: 0; font-size: clamp(24px, 3vw, 34px); }
.subtitle { margin: 10px 0 0; max-width: 760px; color: #5b667a; line-height: 1.7; font-size: 14px; }
.operator { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }

.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.metric { background: #fff; border: 1px solid #dfe7f1; border-radius: 10px; padding: 14px 16px; }
.metric span { display: block; color: #69758c; font-size: 12.5px; }
.metric strong { display: block; margin-top: 6px; font-size: 26px; color: #17324d; }

.recover-bar { margin-bottom: 14px; border-radius: 10px; }

.main-grid { display: grid; grid-template-columns: 340px 1fr; gap: 16px; align-items: start; }
.side { display: grid; gap: 14px; position: sticky; top: 14px; }
.side-card { border-radius: 10px; }
.list-card { max-height: calc(100vh - 40px); overflow: auto; }
.side-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.content { min-width: 0; background: #fff; border: 1px solid #dfe7f1; border-radius: 10px; padding: 18px; }
.content-tabs { margin-bottom: 14px; }

@media (max-width: 960px) {
  .topbar { grid-template-columns: 1fr; }
  .operator { justify-content: flex-start; }
  .metrics { grid-template-columns: repeat(2, 1fr); }
  .main-grid { grid-template-columns: 1fr; }
  .side { position: static; }
}
</style>
