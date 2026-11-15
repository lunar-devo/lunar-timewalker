#!/usr/bin/env bash
# Builds the site and publishes the build as the gh-pages branch, which GitHub Pages serves.
# The branch holds one commit, the latest build; each run replaces it.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

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

git push --force origin "$commit:refs/heads/gh-pages"
echo "Published $(git rev-parse --short HEAD) as $(git rev-parse --short "$commit") on gh-pages."
