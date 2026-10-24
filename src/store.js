// store.js
import {defineStore} from 'pinia'
import {ref, reactive} from 'vue'
import {MediaSearch, createSearchState} from './media-search.js'
import {LibraryViews} from './library-views.js'
import {BrowseSnapshots} from './browse-snapshots.js'

export const useBrowseSnapshots = defineStore('BrowseSnapshots', () => {
    const snapshots = new BrowseSnapshots();
    const account = ref('');
    const revision = ref(0);
    return {account, revision, setAccount: value => { snapshots.setAccount(value); account.value = snapshots.account; revision.value = snapshots.revision; },
        invalidateDetails: () => snapshots.invalidateDetails(), get: (user, key) => snapshots.get(user, key), save: (user, key, value, version) => snapshots.save(user, key, value, version)};
})

export const useLibraryViews = defineStore('LibraryViews', () => {
    const views = new LibraryViews();
    const account = ref('');
    return {account, setAccount: value => { views.setAccount(value); account.value = views.account; },
        invalidate: () => views.invalidate(), get: (user, library) => views.get(user, library), save: (user, library, state) => views.save(user, library, state)};
})

export const useMediaSearch = defineStore('MediaSearch', () => {
    const state = reactive(createSearchState());
    let storage = null;
    try { storage = window.localStorage; } catch { /* History is optional. */ }
    const search = new MediaSearch({state, storage});
    return {state, setAccount: account => search.setAccount(account),
        invalidate: () => search.invalidate(), submit: (requests, query, options) => search.submit(requests, query, options), cancel: () => search.cancel(),
        clear: () => search.clear(), clearHistory: () => search.clearHistory(), showMore: () => search.showMore()};
})


export const useMediaDbData = defineStore('MediaDbData', () => {
    const list = ref([])
    const info = ref({})
    const errors = ref({})
    const loading = ref({})
    const sort_column = ref("create_time");
    const sort_type = ref("DESC");
    return {list, info, errors, loading, sort_column, sort_type}
})

export const usePlayerData = defineStore("PlayerData", () => {
    const episode_guid = ref(null);
    return {episode_guid}
})
