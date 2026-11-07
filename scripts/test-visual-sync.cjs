#!/usr/bin/env node
'use strict';

// Exercise the production worker with generated or decoded RGBA frames. No browser,
// account, network request, media download, or fixture redistribution is required.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const synthetic = require('./visual-sync-fixtures.cjs');

const ROOT = path.resolve(__dirname, '..');
const MODULES = {
  'visual-sync-core.js': 'VisualSync',
  'visual-sync-inset.js': 'VisualSyncInset',
  'visual-sync-overlap.js': 'VisualSyncOverlap',
};
const RUNTIME_FILES = [...Object.keys(MODULES), 'visual-sync-worker.js'];
const HELP = `Usage: node scripts/test-visual-sync.cjs [options]

  --suite synthetic|video|all  Default: synthetic (16 generated-clock cases)
  --case NAME                 Run a named case; repeat to select several
  --fixtures DIR              Directory containing the manifest's local media files
  --ffmpeg PATH               FFmpeg executable; default: ffmpeg on PATH
  --output FILE               JSON report; default: .cache/visual-sync/report.json
  --cache DIR                 Decoded-frame cache; default: .cache/visual-sync/frames
  --manifest FILE             Case manifest; default: tests/fixtures/visual-sync-cases.json
  --runtime DIR               Production UI directory; default: browser-extension/ui
  --allow-known-failures      Permit only documented missing-match failures in the exit status
  --list                      List selected case names without loading media or FFmpeg
  --help                      Show this help

A named --case selects from the entire manifest unless --suite is explicit.
Without --allow-known-failures, every failed expectation exits 1, including the
known rough-border positive. Reports always retain its passed:false result.
Configuration, missing fixtures, and extraction errors exit 2.
`;

function argumentsFor(argv) {
  const options = {
    suite: 'synthetic', cases: [], ffmpeg: 'ffmpeg',
    output: path.join(ROOT, '.cache/visual-sync/report.json'),
    cache: path.join(ROOT, '.cache/visual-sync/frames'),
    manifest: path.join(ROOT, 'tests/fixtures/visual-sync-cases.json'),
    runtime: path.join(ROOT, 'browser-extension/ui'),
  };
  const paths = new Set(['fixtures', 'output', 'cache', 'manifest', 'runtime']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help') options.help = true;
    else if (flag === '--list') options.list = true;
    else if (flag === '--allow-known-failures') options.allowKnownFailures = true;
    else {
      const key = flag.slice(2);
      if (!flag.startsWith('--') || ![...paths, 'case', 'suite', 'ffmpeg'].includes(key)) {
        throw Error(`Unknown argument: ${flag}`);
      }
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw Error(`Missing value for ${flag}`);
      if (key === 'case') options.cases.push(value);
      else options[key] = paths.has(key) ? path.resolve(value) : value;
      if (key === 'suite') options.explicitSuite = true;
    }
  }
  if (!['synthetic', 'video', 'all'].includes(options.suite)) throw Error('Invalid --suite');
  if (options.cases.length && !options.explicitSuite) options.suite = 'all';
  return options;
}

function check(condition, message) {
  if (!condition) throw Error(message);
}

