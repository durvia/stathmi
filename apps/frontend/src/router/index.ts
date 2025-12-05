import { defineAsyncComponent, defineComponent, h, type Component } from 'vue';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useUserStore } from '@/stores/user';
import RouteLoading from '@/components/layout/RouteLoading.vue';

type AsyncViewLoader = () => Promise<{ default: Component }>;

/**
 * 检测是否为 chunk 加载失败错误
 * 当服务器部署新版本后，旧版本 chunk 文件被删除，导致加载失败
 */
function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  // Vite 动态导入失败的典型错误信息
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Unable to preload CSS') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk')
  );
}

/**
 * 处理 chunk 加载失败：刷新页面获取最新版本
 * 使用 sessionStorage 防止无限刷新
 */
function handleChunkLoadError() {
  const RELOAD_KEY = 'chunk-reload-attempted';
  const lastAttempt = sessionStorage.getItem(RELOAD_KEY);
  const now = Date.now();

  // 5秒内已尝试过刷新，不再重复
  if (lastAttempt && now - parseInt(lastAttempt, 10) < 5000) {
    console.error('[Router] Chunk reload already attempted, giving up');
    return;
  }

  sessionStorage.setItem(RELOAD_KEY, String(now));
  window.location.reload();
}

const withRouteLoading = (loader: AsyncViewLoader, name?: string) => {
  const AsyncView = defineAsyncComponent({
    loader,
    loadingComponent: RouteLoading,
    delay: 0,
    suspensible: false,
    onError(error, _retry, fail) {
      if (isChunkLoadError(error)) {
        console.warn('[Router] Chunk load failed, reloading page...', error.message);
        handleChunkLoadError();
        fail(); // 标记失败，防止后续处理
      } else {
        fail();
      }
    },
  });

  return defineComponent({
    name: name ?? 'RouteViewWithLoading',
    setup() {
      return () => h(AsyncView);
    },
  });
};

// 原始 loader，用于预加载
const loaders = {
  follows: () => import('@/views/FollowsView.vue'),
  authorFollows: () => import('@/views/AuthorFollowsView.vue'),
  trending: () => import('@/views/home/TrendingFeedView.vue'),
  following: () => import('@/views/home/FollowingFeedView.vue'),
  custom: () => import('@/views/home/CustomFeedView.vue'),
  search: () => import('@/views/SearchView.vue'),
  settings: () => import('@/views/SettingsView.vue'),
  userProfile: () => import('@/views/UserProfileView.vue'),
  login: () => import('@/views/LoginView.vue'),
  oauthError: () => import('@/views/OAuthErrorView.vue'),
  onboarding: () => import('@/views/OnboardingView.vue'),
  notFound: () => import('@/views/NotFoundView.vue'),
};

const views = {
  follows: withRouteLoading(loaders.follows),
  authorFollows: withRouteLoading(loaders.authorFollows),
  trending: withRouteLoading(loaders.trending, 'TrendingFeedView'),
  following: withRouteLoading(loaders.following, 'FollowingFeedView'),
  custom: withRouteLoading(loaders.custom, 'CustomFeedView'),
  search: withRouteLoading(loaders.search, 'SearchView'),
  settings: withRouteLoading(loaders.settings),
  userProfile: withRouteLoading(loaders.userProfile),
  login: withRouteLoading(loaders.login),
  oauthError: withRouteLoading(loaders.oauthError),
  onboarding: withRouteLoading(loaders.onboarding),
  notFound: withRouteLoading(loaders.notFound),
};

