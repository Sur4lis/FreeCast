const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const repository = process.env.GITHUB_REPOSITORY;
const commit = process.env.GITHUB_SHA;
const token = process.env.GH_TOKEN;
if (repository !== 'Sur4lis/FreeCast' || !/^[a-f0-9]{40}$/.test(commit || '') || !token) throw Error('Missing release context');
const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
async function api(route, method = 'GET', body) {
  const response = await fetch('https://api.github.com/repos/' + repository + route, {
    method, headers: {...headers, 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000)
  });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw Error('GitHub ' + method + ' ' + route + ': ' + response.status);
  return response.json();
}
async function main() {
  let release = await api('/releases/tags/v1.20');
  if (release && !release.draft) throw Error('v1.20 is already published; refusing to replace it');
  if (release && release.target_commitish !== commit) throw Error('Existing draft targets another commit');
  if (!release) release = await api('/releases', 'POST', {
    tag_name: 'v1.20', target_commitish: commit, name: 'FreeCast v1.20', draft: true,
    prerelease: false, make_latest: 'false', body: fs.readFileSync(path.join(root, 'releases/v1.20.md'), 'utf8')
  });
  const names = ['FreeCast_v1.20.zip', 'FreeCast_v1.20_source.zip', 'SHA256SUMS.txt'];
  for (const name of names) {
    const data = fs.readFileSync(path.join(root, 'release', name));
    const digest = 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
    const existing = release.assets.find(asset => asset.name === name);
    if (existing) {
      if (existing.digest !== digest || existing.size !== data.length || existing.state !== 'uploaded') throw Error('Conflicting release asset: ' + name);
      continue;
    }
    const url = release.upload_url.split('{')[0] + '?name=' + encodeURIComponent(name);
    const response = await fetch(url, {method: 'POST', headers: {...headers, 'Content-Type': name.endsWith('.zip') ? 'application/zip' : 'text/plain'}, body: data, signal: AbortSignal.timeout(300000)});
    if (!response.ok) throw Error('Asset upload failed: ' + name + ' (' + response.status + ')');
    const asset = await response.json();
    if (asset.digest !== digest || asset.size !== data.length || asset.state !== 'uploaded') throw Error('Asset verification failed: ' + name);
    console.log('Verified ' + name);
  }
  release = await api('/releases/' + release.id, 'PATCH', {draft: false, prerelease: false, make_latest: 'true'});
  console.log(release.html_url);
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
