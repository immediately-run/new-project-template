// zip-cache-stub.test.mjs (R3-1332) — the stub's round trip and its refusals.
// Run by `node scripts/check-workflow-drift.mjs --self-test` (CI), or alone:
// `node scripts/zip-cache-stub.test.mjs`.
import { pathToFileURL } from 'node:url';
import { parseStub, renderStub, siteFilesProblem, SHARED_JOB } from './zip-cache-stub.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Runs every case through `ok(name, cond)`; returns the case count. */
export function runStubCases(ok) {
  const cases = [
    ['the default stub round-trips', () => same(parseStub(renderStub()), { branches: ['main'], landingHtml: '', siteFiles: [] })],
    ['a master trigger round-trips', () => same(parseStub(renderStub({ branches: ['master'] })), { branches: ['master'], landingHtml: '', siteFiles: [] })],
    ['two branches round-trip', () => same(parseStub(renderStub({ branches: ['main', 'release'] })).branches, ['main', 'release'])],
    ['a landing page round-trips', () => parseStub(renderStub({ landingHtml: '.github/cache-landing.html' })).landingHtml === '.github/cache-landing.html'],
    ['the stub calls the shared job at @main', () => renderStub().includes(`uses: ${SHARED_JOB}`) && SHARED_JOB.endsWith('@main')],
    ['a reworded comment is still the stub', () => parseStub(renderStub().replace(/^# immediately\.run cache.*$/m, '# reworded')) !== null],
    ['a tag reference is refused', () => parseStub(renderStub().replace(SHARED_JOB, SHARED_JOB.replace('@main', '@v1'))) === null],
    ['a sha reference is refused', () => parseStub(renderStub().replace(SHARED_JOB, SHARED_JOB.replace('@main', `@${'a'.repeat(40)}`))) === null],
    ['another branch reference is refused', () => parseStub(renderStub().replace(SHARED_JOB, SHARED_JOB.replace('@main', '@develop'))) === null],
    ['secrets: inherit is refused', () => parseStub(renderStub().replace(/    secrets:\n(.*\n){2}/, '    secrets: inherit\n')) === null],
    ['an added step is refused', () => parseStub(renderStub() + '  extra:\n    runs-on: ubuntu-latest\n') === null],
    ['a full by-value workflow is refused', () => parseStub('name: Cache for immediately.run\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n') === null],
    ['a non-string is refused', () => parseStub(undefined) === null],
    ['renderStub refuses an empty branch list', () => { try { renderStub({ branches: [] }); return false; } catch { return true; } }],
    ['renderStub refuses a quote in the landing path', () => { try { renderStub({ landingHtml: "x'y" }); return false; } catch { return true; } }],
    // site-files: optional, so every stub rendered before it existed is still a stub.
    ['site files round-trip', () => same(parseStub(renderStub({ landingHtml: 'site/index.html', siteFiles: ['llms.txt', 'site/favicon-16.png'] })),
      { branches: ['main'], landingHtml: 'site/index.html', siteFiles: ['llms.txt', 'site/favicon-16.png'] })],
    ['no site files writes no site-files line', () => !renderStub().includes('site-files') && !renderStub({ siteFiles: [] }).includes('site-files')],
    ['a stub from before site-files is still a stub', () => parseStub(renderStub({ landingHtml: 'site/index.html' }).replace(/^ {6}site-files:.*\n/m, '')) !== null],
    ['a hand-edited site-files list is drift', () => parseStub(renderStub({ siteFiles: ['a.txt'] }).replace("site-files: 'a.txt'", "site-files: 'a.txt  b.txt'")) === null],
    ['an empty site-files line is drift', () => parseStub(renderStub().replace("landing-html: ''", "landing-html: ''\n      site-files: ''")) === null],
    ['site files refuse a path outside the repo', () => siteFilesProblem(['../secret']) !== null && siteFilesProblem(['/etc/passwd']) !== null],
    ['site files refuse a quote or a space', () => siteFilesProblem(["a'b"]) !== null && siteFilesProblem(['a b']) !== null],
    ['site files refuse the names the job writes', () => siteFilesProblem(['site/index.html']) !== null && siteFilesProblem(['x/cached_repositories']) !== null],
    ['site files refuse two paths with one name', () => /both be published as 'icon\.png'/.test(siteFilesProblem(['a/icon.png', 'b/icon.png']) ?? '')],
    ['renderStub refuses bad site files', () => { try { renderStub({ siteFiles: ['../x'] }); return false; } catch { return true; } }],
  ];
  for (const [name, fn] of cases) ok(name, fn());
  return cases.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let failed = 0;
  const n = runStubCases((name, cond) => { if (!cond) { failed += 1; console.error(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); });
  console.log(`zip-cache-stub: ${failed ? 'FAIL' : 'PASS'} (${n - failed}/${n})`);
  process.exit(failed ? 1 : 0);
}
