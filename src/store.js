// store.js
import {defineStore} from 'pinia'
import {ref} from 'vue'


export const useMediaDbData = defineStore('MediaDbData', () => {
    const list = ref([])
    const info = ref({})
    const errors = ref({})
    const sort_column = ref("create_time");
    const sort_type = ref("DESC");
    return {list, info, errors, sort_column, sort_type}
})

export const usePlayerData = defineStore("PlayerData", () => {
    const episode_guid = ref(null);
    return {episode_guid}
})
