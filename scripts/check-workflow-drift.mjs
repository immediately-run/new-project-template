#!/usr/bin/env node
// Reports org repos whose `.github/workflows/cache.yml` is not the stub that
// calls this template's shared job.
//
// WHY THIS EXISTS. cache.yml used to reach each repo BY VALUE, and nothing
// updated the copies: 22 repos missed the Pages token-mint step (R3-535), and
// R3-897's keep-set never left the template, so grove evicted a zip a consumer
// pinned (R3-1331). Since R3-1332 the job lives once, in
// `.github/workflows/zip-cache.yml`, and every repo's cache.yml is the stub
// `scripts/zip-cache-stub.mjs` renders, calling it at `@main`
// (ZIP_CACHE_AUTOMATION_SPEC §4 *Distribution*, §8).
//
// WHAT IT COMPARES. A repo's file passes when `parseStub` accepts it: exactly a
// rendered stub, comments aside, with its own push branches and optional
// landing page. A full by-value copy, a sha or tag reference, or a hand-added
// step is drift. The stub has nothing that can lag, so drift is a repo that
// was never migrated or was edited by hand.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseStub, renderStub, SHARED_JOB } from './zip-cache-stub.mjs';
import { runStubCases } from './zip-cache-stub.test.mjs';

const OWNER = process.env.DRIFT_OWNER ?? 'immediately-run';
const WORKFLOW = '.github/workflows/cache.yml';
// The shared job: the one file that pins the CLI (and so the one the pin guard reads).
const JOB = '.github/workflows/zip-cache.yml';

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * The `@immediately-run/cli` version `zip-cache.yml` pins, read from the workflow
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
    return { ok: false, reason: 'zip-cache.yml pins no @immediately-run/cli version at all' };
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

function fetchWorkflow(repo) {
  try {
    const b64 = gh('api', `repos/${OWNER}/${repo}/contents/${WORKFLOW}`, '--jq', '.content');
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null; // no cache.yml — not an app repo, or not caching yet
  }
}

/** Every non-archived public repo in the owner's account. Exported for the
 *  fleet migration (R3-1333), which acts on exactly the repos this check reads.
 *  `--slurp` cannot be combined with `--jq`, so page through and take one name
 *  per line. Archived repos are frozen history and are excluded (`showcase`). */
export function listRepos(run = gh) {
  return run('api', `orgs/${OWNER}/repos?per_page=100&type=public`, '--paginate',
    '--jq', '.[] | select(.archived | not) | .name')
    .split('\n').map((l) => l.trim()).filter(Boolean).sort();
}

/** Split repos into stubs and drift. PURE — `fetch(repo)` returns the repo's
 *  cache.yml text, or null when it has none. */
export function judgeRepos(repos, fetch) {
  const drifted = [];
  let checked = 0;
  for (const repo of repos) {
    const text = fetch(repo);
    if (text === null) continue;
    checked += 1;
    if (parseStub(text) === null) drifted.push(repo);
  }
  return { checked, drifted };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain && process.argv.includes('--self-test')) {
  const ok = (name, cond) => { if (!cond) { console.error(`✗ self-test: ${name}`); process.exit(1); } console.log(`  ✓ ${name}`); };
  let n = runStubCases(ok);
  // The real producer: this repo's own committed stub, and its committed job.
  ok('this repo\'s own cache.yml is a stub', parseStub(readFileSync(WORKFLOW, 'utf8')) !== null);
  const job = readFileSync(JOB, 'utf8');
  ok('the job is a reusable workflow', /^on:\n  workflow_call:/m.test(job));
  ok('the job carries no concurrency group (the stub owns it)', !/^concurrency:/m.test(job));
  // The build loop leaves the checkout at the last kept ref, so the landing page
  // must come from the pushed commit, not the working tree (R3-1332 review r1).
  ok('the landing page is read from the pushed commit', /git show "\$PUSHED_SHA:\$LANDING_HTML"/.test(job) && !/cp "\$LANDING_HTML"/.test(job));
  ok('the landing page must be a file (a tree would publish a listing)', /git cat-file -t "\$PUSHED_SHA:\$LANDING_HTML"[^\n]*!= "blob"/.test(job));
  const fakeFiles = { stub: renderStub(), copy: job, none: null, tagged: renderStub().replace(SHARED_JOB, SHARED_JOB.replace('@main', '@v1')) };
  const judged = judgeRepos(Object.keys(fakeFiles), (r) => fakeFiles[r]);
  ok('a repo with no cache.yml is not counted', judged.checked === 3);
  ok('a by-value copy and a tag reference are drift; the stub is not',
    JSON.stringify(judged.drifted) === JSON.stringify(['copy', 'tagged']));
  n += 7;
  // The pin guard. Its input is the REAL zip-cache.yml, and its npm lookup is
  // stubbed so the three outcomes — served, absent, unreachable — are all
  // exercised. Only the last of these is hard to produce on demand in CI.
  ok('the pin is read out of the real zip-cache.yml', /^[0-9]+\.[0-9]+\.[0-9]+/.test(pinnedCliVersion(job) ?? ''));
  ok('a workflow with no pin is not a pass', judgePin(pinnedCliVersion('runs-on: ubuntu-latest'), () => '1.0.0').ok === false);
  ok('a version npm serves passes', judgePin('0.8.2', (v) => v).ok === true);
  ok('a version npm does not serve fails', judgePin('0.0.0-not-real', () => '').ok === false);
  ok('the failure names the version', judgePin('0.0.0-not-real', () => '').reason.includes('0.0.0-not-real'));
  ok('an unreachable registry fails, it does not pass', judgePin('0.8.2', () => { throw new Error('ENOTFOUND'); }).ok === false);
  n += 6;
  console.log(`self-test: PASS (${n}/${n})`);
  process.exit(0);
}

// The pin guard, against the real registry. Separate from the drift comparison
// because it answers a different question — not "does every repo carry this
// file" but "is the version this file pins one npm will serve". Getting that
// wrong ships a workflow that fails ETARGET in forty repos at once, which is
// how it was found: new-project-template's own cache run was red for four days
// against `cli@0.8.2` while it was still unpublished (R3-623).
if (isMain && process.argv.includes('--check-pin')) {
  // The injected override exists for fault injection: pointing the guard at a
  // version that does not exist is the only way to show it fires, and R2 says
  // inspection is not evidence.
  const pinned = process.env.DRIFT_PIN_OVERRIDE ?? pinnedCliVersion(readFileSync(JOB, 'utf8'));
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
    console.error(`::error::${JOB} pins a CLI version npm will not serve — ${reason}. ` +
      `Every repo carrying this workflow fails ETARGET until it publishes. ` +
      `Check https://www.npmjs.com/package/@immediately-run/cli?activeTab=versions`);
    process.exit(1);
  }
  console.log(`✓ ${reason}`);
  process.exit(0);
}

if (isMain) {
  const repos = listRepos();
  const { checked, drifted } = judgeRepos(repos, fetchWorkflow);
  console.log(`checked ${checked} repo(s) carrying ${WORKFLOW} (of ${repos.length} non-archived public repos)`);
  if (drifted.length === 0) {
    console.log('✓ every cache.yml is the stub');
    process.exit(0);
  }
  console.error(`\n✗ ${drifted.length} repo(s) do not carry the stub (scripts/zip-cache-stub.mjs):\n`);
  for (const r of drifted) console.error(`  - ${r}  https://github.com/${OWNER}/${r}/blob/main/${WORKFLOW}`);
  console.error('\nReplace the file with renderStub() — the fleet migration (R3-1333) opens these PRs.');
  process.exit(1);
}
