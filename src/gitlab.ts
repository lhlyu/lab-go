export interface GitLabConfig {
    baseUrl: string
    token: string
}

export interface GitLabGroup {
    id: number
    name: string
    description: string | null
}

export interface GitLabProject {
    id: number
    name: string
    description: string | null
    default_branch: string | null
    web_url: string
}

export interface GitLabBranch {
    name: string
    default: boolean
}

export interface GitLabPipeline {
    status: string
    ref: string
    web_url: string
}

export interface GitLabMergeRequest {
    iid: number
    title: string
    source_branch: string
    target_branch: string
    web_url: string
}

export class GitLabApiError extends Error {
    readonly status: number

    constructor(status: number, message: string) {
        super(message)
        this.name = 'GitLabApiError'
        this.status = status
    }
}

const API_PATH = '/api/v4'
const PAGE_SIZE = 100

export function normalizeGitLabUrl(value: string): string {
    const url = new URL(value.trim())

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('GitLab 地址仅支持 HTTP 或 HTTPS')
    }

    url.search = ''
    url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '')

    return url.toString().replace(/\/$/, '')
}

function createApiUrl(
    baseUrl: string,
    path: string,
    params: Record<string, string | number | boolean> = {},
): URL {
    const url = new URL(`${baseUrl}${API_PATH}${path}`)

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value))
    }

    return url
}

function formatApiErrorMessage(value: unknown): string {
    if (typeof value === 'string') return value.trim()
    if (Array.isArray(value)) return value.map(formatApiErrorMessage).filter(Boolean).join('；')

    if (value && typeof value === 'object') {
        return Object.entries(value)
            .map(([field, detail]) => {
                const message = formatApiErrorMessage(detail)
                return message ? `${field}：${message}` : ''
            })
            .filter(Boolean)
            .join('；')
    }

    return ''
}

async function request<T>(
    config: GitLabConfig,
    url: URL,
    init: RequestInit = {},
): Promise<{ data: T; response: Response }> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    headers.set('PRIVATE-TOKEN', config.token)

    const response = await fetch(url, { ...init, headers })

    if (!response.ok) {
        let message = response.statusText

        try {
            const payload = (await response.json()) as { message?: unknown }
            message = formatApiErrorMessage(payload.message) || message
        } catch {
            // 保留 HTTP 状态文本。
        }

        throw new GitLabApiError(response.status, message)
    }

    return { data: (await response.json()) as T, response }
}

function getNextPage(response: Response, currentPage: number, itemCount: number): number | null {
    const nextPageHeader = response.headers.get('x-next-page')

    if (nextPageHeader !== null) {
        const nextPage = Number(nextPageHeader)
        return Number.isInteger(nextPage) && nextPage > currentPage ? nextPage : null
    }

    const linkHeader = response.headers.get('link')
    const nextLink = linkHeader?.match(/[?&]page=(\d+)[^>]*>;\s*rel="next"/)

    if (nextLink?.[1]) {
        return Number(nextLink[1])
    }

    return itemCount === PAGE_SIZE ? currentPage + 1 : null
}

async function requestAll<T>(
    config: GitLabConfig,
    path: string,
    params: Record<string, string | number | boolean>,
): Promise<T[]> {
    const items: T[] = []
    let page = 1

    while (page > 0) {
        const url = createApiUrl(config.baseUrl, path, { ...params, page, per_page: PAGE_SIZE })
        const { data, response } = await request<T[]>(config, url)
        items.push(...data)
        page = getNextPage(response, page, data.length) ?? 0
    }

    return items
}

export async function validateConnection(config: GitLabConfig): Promise<void> {
    const url = createApiUrl(config.baseUrl, '/user')
    await request<unknown>(config, url)
}

export function listGroups(config: GitLabConfig): Promise<GitLabGroup[]> {
    return requestAll<GitLabGroup>(config, '/groups', {
        all_available: false,
        order_by: 'name',
        sort: 'asc',
    })
}

export function listGroupProjects(config: GitLabConfig, groupId: number): Promise<GitLabProject[]> {
    return requestAll<GitLabProject>(config, `/groups/${groupId}/projects`, {
        include_subgroups: false,
        with_shared: false,
        simple: true,
        order_by: 'name',
        sort: 'asc',
    })
}

export function listProjectBranches(
    config: GitLabConfig,
    projectId: number,
): Promise<GitLabBranch[]> {
    return requestAll<GitLabBranch>(config, `/projects/${projectId}/repository/branches`, {})
}

export async function getLatestProjectPipeline(
    config: GitLabConfig,
    projectId: number,
): Promise<GitLabPipeline | null> {
    const url = createApiUrl(config.baseUrl, `/projects/${projectId}/pipelines`, {
        order_by: 'id',
        sort: 'desc',
        per_page: 1,
    })
    const { data } = await request<GitLabPipeline[]>(config, url)
    return data[0] ?? null
}

export async function validateProjectBranch(
    config: GitLabConfig,
    projectId: number,
    branch: string,
): Promise<void> {
    const path = `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`
    await request<unknown>(config, createApiUrl(config.baseUrl, path))
}

export async function projectTagExists(
    config: GitLabConfig,
    projectId: number,
    tagName: string,
): Promise<boolean> {
    const path = `/projects/${projectId}/repository/tags/${encodeURIComponent(tagName)}`

    try {
        await request<unknown>(config, createApiUrl(config.baseUrl, path))
        return true
    } catch (error) {
        if (error instanceof GitLabApiError && error.status === 404) return false
        throw error
    }
}

export async function createProjectTag(
    config: GitLabConfig,
    projectId: number,
    tagName: string,
    ref: string,
): Promise<void> {
    const url = createApiUrl(config.baseUrl, `/projects/${projectId}/repository/tags`)
    await request<unknown>(config, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_name: tagName, ref }),
    })
}

export async function createProjectMergeRequest(
    config: GitLabConfig,
    projectId: number,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string,
): Promise<GitLabMergeRequest> {
    const url = createApiUrl(config.baseUrl, `/projects/${projectId}/merge_requests`)
    const { data } = await request<GitLabMergeRequest>(config, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source_branch: sourceBranch,
            target_branch: targetBranch,
            title,
            description,
            remove_source_branch: false,
            squash: false,
        }),
    })
    return data
}
