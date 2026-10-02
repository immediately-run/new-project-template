#!/usr/bin/env node
// check-kept-zip-refs.mjs (R3-897) — the keep-set test for cache.yml's consumer-pin
// scan.
//
// WHY THIS EXISTS. cache.yml's "Derive the consumer-pinned refs to keep" step
// re-builds every sha zip a consumer pins, so a Pages redeploy no longer evicts
// a pinned commit (omnibox's 2026-09-29 redeploy dropped c61f996…, the pin both
// landing-page and home carried, and every cold front-door boot fell to ~10
// anonymous api.github.com calls against a 60/hour limit). The scan lives INLINE
// in the workflow — cache.yml is copied BY VALUE to every repo and replicated by
// the drift check, so a script beside it would drift while the workflow's copy
// stayed — which leaves the logic with no ordinary unit-test seam.
//
// THE SEAM THIS BUILDS. The inline block is fenced (# KEPT-ZIP-REFS-BEGIN/END)
// and this check EXTRACTS it from the workflow file itself and runs it against
// a FAKE gh — the subject is the code CI runs, byte for byte, never a copy
// (ways_of_working §4: a hand-copied fixture encodes the same false assumption
// as the code under test). The inputs are the REAL producers: the sibling
// checkouts' package.json files (landing-page, home) where they exist, so the
// case asserts the LIVE pins; with no siblings (CI checks this repo out alone)
// the same cases run over a frozen one-pin listing.
//
// Run: node scripts/check-kept-zip-refs.mjs --self-test
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'cache.yml');
const FENCE_BEGIN = '# KEPT-ZIP-REFS-BEGIN';
const FENCE_END = '# KEPT-ZIP-REFS-END';

/** The fenced inline block from the workflow — the REAL producer, not a copy.
 *  `core` is the executable node heredoc between the fences. */
export function keptZipRefsBlock(workflowText = readFileSync(WORKFLOW, 'utf8')) {
  const begin = workflowText.indexOf(FENCE_BEGIN);
  const end = workflowText.indexOf(FENCE_END);
  if (begin === -1 || end === -1 || end < begin) return null;
  const block = workflowText.slice(begin, end + FENCE_END.length);
  const core = block.replace(/^[\s\S]*node <<'KEPT_ZIP_REFS'[^\n]*\n/, '').replace(/\n[ \t]*KEPT_ZIP_REFS[\s\S]*$/, '');
  return { block, core };
}

/** The pins of `repo` in a parsed package.json's dependency groups — the SAME
 *  derivation shape the scan uses (walk parsed dependency values, never a regex
 *  over raw text), parameterised by owner/repo so it cannot hand-copy the
 *  workflow's spelling. */
export function pinsOf(pkgText, owner, repo) {
  const pkg = JSON.parse(pkgText);
  const prefix = `github:${owner}/${repo}#`;
  const out = [];
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const spec of Object.values(pkg[group] ?? {})) {
      if (typeof spec === 'string' && spec.startsWith(prefix) && /^[0-9a-f]{40}$/.test(spec.slice(prefix.length))) {
        out.push(spec.slice(prefix.length));
      }
    }
  }
  return out;
}

/** Run the extracted core with a FAKE gh first on PATH. The fake serves the
 *  org listing (names one per line, `--paginate`-shaped: the sibling names, the
 *  library itself, a self-pinning twin, and an archived consumer) and each
 *  package.json from the sibling map; a repo with no entry answers 404-style. */
