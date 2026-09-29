<script setup lang="ts">
import { computed, reactive } from "vue";
import { ElMessageBox } from "element-plus";
import { Plus, Delete, Lock, Stamp, RefreshLeft, CircleClose } from "@element-plus/icons-vue";
import type { NewItemInput, ShiftOrder } from "../types";
import { AMENDMENT_LABEL, ORDER_STATUS_LABEL } from "../types";
import ItemRow from "./ItemRow.vue";

const props = defineProps<{
  order: ShiftOrder;
  actor: string;
  allOrders: ShiftOrder[];
}>();

const emit = defineEmits<{
  addItem: [orderId: string, input: NewItemInput];
  removeItem: [orderId: string, itemId: string];
  finalize: [orderId: string];
  accept: [orderId: string, itemId: string, note: string];
  reject: [orderId: string, itemId: string, reason: string];
  resolve: [orderId: string, itemId: string, note: string];
  sign: [orderId: string, note: string];
  voidOrder: [orderId: string, reason: string];
  amend: [preset: { type: "supplement" | "revoke" | "reassign"; itemId?: string }];
  openOrder: [id: string];
}>();

const draftItem = reactive<NewItemInput>({ kind: "cash", title: "", detail: "", amount: undefined });

const counts = computed(() => ({
  pending: props.order.items.filter((i) => i.status === "pending").length,
  accepted: props.order.items.filter((i) => i.status === "accepted").length,
  rejected: props.order.items.filter((i) => i.status === "rejected").length
}));

const canFinalize = computed(
  () => props.order.status === "draft" && props.actor === props.order.outgoing
);
const canSign = computed(
  () => props.order.status === "finalized" && props.actor === props.order.incoming && counts.value.pending === 0
);
const canVoid = computed(
  () => props.order.status === "draft" && props.actor === props.order.outgoing
);

const relatedAmendments = computed(() =>
  props.allOrders.filter((o) => o.kind === "amendment" && o.sourceOrderId === props.order.id)
);

function add() {
  emit("addItem", props.order.id, { ...draftItem });
  draftItem.title = "";
  draftItem.detail = "";
  draftItem.amount = undefined;
}

async function doFinalize() {
  try {
    await ElMessageBox.confirm(
      "定稿后未结事项将锁定成交接单，交班人停止处理；接棒人逐项接收或退回。确认定稿？",
      "定稿交接单",
      { confirmButtonText: "确认定稿", cancelButtonText: "再检查一下", type: "warning" }
    );
    emit("finalize", props.order.id);
  } catch {
    /* 取消 */
  }
}

async function doSign() {
  const rejectedUnresolved = props.order.items.filter((i) => i.status === "rejected" && !i.resolved).length;
  const tip =
    rejectedUnresolved > 0
      ? `有 ${rejectedUnresolved} 个退回项尚未闭环，签收后仍归交班班次负责。确认签收？`
      : "签收后接收项责任正式转到新班次，单据不可重开。确认签收？";
  try {
    const { value } = await ElMessageBox.prompt(tip, "整单签收", {
      confirmButtonText: "确认签收",
      cancelButtonText: "取消",
      inputType: "textarea",
      inputPlaceholder: "签收备注（可留空）"
    });
    emit("sign", props.order.id, value ?? "");
  } catch {
    /* 取消 */
  }
}

async function doVoid() {
  try {
    const { value } = await ElMessageBox.prompt("作废原因（定稿/签收单不能作废，仅草稿可作废）", "作废草稿", {
      confirmButtonText: "作废",
      cancelButtonText: "取消",
      inputType: "textarea"
    });
    emit("voidOrder", props.order.id, value ?? "");
  } catch {
    /* 取消 */
  }
}

function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "";
}
</script>

