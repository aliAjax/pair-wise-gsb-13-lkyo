<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessageBox } from "element-plus";
import {
  SwitchButton,
  Refresh,
  DocumentAdd,
  WarningFilled,
  Connection
} from "@element-plus/icons-vue";
import { useHandover } from "./handover/useHandover";
import type { NewAmendmentInput, NewItemInput, ShiftSlot } from "./types";
import OrderDetail from "./components/OrderDetail.vue";
import AmendmentDialog from "./components/AmendmentDialog.vue";

const h = useHandover();

const STAFF = ["王强", "李娜", "赵磊"];
const SLOTS: ShiftSlot[] = ["早班", "中班", "晚班"];
const actor = ref("李娜");
h.setActor(actor.value);

function switchActor(name: string) {
  actor.value = name;
  h.setActor(name);
}

type Filter = "open" | "signed" | "void" | "amendment" | "all";
const filter = ref<Filter>("open");

const visibleOrders = computed(() => {
  switch (filter.value) {
    case "open":
      return h.orders.value.filter((o) => o.status === "draft" || o.status === "finalized");
    case "signed":
      return h.orders.value.filter((o) => o.status === "signed");
    case "void":
      return h.orders.value.filter((o) => o.status === "void");
    case "amendment":
      return h.orders.value.filter((o) => o.kind === "amendment");
    default:
      return h.orders.value;
  }
});

const selectedId = ref<string | null>(null);
const selectedOrder = computed(
  () => h.orders.value.find((o) => o.id === selectedId.value) ?? visibleOrders.value[0] ?? null
);

function selectOrder(id: string) {
  selectedId.value = id;
}

/* ---------- 新建 / 补建 ---------- */
const newDlg = ref(false);
const newForm = reactive({
  shiftDate: new Date().toISOString().slice(0, 10),
  shiftSlot: "早班" as ShiftSlot,
  outgoing: actor.value,
  incoming: "赵磊",
  backfilled: false
});

function openNewDialog(backfill?: { date: string; slot: ShiftSlot; outgoing: string; incoming: string }) {
  if (backfill) {
    Object.assign(newForm, {
      shiftDate: backfill.date,
      shiftSlot: backfill.slot,
      outgoing: backfill.outgoing,
      incoming: backfill.incoming,
      backfilled: true
    });
  } else {
    Object.assign(newForm, {
      shiftDate: new Date().toISOString().slice(0, 10),
      shiftSlot: "早班",
      outgoing: actor.value,
      incoming: STAFF.find((s) => s !== actor.value) ?? "赵磊",
      backfilled: false
    });
  }
  newDlg.value = true;
}

function submitNew() {
  const order = h.createOrder({ ...newForm });
  if (order) {
    newDlg.value = false;
    selectedId.value = order.id;
    filter.value = "open";
  }
}

/* ---------- 修订单 ---------- */
const amendDlg = ref(false);
const amendPreset = ref<{ type: "supplement" | "revoke" | "reassign"; itemId?: string } | null>(null);

function openAmendment(preset: { type: "supplement" | "revoke" | "reassign"; itemId?: string }) {
  amendPreset.value = preset;
  amendDlg.value = true;
}

function submitAmendment(input: NewAmendmentInput) {
  const order = h.createAmendment(input);
  if (order) {
    amendDlg.value = false;
    selectedId.value = order.id;
    filter.value = "open";
  }
}

/* ---------- 事件透传 ---------- */
function accept(orderId: string, itemId: string, note: string) {
  h.acceptItem(orderId, itemId, note);
}
function reject(orderId: string, itemId: string, reason: string) {
  h.rejectItem(orderId, itemId, reason);
}
function addItem(orderId: string, input: NewItemInput) {
  h.addItem(orderId, input);
}

async function simulateReboot() {
  try {
    await ElMessageBox.confirm(
      "模拟电脑关机后重新开机：未完成交接单将原样续接，已接收项不会重开或丢失。",
      "中途关机重开",
      { confirmButtonText: "重启并续接", cancelButtonText: "取消", type: "warning" }
    );
    h.simulateReboot();
  } catch {
    /* 取消 */
  }
}

function fmtShift(date: string, slot: string) {
  return `${date} ${slot}`;
}
</script>