export function runKeptZipRefs({ core, owner, repo, siblings, extraListings = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'kept-zip-refs-'));
  try {
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env node
const { existsSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2); // ['api', url, ...flags]
const url = args.find((a) => a.startsWith('/'));
const siblings = JSON.parse(process.env.FAKE_GH_SIBLINGS ?? '{}');
const extra = JSON.parse(process.env.FAKE_GH_EXTRA ?? '[]');
// The listing includes the library ITSELF (by its exact name) and an archived
// consumer, so the scan's own-repo skip and its no-archived-carve-out are both
// driven for real — not just via a 404.
const listings = [...extra, ...Object.keys(siblings), 'the-library-itself', process.env.KEPT_REPO, 'an-archived-consumer'];
if (url.startsWith('/orgs/')) {
  process.stdout.write(listings.join('\\n'));
} else if (url.includes('/contents/package.json')) {
  const name = url.split('/repos/')[1].split('/contents')[0].split('/')[1];
  const path = siblings[name];
  if (!path || !existsSync(path)) { process.stderr.write('"gh": Not Found (HTTP 404)'); process.exit(1); }
  process.stdout.write(readFileSync(path, 'utf8'));
} else {
  process.exit(2);
}
`,
      { mode: 0o755 },
    );
    return execFileSync('node', ['-'], {
      input: core,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        KEPT_OWNER: owner,
        KEPT_REPO: repo,
        FAKE_GH_SIBLINGS: JSON.stringify(siblings),
        FAKE_GH_EXTRA: JSON.stringify(extraListings),
      },
      maxBuffer: 1 << 24,
    }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The live sibling pins where the checkouts exist; null in CI (no siblings). */
function liveSiblingPins() {
  const siblings = {};
  for (const name of ['landing-page', 'home']) {
    const path = join(ROOT, '..', name, 'package.json');
    if (existsSync(path)) siblings[name] = path;
  }
  return Object.keys(siblings).length > 0 ? siblings : null;
}

/** A frozen sibling map for CI: the eviction case's pin, verbatim from history. */
const FROZEN_PIN = 'c61f996c06e675e9770db608abc763986343872c';

function selfTest() {
  let ok = 0;
  let attempted = 0;
  const check = (name, cond) => {
    attempted++;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (cond) ok++;
  };

  const OWNER = 'immediately-run';
  const REPO = 'omnibox';
  const { block, core } = keptZipRefsBlock();
  check('the workflow carries the fenced KEPT-ZIP-REFS block (the subject exists)', block !== null);
  check('the block reads the pins via gh (not a hand-copied variant of the scan)', /execFileSync\('gh'/.test(core));
  check('the block discriminates its catch (only HTTP 404/403 continue — fail-closed otherwise)', /HTTP 40\[34\]/.test(core));
  if (!block) {
    console.log(`\n${ok}/${attempted} self-test cases.`);
    process.exit(1);
  }

  const siblings = liveSiblingPins();
  let frozenDir;
  let map;
  let expectedPins;
  if (siblings) {
    map = siblings;
    expectedPins = [];
    for (const path of Object.values(siblings)) {
      expectedPins.push(...pinsOf(readFileSync(path, 'utf8'), OWNER, REPO));
    }
  } else {
    frozenDir = mkdtempSync(join(tmpdir(), 'kept-zip-frozen-'));
    const path = join(frozenDir, 'package.json');
    writeFileSync(path, JSON.stringify({ name: 'frozen-consumer', dependencies: { '@immediately-run/omnibox': `github:${OWNER}/${REPO}#${FROZEN_PIN}` } }, null, 2));
    map = { 'frozen-consumer': path };
    expectedPins = [FROZEN_PIN];
  }
  const out = runKeptZipRefs({ core, owner: OWNER, repo: REPO, siblings: map });

  check(
    `the real consumer pins are kept (${expectedPins.map((p) => p.slice(0, 7)).join(', ')})`,
    expectedPins.length > 0 && expectedPins.every((p) => out.includes(p)),
  );
  check('the output is the refs= line the workflow output consumes', /^refs=([0-9a-f]{40}( [0-9a-f]{40})*)?$/.test(out));

  // The self-pin skip branch, driven for real: the listing includes the library
  // itself BY EXACT NAME, and its package.json (a self-pin, reachable through the
  // sibling map) would be kept if the skip were removed — so the sha's absence is
  // the skip doing the work, not a 404.
  const selfPin = 'a'.repeat(40);
  const twinDir = mkdtempSync(join(tmpdir(), 'kept-zip-self-'));
  const twinPkg = join(twinDir, 'package.json');
  writeFileSync(twinPkg, JSON.stringify({ name: REPO, dependencies: { [`@immediately-run/${REPO}`]: `github:${OWNER}/${REPO}#${selfPin}` } }, null, 2));
  const outSelf = runKeptZipRefs({
    core,
    owner: OWNER,
    repo: REPO,
    siblings: { ...map, [REPO]: twinPkg },
  });
  check('the library itself is never kept (its exact-named listing entry, with a reachable self-pin, is skipped)', !outSelf.includes(selfPin) && expectedPins.every((p) => outSelf.includes(p)));
  rmSync(twinDir, { recursive: true, force: true });

  // An ARCHIVED consumer's pin is kept too (the scan has no archived carve-out:
  // an archived repo's Pages and pin stay live).
  const archivedPin = 'b'.repeat(40);
  const archivedDir = mkdtempSync(join(tmpdir(), 'kept-zip-arch-'));
  const archivedPkg = join(archivedDir, 'package.json');
  writeFileSync(archivedPkg, JSON.stringify({ name: 'an-archived-consumer', dependencies: { [`@immediately-run/${REPO}`]: `github:${OWNER}/${REPO}#${archivedPin}` } }, null, 2));
  const outArchived = runKeptZipRefs({
    core,
    owner: OWNER,
    repo: REPO,
    siblings: { ...map, 'an-archived-consumer': archivedPkg },
  });
  check('an archived consumer’s pin is kept (no archived carve-out)', outArchived.includes(archivedPin) && expectedPins.every((p) => outArchived.includes(p)));
  rmSync(archivedDir, { recursive: true, force: true });

  // Fault injections. With no consumer pins the kept set is empty — the pass
  // above is the scan doing the work, not a pass-through. And a transient
  // failure (a 5xx, not a 404) FAILS the run fail-closed: the pin is never
  // silently dropped.
  const outEmpty = runKeptZipRefs({ core, owner: OWNER, repo: REPO, siblings: {} });
  check('fault injection: with no consumer pins, the kept set is empty (refs= only)', outEmpty === 'refs=');

  const failDir = mkdtempSync(join(tmpdir(), 'kept-zip-5xx-'));
  writeFileSync(
    join(failDir, 'gh'),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('/'));
if (url.startsWith('/orgs/')) { process.stdout.write('home\\n'); process.exit(0); }
process.stderr.write('"gh": Server Error (HTTP 500)'); process.exit(1);
`,
    { mode: 0o755 },
  );
  let rethrown = false;
  try {
    execFileSync('node', ['-'], {
      input: core,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${failDir}:${process.env.PATH}`, KEPT_OWNER: OWNER, KEPT_REPO: REPO, FAKE_GH_SIBLINGS: '{}' },
      maxBuffer: 1 << 24,
    });
  } catch {
    rethrown = true; // the scan rethrows the 5xx — the run fails fail-closed
  }
  check('fault injection: a transient 5xx on a consumer read FAILS the run (never a silent eviction)', rethrown);
  rmSync(failDir, { recursive: true, force: true });

  if (frozenDir) rmSync(frozenDir, { recursive: true, force: true });
  console.log(`\n${ok}/${attempted} self-test cases.`);
  if (ok !== attempted) process.exit(1);
}

// Run only when executed as the entry script (importing the pure parts must not
// run the self-test — the org's convention).
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    console.error('check-kept-zip-refs: run with --self-test (the check is the test; there is no live mode).');
    process.exit(1);
  }
}
