import {
    getLatestProjectPipeline,
    GitLabApiError,
    type GitLabConfig,
    type GitLabPipeline,
    type GitLabProject,
} from './gitlab.ts'
import { getErrorMessage, mapWithConcurrency } from './utils.ts'

const ACTIVE_PIPELINE_STATUSES = new Set([
    'created',
    'waiting_for_resource',
    'preparing',
    'waiting_for_callback',
    'pending',
    'running',
    'canceling',
])

const PIPELINE_STATUS_LABELS: Record<string, string> = {
    created: '已创建',
    waiting_for_resource: '等待资源',
    preparing: '准备中',
    waiting_for_callback: '等待回调',
    pending: '等待中',
    running: '运行中',
    success: '成功',
    failed: '失败',
    canceling: '取消中',
    canceled: '已取消',
    skipped: '已跳过',
    manual: '等待手动',
    scheduled: '已计划',
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined

export function stopPipelineRefresh(): void {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer)
    refreshTimer = undefined
}

function renderPipelineState(container: HTMLElement, pipeline: GitLabPipeline | null): void {
    container.replaceChildren()
    container.title = ''

    if (!pipeline) {
        container.className = 'pipeline-state'
        container.textContent = '暂无流水线'
        return
    }

    const link = document.createElement('a')
    link.href = pipeline.web_url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.className = `pipeline-link status-${pipeline.status}`
    link.title = `${pipeline.ref} · ${PIPELINE_STATUS_LABELS[pipeline.status] ?? pipeline.status}`

    const status = document.createElement('strong')
    status.textContent = PIPELINE_STATUS_LABELS[pipeline.status] ?? pipeline.status

    const ref = document.createElement('small')
    ref.textContent = pipeline.ref

    link.append(status, ref)
    container.append(link)
}

async function loadPipelineStatuses(
    config: GitLabConfig,
    projects: GitLabProject[],
    containers: Map<number, HTMLElement>,
    isCurrent: () => boolean,
    handleAuthError: (error: unknown, config: GitLabConfig) => boolean,
): Promise<Set<number>> {
    const activeProjectIds = new Set<number>()
    let authError: unknown

    await mapWithConcurrency(projects, 4, async (project) => {
        const container = containers.get(project.id)
        if (!container || !isCurrent()) return

        container.className = 'pipeline-state'
        container.textContent = '加载中…'
        container.title = ''

        try {
            const pipeline = await getLatestProjectPipeline(config, project.id)
            if (!isCurrent()) return
            renderPipelineState(container, pipeline)
            if (pipeline && ACTIVE_PIPELINE_STATUSES.has(pipeline.status)) {
                activeProjectIds.add(project.id)
            }
        } catch (error) {
            if (!isCurrent()) return
            if (error instanceof GitLabApiError && error.status === 401) authError = error
            container.className = 'pipeline-state'
            container.textContent = '加载失败'
            container.title = getErrorMessage(error)
        }
    })

    if (authError && isCurrent()) handleAuthError(authError, config)
    return activeProjectIds
}

export function startPipelineRefresh(
    config: GitLabConfig,
    projects: GitLabProject[],
    containers: Map<number, HTMLElement>,
    isCurrent: () => boolean,
    handleAuthError: (error: unknown, config: GitLabConfig) => boolean,
): void {
    const refresh = async (projectsToRefresh: GitLabProject[]): Promise<void> => {
        stopPipelineRefresh()
        const activeProjectIds = await loadPipelineStatuses(
            config,
            projectsToRefresh,
            containers,
            isCurrent,
            handleAuthError,
        )
        if (!isCurrent()) return

        if (activeProjectIds.size > 0) {
            const activeProjects = projects.filter((project) => activeProjectIds.has(project.id))
            refreshTimer = setTimeout(() => void refresh(activeProjects), 15_000)
        }
    }

    void refresh(projects)
}
