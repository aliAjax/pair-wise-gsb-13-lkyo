<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "../store";
import { ShiftInfo, ShiftSlot, SHIFT_SLOTS } from "../types";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();

const store = useStore();

const sorted = computed<ShiftInfo[]>(() =>
  [...store.shifts].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return SHIFT_SLOTS.indexOf(b.slot) - SHIFT_SLOTS.indexOf(a.slot);
  }),
);

function onChange(v: string) {
  if (v === "__new__") {
    quickNew.show = true;
  } else {
    emit("update:modelValue", v);
  }
}

import { reactive } from "vue";
const today = new Date();
const p = (n: number) => String(n).padStart(2, "0");
const quickNew = reactive({
  show: false,
  date: `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`,
  slot: "早班" as ShiftSlot,
  leader: "",
});

function confirmNew() {
  const s = store.ensureShift(quickNew.date, quickNew.slot, quickNew.leader);
  quickNew.show = false;
  emit("update:modelValue", s.id);
}
</script>

<template>
  <el-select :model-value="props.modelValue" placeholder="选择班次" filterable @change="onChange" style="width: 100%">
    <el-option
      v-for="s in sorted"
      :key="s.id"
      :label="`${s.date} ${s.slot} · ${s.leader || '未指派'}`"
      :value="s.id"
    />
    <el-option label="➕ 新建班次…" value="__new__" />
  </el-select>

  <el-dialog v-model="quickNew.show" title="新建班次" width="380px">
    <el-form label-width="72px">
      <el-form-item label="日期">
        <el-date-picker v-model="quickNew.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
      </el-form-item>
      <el-form-item label="班次">
        <el-select v-model="quickNew.slot" style="width: 100%">
          <el-option v-for="slot in SHIFT_SLOTS" :key="slot" :label="slot" :value="slot" />
        </el-select>
      </el-form-item>
      <el-form-item label="负责人">
        <el-input v-model="quickNew.leader" placeholder="当班负责人姓名" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="quickNew.show = false">取消</el-button>
      <el-button type="primary" @click="confirmNew">创建并选择</el-button>
    </template>
  </el-dialog>
</template>
