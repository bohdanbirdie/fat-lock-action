import * as core from '@actions/core'
import * as github from '@actions/github'

export async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token')
    const sizeThreshold = parseInt(core.getInput('size-threshold'), 10)
    const octokit = github.getOctokit(token)
    const context = github.context

    if (!context.payload.pull_request) {
      core.info('This action only works on pull requests')
      return
    }

    const owner = context.repo.owner
    const repo = context.repo.repo
    const pull_number = context.payload.pull_request.number

    const response = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number,
      mediaType: {
        format: 'diff'
      }
    })

    const diff = response.data.toString()
    const packageLockChanges = extractPackageLockChanges(diff)

    core.setOutput('changes-size', packageLockChanges.length)

    if (packageLockChanges.length > sizeThreshold) {
      const comment = generateComment(packageLockChanges.length, sizeThreshold)

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: comment
      })

      core.warning(
        `package-lock.json changes (${packageLockChanges.length} lines) exceed threshold of ${sizeThreshold} lines`
      )
    } else {
      core.info(
        `package-lock.json changes (${packageLockChanges.length} lines) are within threshold of ${sizeThreshold} lines`
      )
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

function extractPackageLockChanges(diff: string): string[] {
  const lines = diff.split('\n')
  const changes: string[] = []
  let inPackageLock = false

  for (const line of lines) {
    if (line.startsWith('diff --git') && line.includes('package-lock.json')) {
      inPackageLock = true
      continue
    } else if (inPackageLock && line.startsWith('diff --git')) {
      inPackageLock = false
    }

    if (inPackageLock && (line.startsWith('+') || line.startsWith('-'))) {
      changes.push(line)
    }
  }

  return changes
}

function generateComment(changesCount: number, threshold: number): string {
  return `## ⚠️ Large package-lock.json Changes Detected

This PR contains **${changesCount} lines** of changes to package-lock.json, which exceeds the threshold of ${threshold} lines.

### 💡 Suggestions:
- Consider if all these dependency changes are necessary
- Review the changes to ensure no unwanted dependencies were added
- If these changes are intentional, please explain in the PR description

For more information, check the [package-lock.json changes](${github.context.payload.pull_request?.html_url}) in this PR.`
}
