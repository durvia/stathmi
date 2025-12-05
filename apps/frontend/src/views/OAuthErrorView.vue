<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goToLogin() {
  router.push('/login');
}
</script>

<template>
  <div class="error-page">
    <div class="error-container">
      <!-- 品牌区域 -->
      <div class="brand-section">
        <img src="/default-img/title.png" alt="星图ΣΤΑΘΜΗ" class="brand-logo" />
      </div>

      <!-- 错误卡片 -->
      <div class="error-card">
        <div class="error-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        </div>

        <h2 class="error-title">无法登录</h2>
        <p class="error-desc">本站仅对 <strong>旅程ΟΡΙΖΟΝΤΑΣ</strong> Discord 服务器成员开放。</p>
        <p class="error-hint">请确认您已加入服务器并具有已验证身份组后再尝试登录。</p>

        <div class="action-buttons">
          <a href="https://discord.gg/lvcheng" target="_blank" rel="noopener noreferrer" class="action-btn discord">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
              />
            </svg>
            加入服务器
          </a>
          <button type="button" class="action-btn secondary" @click="goToLogin">返回登录</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background:
    radial-gradient(ellipse at 20% 0%, rgba(59, 130, 246, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 100%, rgba(235, 69, 158, 0.06) 0%, transparent 50%), var(--opz-bg-base);
}

.error-container {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.brand-section {
  text-align: center;
}

.brand-logo {
  height: 8rem;
  width: auto;
  filter: var(--opz-icon-filter);
}

.error-card {
  background: var(--opz-bg-card);
  border: 1px solid var(--opz-border);
  border-radius: 16px;
  padding: 2rem 1.5rem;
  text-align: center;
}

.error-icon {
  width: 4rem;
  height: 4rem;
  margin: 0 auto 1rem;
  color: var(--opz-warning, #f59e0b);
}

.error-icon svg {
  width: 100%;
  height: 100%;
}

.error-title {
  margin: 0 0 0.75rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--opz-text-primary);
}

.error-desc {
  margin: 0 0 0.375rem;
  font-size: 0.9375rem;
  color: var(--opz-text-secondary);
  line-height: 1.5;
}

.error-desc strong {
  color: var(--opz-text-primary);
}

.error-hint {
  margin: 0 0 1.5rem;
  font-size: 0.8125rem;
  color: var(--opz-text-tertiary);
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  border: 1px solid var(--opz-border);
  border-radius: 10px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  text-decoration: none;
}

.action-btn.discord {
  background: #5865f2;
  border-color: #5865f2;
  color: #fff;
}

.action-btn.discord:hover {
  background: #4752c4;
}

.action-btn.secondary {
  background: var(--opz-bg-soft);
  color: var(--opz-text-secondary);
}

.action-btn.secondary:hover {
  border-color: var(--opz-text-tertiary);
  color: var(--opz-text-primary);
}

.btn-icon {
  width: 1.25rem;
  height: 1.25rem;
}

@media (max-width: 480px) {
  .brand-logo {
    height: 4.5rem;
  }
}
</style>
