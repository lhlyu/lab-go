import './style.css'
import {
    GitLabApiError,
    getLatestProjectTag,
    listGroupProjects,
    listGroups,
    normalizeGitLabUrl,
    validateConnection,
    type GitLabConfig,
    type GitLabGroup,
    type GitLabProject,
} from './gitlab.ts'
import { openMergeRequestDialog } from './merge-request-dialog.ts'
import { startPipelineRefresh, stopPipelineRefresh } from './pipeline.ts'
import {
    clearConnectionState,
    clearToken,
    DEFAULT_GITLAB_URL,
    readConfig,
    readStoredValue,
    saveConfig,
    saveSelectedGroup,
    STORAGE_KEYS,
} from './storage.ts'
import { openTagDialog } from './tag-dialog.ts'
import { getErrorMessage, mapWithConcurrency } from './utils.ts'

const app = document.querySelector<HTMLDivElement>('#app')!
const GITHUB_REPOSITORY_URL = 'https://github.com/lhlyu/lab-go'
const selectedProjectIds = new Set<number>()
let projectRequestVersion = 0

function githubRepositoryLink(label: string): string {
    return `
      <a
        class="github-link"
        href="${GITHUB_REPOSITORY_URL}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="在 GitHub 查看 LabGo 开源仓库"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 7.16a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.25C22 6.59 17.52 2 12 2Z" />
        </svg>
        <span>${label}</span>
      </a>
    `
}

function renderLogin(message = '', preferredBaseUrl = ''): void {
    stopPipelineRefresh()
    projectRequestVersion += 1
    app.className = 'login-page'
    app.innerHTML = `
    <main class="login-shell">
      <section class="login-card" aria-labelledby="login-title">
        <div class="card-heading">
          <p class="eyebrow">LabGo</p>
          <h1 id="login-title">连接 GitLab</h1>
          <p>输入实例地址和 Personal Access Token</p>
        </div>

        <form id="connection-form" novalidate>
          <label for="gitlab-url">GitLab 地址</label>
          <input id="gitlab-url" name="baseUrl" type="url" inputmode="url" autocomplete="url" required />
          <p class="field-hint">例如：https://gitlab.com</p>

          <label for="gitlab-token">Personal Access Token</label>
          <div class="token-field">
            <input id="gitlab-token" name="token" type="password" autocomplete="off" required />
            <button id="toggle-token" type="button" aria-label="显示 Token">显示</button>
          </div>
          <p class="field-hint">
            创建合并请求或 Tag 需要授予
            <a id="token-settings-link" target="_blank" rel="noopener noreferrer"><code>api</code> 权限</a>
          </p>

          <p id="form-message" class="form-message" aria-live="polite"></p>
          <button id="connect-button" class="primary-button" type="submit">
            <span>进入管理页面</span>
            <span aria-hidden="true">→</span>
          </button>
        </form>

        <p class="security-note">请仅在可信设备上使用，Token 将保存在当前浏览器的 localStorage 中</p>
        <div class="login-project-link">${githubRepositoryLink('GitHub 开源仓库')}</div>
      </section>
    </main>
  `

    const form = document.querySelector<HTMLFormElement>('#connection-form')!
    const urlInput = document.querySelector<HTMLInputElement>('#gitlab-url')!
    const tokenInput = document.querySelector<HTMLInputElement>('#gitlab-token')!
    const tokenSettingsLink = document.querySelector<HTMLAnchorElement>('#token-settings-link')!
    const toggleToken = document.querySelector<HTMLButtonElement>('#toggle-token')!
    const submitButton = document.querySelector<HTMLButtonElement>('#connect-button')!
    const formMessage = document.querySelector<HTMLParagraphElement>('#form-message')!

    urlInput.value = preferredBaseUrl || readStoredValue(STORAGE_KEYS.baseUrl) || DEFAULT_GITLAB_URL
    formMessage.textContent = message
    formMessage.hidden = !message

    const updateTokenSettingsLink = (): void => {
        try {
            const baseUrl = normalizeGitLabUrl(urlInput.value)
            tokenSettingsLink.href = `${baseUrl}/-/user_settings/personal_access_tokens`
            tokenSettingsLink.removeAttribute('aria-disabled')
        } catch {
            tokenSettingsLink.removeAttribute('href')
            tokenSettingsLink.setAttribute('aria-disabled', 'true')
        }
    }

    updateTokenSettingsLink()
    urlInput.addEventListener('input', updateTokenSettingsLink)

    toggleToken.addEventListener('click', () => {
        const shouldShow = tokenInput.type === 'password'
        tokenInput.type = shouldShow ? 'text' : 'password'
        toggleToken.textContent = shouldShow ? '隐藏' : '显示'
        toggleToken.setAttribute('aria-label', shouldShow ? '隐藏 Token' : '显示 Token')
    })

    form.addEventListener('submit', async (event) => {
        event.preventDefault()
        formMessage.hidden = true

        if (!urlInput.value.trim() || !tokenInput.value.trim()) {
            formMessage.textContent = '请完整填写 GitLab 地址和 Personal Access Token'
            formMessage.hidden = false
            return
        }

        let config: GitLabConfig
        try {
            config = {
                baseUrl: normalizeGitLabUrl(urlInput.value),
                token: tokenInput.value.trim(),
            }
        } catch (error) {
            formMessage.textContent = getErrorMessage(error)
            formMessage.hidden = false
            return
        }

        submitButton.disabled = true
        submitButton.firstElementChild!.textContent = '正在验证连接…'

        try {
            await validateConnection(config)
            saveConfig(config)
            renderDashboard(config)
        } catch (error) {
            formMessage.textContent = getErrorMessage(error)
            formMessage.hidden = false
            submitButton.disabled = false
            submitButton.firstElementChild!.textContent = '进入管理页面'
        }
    })
}

