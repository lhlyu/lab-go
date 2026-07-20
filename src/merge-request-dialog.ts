import {
    createProjectMergeRequest,
    GitLabApiError,
    listProjectBranches,
    type GitLabConfig,
    type GitLabProject,
} from './gitlab.ts'
import { getErrorMessage } from './utils.ts'

let dialogVersion = 0

function getMergeRequestError(error: unknown): string {
    if (error instanceof GitLabApiError) {
        if (error.status === 400) return error.message || '分支或合并请求信息无效'
        if (error.status === 403) return '权限不足，无法创建合并请求'
        if (error.status === 404) return '项目或分支不存在'
        if (error.status === 409) return '相同分支之间已存在合并请求'
    }

    return getErrorMessage(error)
}

export function openMergeRequestDialog(
    dialog: HTMLDialogElement,
    config: GitLabConfig,
    project: GitLabProject,
    handleAuthError: (error: unknown, config: GitLabConfig) => boolean,
): void {
    const currentVersion = ++dialogVersion
    dialog.innerHTML = `
      <div class="dialog-heading">
        <div>
          <p class="eyebrow">Merge Request</p>
          <h3>创建合并请求</h3>
          <p id="merge-request-project-name"></p>
        </div>
        <button id="close-merge-request-dialog" class="dialog-close" type="button" aria-label="关闭">×</button>
      </div>

      <form id="merge-request-form" class="dialog-form">
        <div class="branch-fields">
          <div>
            <label for="merge-source-branch">源分支</label>
            <select id="merge-source-branch" required disabled>
              <option>正在加载分支…</option>
            </select>
          </div>
          <div>
            <label for="merge-target-branch">目标分支</label>
            <select id="merge-target-branch" required disabled>
              <option>正在加载分支…</option>
            </select>
          </div>
        </div>

        <label for="merge-request-title">标题</label>
        <input id="merge-request-title" autocomplete="off" required disabled />

        <label for="merge-request-description">描述</label>
        <textarea id="merge-request-description" rows="4" placeholder="可选" disabled></textarea>

        <p class="merge-policy-note">合并后保留源分支，不压缩提交。</p>
        <p id="merge-request-message" class="dialog-message" aria-live="polite"></p>

        <div class="dialog-footer">
          <button id="cancel-merge-request" class="secondary-button" type="button">取消</button>
          <button id="create-merge-request" class="primary-button compact-button" type="submit" disabled>创建合并请求</button>
        </div>
      </form>
    `

    const form = dialog.querySelector<HTMLFormElement>('#merge-request-form')!
    const sourceSelect = dialog.querySelector<HTMLSelectElement>('#merge-source-branch')!
    const targetSelect = dialog.querySelector<HTMLSelectElement>('#merge-target-branch')!
    const titleInput = dialog.querySelector<HTMLInputElement>('#merge-request-title')!
    const descriptionInput = dialog.querySelector<HTMLTextAreaElement>(
        '#merge-request-description',
    )!
    const message = dialog.querySelector<HTMLParagraphElement>('#merge-request-message')!
    const submitButton = dialog.querySelector<HTMLButtonElement>('#create-merge-request')!
    let titleEdited = false

    dialog.querySelector<HTMLParagraphElement>('#merge-request-project-name')!.textContent =
        project.name

    const closeDialog = (): void => dialog.close()
    dialog
        .querySelector<HTMLButtonElement>('#close-merge-request-dialog')!
        .addEventListener('click', closeDialog)
    dialog
        .querySelector<HTMLButtonElement>('#cancel-merge-request')!
        .addEventListener('click', closeDialog)

    const updateSuggestedTitle = (): void => {
        if (!titleEdited) {
            titleInput.value = `合并 ${sourceSelect.value} 到 ${targetSelect.value}`
        }
    }

    titleInput.addEventListener('input', () => {
        titleEdited = true
    })
    sourceSelect.addEventListener('change', updateSuggestedTitle)
    targetSelect.addEventListener('change', updateSuggestedTitle)

    dialog.showModal()

    void listProjectBranches(config, project.id)
        .then((branches) => {
            if (!dialog.open || currentVersion !== dialogVersion) return
            sourceSelect.replaceChildren()
            targetSelect.replaceChildren()

            for (const branch of branches) {
                const sourceOption = document.createElement('option')
                sourceOption.value = branch.name
                sourceOption.textContent = branch.name
                sourceSelect.append(sourceOption)
                targetSelect.append(sourceOption.cloneNode(true))
            }

            if (branches.length < 2) {
                message.textContent = '至少需要两个分支才能创建合并请求。'
                return
            }

            const targetBranch =
                branches.find((branch) => branch.name === project.default_branch) ??
                branches.find((branch) => branch.default) ??
                branches[0]!
            targetSelect.value = targetBranch.name
            sourceSelect.value =
                branches.find((branch) => branch.name !== targetBranch.name)?.name ?? ''

            sourceSelect.disabled = false
            targetSelect.disabled = false
            titleInput.disabled = false
            descriptionInput.disabled = false
            submitButton.disabled = false
            updateSuggestedTitle()
            sourceSelect.focus()
        })
        .catch((error) => {
            if (!dialog.open || currentVersion !== dialogVersion || handleAuthError(error, config))
                return
            message.textContent = getMergeRequestError(error)
        })

    form.addEventListener('submit', async (event) => {
        event.preventDefault()
        const sourceBranch = sourceSelect.value
        const targetBranch = targetSelect.value
        const title = titleInput.value.trim()

        if (sourceBranch === targetBranch) {
            message.textContent = '源分支和目标分支不能相同。'
            sourceSelect.focus()
            return
        }

        if (!title) {
            message.textContent = '请输入合并请求标题。'
            titleInput.focus()
            return
        }

        sourceSelect.disabled = true
        targetSelect.disabled = true
        titleInput.disabled = true
        descriptionInput.disabled = true
        submitButton.disabled = true
        submitButton.textContent = '正在创建…'
        message.textContent = ''

        try {
            const mergeRequest = await createProjectMergeRequest(
                config,
                project.id,
                sourceBranch,
                targetBranch,
                title,
                descriptionInput.value.trim(),
            )
            if (!dialog.open || currentVersion !== dialogVersion) return

            dialog.innerHTML = `
              <div class="dialog-heading">
                <div>
                  <p class="eyebrow">创建成功</p>
                  <h3 id="merge-request-result-title"></h3>
                  <p id="merge-request-result-branches"></p>
                </div>
              </div>
              <p class="dialog-summary"></p>
              <div class="dialog-footer">
                <button id="close-merge-request-result" class="secondary-button" type="button">关闭</button>
                <a id="open-merge-request" class="primary-button compact-button button-link" target="_blank" rel="noopener noreferrer">查看合并请求</a>
              </div>
            `
            dialog.querySelector<HTMLHeadingElement>('#merge-request-result-title')!.textContent =
                `合并请求 !${mergeRequest.iid}`
            dialog.querySelector<HTMLParagraphElement>(
                '#merge-request-result-branches',
            )!.textContent = `${mergeRequest.source_branch} → ${mergeRequest.target_branch}`
            dialog.querySelector<HTMLParagraphElement>('.dialog-summary')!.textContent =
                mergeRequest.title
            dialog.querySelector<HTMLAnchorElement>('#open-merge-request')!.href =
                mergeRequest.web_url
            dialog
                .querySelector<HTMLButtonElement>('#close-merge-request-result')!
                .addEventListener('click', closeDialog)
        } catch (error) {
            if (!dialog.open || currentVersion !== dialogVersion) return
            if (handleAuthError(error, config)) return
            message.textContent = getMergeRequestError(error)
            sourceSelect.disabled = false
            targetSelect.disabled = false
            titleInput.disabled = false
            descriptionInput.disabled = false
            submitButton.disabled = false
            submitButton.textContent = '创建合并请求'
        }
    })
}
