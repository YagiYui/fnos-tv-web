import { createRouter, createWebHistory } from 'vue-router';
import VueCookies from 'vue-cookies';
const routes = [
    {path:'/watchlist',name:'Watchlist',component:()=>import('../views/Watchlist.vue')},

    {
        path: '/',
        name: 'Home',
        component: () => import('../views/Home.vue')
    },
    {
        path: '/login',
        name: 'Login',
        component: () => import('../views/User/Login.vue'),
    },
    {
        path: '/list',
        name: 'VideoList',
        component: () => import('../views/Video/VideoList.vue')
    },
    {
        path: '/video',
        name: 'VideoData',
        component: () => import('../views/Video/VideoData.vue')
    },
    {
        path: '/player',
        name: 'VideoPlayer',
        component: () => import('../views/Play/VideoPlayer.vue')
    }
]
const router = createRouter({
    history: createWebHistory(),
    routes,
    // linkActiveClass: 'active',
    scrollBehavior(to, from, savedPosition) {
        return { x: 0, y: 0 }
    }
});

router.beforeEach(to => {
    if (to.path !== '/login' && !VueCookies.get('authorization')) {
        return {path: '/login', query: typeof to.query.code === 'string' ? {code: to.query.code} : {}};
    }
});

router.afterEach((to, from, next) => {
    window.scrollTo(0, 0);
});

export default router
