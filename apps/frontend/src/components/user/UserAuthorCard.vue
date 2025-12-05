<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import type { UserProfileExtended, Role } from '@opz-hub/shared';
import { useAuthorFallback } from '@/composables/useAuthorFallback';
import { useRolesStore } from '@/stores/roles';
import { useQuickConfirm } from '@/composables/useQuickConfirm';
import RoleBadge from './RoleBadge.vue';

const props = defineProps<{
  profile: UserProfileExtended;
  isFollowing: boolean;
  isOwnProfile: boolean;
  creationDays: number;
  totalPosts?: number;
  pending?: boolean;
}>();

const emit = defineEmits<{
  toggleFollow: [];
}>();

const rolesStore = useRolesStore();
const { roleMap } = storeToRefs(rolesStore);

// 作者信息回退
const authorInfo = computed(() => ({
  authorAvatar: props.profile.avatar,
  authorName: props.profile.nickname ?? props.profile.globalName ?? props.profile.username,
  authorDiscordRoles: props.profile.discordRoles,
}));

const { avatarSrc, authorDisplayName, authorColor, handleAvatarError } = useAuthorFallback(authorInfo);

// 按 position 降序排列的角色列表（必须同时有图标和配色）
const sortedRoles = computed((): Role[] => {
  const roleIds = props.profile.discordRoles;
  const map = roleMap.value;
  const roles: Role[] = [];

  for (const id of roleIds) {
    const role = map.get(id);
    const hasIcon = role?.iconUrl || role?.emoji;
    const hasColor = role?.primaryColor && role.primaryColor !== '#000000';
    if (role && hasIcon && hasColor) {
      roles.push(role);
    }
  }

  return roles.sort((a, b) => b.position - a.position);
});

// 格式化数字
function formatNumber(n: number): string {
  if (n >= 10000) {
    return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
  }
  if (n >= 1000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return n.toString();
}

// 生成角色胶囊样式
function getRoleStyle(color: string | null) {
  // 无颜色或黑色(#000000)视为默认，使用 CSS 变量适配主题
  if (!color || color === '#000000') return undefined;
  return {
    backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
    color: color,
  };
}

const { confirm } = useQuickConfirm();

async function handleUnfollow(e: Event) {
  const confirmed = await confirm(e, '确定要取消关注吗？');
  if (!confirmed) return;
  emit('toggleFollow');
}
</script>

<template>
  <div class="author-card">
    <!-- 头像 -->
    <img :src="avatarSrc" alt="" class="author-avatar" @error="handleAvatarError" />

    <!-- 显示名 + 创作天数 -->
    <div class="author-info">
      <div class="author-name" :style="authorColor ? { color: authorColor } : undefined">
        {{ authorDisplayName }}
      </div>
      <div class="meta-info">
        <div class="meta-item">
          <img src="@/assets/icons/calendar.svg" alt="" class="meta-icon" />
          <span>创作 {{ creationDays }} 天</span>
        </div>
        <span v-if="totalPosts !== undefined" class="meta-divider">·</span>
        <div v-if="totalPosts !== undefined" class="meta-item">
          <span>{{ totalPosts }} 个作品</span>
        </div>
      </div>
    </div>

    <!-- 身份组列表 -->
    <div v-if="sortedRoles.length > 0" class="roles-list">
      <div v-for="role in sortedRoles" :key="role.id" class="role-item" :style="getRoleStyle(role.primaryColor)">
        <RoleBadge :role="role" />
        <span class="role-name">{{ role.name }}</span>
      </div>
    </div>

    <!-- 统计数据 -->
    <div class="stats-grid">
      <div class="stat-item">
        <span class="stat-value">{{ formatNumber(profile.totalLikes) }}</span>
        <span class="stat-label">获赞</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ formatNumber(profile.totalComments) }}</span>
        <span class="stat-label">评论</span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="action-buttons">
      <template v-if="!isOwnProfile">
        <button
          v-if="!isFollowing"
          type="button"
          class="action-btn primary"
          :disabled="pending"
          @click="emit('toggleFollow')"
        >
          关注
        </button>
        <button v-else type="button" class="action-btn following" :disabled="pending" @click="handleUnfollow">
          已关注
        </button>
      </template>
      <a
        :href="`https://discord.com/users/${profile.id}`"
        target="_blank"
        rel="noopener noreferrer"
        class="action-btn discord"
      >
        <img src="@/assets/icons/discord.svg" alt="" class="btn-icon" />
        主页
      </a>
    </div>
  </div>
