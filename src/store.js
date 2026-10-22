// store.js
import {defineStore} from 'pinia'
import {ref, reactive} from 'vue'
import {MediaSearch, createSearchState} from './media-search.js'
import {LibraryViews} from './library-views.js'

export const useLibraryViews = defineStore('LibraryViews', () => {
    const views = new LibraryViews();
    const account = ref('');
    return {account, setAccount: value => { views.setAccount(value); account.value = views.account; },
        get: (user, library) => views.get(user, library), save: (user, library, state) => views.save(user, library, state)};
})

export const useMediaSearch = defineStore('MediaSearch', () => {
    const state = reactive(createSearchState());
    let storage = null;
    try { storage = window.localStorage; } catch { /* History is optional. */ }
    const search = new MediaSearch({state, storage});
    return {state, setAccount: account => search.setAccount(account),
        submit: (requests, query) => search.submit(requests, query), cancel: () => search.cancel(),
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
