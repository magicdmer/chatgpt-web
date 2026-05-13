<script setup lang='ts'>
interface Emit {
  (e: 'click'): void
}

const emit = defineEmits<Emit>()

function handleClick() {
  emit('click')
}
</script>

<template>
  <button
    class="hover-btn"
    @click="handleClick"
  >
    <slot />
  </button>
</template>

<style scoped>
.hover-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.hover-btn:hover {
  background: var(--surface-hover);
  transform: scale(1.08);
}

.hover-btn:active {
  transform: scale(0.95);
}
</style>