</template>

<style scoped>
.author-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1.25rem;
  background: var(--opz-bg-card);
  border: 1px solid var(--opz-border);
  border-radius: 12px;
}

.author-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--opz-bg-elevated);
}

.author-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.author-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--opz-text-primary);
  text-align: center;
  word-break: break-word;
}

.meta-info {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--opz-text-tertiary);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.meta-divider {
  color: var(--opz-text-quaternary, rgba(0, 0, 0, 0.25));
}

.meta-icon {
  width: 0.875rem;
  height: 0.875rem;
  opacity: 0.5;
}

/* 浅色主题下图标用深色，深色主题下用浅色 */
:root[data-theme='dark'] .meta-icon,
:root[data-theme='dark'] .btn-icon {
  filter: invert(1);
}

.roles-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  max-width: 100%;
}

.role-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0.25rem 0.625rem;
  background: var(--opz-bg-soft);
  border: 1px solid var(--opz-border);
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--opz-text-primary);
}

.role-name {
  white-space: nowrap;
}

.stats-grid {
  display: flex;
  justify-content: space-evenly;
  gap: 1rem;
  width: 100%;
  padding: 0.75rem 0;
  border-top: 1px solid var(--opz-border);
  border-bottom: 1px solid var(--opz-border);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.stat-value {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--opz-text-primary);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--opz-text-tertiary);
}

.action-buttons {
  display: flex;
  gap: 0.5rem;
  width: 100%;
  margin-top: 0.25rem;
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--opz-border);
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  text-decoration: none;
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.action-btn.primary {
  background: var(--opz-primary);
  border-color: var(--opz-primary);
  color: white;
}

.action-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.action-btn.following {
  background: var(--opz-bg-soft);
  color: var(--opz-text-secondary);
  border-color: var(--opz-border);
}

.action-btn.following:hover:not(:disabled) {
  border-color: var(--opz-danger);
  color: var(--opz-danger);
  background: color-mix(in srgb, var(--opz-danger) 10%, var(--opz-bg-soft));
}

.action-btn.discord {
  background: var(--opz-bg-soft);
  color: var(--opz-text-secondary);
  border-color: var(--opz-border);
}

.action-btn.discord:hover {
  border-color: #5865f2;
  color: #5865f2;
  background: color-mix(in srgb, #5865f2 10%, var(--opz-bg-soft));
}

/* Discord 蓝色 filter：把黑色图标变成 #5865f2 */
.action-btn.discord:hover .btn-icon {
  filter: brightness(0) saturate(100%) invert(41%) sepia(52%) saturate(2108%) hue-rotate(218deg) brightness(101%)
    contrast(91%);
}

:root[data-theme='dark'] .action-btn.discord:hover .btn-icon {
  filter: brightness(0) saturate(100%) invert(41%) sepia(52%) saturate(2108%) hue-rotate(218deg) brightness(101%)
    contrast(91%);
}

.btn-icon {
  width: 1rem;
  height: 1rem;
}

/* 移动端紧凑布局 */
@media (max-width: 767px) {
  .author-card {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    padding: 1rem;
  }

  .author-avatar {
    width: 56px;
    height: 56px;
  }

  .author-info {
    flex: 1;
    align-items: flex-start;
    align-self: center;
  }

  .author-name {
    font-size: 1rem;
    text-align: left;
  }

  .roles-list {
    width: 100%;
    justify-content: flex-start;
    order: 3;
  }

  .stats-grid {
    width: 100%;
    order: 4;
    padding: 0.5rem 0;
    gap: 0.5rem;
  }

  .stat-value {
    font-size: 1rem;
  }

  .action-buttons {
    order: 5;
    width: 100%;
    margin-top: 0;
  }

  .action-btn {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
  }
}
</style>
