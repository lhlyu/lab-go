import type { GitLabConfig } from './gitlab.ts'

export const DEFAULT_GITLAB_URL = 'https://gitlab.com'

export const STORAGE_KEYS = {
    baseUrl: 'gitlab.baseUrl',
    token: 'gitlab.personalAccessToken',
    selectedGroupId: 'gitlab.selectedGroupId',
} as const

export function readStoredValue(key: string): string {
    try {
        return localStorage.getItem(key)?.trim() ?? ''
    } catch {
        return ''
    }
}

export function readConfig(): GitLabConfig | null {
    const baseUrl = readStoredValue(STORAGE_KEYS.baseUrl)
    const token = readStoredValue(STORAGE_KEYS.token)
    return baseUrl && token ? { baseUrl, token } : null
}

export function saveConfig(config: GitLabConfig): void {
    const previousBaseUrl = readStoredValue(STORAGE_KEYS.baseUrl)
    if (previousBaseUrl !== config.baseUrl) {
        localStorage.removeItem(STORAGE_KEYS.selectedGroupId)
    }

    localStorage.setItem(STORAGE_KEYS.baseUrl, config.baseUrl)
    localStorage.setItem(STORAGE_KEYS.token, config.token)
}

export function clearToken(): void {
    try {
        localStorage.removeItem(STORAGE_KEYS.token)
    } catch {
        // 存储不可用时，重新渲染入口页即可。
    }
}

export function clearConnectionState(): void {
    try {
        localStorage.removeItem(STORAGE_KEYS.token)
        localStorage.removeItem(STORAGE_KEYS.selectedGroupId)
    } catch {
        // 存储不可用时，重新渲染入口页即可。
    }
}

export function saveSelectedGroup(groupId: number): void {
    try {
        localStorage.setItem(STORAGE_KEYS.selectedGroupId, String(groupId))
    } catch {
        // 选择状态保存失败不影响项目浏览。
    }
}
