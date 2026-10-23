const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Zip = require('adm-zip');
const root = path.resolve(__dirname, '..');
const lock = require('../assets.lock.json');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

async function main() {
  const missing = Object.entries(lock.files).filter(([name, digest]) => {
    const file = path.join(root, 'browser-extension', name);
    return !fs.existsSync(file) || hash(fs.readFileSync(file)) !== digest;
  });
  if (!missing.length) return console.log('Assets verified.');
  const response = await fetch(lock.archive, {signal: AbortSignal.timeout(300000)});
  if (!response.ok) throw Error('Asset download failed: ' + response.status);
  const data = Buffer.from(await response.arrayBuffer());
  if (hash(data) !== lock.sha256) throw Error('Archive checksum mismatch');
  const zip = new Zip(data);
  for (const [name, digest] of missing) {
    const matches = zip.getEntries().filter(entry => !entry.isDirectory && entry.entryName.endsWith('/' + name));
    if (matches.length !== 1) throw Error('Missing or ambiguous asset: ' + name);
    const bytes = matches[0].getData();
    if (hash(bytes) !== digest) throw Error('Asset checksum mismatch: ' + name);
    const target = path.join(root, 'browser-extension', name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, bytes);
    console.log('Prepared ' + name);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