function createState(title: string, description: string, retry?: () => void): HTMLDivElement {
    const state = document.createElement('div')
    state.className = 'content-state'

    const badge = document.createElement('span')
    badge.className = 'state-badge'
    badge.textContent = retry ? '!' : '·'

    const heading = document.createElement('h3')
    heading.textContent = title

    const copy = document.createElement('p')
    copy.textContent = description

    state.append(badge, heading, copy)

    if (retry) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'secondary-button'
        button.textContent = '重新加载'
        button.addEventListener('click', retry)
        state.append(button)
    }

    return state
}

function handleAuthError(error: unknown, config: GitLabConfig): boolean {
    if (error instanceof GitLabApiError && error.status === 401) {
        clearToken()
        renderLogin(getErrorMessage(error), config.baseUrl)
        return true
    }

    return false
}

function renderDashboard(config: GitLabConfig): void {
    stopPipelineRefresh()
    projectRequestVersion += 1
    app.className = 'dashboard-page'
    app.innerHTML = `
    <div class="dashboard-shell">
      <header class="topbar">
        <div class="brand">
          <div>
            <strong>Gitlab 助手</strong>
            <a id="instance-name" target="_blank" rel="noopener noreferrer"></a>
          </div>
        </div>
        <div class="topbar-actions">
          ${githubRepositoryLink('GitHub')}
          <button id="change-connection" class="secondary-button" type="button">更换连接</button>
        </div>
      </header>

      <main class="workspace">
        <aside class="group-panel" aria-labelledby="group-heading">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Workspace</p>
              <h1 id="group-heading">项目组</h1>
            </div>
            <span id="group-count" class="count-badge">—</span>
          </div>
          <nav id="group-list" class="group-list" aria-label="项目组列表" aria-live="polite"></nav>
        </aside>

        <section class="project-panel" aria-labelledby="project-heading">
          <div class="panel-heading project-heading-row">
            <div>
              <p class="eyebrow">Repositories</p>
              <h2 id="project-heading">选择一个项目组</h2>
            </div>
            <div class="project-actions">
              <span id="project-count" class="count-badge">—</span>
              <button id="batch-tag-button" class="secondary-button" type="button" hidden></button>
            </div>
          </div>
          <div id="project-list" class="project-list" aria-live="polite"></div>
        </section>
      </main>
      <dialog id="tag-dialog" class="action-dialog" aria-label="创建 Git Tag"></dialog>
      <dialog id="merge-request-dialog" class="action-dialog" aria-label="创建合并请求"></dialog>
    </div>
  `

    const instanceLink = document.querySelector<HTMLAnchorElement>('#instance-name')!
    instanceLink.href = config.baseUrl
    instanceLink.textContent = config.baseUrl
    document
        .querySelector<HTMLButtonElement>('#change-connection')!
        .addEventListener('click', () => {
            clearConnectionState()
            renderLogin('', config.baseUrl)
        })

    void loadGroups(config)
}

