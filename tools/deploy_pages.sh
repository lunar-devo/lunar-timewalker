#!/usr/bin/env bash
# Builds the site and publishes the build to the repository that GitHub Pages serves at the bare domain
# (https://lunar-devo.github.io/). That repository is the git remote `site` and holds the site alone: its main
# branch has one commit, the latest build, which each run replaces, and the records GitHub keeps of each Pages
# build (Actions runs, earlier deployments) are deleted once the new build is live.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! git remote get-url site >/dev/null 2>&1; then
  echo "Add the site repository first: git remote add site https://github.com/lunar-devo/lunar-devo.github.io.git" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first: the site is built from what is committed." >&2
  exit 1
fi

npm run build

# The build is committed through a throwaway index, so neither the working tree nor the current branch moves.
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
tree="$(GIT_INDEX_FILE="$scratch/index" sh -c 'git --work-tree=dist add -A . && git write-tree')"
commit="$(git commit-tree "$tree" -m "Lunar Timewalker")"

git push --force site "$commit:refs/heads/main"
echo "Published $(git rev-parse --short HEAD) on $(git remote get-url site)."

# Waits until Pages has built this commit, then deletes the finished Actions runs and every deployment but the
# newest. Needs the GitHub CLI signed in to the site's account.
clear_build_records() {
  local repo status run deployment
  repo="$(git remote get-url site | sed -E 's#^https://([^@/]+@)?github\.com/##; s#\.git$##')"
  for _ in $(seq 60); do
    status="$(gh api "repos/$repo/pages/builds/latest" --jq '.status + " " + .commit' 2>/dev/null || true)"
    [ "$status" = "built $commit" ] && break
    sleep 5
  done
  for run in $(gh api "repos/$repo/actions/runs?per_page=100" --jq '.workflow_runs[] | select(.status == "completed") | .id'); do
    gh api -X DELETE "repos/$repo/actions/runs/$run" >/dev/null
  done
  for deployment in $(gh api "repos/$repo/deployments?per_page=100" --jq '.[1:][] | .id'); do
    gh api -X POST "repos/$repo/deployments/$deployment/statuses" -f state=inactive >/dev/null
    gh api -X DELETE "repos/$repo/deployments/$deployment" >/dev/null
  done
  echo "Pages build of $(git rev-parse --short "$commit"): ${status:-unknown}; build records cleared."
}

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  clear_build_records || echo "Could not clear the build records; the site itself is published." >&2
else
  echo "GitHub CLI not signed in: the build records in the site repository were left as they are." >&2
fi