// 预加载关键模块（Feed 页面 + 用户菜单相关页面）
function preloadCriticalModules() {
  const criticalLoaders = [
    // Feed 页面
    loaders.trending,
    loaders.following,
    loaders.custom,
    // 用户菜单相关（桌面端 ProfileMenu / 移动端 ProfileDrawer）
    loaders.follows,
    loaders.authorFollows,
    loaders.settings,
    loaders.userProfile,
  ];

  // 使用 requestIdleCallback 在空闲时预加载，避免阻塞首屏
  const scheduleIdle = (cb: () => void) => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(cb);
    } else {
      setTimeout(cb, 100);
    }
  };

  const preload = (index: number) => {
    const loader = criticalLoaders[index];
    if (!loader) return;
    scheduleIdle(() => {
      loader();
      preload(index + 1);
    });
  };

  preload(0);
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/following',
  },
  {
    path: '/trending',
    name: 'trending',
    component: views.trending,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 热门',
      tab: 'trending',
    },
  },
  {
    path: '/following',
    name: 'following',
    component: views.following,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 我的',
      tab: 'following',
      requiresAuth: true,
    },
  },
  {
    path: '/custom',
    name: 'custom',
    component: views.custom,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 分区',
      tab: 'custom',
    },
  },
  {
    path: '/search',
    name: 'search',
    component: views.search,
    meta: {
      title: '星图ΣΤΑΘΜΗ -  搜索',
    },
  },
  {
    path: '/follows',
    name: 'follows',
    component: views.follows,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 频道偏好',
      requiresAuth: true,
    },
  },
  {
    path: '/follows/authors',
    name: 'follows-authors',
    component: views.authorFollows,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 作者偏好',
      requiresAuth: true,
    },
  },
  // 兼容旧路由
  {
    path: '/favorites',
    redirect: '/follows',
  },
  {
    path: '/notifications',
    redirect: '/follows',
  },
  {
    path: '/blocks',
    redirect: '/follows',
  },
  {
    path: '/settings',
    name: 'settings',
    component: views.settings,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 界面偏好',
      requiresAuth: true,
    },
  },
  {
    path: '/user/:id',
    name: 'user-profile',
    component: views.userProfile,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 个人主页',
    },
  },
  {
    path: '/login',
    name: 'login',
    component: views.login,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 登录',
      fullscreen: true,
    },
  },
  {
    path: '/oauth-error',
    name: 'oauth-error',
    component: views.oauthError,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 登录失败',
      fullscreen: true,
      public: true,
    },
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: views.onboarding,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 首次使用',
      requiresAuth: true,
      fullscreen: true,
    },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: views.notFound,
    meta: {
      title: '星图ΣΤΑΘΜΗ - 404',
      fullscreen: true,
    },
  },
];

const DEFAULT_TITLE = '星图ΣΤΑΘΜΗ';

// KeepAlive 缓存的路由，滚动位置由 useScrollRestore 管理
const KEEP_ALIVE_ROUTES = new Set(['trending', 'following', 'custom', 'search']);

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    // 如果有保存的位置（浏览器后退/前进），恢复到该位置
    if (savedPosition) {
      return savedPosition;
    }
    // 进入 KeepAlive 路由时，滚动位置由 useScrollRestore 管理
    if (KEEP_ALIVE_ROUTES.has(to.name as string)) {
      return false;
    }
    // 其他情况滚动到顶部
    return { top: 0 };
  },
});

router.beforeEach(async (to) => {
  const userStore = useUserStore();
  await userStore.ensureSession();

  const isAuthenticated = userStore.isAuthenticated;
  const needsOnboarding = userStore.requiresOnboarding;

  // 全局认证：非公开页面都需要登录
  const publicPaths = ['/login', '/oauth-error'];
  if (!isAuthenticated && !publicPaths.includes(to.path)) {
    const redirect = to.fullPath !== '/login' ? to.fullPath : undefined;
    return {
      path: '/login',
      query: redirect ? { redirect } : undefined,
    };
  }

  // 登录态访问 /login 跳转到用户个人主页
  if (isAuthenticated && to.path === '/login') {
    return { path: `/user/${userStore.session!.id}` };
  }

  // 未完成 onboarding，一律拉回 /onboarding
  if (needsOnboarding && to.path !== '/onboarding') {
    return { path: '/onboarding' };
  }

  if (!needsOnboarding && to.path === '/onboarding') {
    return { path: '/following' };
  }

  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ?? DEFAULT_TITLE;
});

// 路由准备好后预加载关键模块
router.isReady().then(() => {
  preloadCriticalModules();
});

export default router;