function validateManifest(manifest) {
  check(manifest.schemaVersion === 1 && manifest.sampleRate === 4, 'Expected manifest schemaVersion 1 and sampleRate 4');
  check(Number.isFinite(manifest.toleranceSeconds) && manifest.toleranceSeconds >= 0 && manifest.toleranceSeconds <= 1,
    'toleranceSeconds must be between 0 and 1');
  check(Array.isArray(manifest.cases) && manifest.cases.length > 0, 'Manifest has no cases');
  const names = new Set();
  for (const test of manifest.cases) {
    check(typeof test.name === 'string' && /^[a-z0-9-]+$/.test(test.name) && !names.has(test.name), 'Invalid or duplicate case name');
    names.add(test.name);
    check(['single', 'dual'].includes(test.mode), `${test.name}: invalid mode`);
    check(typeof test.expectMatch === 'boolean', `${test.name}: expectMatch must be boolean`);
    check(!test.expectMatch || Number.isFinite(test.expectedOffset), `${test.name}: expectedOffset is required for a positive`);
    check(!test.knownFailure || (typeof test.knownFailure === 'string' && test.expectMatch), `${test.name}: knownFailure describes a missing-match positive only`);
    check(!test.repeatSeconds || (Number.isFinite(test.repeatSeconds) && test.repeatSeconds > 0 && Number.isInteger(test.repeatSeconds * 4)),
      `${test.name}: repeatSeconds must be positive and on the 4 fps grid`);
    for (const key of ['a', 'b']) {
      const spec = test[key], label = `${test.name}.${key}`;
      check(spec && typeof spec === 'object', `${label}: missing source`);
      const [width, height] = spec.dimensions || [];
      check(Array.isArray(spec.dimensions) && spec.dimensions.length === 2 && [width, height].every(x => Number.isInteger(x) && x > 0), `${label}: invalid dimensions`);
      check(Array.isArray(spec.roi) && spec.roi.length === 4 && spec.roi.every(Number.isInteger), `${label}: invalid roi`);
      const [x, y, w, h] = spec.roi;
      check(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height, `${label}: roi is outside the source`);
      check(Number.isFinite(spec.duration) && spec.duration > 0 && Number.isInteger(spec.duration * 4), `${label}: duration must be positive and on the 4 fps grid`);
      check(spec.start === undefined || (Number.isFinite(spec.start) && spec.start >= 0), `${label}: invalid start`);
      check(spec.mediaOrigin === undefined || Number.isFinite(spec.mediaOrigin), `${label}: invalid mediaOrigin`);
      check(!test.repeatSeconds || test.repeatSeconds <= spec.duration, `${label}: repeat exceeds source duration`);
      if (spec.synthetic) {
        check(spec.synthetic === 'clock' && width === 232 && height === 64 && test.mode === 'dual', `${label}: unsupported synthetic source`);
        check(spec.minute === undefined || (Number.isInteger(spec.minute) && spec.minute >= 0 && spec.minute <= 99), `${label}: invalid minute`);
      } else {
        check(typeof spec.file === 'string' && spec.file && !path.isAbsolute(spec.file)
          && !/[:\\]/.test(spec.file) && !spec.file.split('/').some(x => !x || x === '.' || x === '..'), `${label}: file must be a relative fixture path`);
        check(manifest.assets && manifest.assets[spec.file] && /^[a-f0-9]{64}$/.test(manifest.assets[spec.file].sha256), `${label}: asset SHA-256 is required`);
      }
    }
  }
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(8 * 1024 * 1024);
  try {
    for (let size; (size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, size));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

function runtimeHashes(directory) {
  return Object.fromEntries(RUNTIME_FILES.map(name => [name, hashFile(path.join(directory, name))]));
}

function selection(manifest, options) {
  for (const name of options.cases) check(manifest.cases.some(test => test.name === name), `Unknown case: ${name}`);
  const selected = manifest.cases.filter(test => {
    const generated = !!test.a.synthetic && !!test.b.synthetic;
    return (options.suite === 'all' || (options.suite === 'synthetic' ? generated : !generated))
      && (!options.cases.length || options.cases.includes(test.name));
  });
  check(selected.length > 0, 'No cases selected');
  return selected;
}

function fixtureHashes(selected, manifest, options) {
  const files = [...new Set(selected.flatMap(test => [test.a.file, test.b.file]).filter(Boolean))];
  check(!files.length || options.fixtures, 'Video cases require --fixtures DIR');
  return Object.fromEntries(files.map(file => {
    const source = path.join(options.fixtures, file);
    check(fs.existsSync(source) && fs.statSync(source).isFile(), `Missing fixture: ${file}`);
    const sha256 = hashFile(source);
    check(sha256 === manifest.assets[file].sha256, `Fixture SHA-256 mismatch: ${file}; use the intended asset or a manifest for your own material`);
    return [file, sha256];
  }));
}

function samples(spec, full, options) {
  if (spec.synthetic) return synthetic.samples(spec);
  const rectangle = full ? [0, 0, ...spec.dimensions] : spec.roi;
  const scale = Math.min(1, (full ? 1920 : 256) / Math.max(rectangle[2], rectangle[3]));
  const width = Math.max(2, Math.round(rectangle[2] * scale));
  const height = Math.max(2, Math.round(rectangle[3] * scale));
  const vf = `fps=4,crop=${rectangle[2]}:${rectangle[3]}:${rectangle[0]}:${rectangle[1]}:exact=1,scale=${width}:${height}:flags=bilinear`;
  const source = fs.realpathSync(path.join(options.fixtures, spec.file));
  // Include the resolved source identity and capture geometry. Realpath permits
  // local symlink fixture directories to reuse the same verified source cache.
  const signature = JSON.stringify([source, fs.statSync(source).mtimeMs, spec.start || 0, spec.duration, vf]);
  const cacheName = crypto.createHash('sha256').update(signature).digest('hex').slice(0, 18) + '.rgba';
  const output = path.join(options.cache, cacheName);
  const bytes = width * height * 4, count = spec.duration * 4, expectedBytes = count * bytes;
  if (!fs.existsSync(output)) {
    fs.mkdirSync(options.cache, { recursive: true });
    const temporary = output + `.tmp-${process.pid}`;
    try {
      const run = spawnSync(options.ffmpeg, ['-nostdin', '-v', 'error', '-threads', '2', '-ss', String(spec.start || 0),
        '-i', source, '-t', String(spec.duration), '-an', '-vf', vf, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-n', temporary],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
      check(run.status === 0, `${spec.file}: frame extraction failed: ${run.error?.message || run.stderr.trim() || run.signal || run.status}`);
      check(fs.statSync(temporary).size === expectedBytes, `${spec.file}: truncated or unexpected frame count; expected ${count} frames`);
      fs.renameSync(temporary, output);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  check(fs.statSync(output).size === expectedBytes, `${spec.file}: invalid cached frame count; remove ${cacheName} from the cache and retry`);
  const fd = fs.openSync(output, 'r');
  return {
    width, height, count,
    read(index) {
      const buffer = Buffer.alloc(bytes);
      check(fs.readSync(fd, buffer, 0, bytes, index * bytes) === bytes, `${spec.file}: short frame`);
      return new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, bytes);
    },
    close() { fs.closeSync(fd); },
  };
}

function execute(test, manifest, options) {
  const a = samples(test.a, false, options);
  let b;
  try {
    b = samples(test.b, test.mode === 'single', options);
    const messages = [], costs = [];
    const context = vm.createContext({ console, performance });
    context.self = context;
    context.postMessage = event => { if (event.type !== 'ready') messages.push(JSON.parse(JSON.stringify(event))); };
    // This is the production CommonJS export of each shared algorithm, not a test
    // reimplementation. Native modules avoid distorting timings with VM lookups.
    context.importScripts = (...names) => {
      for (const name of names) {
        check(Object.hasOwn(MODULES, name), `Unexpected worker dependency: ${name}`);
        context[MODULES[name]] = require(path.join(options.runtime, name));
      }
    };
    vm.runInContext(fs.readFileSync(path.join(options.runtime, 'visual-sync-worker.js'), 'utf8'), context, { filename: 'visual-sync-worker.js' });
    const stability = new context.VisualSync.Stability();
    let stable = null, seen = 0;
    context.onmessage({ data: { type: 'configure', mode: test.mode } });
    const count = Math.min(a.count, b.count);
    for (let i = 0; i < count; i++) {
      for (const [key, source] of [['a', a], ['b', b]]) {
        const spec = test[key];
        const index = test.static ? 0 : test.repeatSeconds ? i % (test.repeatSeconds * 4) : i;
        const begin = performance.now();
        context.onmessage({ data: { key, at: i / 4, mediaTime: (spec.mediaOrigin || 0) + (spec.start || 0) + i / 4,
          rgba: source.read(index), width: source.width, height: source.height } });
        costs.push(performance.now() - begin);
      }
      for (; seen < messages.length; seen++) {
        const event = messages[seen];
        check(event.type !== 'error', event.message || 'Worker error');
        // The player discards previous confidence when spatial registration changes.
        if (event.type === 'registered' || event.type === 'located') stability.reset();
        if (event.type === 'result' && stability.observe(event.result, event.at) && !stable) {
          const edgeDifference = (test.a.mediaOrigin || 0) + (test.a.start || 0)
            - (test.b.mediaOrigin || 0) - (test.b.start || 0);
          stable = { at: event.at, mediaDelta: event.result.mediaDelta,
            offset: context.VisualSync.targetOffset(edgeDifference, 0, event.result.mediaDelta),
            score: event.result.score, margin: event.result.margin };
        }
      }
    }
    const passed = test.expectMatch
      ? !!stable && Number.isFinite(stable.offset) && Math.abs(stable.offset - test.expectedOffset) <= manifest.toleranceSeconds
      : !stable;
    // A wrong offset or thrown error is never an accepted known failure.
    const knownFailureObserved = !passed && !!test.knownFailure && test.expectMatch && !stable;
    costs.sort((x, y) => x - y);
    const total = costs.reduce((x, y) => x + y, 0);
    return {
      name: test.name, mode: test.mode, expectMatch: test.expectMatch,
      expectedOffset: test.expectedOffset ?? null, passed, knownFailure: test.knownFailure || null, knownFailureObserved, stable,
      frameCount: count, processingMs: { total, mean: total / costs.length, median: costs[Math.floor(costs.length * .5)],
        p95: costs[Math.floor(costs.length * .95)], max: costs.at(-1) },
      locations: messages.filter(event => event.type === 'located'),
      registrations: messages.filter(event => event.type === 'registered'),
      results: messages.filter(event => event.type === 'result'),
    };
  } finally { a.close(); b?.close(); }
}

function main(argv) {
  const options = argumentsFor(argv);
  if (options.help) { console.log(HELP); return 0; }
  const manifestBytes = fs.readFileSync(options.manifest);
  const manifest = JSON.parse(manifestBytes);
  validateManifest(manifest);
  const selected = selection(manifest, options);
  if (options.list) { console.log(selected.map(test => test.name).join('\n')); return 0; }
  const sourceHashes = runtimeHashes(options.runtime);
  const assets = fixtureHashes(selected, manifest, options);
  let ffmpegVersion = null;
  if (Object.keys(assets).length) {
    const version = spawnSync(options.ffmpeg, ['-version'], { encoding: 'utf8', timeout: 10000 });
    check(version.status === 0, `Cannot run FFmpeg: ${version.error?.message || version.stderr?.trim() || version.status}`);
    ffmpegVersion = version.stdout.split(/\r?\n/)[0];
  }
  const started = performance.now(), results = [];
  for (const test of selected) {
    const result = execute(test, manifest, options);
    results.push(result);
    console.log(`${result.passed ? 'PASS' : result.knownFailureObserved ? 'KNOWN FAIL' : 'FAIL'} ${result.name}`
      + (result.stable ? `: offset=${Number.isFinite(result.stable.offset) ? result.stable.offset.toFixed(3) + 's' : 'unsupported'} at=${result.stable.at.toFixed(2)}s` : ': no stable match'));
  }
  check(JSON.stringify(sourceHashes) === JSON.stringify(runtimeHashes(options.runtime)), 'Runtime changed during validation; repeat against unchanged files');
  const blockingFailures = results.filter(result => !result.passed && !(options.allowKnownFailures && result.knownFailureObserved)).length;
  const unexpectedFailures = results.filter(result => !result.passed && !result.knownFailureObserved).length;
  const report = {
    schemaVersion: 1, testedAt: new Date().toISOString(), nodeVersion: process.version, ffmpegVersion,
    manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'), sourceHashes, fixtureHashes: assets,
    sampleRate: manifest.sampleRate, toleranceSeconds: manifest.toleranceSeconds,
    description: 'Offline production worker with native shared modules and exact decoded/generated frames; presentation timestamps are simulated at 4 fps. Timings include frame reads and worker calls, not system CPU utilization or live playback.',
    summary: { cases: results.length, passed: results.filter(result => result.passed).length,
      knownFailures: results.filter(result => result.knownFailureObserved).length, unexpectedFailures, blockingFailures,
      allowKnownFailures: !!options.allowKnownFailures, elapsedMs: performance.now() - started },
    results,
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.summary.passed}/${results.length} passed; ${report.summary.knownFailures} known failure(s). Report: ${options.output}`);
  return blockingFailures ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(`visual-sync: ${error.message}`); process.exitCode = 2; }
}
module.exports = { argumentsFor, validateManifest, selection, execute, main };
