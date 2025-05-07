import * as core from '@actions/core'
import * as github from '@actions/github'

export async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token')
    const sizeThreshold = parseInt(core.getInput('size-threshold'), 10)
    const lockFilePath = core.getInput('lockfile-path')
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
    const packageLockChanges = extractPackageLockChanges(diff, lockFilePath)

    core.setOutput('changes-size', packageLockChanges.length)

    if (packageLockChanges.length > sizeThreshold) {
      const commentEnabled =
        core.getInput('comment-enabled').toLowerCase() === 'true'
      const failIfExceeded =
        core.getInput('fail-if-exceeded').toLowerCase() === 'true'

      if (commentEnabled) {
        const comment = generateComment(
          packageLockChanges.length,
          sizeThreshold,
          lockFilePath
        )

        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: pull_number,
          body: comment
        })
      }

      const message = `${lockFilePath} changes (${packageLockChanges.length} lines) exceed threshold of ${sizeThreshold} lines`

      if (failIfExceeded) {
        core.setFailed(message)
      } else {
        core.warning(message)
      }
    } else {
      core.info(
        `${lockFilePath} changes (${packageLockChanges.length} lines) are within threshold of ${sizeThreshold} lines`
      )
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

function extractPackageLockChanges(diff: string, lockFile: string): string[] {
  const lines = diff.split('\n')
  const changes: string[] = []
  let inLockFile = false

  for (const line of lines) {
    if (line.startsWith('diff --git') && line.includes(lockFile)) {
      inLockFile = true
      continue
    } else if (inLockFile && line.startsWith('diff --git')) {
      inLockFile = false
    }

    if (inLockFile && (line.startsWith('+') || line.startsWith('-'))) {
      changes.push(line)
    }
  }

  return changes
}

function generateComment(
  changesCount: number,
  threshold: number,
  lockFile: string
): string {
  const fileName = lockFile.split('/').pop() || lockFile
  return `## ⚠️ Large \`${fileName}\` Changes Detected

This PR contains **${changesCount} lines** of changes to \`${fileName}\`, which exceeds the threshold of ${threshold} lines.

### ⚠️ Possible Accidental Lock File Regeneration
Large changes to \`${fileName}\` often indicate that the lock file was regenerated from scratch, which might be unintentional.

### 🔍 Common Causes:
- Running install without the existing lock file
- Different package manager versions between local and CI
- Switching package managers without migrating the lock file

### 💡 If This Was Unintentional:
1. Restore the original lock file
2. Use the same package manager version as in the project
3. Only run install with an existing lock file

### 🟢 If This Was Intentional:
Please explain in the PR description why the lock file needed to be regenerated`
}
