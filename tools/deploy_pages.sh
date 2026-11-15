#!/usr/bin/env bash
# Builds the site and publishes the build to the repository that GitHub Pages serves at the bare domain
# (https://lunar-devo.github.io/). That repository is the git remote `site`; its main branch holds one commit,
# the latest build, and each run replaces it.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! git remote get-url site >/dev/null 2>&1; then
  echo "Add the site repository first: git remote add site https://github.com/lunar-devo/lunar-devo.github.io.git" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first: the published site is named after the commit it is built from." >&2
  exit 1
fi

npm run build

# The build is committed through a throwaway index, so neither the working tree nor the current branch moves.
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
tree="$(GIT_INDEX_FILE="$scratch/index" sh -c 'git --work-tree=dist add -A . && git write-tree')"
commit="$(git commit-tree "$tree" -m "Site build of $(git rev-parse --short HEAD)")"

git push --force site "$commit:refs/heads/main"
echo "Published $(git rev-parse --short HEAD) as $(git rev-parse --short "$commit") on $(git remote get-url site)."
