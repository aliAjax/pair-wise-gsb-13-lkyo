<script setup lang="ts">
import { ElMessageBox } from "element-plus";
import {
  Coin,
  Warning,
  RefreshLeft,
  Check,
  Close
} from "@element-plus/icons-vue";
import type { HandoverItem, ShiftOrder } from "../types";
import { ITEM_KIND_LABEL, ITEM_STATUS_LABEL } from "../types";

const props = defineProps<{
  order: ShiftOrder;
  item: HandoverItem;
  actor: string;
}>();

const emit = defineEmits<{
  accept: [orderId: string, itemId: string, note: string];
  reject: [orderId: string, itemId: string, reason: string];
  resolve: [orderId: string, itemId: string, note: string];
  amend: [type: "revoke" | "reassign", itemId: string];
}>();

const kindIcon = { cash: Coin, device: Warning, refund: RefreshLeft } as const;
const kindType = { cash: "primary", device: "warning", refund: "danger" } as const;
const statusType = { pending: "info", accepted: "success", rejected: "danger" } as const;

const isIncoming = () => props.actor === props.order.incoming;
const isOutgoing = () => props.actor === props.order.outgoing;
const canDecide = () => props.order.status === "finalized" && props.item.status === "pending" && isIncoming();

async function accept() {
  try {
    const { value } = await ElMessageBox.prompt("接收意见（可留空）", `接收：${props.item.title}`, {
      confirmButtonText: "确认接收",
      cancelButtonText: "取消",
      inputType: "textarea",
      inputPlaceholder: "账实一致 / 已验证可用……"
    });
    emit("accept", props.order.id, props.item.id, value ?? "");
  } catch {
    /* 取消 */
  }
}

async function reject() {
  try {
    const { value } = await ElMessageBox.prompt("退回原因（必填）", `退回：${props.item.title}`, {
      confirmButtonText: "确认退回",
      cancelButtonText: "取消",
      inputType: "textarea",
      inputPlaceholder: "退回后责任留在交班班次，交班人可闭环处理"
    });
    emit("reject", props.order.id, props.item.id, value ?? "");
  } catch {
    /* 取消 */
  }
}

async function resolveRejected() {
  try {
    const { value } = await ElMessageBox.prompt("交班人闭环处理登记", props.item.title, {
      confirmButtonText: "登记闭环",
      cancelButtonText: "取消",
      inputType: "textarea",
      inputValue: props.item.resolvedNote ?? ""
    });
    emit("resolve", props.order.id, props.item.id, value ?? "");
  } catch {
    /* 取消 */
  }
}

function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "";
}
</script>

<template>
  <div class="item" :class="`is-${item.status}`">
    <div class="item-main">
      <div class="item-head">
        <el-tag :type="kindType[item.kind]" size="small" effect="dark" class="kind-tag">
          <el-icon class="tag-icon"><component :is="kindIcon[item.kind]" /></el-icon>
          {{ ITEM_KIND_LABEL[item.kind] }}
        </el-tag>
        <span class="item-title">{{ item.title }}</span>
        <el-tag :type="statusType[item.status]" size="small">{{ ITEM_STATUS_LABEL[item.status] }}</el-tag>
      </div>
      <p class="item-detail">{{ item.detail }}</p>

      <div v-if="item.decisionNote" class="decision" :class="item.status">
        <el-icon v-if="item.status === 'accepted'" class="ok"><Check /></el-icon>
        <el-icon v-else class="bad"><Close /></el-icon>
        <span>{{ item.decidedBy }} {{ fmt(item.decidedAt) }}：{{ item.decisionNote }}</span>
      </div>

      <div v-if="item.resolved" class="decision resolved">
        <el-icon class="ok"><Check /></el-icon>
        <span>交班人闭环 {{ fmt(item.resolvedAt) }}：{{ item.resolvedNote }}</span>
      </div>

      <div v-if="item.revokedAt" class="strike-note">
        已由修订单 {{ item.revokedByOrder }} 撤销（{{ fmt(item.revokedAt) }}），本原始记录保留
      </div>
      <div v-else-if="item.reassignedAt" class="strike-note">
        已由修订单 {{ item.reassignedByOrder }} 改派给 {{ item.reassignedTo }}（{{ fmt(item.reassignedAt) }}），本原始记录保留
      </div>
    </div>

    <div class="item-ops">
      <template v-if="canDecide()">
        <el-button type="success" size="small" @click="accept">接收</el-button>
        <el-button type="danger" plain size="small" @click="reject">退回</el-button>
      </template>
      <template v-else-if="item.status === 'rejected' && !item.resolved && ['finalized', 'signed'].includes(order.status) && isOutgoing()">
        <el-button type="warning" size="small" @click="resolveRejected">交班人闭环</el-button>
      </template>
      <template v-if="order.status === 'signed' && item.status === 'accepted' && !item.revokedAt && !item.reassignedAt">
        <el-button link type="primary" size="small" @click="emit('amend', 'revoke', item.id)">撤销</el-button>
        <el-button link type="primary" size="small" @click="emit('amend', 'reassign', item.id)">改派</el-button>
      </template>
    </div>
  </div>
</template>
