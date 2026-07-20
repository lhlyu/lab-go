import {
    createProjectTag,
    GitLabApiError,
    listProjectBranches,
    projectTagExists,
    validateProjectBranch,
    type GitLabConfig,
    type GitLabProject,
} from './gitlab.ts'
import { getErrorMessage, mapWithConcurrency } from './utils.ts'

interface TagCandidate {
    project: GitLabProject
    ref: string
    ready: boolean
    reason: string
}

interface TagCreationResult {
    project: GitLabProject
    success: boolean
    reason: string
}

let dialogVersion = 0

function getTagOperationError(error: unknown): string {
    if (error instanceof GitLabApiError) {
        if (error.status === 400) return error.message || 'Tag 名称或来源分支无效'
        if (error.status === 401) return 'Token 无效或已过期'
        if (error.status === 403) return '权限不足，请检查 api 权限和 Protected Tag 规则'
        if (error.status === 404) return '项目或分支不存在'
        return `GitLab 请求失败（${error.status}）`
    }

    return getErrorMessage(error)
}

async function checkTagCandidate(
    config: GitLabConfig,
    project: GitLabProject,
    tagName: string,
    ref: string,
): Promise<TagCandidate> {
    if (!ref) return { project, ref, ready: false, reason: '项目没有默认分支' }

    try {
        await validateProjectBranch(config, project.id, ref)
    } catch (error) {
        const reason =
            error instanceof GitLabApiError && error.status === 404
                ? `分支 ${ref} 不存在`
                : getTagOperationError(error)
        return { project, ref, ready: false, reason }
    }

    try {
        if (await projectTagExists(config, project.id, tagName)) {
            return { project, ref, ready: false, reason: `Tag ${tagName} 已存在` }
        }
    } catch (error) {
        return { project, ref, ready: false, reason: getTagOperationError(error) }
    }

    return { project, ref, ready: true, reason: '' }
}

function showTagResults(
    dialog: HTMLDialogElement,
    tagName: string,
    results: TagCreationResult[],
): void {
    const successCount = results.filter((result) => result.success).length

    dialog.innerHTML = `
      <div class="dialog-heading">
        <div>
          <p class="eyebrow">执行结果</p>
          <h3>Tag 创建完成</h3>
        </div>
      </div>
      <p id="tag-result-summary" class="dialog-summary"></p>
      <ul id="tag-result-list" class="tag-result-list"></ul>
      <div class="dialog-footer">
        <button id="close-tag-results" class="primary-button compact-button" type="button">关闭</button>
      </div>
    `

    dialog.querySelector<HTMLParagraphElement>('#tag-result-summary')!.textContent =
        `${tagName}：成功 ${successCount} 个，失败 ${results.length - successCount} 个`

    const resultList = dialog.querySelector<HTMLUListElement>('#tag-result-list')!
    for (const result of results) {
        const item = document.createElement('li')
        const projectName = document.createElement('strong')
        projectName.textContent = result.project.name

        const reason = document.createElement('span')
        reason.textContent = result.reason

        item.append(projectName, reason)
        resultList.append(item)
    }

    dialog
        .querySelector<HTMLButtonElement>('#close-tag-results')!
        .addEventListener('click', () => dialog.close())
}