<template>
  <el-container class="layout">
    <el-header class="topbar">
      <div class="brand">
        <el-icon class="brand-icon"><Connection /></el-icon>
        <div>
          <h1>加油站班次交接</h1>
          <p>油款 · 设备异常 · 顾客退款：定稿成单 → 逐项接收/退回 → 签收转责</p>
        </div>
      </div>
      <div class="top-ops">
        <el-button :icon="Refresh" @click="simulateReboot">模拟关机重开</el-button>
        <el-button text @click="h.resetAll()">重置演示数据</el-button>
        <el-divider direction="vertical" />
        <el-icon class="switch-icon"><SwitchButton /></el-icon>
        <el-select :model-value="actor" style="width: 110px" @update:model-value="switchActor">
          <el-option v-for="name in STAFF" :key="name" :label="name" :value="name" />
        </el-select>
      </div>
    </el-header>

    <!-- 开机续接横幅 -->
    <el-alert
      v-if="h.recoveredOnBoot && h.openOrders.value.length"
      type="warning"
      show-icon
      :closable="false"
      class="boot-banner"
    >
      <template #title>
        开机续接：发现 {{ h.openOrders.value.length }} 张未完成交接单，已按原状态恢复——已接收项保留，不能重开；请继续逐项处理。
      </template>
    </el-alert>
    <el-alert
      v-if="h.corruptedOnBoot"
      type="error"
      show-icon
      :closable="false"
      class="boot-banner"
      title="本地数据损坏，原始数据已另存备份（*.corrupt-*），当前载入安全数据。"
    />

    <main class="content">
      <!-- 左：列表 -->
      <aside class="sidebar">
        <div class="sidebar-head">
          <el-radio-group v-model="filter" size="small">
            <el-radio-button value="open">进行中 {{ h.openOrders.value.length }}</el-radio-button>
            <el-radio-button value="signed">已签收</el-radio-button>
            <el-radio-button value="amendment">修订单</el-radio-button>
            <el-radio-button value="void">作废</el-radio-button>
            <el-radio-button value="all">全部</el-radio-button>
          </el-radio-group>
          <el-button type="primary" :icon="DocumentAdd" @click="openNewDialog()">新建交接单</el-button>
        </div>

        <!-- 旧班次缺单提示 -->
        <el-card v-if="h.missingShifts.value.length" shadow="never" class="missing-card">
          <div class="missing-title">
            <el-icon class="warn"><WarningFilled /></el-icon>
            <span>以下班次还没有交接单，下次换班需补齐：</span>
          </div>
          <div v-for="shift in h.missingShifts.value" :key="shift.date + shift.slot" class="missing-row">
            <span>{{ fmtShift(shift.date, shift.slot) }}：{{ shift.outgoing }} → {{ shift.incoming }}</span>
            <el-button size="small" type="warning" plain @click="openNewDialog(shift)">补建</el-button>
          </div>
        </el-card>

        <div class="order-list">
          <button
            v-for="order in visibleOrders"
            :key="order.id"
            class="order-item"
            :class="{ active: selectedOrder?.id === order.id }"
            @click="selectOrder(order.id)"
          >
            <div class="oi-top">
              <span class="oi-no">{{ order.bizNo }}</span>
              <el-tag
                :type="{ draft: 'info', finalized: 'warning', signed: 'success', void: 'danger' }[order.status]"
                size="small"
              >
                {{ { draft: "草稿", finalized: "待逐项接收", signed: "已签收", void: "作废" }[order.status] }}
              </el-tag>
            </div>
            <div class="oi-sub">
              {{ order.shiftDate }} {{ order.shiftSlot }} · {{ order.outgoing }}→{{ order.incoming }}
              <el-tag v-if="order.kind === 'amendment'" size="small" type="warning" effect="plain" class="am-tag">修订单</el-tag>
              <el-tag v-else-if="order.backfilled" size="small" type="info" effect="plain" class="am-tag">补建</el-tag>
            </div>
            <div v-if="order.status === 'finalized'" class="oi-progress">
              <el-progress
                :percentage="Math.round(
                  (order.items.filter((i) => i.status !== 'pending').length / Math.max(order.items.length, 1)) * 100
                )"
                :stroke-width="6"
                :show-text="false"
              />
              <span>{{ order.items.filter((i) => i.status === 'accepted').length }} 收 /
                {{ order.items.filter((i) => i.status === 'rejected').length }} 退 /
                {{ order.items.filter((i) => i.status === 'pending').length }} 待</span>
            </div>
          </button>
          <el-empty v-if="!visibleOrders.length" description="没有匹配的交接单" :image-size="72" />
        </div>
      </aside>

      <!-- 右：详情 -->
      <section class="detail">
        <OrderDetail
          v-if="selectedOrder"
          :key="selectedOrder.id"
          :order="selectedOrder"
          :actor="actor"
          :all-orders="h.orders.value"
          @add-item="addItem"
          @remove-item="h.removeItem"
          @finalize="h.finalize"
          @accept="accept"
          @reject="reject"
          @resolve="h.resolveRejected"
          @sign="h.sign"
          @void-order="h.voidDraft"
          @amend="openAmendment"
          @open-order="selectOrder"
        />
        <el-empty v-else description="选择或新建一张交接单开始交接" />
      </section>
    </main>

    <!-- 新建/补建 -->
    <el-dialog v-model="newDlg" :title="newForm.backfilled ? '补建旧班次交接单' : '新建交接单'" width="440px">
      <el-alert
        v-if="newForm.backfilled"
        type="warning"
        :closable="false"
        title="旧班次原先没有交接单：现在补建并正常走完定稿、接收、签收；记录会标注为补建。"
        class="new-alert"
      />
      <el-form label-width="86px">
        <el-form-item label="班次日期">
          <el-date-picker v-model="newForm.shiftDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="班次">
          <el-radio-group v-model="newForm.shiftSlot">
            <el-radio v-for="s in SLOTS" :key="s" :value="s">{{ s }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="交班人">
          <el-select v-model="newForm.outgoing" style="width: 100%">
            <el-option v-for="name in STAFF" :key="name" :label="name" :value="name" />
          </el-select>
        </el-form-item>
        <el-form-item label="接棒人">
          <el-select v-model="newForm.incoming" style="width: 100%">
            <el-option v-for="name in STAFF" :key="name" :label="name" :value="name" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="newDlg = false">取消</el-button>
        <el-button type="primary" @click="submitNew">{{ newForm.backfilled ? "补建" : "创建" }}</el-button>
      </template>
    </el-dialog>

    <!-- 补记/撤销/改派 -->
    <AmendmentDialog
      :visible="amendDlg"
      :source="selectedOrder"
      :actor="actor"
      :preset="amendPreset"
      @close="amendDlg = false"
      @submit="submitAmendment"
    />
  </el-container>
</template>