async function loadGroups(config: GitLabConfig): Promise<void> {
    const requestVersion = projectRequestVersion
    const groupList = document.querySelector<HTMLElement>('#group-list')
    const projectList = document.querySelector<HTMLElement>('#project-list')

    if (!groupList || !projectList) return

    groupList.replaceChildren(createState('正在加载', '正在获取你的项目组…'))
    projectList.replaceChildren(createState('等待项目组', '项目组加载完成后，将自动展示直属项目'))

    try {
        const groups = await listGroups(config)
        if (requestVersion !== projectRequestVersion) return
        renderGroups(config, groups)
    } catch (error) {
        if (requestVersion !== projectRequestVersion) return
        if (handleAuthError(error, config)) return
        groupList.replaceChildren(
            createState('项目组加载失败', getErrorMessage(error), () => void loadGroups(config)),
        )
        projectList.replaceChildren(createState('暂时无法展示项目', '请先重新加载左侧项目组'))
    }
}

function renderGroups(config: GitLabConfig, groups: GitLabGroup[]): void {
    const groupList = document.querySelector<HTMLElement>('#group-list')!
    const groupCount = document.querySelector<HTMLSpanElement>('#group-count')!
    const projectList = document.querySelector<HTMLElement>('#project-list')!
    const projectHeading = document.querySelector<HTMLHeadingElement>('#project-heading')!
    const projectCount = document.querySelector<HTMLSpanElement>('#project-count')!
    const groupButtons = new Map<number, HTMLButtonElement>()

    groupCount.textContent = String(groups.length)
    groupList.replaceChildren()

    if (groups.length === 0) {
        groupList.append(createState('暂无项目组', '当前用户还没有加入任何项目组'))
        projectHeading.textContent = '暂无项目'
        projectCount.textContent = '0'
        projectList.replaceChildren(createState('暂无可展示内容', '加入项目组后，项目会显示在这里'))
        return
    }

    const selectGroup = (group: GitLabGroup, button: HTMLButtonElement): void => {
        for (const item of groupList.querySelectorAll<HTMLButtonElement>('.group-item')) {
            const selected = item === button
            item.classList.toggle('is-active', selected)
            item.setAttribute('aria-current', selected ? 'true' : 'false')
        }

        projectHeading.textContent = group.name
        projectCount.textContent = '—'
        saveSelectedGroup(group.id)
        void loadProjects(config, group)
    }

    for (const group of groups) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'group-item'

        const label = document.createElement('span')
        label.className = 'group-label'

        const name = document.createElement('strong')
        name.textContent = group.name

        const description = document.createElement('small')
        description.textContent = group.description?.trim() || '暂无描述'

        label.append(name, description)
        button.append(label)
        button.addEventListener('click', () => selectGroup(group, button))
        groupButtons.set(group.id, button)
        groupList.append(button)
    }

    const storedGroupId = Number(readStoredValue(STORAGE_KEYS.selectedGroupId))
    const initialGroup = groups.find((group) => group.id === storedGroupId) ?? groups[0]!
    selectGroup(initialGroup, groupButtons.get(initialGroup.id)!)
}