export function openTagDialog(
    dialog: HTMLDialogElement,
    config: GitLabConfig,
    projects: GitLabProject[],
    onComplete: (tagName: string, projectIds: number[]) => void,
): void {
    const currentVersion = ++dialogVersion
    let stage: 'check' | 'create' = 'check'
    let candidates: TagCandidate[] = []

    dialog.innerHTML = `
      <div class="dialog-heading">
        <div>
          <p class="eyebrow">Git Tag</p>
          <h3>创建 Tag</h3>
          <p id="tag-target-summary"></p>
        </div>
        <button id="close-tag-dialog" class="dialog-close" type="button" aria-label="关闭">×</button>
      </div>

      <form id="tag-form" class="dialog-form">
        <label for="tag-name">Tag 名称</label>
        <input id="tag-name" name="tagName" autocomplete="off" placeholder="例如 v1.0.0" required />

        <label for="tag-ref-mode">来源分支</label>
        <select id="tag-ref-mode">
          <option value="default">各项目默认分支</option>
          <option value="custom">指定同名分支</option>
        </select>

        <div id="custom-ref-field" hidden>
          <label for="tag-custom-ref">分支名称</label>
          <input id="tag-custom-ref" list="project-branches" autocomplete="off" placeholder="例如 main" />
          <datalist id="project-branches"></datalist>
        </div>

        <p id="tag-dialog-message" class="dialog-message" aria-live="polite"></p>

        <section id="tag-confirmation" class="tag-confirmation" hidden>
          <strong id="tag-confirmation-summary"></strong>
          <ul id="tag-check-list"></ul>
          <p>创建 Tag 可能触发项目的 CI/CD 流水线，权限由 GitLab 最终校验。</p>
        </section>

        <div class="dialog-footer">
          <button id="cancel-tag-dialog" class="secondary-button" type="button">取消</button>
          <button id="tag-primary-action" class="primary-button compact-button" type="submit">检查并继续</button>
        </div>
      </form>
    `

    const form = dialog.querySelector<HTMLFormElement>('#tag-form')!
    const tagNameInput = dialog.querySelector<HTMLInputElement>('#tag-name')!
    const refMode = dialog.querySelector<HTMLSelectElement>('#tag-ref-mode')!
    const customRefField = dialog.querySelector<HTMLDivElement>('#custom-ref-field')!
    const customRefInput = dialog.querySelector<HTMLInputElement>('#tag-custom-ref')!
    const message = dialog.querySelector<HTMLParagraphElement>('#tag-dialog-message')!
    const confirmation = dialog.querySelector<HTMLElement>('#tag-confirmation')!
    const confirmationSummary = dialog.querySelector<HTMLElement>('#tag-confirmation-summary')!
    const checkList = dialog.querySelector<HTMLUListElement>('#tag-check-list')!
    const primaryButton = dialog.querySelector<HTMLButtonElement>('#tag-primary-action')!

    dialog.querySelector<HTMLParagraphElement>('#tag-target-summary')!.textContent =
        projects.length === 1 ? projects[0]!.name : `已选择 ${projects.length} 个项目`

    const closeDialog = (): void => dialog.close()
    dialog
        .querySelector<HTMLButtonElement>('#close-tag-dialog')!
        .addEventListener('click', closeDialog)
    dialog
        .querySelector<HTMLButtonElement>('#cancel-tag-dialog')!
        .addEventListener('click', closeDialog)

    const resetCheck = (): void => {
        message.textContent = ''
        if (stage === 'check') return
        stage = 'check'
        candidates = []
        confirmation.hidden = true
        primaryButton.disabled = false
        primaryButton.textContent = '检查并继续'
    }

    const disableFields = (disabled: boolean): void => {
        tagNameInput.disabled = disabled
        refMode.disabled = disabled
        customRefInput.disabled = disabled
    }

    refMode.addEventListener('change', () => {
        customRefField.hidden = refMode.value !== 'custom'
        resetCheck()
        if (!customRefField.hidden) customRefInput.focus()
    })
    tagNameInput.addEventListener('input', resetCheck)
    customRefInput.addEventListener('input', resetCheck)

    if (projects.length === 1) {
        void listProjectBranches(config, projects[0]!.id)
            .then((branches) => {
                if (!dialog.open || currentVersion !== dialogVersion) return
                const dataList = dialog.querySelector<HTMLDataListElement>('#project-branches')
                if (!dataList) return

                for (const branch of branches) {
                    const option = document.createElement('option')
                    option.value = branch.name
                    dataList.append(option)
                }
            })
            .catch(() => {
                // 分支建议加载失败时仍允许手动输入。
            })
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault()
        const tagName = tagNameInput.value.trim()
        const customRef = customRefInput.value.trim()

        if (!tagName) {
            message.textContent = '请输入 Tag 名称。'
            tagNameInput.focus()
            return
        }

        if (refMode.value === 'custom' && !customRef) {
            message.textContent = '请输入来源分支名称。'
            customRefInput.focus()
            return
        }

        primaryButton.disabled = true
        disableFields(true)

        if (stage === 'check') {
            message.textContent = `正在检查 ${projects.length} 个项目…`
            const getRef = (project: GitLabProject): string =>
                refMode.value === 'custom' ? customRef : (project.default_branch ?? '')

            candidates = await mapWithConcurrency(projects, 3, (project) =>
                checkTagCandidate(config, project, tagName, getRef(project)),
            )
            if (!dialog.open || currentVersion !== dialogVersion) return

            const readyCount = candidates.filter((candidate) => candidate.ready).length
            confirmationSummary.textContent = `可创建 ${readyCount} 个，不可创建 ${candidates.length - readyCount} 个`
            checkList.replaceChildren()

            for (const candidate of candidates.filter((item) => !item.ready)) {
                const item = document.createElement('li')
                item.textContent = `${candidate.project.name}：${candidate.reason}`
                checkList.append(item)
            }

            confirmation.hidden = false
            message.textContent = ''
            stage = 'create'
            disableFields(false)
            primaryButton.disabled = readyCount === 0
            primaryButton.textContent = `在 ${readyCount} 个项目创建 Tag`
            return
        }

        const readyCandidates = candidates.filter((candidate) => candidate.ready)
        message.textContent = `正在创建 ${tagName}…`
        primaryButton.textContent = '正在创建…'

        const createdResults = await mapWithConcurrency(readyCandidates, 3, async (candidate) => {
            try {
                await createProjectTag(config, candidate.project.id, tagName, candidate.ref)
                return {
                    project: candidate.project,
                    success: true,
                    reason: `已从 ${candidate.ref} 创建`,
                }
            } catch (error) {
                return {
                    project: candidate.project,
                    success: false,
                    reason: getTagOperationError(error),
                }
            }
        })
        if (!dialog.open || currentVersion !== dialogVersion) return

        const skippedResults = candidates
            .filter((candidate) => !candidate.ready)
            .map<TagCreationResult>((candidate) => ({
                project: candidate.project,
                success: false,
                reason: candidate.reason,
            }))

        onComplete(
            tagName,
            createdResults.filter((result) => result.success).map((result) => result.project.id),
        )
        showTagResults(dialog, tagName, [...createdResults, ...skippedResults])
    })

    dialog.showModal()
    tagNameInput.focus()
}