<template>
  <el-card class="order-card" shadow="never">
    <template #header>
      <div class="order-header">
        <div class="order-id">
          <el-tag v-if="order.kind === 'amendment'" type="warning" effect="dark" size="small">
            {{ AMENDMENT_LABEL[order.amendmentType!] }}修订单
          </el-tag>
          <el-tag v-else-if="order.backfilled" type="info" size="small">旧班次补建</el-tag>
          <strong>{{ order.bizNo }}</strong>
          <el-tag
            :type="{ draft: 'info', finalized: 'warning', signed: 'success', void: 'danger' }[order.status]"
            size="small"
          >
            {{ ORDER_STATUS_LABEL[order.status] }}
          </el-tag>
        </div>
        <div class="order-shift">
          {{ order.shiftDate }} {{ order.shiftSlot }} ·
          <span class="person">{{ order.outgoing }}</span>
          <el-icon><RefreshLeft /></el-icon>
          <span class="person">{{ order.incoming }}</span>
        </div>
      </div>
    </template>

    <div v-if="order.kind === 'amendment'" class="amend-link">
      关联原记录：{{ order.sourceSummary }}
    </div>

    <!-- 草稿：交班人继续处理未结事项 -->
    <div v-if="order.status === 'draft'" class="draft-box">
      <div class="draft-hint">
        <el-icon><Lock /></el-icon>
        <span>定稿前由交班人 <b>{{ order.outgoing }}</b> 继续处理并登记；定稿后事项锁定，不能再改。</span>
      </div>
      <div v-if="actor === order.outgoing" class="add-form">
        <el-radio-group v-model="draftItem.kind" size="small">
          <el-radio-button value="cash">油款</el-radio-button>
          <el-radio-button value="device">设备异常</el-radio-button>
          <el-radio-button value="refund">顾客退款</el-radio-button>
        </el-radio-group>
        <el-input v-model="draftItem.title" placeholder="未结事项标题，如：油款 ¥18,640 待核 / 3号枪故障 / 顾客退款 ¥260" />
        <el-input v-model="draftItem.detail" type="textarea" :rows="2" placeholder="经过、凭证、联系人等细节" />
        <el-input-number v-model="draftItem.amount" :min="0" :precision="2" placeholder="金额(选填)" controls-position="right" />
        <el-button type="primary" :icon="Plus" :disabled="!draftItem.title.trim()" @click="add">登记未结事项</el-button>
      </div>
      <el-alert v-else type="info" :closable="false" title="当前身份不是交班人，草稿阶段仅交班人可编辑" />
    </div>

    <!-- 事项清单 -->
    <div class="items">
      <ItemRow
        v-for="item in order.items"
        :key="item.id"
        :order="order"
        :item="item"
        :actor="actor"
        @accept="(o, i, n) => emit('accept', o, i, n)"
        @reject="(o, i, r) => emit('reject', o, i, r)"
        @resolve="(o, i, n) => emit('resolve', o, i, n)"
        @amend="(type, itemId) => emit('amend', { type, itemId })"
      />
      <el-empty v-if="order.items.length === 0" description="还没有登记未结事项" :image-size="64" />
    </div>

    <!-- 定稿后的提示条 -->
    <el-alert
      v-if="order.status === 'finalized'"
      :type="counts.pending > 0 ? 'warning' : 'success'"
      :closable="false"
      class="progress-alert"
      show-icon
    >
      <template #title>
        已定稿：已接收 {{ counts.accepted }} 项 · 退回 {{ counts.rejected }} 项 · 待处理 {{ counts.pending }} 项
        <span v-if="actor === order.incoming && counts.pending > 0">— 请逐项接收或退回</span>
        <span v-else-if="actor !== order.incoming && counts.pending > 0">— 等待接棒人 {{ order.incoming }} 处理</span>
        <span v-else-if="counts.pending === 0">— 全部处理完毕，接棒人可整单签收</span>
      </template>
    </el-alert>

    <!-- 终态信息 -->
    <div v-if="order.status === 'signed'" class="signed-banner">
      <el-icon class="stamp"><Stamp /></el-icon>
      <div>
        <b>{{ fmt(order.signedAt) }} 已签收</b>
        <span v-if="order.signNote">：{{ order.signNote }}</span>
        <div class="signed-sub">接收项责任已转到 {{ order.incoming }} 的班次；退回项责任留在 {{ order.outgoing }} 的班次。原记录永久保留。</div>
      </div>
    </div>
    <div v-if="order.status === 'void'" class="void-banner">
      <el-icon><CircleClose /></el-icon>
      <span>{{ fmt(order.voidedAt) }} 草稿已作废（定稿/签收单不可作废）</span>
    </div>

    <!-- 操作按钮 -->
    <div class="order-actions">
      <el-button v-if="canFinalize" type="warning" :icon="Lock" @click="doFinalize">
        定稿成交接单（{{ order.items.length }} 项）
      </el-button>
      <el-button v-if="canSign" type="success" :icon="Stamp" @click="doSign">整单签收</el-button>
      <el-button v-if="canVoid" type="danger" plain :icon="CircleClose" @click="doVoid">作废草稿</el-button>
      <el-button
        v-if="order.kind === 'normal' && order.status === 'signed'"
        type="primary"
        plain
        size="small"
        @click="emit('amend', { type: 'supplement' })"
      >
        补记新事项（重新发起）
      </el-button>
    </div>

    <!-- 关联修订单 -->
    <div v-if="relatedAmendments.length" class="related">
      <span>关联修订单：</span>
      <el-button
        v-for="am in relatedAmendments"
        :key="am.id"
        link
        type="primary"
        size="small"
        @click="emit('openOrder', am.id)"
      >
        {{ am.bizNo }}（{{ AMENDMENT_LABEL[am.amendmentType!] }}·{{ ORDER_STATUS_LABEL[am.status].split("·")[0] }}）
      </el-button>
    </div>

    <!-- 事件流水 -->
    <el-collapse class="events">
      <el-collapse-item title="交接事件流水（审计留痕，不可删除）" name="events">
        <el-timeline>
          <el-timeline-item v-for="(entry, idx) in [...order.events].reverse()" :key="idx" :timestamp="fmt(entry.at)">
            <b>{{ entry.by }}</b> {{ entry.action }}
            <div v-if="entry.detail" class="event-detail">{{ entry.detail }}</div>
          </el-timeline-item>
        </el-timeline>
      </el-collapse-item>
    </el-collapse>
  </el-card>
</template>