async function loadProjects(config: GitLabConfig, group: GitLabGroup): Promise<void> {
    stopPipelineRefresh()
    const requestVersion = ++projectRequestVersion
    const projectList = document.querySelector<HTMLElement>('#project-list')

    if (!projectList) return
    resetProjectActions()
    projectList.replaceChildren(createState('正在加载', `正在获取 ${group.name} 的直属项目…`))

    try {
        const projects = await listGroupProjects(config, group.id)
        if (requestVersion !== projectRequestVersion) return
        renderProjects(config, projects)
    } catch (error) {
        if (requestVersion !== projectRequestVersion || handleAuthError(error, config)) return
        projectList.replaceChildren(
            createState(
                '项目加载失败',
                getErrorMessage(error),
                () => void loadProjects(config, group),
            ),
        )
    }
}

function resetProjectActions(): void {
    selectedProjectIds.clear()

    for (const checkbox of document.querySelectorAll<HTMLInputElement>('.project-checkbox')) {
        checkbox.checked = false
        checkbox.indeterminate = false
    }

    const batchButton = document.querySelector<HTMLButtonElement>('#batch-tag-button')
    if (batchButton) batchButton.hidden = true
}

function renderProjects(config: GitLabConfig, projects: GitLabProject[]): void {
    const projectList = document.querySelector<HTMLElement>('#project-list')!
    const projectCount = document.querySelector<HTMLSpanElement>('#project-count')!
    const batchButton = document.querySelector<HTMLButtonElement>('#batch-tag-button')!
    const tagDialog = document.querySelector<HTMLDialogElement>('#tag-dialog')!
    const mergeRequestDialog = document.querySelector<HTMLDialogElement>('#merge-request-dialog')!

    projectCount.textContent = String(projects.length)
    selectedProjectIds.clear()
    batchButton.hidden = true
    projectList.replaceChildren()

    if (projects.length === 0) {
        projectList.append(createState('暂无直属项目', '这个项目组当前没有可访问的直属项目'))
        return
    }

    const header = document.createElement('div')
    header.className = 'project-table-header'

    const selectAll = document.createElement('input')
    selectAll.type = 'checkbox'
    selectAll.className = 'project-checkbox'
    selectAll.setAttribute('aria-label', '选择全部项目')

    const idHeading = document.createElement('span')
    idHeading.textContent = '项目 ID'

    const infoHeading = document.createElement('span')
    infoHeading.textContent = '项目名称与描述'

    const defaultBranchHeading = document.createElement('span')
    defaultBranchHeading.textContent = '默认分支'

    const latestTagHeading = document.createElement('span')
    latestTagHeading.textContent = '最新 Tag'

    const pipelineHeading = document.createElement('span')
    pipelineHeading.textContent = '流水线'

    const actionHeading = document.createElement('span')
    actionHeading.className = 'action-heading'
    actionHeading.textContent = '操作'

    header.append(
        selectAll,
        idHeading,
        infoHeading,
        defaultBranchHeading,
        latestTagHeading,
        pipelineHeading,
        actionHeading,
    )
    projectList.append(header)

    const checkboxes = new Map<number, HTMLInputElement>()
    const latestTagContainers = new Map<number, HTMLElement>()
    const pipelineContainers = new Map<number, HTMLElement>()
    const handleTagComplete = (tagName: string, projectIds: number[]): void => {
        resetProjectActions()
        for (const projectId of projectIds) {
            const container = latestTagContainers.get(projectId)
            if (!container) continue
            container.textContent = tagName
            container.title = tagName
        }
    }
    const syncSelection = (): void => {
        selectAll.checked = selectedProjectIds.size === projects.length
        selectAll.indeterminate = selectedProjectIds.size > 0 && !selectAll.checked
        batchButton.hidden = selectedProjectIds.size === 0
        batchButton.textContent = `为 ${selectedProjectIds.size} 个项目打 Tag`
    }

    selectAll.addEventListener('change', () => {
        selectedProjectIds.clear()
        for (const project of projects) {
            if (selectAll.checked) selectedProjectIds.add(project.id)
            checkboxes.get(project.id)!.checked = selectAll.checked
        }
        syncSelection()
    })

    batchButton.onclick = () => {
        const selectedProjects = projects.filter((project) => selectedProjectIds.has(project.id))
        if (selectedProjects.length > 0) {
            openTagDialog(tagDialog, config, selectedProjects, handleTagComplete)
        }
    }

    for (const project of projects) {
        const row = document.createElement('div')
        row.className = 'project-row'

        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.className = 'project-checkbox'
        checkbox.setAttribute('aria-label', `选择项目 ${project.name}`)
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) selectedProjectIds.add(project.id)
            else selectedProjectIds.delete(project.id)
            syncSelection()
        })
        checkboxes.set(project.id, checkbox)

        const id = document.createElement('span')
        id.className = 'project-id'
        id.textContent = `#${project.id}`

        const info = document.createElement('div')
        info.className = 'project-info'

        const link = document.createElement('a')
        link.href = project.web_url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = project.name

        const description = document.createElement('small')
        description.textContent = project.description?.trim() || '暂无描述'

        const defaultBranch = document.createElement('span')
        defaultBranch.className = 'project-default-branch'

        const defaultBranchName = document.createElement('code')
        defaultBranchName.textContent = project.default_branch || '暂无'
        defaultBranch.append(defaultBranchName)

        const latestTag = document.createElement('code')
        latestTag.className = 'project-latest-tag'
        latestTagContainers.set(project.id, latestTag)

        const tagButton = document.createElement('button')
        tagButton.type = 'button'
        tagButton.className = 'row-action-button'
        tagButton.textContent = '创建 Tag'
        tagButton.addEventListener('click', () =>
            openTagDialog(tagDialog, config, [project], handleTagComplete),
        )

        const mergeRequestButton = document.createElement('button')
        mergeRequestButton.type = 'button'
        mergeRequestButton.className = 'row-action-button'
        mergeRequestButton.textContent = '创建 MR'
        mergeRequestButton.addEventListener('click', () =>
            openMergeRequestDialog(mergeRequestDialog, config, project, handleAuthError),
        )

        const rowActions = document.createElement('div')
        rowActions.className = 'row-actions'
        rowActions.append(mergeRequestButton, tagButton)

        const pipelineState = document.createElement('div')
        pipelineState.className = 'pipeline-state'
        pipelineState.textContent = '加载中…'
        pipelineContainers.set(project.id, pipelineState)

        info.append(link, description)
        row.append(checkbox, id, info, defaultBranch, latestTag, pipelineState, rowActions)
        projectList.append(row)
    }

    const requestVersion = projectRequestVersion
    void mapWithConcurrency(projects, 4, async (project) => {
        const container = latestTagContainers.get(project.id)
        if (!container || requestVersion !== projectRequestVersion) return

        try {
            const tag = await getLatestProjectTag(config, project.id)
            if (requestVersion !== projectRequestVersion || !tag) return
            container.textContent = tag.name
            container.title = tag.name
        } catch (error) {
            if (requestVersion !== projectRequestVersion) return
            if (error instanceof GitLabApiError && error.status === 401) {
                handleAuthError(error, config)
            }
        }
    })
    startPipelineRefresh(
        config,
        projects,
        pipelineContainers,
        () => requestVersion === projectRequestVersion,
        handleAuthError,
    )
}

const config = readConfig()
if (config) renderDashboard(config)
else renderLogin()
