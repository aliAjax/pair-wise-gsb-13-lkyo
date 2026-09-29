<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { NewAmendmentInput, ShiftOrder } from "../types";
import { AMENDMENT_LABEL } from "../types";

const props = defineProps<{
  visible: boolean;
  source: ShiftOrder | null;
  actor: string;
  preset?: { type: "supplement" | "revoke" | "reassign"; itemId?: string } | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [input: NewAmendmentInput];
}>();

const form = reactive({
  type: "supplement" as NewAmendmentInput["type"],
  itemId: "",
  outgoing: "",
  incoming: "",
  reason: "",
  reassignTo: "",
  item: { kind: "cash" as const, title: "", detail: "", amount: undefined as number | undefined }
});

watch(
  () => props.visible,
  (open) => {
    if (!open || !props.source) return;
    form.type = props.preset?.type ?? "supplement";
    form.itemId = props.preset?.itemId ?? "";
    // 签收后修正：发起方通常是当前新班次（持有责任的一方）
    form.outgoing = props.actor || props.source.incoming;
    form.incoming = form.type === "supplement" ? props.source.incoming : props.source.outgoing;
    form.reason = "";
    form.reassignTo = "";
    form.item = { kind: "cash", title: "", detail: "", amount: undefined };
  }
);

const targetItem = computed(() =>
  props.source?.items.find((item) => item.id === form.itemId) ?? null
);

const title = computed(() => `定稿后修改：重新发起${AMENDMENT_LABEL[form.type]}修订单`);

function confirm() {
  if (!props.source) return;
  emit("submit", {
    type: form.type,
    sourceOrderId: props.source.id,
    sourceItemId: form.type === "supplement" ? undefined : form.itemId || undefined,
    outgoing: form.outgoing.trim(),
    incoming: form.incoming.trim(),
    reason: form.reason,
    reassignTo: form.reassignTo,
    item:
      form.type === "supplement"
        ? {
            kind: form.item.kind,
            title: form.item.title,
            detail: form.item.detail,
            amount: form.item.amount
          }
        : undefined
  });
}
</script>

<template>
  <el-dialog :model-value="visible" :title="title" width="520px" @close="emit('close')">
    <el-alert
      v-if="source"
      type="info"
      :closable="false"
      class="amend-alert"
      :title="`原单 ${source.bizNo} 保持不变，所有原始记录继续保留；修订单需重新走「定稿 → 逐项接收 → 签收」。`"
    />

    <el-form label-width="86px" class="amend-form">
      <el-form-item label="修改类型">
        <el-radio-group v-if="!preset" v-model="form.type">
          <el-radio value="supplement">补记（新增未结事项）</el-radio>
          <el-radio value="revoke">撤销（原事项作废）</el-radio>
          <el-radio value="reassign">改派（转给他人/班组）</el-radio>
        </el-radio-group>
        <el-tag v-else type="warning">{{ AMENDMENT_LABEL[form.type] }}</el-tag>
      </el-form-item>

      <el-form-item v-if="form.type !== 'supplement'" label="原事项">
        <el-select v-model="form.itemId" placeholder="选择已接收事项" style="width: 100%" :disabled="!!preset">
          <el-option
            v-for="item in source?.items.filter((entry) => entry.status === 'accepted' && !entry.revokedAt && !entry.reassignedAt) ?? []"
            :key="item.id"
            :label="item.title"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <template v-if="form.type === 'supplement'">
        <el-form-item label="类别">
          <el-radio-group v-model="form.item.kind">
            <el-radio value="cash">油款</el-radio>
            <el-radio value="device">设备异常</el-radio>
            <el-radio value="refund">顾客退款</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="form.item.title" placeholder="如：夜间油款差额 ¥120" />
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number v-model="form.item.amount" :min="0" :precision="2" placeholder="选填" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.item.detail" type="textarea" :rows="2" />
        </el-form-item>
      </template>

      <el-form-item v-else-if="form.type === 'reassign'" label="改派给">
        <el-input v-model="form.reassignTo" placeholder="目标人或班组，如：夜班/赵磊" />
      </el-form-item>

      <el-form-item label="原因">
        <el-input v-model="form.reason" type="textarea" :rows="2" placeholder="必填：为什么定稿后还要修改" />
      </el-form-item>

      <el-form-item label="发起方">
        <el-input v-model="form.outgoing" placeholder="责任交出方" />
      </el-form-item>
      <el-form-item label="接收方">
        <el-input v-model="form.incoming" placeholder="责任接收方" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" @click="confirm">发起修订单</el-button>
    </template>
  </el-dialog>
</template>
