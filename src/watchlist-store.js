import {defineStore} from 'pinia';
import {ref, watch} from 'vue';
import {useBrowseSnapshots} from './store.js';
export const useWatchlistChanges = defineStore('WatchlistChanges', () => {
  const account = useBrowseSnapshots(), revision = ref(0), overrides = ref({});
  watch(() => account.revision, () => { overrides.value = {}; }, {flush:'sync'});
  return {revision, overrides, notify(guid, contains) {
    overrides.value = {...overrides.value, [guid]: contains}; revision.value++;
  }};
});
