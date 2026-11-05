// zip-cache-stub.mjs (R3-1332) — the ONE home of the `cache.yml` stub text.
//
// WHY. `cache.yml` used to be copied BY VALUE into every app repo, and a fix to
// this template reached none of them: R3-897's keep-set stayed in two repos, and
// grove evicted a zip a consumer pinned (R3-1331). The job now lives once, in
// `.github/workflows/zip-cache.yml` (`on: workflow_call`), and every repo's
// `cache.yml` is the short stub below, calling it at `@main`
// (ZIP_CACHE_AUTOMATION_SPEC §4 *Distribution*, §8).
//
// Who imports this: `check-workflow-drift.mjs` (is a repo's file a rendered
// stub?), the fleet migration (R3-1333), and this file's own self-test. Nothing
// else spells the `uses:` line.

/** The shared job, by the only reference a stub may use. */
export const SHARED_JOB = 'immediately-run/new-project-template/.github/workflows/zip-cache.yml@main';

const HEADER = `# immediately.run cache — publishes this repo's pre-cached zips on GitHub Pages.
#
# A stub: the job lives in new-project-template's .github/workflows/zip-cache.yml,
# called at @main, so a fix there reaches this repo on its next run. Rendered by
# new-project-template scripts/zip-cache-stub.mjs — do not edit by hand; a
# hand-edited stub is reported as drift (ZIP_CACHE_AUTOMATION_SPEC §8).`;

const BRANCH_RE = /^[A-Za-z0-9._\/-]+$/;
const PATH_RE = /^[A-Za-z0-9._\/-]+$/;

/**
 * The stub for one repo. `branches` is the push trigger's list (a repo whose
 * default branch is not `main` names its own); `landingHtml` is an optional
 * path in the repo, passed to the job as `landing-html`.
 */
export function renderStub({ branches = ['main'], landingHtml = '' } = {}) {
  if (!Array.isArray(branches) || branches.length === 0 || !branches.every((b) => BRANCH_RE.test(b))) {
    throw new Error(`renderStub: branches must be a non-empty list of plain branch names, got ${JSON.stringify(branches)}`);
  }
  if (landingHtml !== '' && !PATH_RE.test(landingHtml)) {
    throw new Error(`renderStub: landingHtml must be a plain repo path, got ${JSON.stringify(landingHtml)}`);
  }
  return `${HEADER}

name: Cache for immediately.run

on:
  push:
    branches: [${branches.join(', ')}]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# Never run two Pages deploys at once; let an in-progress one finish. Here, not in
# the shared job: the same group in caller and callee deadlocks.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  cache:
    uses: ${SHARED_JOB}
    with:
      landing-html: '${landingHtml}'
    secrets:
      DEPLOY_APP_ID: \${{ secrets.DEPLOY_APP_ID }}
      DEPLOY_APP_PRIVATE_KEY: \${{ secrets.DEPLOY_APP_PRIVATE_KEY }}
`;
}

/** Functional content only: comments and blank lines dropped, so a stub whose
 *  header comment was reworded is still the stub. */
function functional(text) {
  return text.replace(/\r\n/g, '\n').split('\n')
    .filter((l) => !/^\s*#/.test(l) && l.trim() !== '')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n');
}

/**
 * Read a repo's `cache.yml` as a stub: `{ branches, landingHtml }` when the file
 * is exactly what `renderStub` would produce for those options (comments aside),
 * else `null`. A reference other than `@main` — a sha, a tag, another branch —
 * an extra step, or a missing secret is `null`, which the drift check reports.
 */
export function parseStub(text) {
  if (typeof text !== 'string') return null;
  const b = /^ {4}branches: \[([^\]\n]*)\]$/m.exec(text);
  const l = /^ {6}landing-html: '([^'\n]*)'$/m.exec(text);
  if (!b || !l) return null;
  const opts = { branches: b[1].split(',').map((s) => s.trim()).filter(Boolean), landingHtml: l[1] };
  let expected;
  try {
    expected = renderStub(opts);
  } catch {
    return null;
  }
  return functional(text) === functional(expected) ? opts : null;
}
