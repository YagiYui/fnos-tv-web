<script setup>
import {onBeforeUnmount, ref, watch} from 'vue';
import {personalRequest} from '../personal-api.js';
import {useBrowseSnapshots} from '../store.js';
import {useWatchlistChanges} from '../watchlist-store.js';
const props = defineProps({guid:String});
const account = useBrowseSnapshots(), changes = useWatchlistChanges();
const contains = ref(null), busy = ref(false), error = ref('');
let controller = null, generation = 0;
function cancel() { generation++; controller?.abort(); }
async function read() {
  cancel(); contains.value = null; error.value = ''; busy.value = false;
  if (!account.account || !props.guid) return;
  const current = generation, id = props.guid; controller = new AbortController();
  try {
    const result = await personalRequest('watchlist/' + encodeURIComponent(id), {signal:controller.signal});
    if (current === generation) contains.value = result.contains;
  } catch (failure) { if (current === generation && failure.name !== 'AbortError') error.value = failure.message; }
}
async function toggle() {
  if (busy.value) return;
  if (contains.value === null) { await read(); return; }
  const current = generation, id = props.guid; busy.value = true; error.value = '';
  try {
    const result = await personalRequest('watchlist/' + encodeURIComponent(id), {method:contains.value ? 'DELETE' : 'PUT',signal:controller.signal});
    if (current !== generation) return;
    contains.value = result.contains; changes.notify(id,result.contains);
  } catch (failure) { if (current === generation && failure.name !== 'AbortError') error.value = failure.message; }
  finally { if (current === generation) busy.value = false; }
}
watch(() => [props.guid,account.revision],read,{immediate:true});
onBeforeUnmount(cancel);
</script>
<template><div class="watchlist-action"><n-button :loading="busy" :disabled="!account.account" @click="toggle"><template #icon><i class="bx" :class="contains ? 'bxs-bookmark' : 'bx-bookmark'"></i></template>{{ contains === null ? error ? '重试待看状态' : '读取待看状态…' : contains ? '移出待看' : '加入待看' }}</n-button><span v-if="error" role="alert">{{ error }}</span></div></template>
<style scoped>.watchlist-action{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap}.watchlist-action>span{font-size:12px;color:var(--cinema-muted)}</style>
