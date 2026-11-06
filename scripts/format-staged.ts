#!/usr/bin/env bun

// Pre-commit hook: format staged files with bun fmt (config in bunfig.toml).
// Installed by `bun install`, whose prepare script points core.hooksPath at .githooks.
// Skip it for one commit with `git commit --no-verify`.
//
// Fully staged files are formatted in place and re-staged. Files that also have
// unstaged changes get only their staged content formatted, written straight to
// the index, so unstaged work is never swept into the commit. (`bun fmt --staged`
// refuses such files, which would block commits made with `git add -p`.)

import { $ } from 'bun'

async function gitFiles(args: string[]): Promise<string[]> {
  return (await $`git ${args} -z`.text()).split('\0').filter(Boolean)
}

function fail(message: string): never {
  console.error(`pre-commit: ${message}\nFix it, or commit with --no-verify to skip formatting.`)
  process.exit(1)
}

const staged = await gitFiles(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
const unstaged = new Set(await gitFiles(['diff', '--name-only']))
const full = staged.filter((f) => !unstaged.has(f))
const partial = staged.filter((f) => unstaged.has(f))

if (full.length) {
  // -u skips file types bun fmt doesn't know (images, lockfiles, ...)
  const result = await $`bun fmt -u --log-level=warn ${full}`.nothrow()
  if (result.exitCode !== 0) fail('bun fmt failed on staged files')
  await $`git add -- ${full}`
}

for (const file of partial) {
  const original = Buffer.from(await $`git show ${`:${file}`}`.arrayBuffer())
  const result = await $`bun fmt --stdin-filepath ${file} < ${original}`.nothrow().quiet()
  if (result.exitCode !== 0) {
    if (result.stderr.toString().includes('No parser could be inferred')) continue
    process.stderr.write(result.stderr)
    fail(`bun fmt failed on the staged version of ${file}`)
  }
  if (result.stdout.equals(original)) continue

  const mode = (await $`git ls-files --stage -- ${file}`.text()).split(' ')[0]
  const sha = (await $`git hash-object -w --stdin < ${result.stdout}`.text()).trim()
  await $`git update-index --cacheinfo ${`${mode},${sha},${file}`}`
  console.log(`pre-commit: formatted staged changes in ${file} (unstaged changes left as-is)`)
}
