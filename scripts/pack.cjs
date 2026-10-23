const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Zip = require('adm-zip');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'browser-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const version = manifest.version_name;
if (version !== '1.20' || manifest.version !== version) throw Error('Unexpected release version');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const ordered = values => values.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
function files(directory) {
  return ordered(fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    if (entry.isSymbolicLink()) throw Error('Symlink in release');
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  }));
}
function add(zip, name, bytes) {
  zip.addFile(name, bytes);
  zip.getEntry(name).header.time = new Date(2026, 9, 23, 0, 0, 0);
  zip.getEntry(name).header.made = 0x0314;
}
function write(zip, name) {
  const destination = path.join(root, 'release', name);
  zip.writeZip(destination);
  const reopened = new Zip(destination);
  for (const entry of zip.getEntries()) {
    if (!reopened.getEntry(entry.entryName) || digest(entry.getData()) !== digest(reopened.readFile(entry.entryName))) throw Error('ZIP verification failed: ' + entry.entryName);
  }
  return digest(fs.readFileSync(destination)) + '  ' + name;
}
fs.mkdirSync(path.join(root, 'release'), {recursive: true});
const expected = JSON.parse(fs.readFileSync(path.join(root, 'release-files.json'), 'utf8'));
const runtime = files(source);
if (runtime.length !== Object.keys(expected).length) throw Error('Unexpected runtime file count');
const appZip = new Zip();
const prefix = 'FreeCast_v' + version;
const sums = [];
for (const file of runtime) {
  const relative = path.relative(source, file).replaceAll('\\', '/');
  const bytes = fs.readFileSync(file);
  if (digest(bytes) !== expected[relative]) throw Error('Runtime checksum mismatch: ' + relative);
  add(appZip, prefix + '/FreeCast浏览器插件/' + relative, bytes);
  sums.push(digest(bytes) + '  ' + relative);
}
add(appZip, prefix + '/文件校验_SHA256.txt', Buffer.from(sums.join('\n') + '\n'));
const packageHash = write(appZip, prefix + '.zip');
const sourceZip = new Zip();
const excluded = new Set(['release', 'node_modules', '.cache', '.git']);
const sourceFiles = [];
for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
  if (excluded.has(entry.name)) continue;
  const file = path.join(root, entry.name);
  sourceFiles.push(...(entry.isDirectory() ? files(file) : [file]));
}
for (const file of ordered(sourceFiles)) {
  if (/\.(?:onnx|wasm)$/.test(file)) continue;
  add(sourceZip, prefix + '_source/' + path.relative(root, file).replaceAll('\\', '/'), fs.readFileSync(file));
}
const sourceHash = write(sourceZip, prefix + '_source.zip');
fs.writeFileSync(path.join(root, 'release', 'SHA256SUMS.txt'), packageHash + '\n' + sourceHash + '\n');
console.log(packageHash + '\n' + sourceHash);
