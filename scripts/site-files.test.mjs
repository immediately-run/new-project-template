// site-files.test.mjs — runs zip-cache.yml's *Publish site files* step for real.
//
// The step is shell inside YAML, so a pattern match on its text would pass while
// the script did something else. This takes the step's actual `run:` block out of
// the committed job and runs it with bash in a scratch git repository, with the
// environment the job gives it, then looks at what landed in `_site/`.
// Run by `node scripts/check-workflow-drift.mjs --self-test` (CI), or alone:
// `node scripts/site-files.test.mjs`.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const JOB = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'zip-cache.yml');

/** The `run: |` block of the named step, de-indented. Throws when it is not there. */
export function stepScript(yaml, stepName) {
  const lines = yaml.split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (at < 0) throw new Error(`no step named ${stepName}`);
  const run = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
  if (run < 0) throw new Error(`step ${stepName} has no run block`);
  const indent = lines[run + 1].match(/^ */)[0].length;
  const body = [];
  for (const l of lines.slice(run + 1)) {
    if (l.trim() !== '' && l.match(/^ */)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

/** Runs every case through `ok(name, cond)`; returns the case count. */
export function runSiteFilesCases(ok) {
  const script = stepScript(readFileSync(JOB, 'utf8'), 'Publish site files');
  const dir = mkdtempSync(join(tmpdir(), 'site-files-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Self Test');
  git('config', 'user.email', 'self-test@example.invalid');
  mkdirSync(join(dir, 'site'));
  mkdirSync(join(dir, 'other'));
  writeFileSync(join(dir, 'llms.txt'), '# llms\n');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x00, 0x0a]);
  writeFileSync(join(dir, 'site', 'favicon-16.png'), png);
  writeFileSync(join(dir, 'site', 'index.html'), '<p>page</p>');
  writeFileSync(join(dir, 'other', 'llms.txt'), 'another\n');
  writeFileSync(join(dir, 'later.txt'), 'committed\n');
  symlinkSync('llms.txt', join(dir, 'link.txt'));
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  const sha = git('rev-parse', 'HEAD').trim();
  // The working tree moves on after the push, as the job's build loop leaves it.
  writeFileSync(join(dir, 'later.txt'), 'working tree, not the commit\n');
  writeFileSync(join(dir, 'uncommitted.txt'), 'never committed\n');

  const publish = (files) => {
    rmSync(join(dir, '_site'), { recursive: true, force: true });
    mkdirSync(join(dir, '_site'));
    const r = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', env: { ...process.env, SITE_FILES: files, PUSHED_SHA: sha } });
    const site = readdirSync(join(dir, '_site')).sort();
    return { code: r.status, out: r.stdout + r.stderr, site };
  };

  const cases = [];
  const good = publish('llms.txt site/favicon-16.png later.txt');
  cases.push(['files are published at the root under their own names', good.code === 0 && JSON.stringify(good.site) === JSON.stringify(['favicon-16.png', 'later.txt', 'llms.txt'])]);
  cases.push(['bytes arrive unchanged, binary included', good.code === 0 && Buffer.compare(readFileSync(join(dir, '_site', 'favicon-16.png')), png) === 0]);
  cases.push(['a file is read from the pushed commit, not the working tree', good.code === 0 && readFileSync(join(dir, '_site', 'later.txt'), 'utf8') === 'committed\n']);
  const refused = (name, files, why) => {
    const r = publish(files);
    cases.push([name, r.code !== 0 && why.test(r.out)]);
  };
  refused('a file not in the commit is refused', 'uncommitted.txt', /not a regular file/);
  refused('a directory is refused', 'site', /not a regular file/);
  refused('a symlink is refused', 'link.txt', /not a regular file/);
  refused('a path outside the repo is refused', '../x', /not a plain path/);
  refused('an absolute path is refused', '/etc/passwd', /not a plain path/);
  refused('a glob is refused, not expanded', 'site/*', /not a plain path/);
  refused('the landing page name is refused', 'site/index.html', /which the job writes itself/);
  refused('two paths with one name are refused', 'llms.txt other/llms.txt', /both be published as 'llms\.txt'/);
  rmSync(dir, { recursive: true, force: true });
  for (const [name, cond] of cases) ok(name, cond);
  return cases.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let failed = 0;
  const n = runSiteFilesCases((name, cond) => { if (!cond) { failed += 1; console.error(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); });
  console.log(`site-files: ${failed ? 'FAIL' : 'PASS'} (${n - failed}/${n})`);
  process.exit(failed ? 1 : 0);
}
