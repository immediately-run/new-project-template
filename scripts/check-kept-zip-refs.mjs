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

/** The fenced inline block from the workflow — the REAL producer, not a copy. */
export function keptZipRefsBlock(workflowText = readFileSync(WORKFLOW, 'utf8')) {
  const begin = workflowText.indexOf('# KEPT-ZIP-REFS-BEGIN');
  const end = workflowText.indexOf('# KEPT-ZIP-REFS-END');
  if (begin === -1 || end === -1 || end < begin) return null;
  const block = workflowText.slice(begin, end + '# KEPT-ZIP-REFS-END'.length);
  // The executable core: the node heredoc between the markers, minus the fence
  // comments themselves.
  const core = block.replace(/^[\s\S]*node <<'KEPT_ZIP_REFS'[^\n]*\n/, '').replace(/\n[ \t]*KEPT_ZIP_REFS[\s\S]*$/, '');
  return { block, core };
}

/** Run the extracted core with a FAKE gh first on PATH. */
export function runKeptZipRefs({ core, owner, repo, siblings }) {
  const dir = mkdtempSync(join(tmpdir(), 'kept-zip-refs-'));
  try {
    // The fake gh: serves the org listing and each package.json from the given
    // sibling map (path per repo name); a repo with no entry answers 404-style
    // (exit 1) the way the real API does for a repo the token cannot read.
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env node
const { existsSync, readFileSync } = require('node:fs');
const url = process.argv[3];
const siblings = JSON.parse(process.env.FAKE_GH_SIBLINGS ?? '{}');
if (url.startsWith('/orgs/')) {
  const repos = [...Object.keys(siblings), 'the-library-itself'].map((name) => ({ name, archived: false }));
  process.stdout.write(JSON.stringify(repos));
} else if (url.includes('/contents/package.json')) {
  const name = url.split('/repos/')[1].split('/contents')[0].split('/')[1];
  const path = siblings[name];
  if (!path || !existsSync(path)) process.exit(1);
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
const FROZEN_PIN_PACKAGE_JSON = JSON.stringify(
  {
    name: 'frozen-consumer',
    dependencies: { '@immediately-run/omnibox': 'github:immediately-run/omnibox#c61f996c06e675e9770db608abc763986343872c' },
  },
  null,
  2,
);

function selfTest() {
  let ok = 0;
  let attempted = 0;
  const check = (name, cond) => {
    attempted++;
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
    if (cond) ok++;
  };

  const { block, core } = keptZipRefsBlock();
  check('the workflow carries the fenced KEPT-ZIP-REFS block (the subject exists)', block !== null);
  check('the block reads the pins via gh (not a hand-copied variant of the scan)', /execFileSync\('gh'/.test(core));
  if (!block) {
    console.log(`\n${ok}/${attempted} self-test cases.`);
    process.exit(1);
  }

  const siblings = liveSiblingPins();
  const map = siblings ?? { 'frozen-consumer': null };
  // CI fallback: serve the frozen package.json from a temp file.
  let frozenDir;
  if (!siblings) {
    frozenDir = mkdtempSync(join(tmpdir(), 'kept-zip-frozen-'));
    const path = join(frozenDir, 'package.json');
    writeFileSync(path, FROZEN_PIN_PACKAGE_JSON);
    map['frozen-consumer'] = path;
  }
  const out = runKeptZipRefs({ core, owner: 'immediately-run', repo: 'omnibox', siblings: map });

  if (siblings) {
    const pins = [];
    for (const path of Object.values(siblings)) {
      const m = /"github:immediately-run\/omnibox#([0-9a-f]{40})"/.exec(readFileSync(path, 'utf8'));
      if (m) pins.push(m[1]);
    }
    check(
      `the real sibling pins are kept (landing-page + home: ${pins.map((p) => p.slice(0, 7)).join(', ')})`,
      pins.length > 0 && pins.every((p) => out.includes(p)),
    );
  } else {
    check(
      'the frozen consumer pin is kept (CI: the eviction case runs over the frozen listing)',
      out.includes('c61f996c06e675e9770db608abc763986343872c'),
    );
  }
  check('the library itself is never kept (its own repo is skipped)', !out.includes('the-library-itself'));
  check('the output is the refs= line the workflow output consumes', /^refs=([0-9a-f]{40}( [0-9a-f]{40})*)?$/.test(out));

  // Fault injection: no consumer pins → the kept set is empty — the pass above
  // is the scan doing the work, not a pass-through.
  const outEmpty = runKeptZipRefs({ core, owner: 'immediately-run', repo: 'omnibox', siblings: {} });
  check('fault injection: with no consumer pins, the kept set is empty (refs= only)', outEmpty === 'refs=');

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
