#!/usr/bin/env node
// Reports org repos whose `.github/workflows/cache.yml` has drifted from this
// template's copy.
//
// WHY THIS EXISTS. cache.yml is owned by new-project-template, but a repo gets
// its copy by VALUE at creation and nothing ever updates it. Two failures
// followed (R3-535): 22 repos carried a copy predating the Pages token-mint
// step and so could not self-provision Pages, and `bundle-picker` acquired a
// stale copy three days after it was created — by someone copying the workflow
// from a sibling repo rather than from here — and served a 404 for its cache
// until it was noticed by hand.
//
// WHAT IT COMPARES, AND WHAT IT DELIBERATELY DOES NOT. Only the FUNCTIONAL
// content: comments and blank lines are stripped, and the `_site/index.html`
// heredoc is blanked, because a repo is expected to write its own landing copy
// (`editor` does). Comparing raw bytes would flag every repo forever and the
// check would be turned off, which is the failure mode this is trying to avoid.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const OWNER = process.env.DRIFT_OWNER ?? 'immediately-run';
const WORKFLOW = '.github/workflows/cache.yml';

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Functional content only: no comments, no blank lines, landing copy blanked. */
export function normalise(text) {
  return text
    .replace(/(cat > _site\/index\.html <<'HTML'\n).*?(\n *HTML\n)/s, '$1<<<LANDING COPY>>>$2')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l) && l.trim() !== '')
    .join('\n');
}

function fetchWorkflow(repo) {
  try {
    const b64 = gh('api', `repos/${OWNER}/${repo}/contents/${WORKFLOW}`, '--jq', '.content');
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null; // no cache.yml — not an app repo, or not caching yet
  }
}

if (process.argv.includes('--self-test')) {
  const base = readFileSync(WORKFLOW, 'utf8');
  const ok = (name, cond) => { if (!cond) { console.error(`✗ self-test: ${name}`); process.exit(1); } console.log(`  ✓ ${name}`); };
  ok('identical input is not drift', normalise(base) === normalise(base));
  ok('a comment-only change is not drift', normalise(base) === normalise(base.replace(/^#.*$/m, '# reworded')));
  ok('custom landing copy is not drift', normalise(base) === normalise(
    base.replace(/(<<'HTML'\n)(.*?)(\n *HTML)/s, "$1          <title>a fork's own words</title>$3")));
  ok('a REMOVED step IS drift', normalise(base) !== normalise(base.replace(/ *- name: Mint Pages-enablement token\n/, '')));
  ok('a changed cli pin IS drift', normalise(base) !== normalise(base.replace(/cli@[0-9.]+/, 'cli@0.0.1')));
  console.log('self-test: PASS (5/5)');
  process.exit(0);
}

const want = normalise(readFileSync(WORKFLOW, 'utf8'));
// `--slurp` cannot be combined with `--jq`, so page through and take one name
// per line. Archived repos are excluded: they are read-only, so a drifted copy
// there is frozen history and can never be fixed or matter (`showcase`).
const repos = gh('api', `orgs/${OWNER}/repos?per_page=100&type=public`, '--paginate',
  '--jq', '.[] | select(.archived | not) | .name')
  .split('\n').map((l) => l.trim()).filter(Boolean);

const drifted = [];
let checked = 0;
for (const repo of repos.sort()) {
  const text = fetchWorkflow(repo);
  if (text === null) continue;
  checked += 1;
  if (normalise(text) !== want) drifted.push(repo);
}

console.log(`checked ${checked} repo(s) carrying ${WORKFLOW} (of ${repos.length} non-archived public repos)`);
if (drifted.length === 0) {
  console.log('✓ no workflow drift');
  process.exit(0);
}
console.error(`\n✗ ${drifted.length} repo(s) have drifted from this template:\n`);
for (const r of drifted) console.error(`  - ${r}  https://github.com/${OWNER}/${r}/blob/main/${WORKFLOW}`);
console.error(`\nSync one with:  gh api repos/${OWNER}/<repo>/contents/${WORKFLOW} ...`);
console.error('or re-copy this repo\'s copy verbatim, preserving that repo\'s _site/index.html copy.');
process.exit(1);
