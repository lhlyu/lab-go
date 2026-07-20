import { GitLabApiError } from './gitlab.ts'

export function getErrorMessage(error: unknown): string {
    if (error instanceof GitLabApiError) {
        if (error.status === 401) return 'Personal Access Token 无效或已过期，请重新输入。'
        if (error.status === 403) return '当前 Token 权限不足，请检查 Token 权限设置。'
        if (error.status === 404) return '未找到 GitLab API，请检查实例地址是否正确。'
        return `GitLab 请求失败（${error.status}），请稍后重试。`
    }

    if (error instanceof TypeError) {
        return '无法连接 GitLab，请检查地址、网络、HTTPS 证书或跨域配置。'
    }

    return error instanceof Error ? error.message : '发生未知错误，请稍后重试。'
}

export async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = []
    let nextIndex = 0

    const worker = async (): Promise<void> => {
        while (nextIndex < items.length) {
            const index = nextIndex++
            results[index] = await mapper(items[index]!)
        }
    }

    const workerCount = Math.min(concurrency, items.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return results
}
