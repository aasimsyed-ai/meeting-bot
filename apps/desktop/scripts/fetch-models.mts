// Downloads the speech models with the app's own verified downloader
// (SHA-256 pinned, atomic install). Used by CI and for local testing.
//   node --experimental-strip-types scripts/fetch-models.mts <dir> [model]
import { downloadModel } from '../src/main/transcription/models.ts';

const [dir, model = 'parakeet-v3'] = process.argv.slice(2);
if (!dir) {
  console.error('usage: fetch-models.mts <dir> [model]');
  process.exit(1);
}
let last = -1;
await downloadModel({
  root: dir,
  model: model as 'moonshine-base-en',
  fetcher: (url, signal) => fetch(url, { signal }),
  signal: new AbortController().signal,
  onProgress: (done, total) => {
    const pct = Math.floor((done / total) * 10) * 10;
    if (pct !== last) {
      last = pct;
      console.log(`${pct}%`);
    }
  },
});
console.log(`models ready in ${dir}`);
