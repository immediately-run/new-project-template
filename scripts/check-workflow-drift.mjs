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

/**
 * The `@immediately-run/cli` version `cache.yml` pins, read from the workflow
 * itself rather than repeated here. The workflow is the one home for the pin
 * (R6); a second copy in this script would be the drift this file exists to
 * catch, one level up.
 *
 * Returns null when no pin is present, which the caller treats as a failure
 * rather than a pass — a cache.yml that stopped pinning is not a green state.
 */
export function pinnedCliVersion(text) {
  const m = /@immediately-run\/cli@([0-9][^\s'"]*)/.exec(text);
  return m ? m[1] : null;
}

/**
 * Decide whether a pinned version is one npm will actually serve. PURE — `view`
 * is injected, so the decision is tested without the network and against the
 * real registry in the same shape.
 *
 * `view` is called with the version and returns what npm reports for
 * `@immediately-run/cli@<version>`: the version string when it exists, an empty
 * string when the registry has no such version (npm exits 0 with no output for
 * an unmatched exact version), or throws when the lookup itself failed.
 *
 * A lookup that throws is NOT a pass. Offline, the honest answer is "cannot be
 * determined", and the whole point of this guard is that an undetermined pin
 * reaches forty repos before anyone notices.
 */
export function judgePin(version, view) {
  if (!version) {
    return { ok: false, reason: 'cache.yml pins no @immediately-run/cli version at all' };
  }
  let reported;
  try {
    reported = view(version);
  } catch (err) {
    return { ok: false, reason: `npm view failed for ${version}: ${err.message}` };
  }
  if (!reported || !reported.trim()) {
    return { ok: false, reason: `npm does not serve @immediately-run/cli@${version}` };
  }
  return { ok: true, reason: `npm serves @immediately-run/cli@${version}` };
}

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
  // The pin guard. Its input is the REAL cache.yml, and its npm lookup is
  // stubbed so the three outcomes — served, absent, unreachable — are all
  // exercised. Only the last of these is hard to produce on demand in CI.
  ok('the pin is read out of the real cache.yml', /^[0-9]+\.[0-9]+\.[0-9]+/.test(pinnedCliVersion(base) ?? ''));
  ok('a cache.yml with no pin is not a pass', judgePin(pinnedCliVersion('runs-on: ubuntu-latest'), () => '1.0.0').ok === false);
  ok('a version npm serves passes', judgePin('0.8.2', (v) => v).ok === true);
  ok('a version npm does not serve fails', judgePin('0.0.0-not-real', () => '').ok === false);
  ok('the failure names the version', judgePin('0.0.0-not-real', () => '').reason.includes('0.0.0-not-real'));
  ok('an unreachable registry fails, it does not pass', judgePin('0.8.2', () => { throw new Error('ENOTFOUND'); }).ok === false);
  console.log('self-test: PASS (11/11)');
  process.exit(0);
}

// The pin guard, against the real registry. Separate from the drift comparison
// because it answers a different question — not "does every repo carry this
// file" but "is the version this file pins one npm will serve". Getting that
// wrong ships a workflow that fails ETARGET in forty repos at once, which is
// how it was found: new-project-template's own cache run was red for four days
// against `cli@0.8.2` while it was still unpublished (R3-623).
if (process.argv.includes('--check-pin')) {
  // The injected override exists for fault injection: pointing the guard at a
  // version that does not exist is the only way to show it fires, and R2 says
  // inspection is not evidence.
  const pinned = process.env.DRIFT_PIN_OVERRIDE ?? pinnedCliVersion(readFileSync(WORKFLOW, 'utf8'));
  // npm reports "this version does not exist" as an E404 *failure*, not as empty
  // output. That is the expected answer here, not a broken lookup, so it is
  // translated into the empty string and only a genuine failure (offline, auth,
  // registry down) is allowed to throw — the two lead to different actions, and
  // a message that says "npm view failed" when the truth is "nobody published
  // it" sends the reader to the wrong place. npm's own stderr is captured rather
  // than inherited so the annotation is one line, not forty.
  const view = (v) => {
    try {
      return execFileSync('npm', ['view', `@immediately-run/cli@${v}`, 'version'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      const output = `${err.stderr ?? ''}${err.stdout ?? ''}`;
      if (/E404|No match found for version/.test(output)) return '';
      throw new Error(output.trim().split('\n')[0] || err.message.split('\n')[0]);
    }
  };
  const { ok: pass, reason } = judgePin(pinned, view);
  if (!pass) {
    console.error(`::error::${WORKFLOW} pins a CLI version npm will not serve — ${reason}. ` +
      `Every repo carrying this workflow fails ETARGET until it publishes. ` +
      `Check https://www.npmjs.com/package/@immediately-run/cli?activeTab=versions`);
    process.exit(1);
  }
  console.log(`✓ ${reason}`);
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
