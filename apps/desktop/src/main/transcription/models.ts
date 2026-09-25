import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ModelId, ModelStatus } from '../../shared/types';

/**
 * Speech models come from the sherpa-onnx GitHub releases (Apache-2.0 code;
 * model licenses are listed in docs/open-source-dependencies.md). Every
 * download is pinned to a SHA-256 hash and installed atomically.
 */
const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

export interface ModelFile {
  id: string;
  url: string;
  sha256: string;
  bytes: number;
  /** "archive" files are .tar.bz2 and extract to `dir`. */
  kind: 'archive' | 'file';
  dir?: string;
  fileName?: string;
}

export const SUPPORT_FILES: ModelFile[] = [
  {
    id: 'vad',
    url: `${BASE}/asr-models/silero_vad.onnx`,
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
    bytes: 643_854,
    kind: 'file',
    fileName: 'silero_vad.onnx',
  },
  {
    id: 'speaker',
    url: `${BASE}/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx`,
    sha256: '5ef208a9da1453335308a6b6f4e6dfbd7e183a38b604de0a57664f45d257fe94',
    bytes: 26_534_365,
    kind: 'file',
    fileName: 'wespeaker_en_voxceleb_resnet34.onnx',
  },
];

export const ASR_MODELS: Record<
  ModelId,
  ModelFile & { label: string; languages: string; engine: 'moonshine' | 'transducer' }
> = {
  'moonshine-base-en': {
    id: 'moonshine-base-en',
    label: 'Standard (English)',
    languages: 'English',
    engine: 'moonshine',
    url: `${BASE}/asr-models/sherpa-onnx-moonshine-base-en-int8.tar.bz2`,
    sha256: '21870cecaa2e44e4e2bf63e02d1072bed183ccd10284871353bd9d24dad14e5e',
    bytes: 250_807_309,
    kind: 'archive',
    dir: 'sherpa-onnx-moonshine-base-en-int8',
  },
  'moonshine-tiny-en': {
    id: 'moonshine-tiny-en',
    label: 'Fast (English, smaller download)',
    languages: 'English',
    engine: 'moonshine',
    url: `${BASE}/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2`,
    sha256: 'd5fe6ec4334fef36255b2a4010412cad4c007e33103fec62fb5d17cad88086f2',
    bytes: 107_600_538,
    kind: 'archive',
    dir: 'sherpa-onnx-moonshine-tiny-en-int8',
  },
  'parakeet-v3': {
    id: 'parakeet-v3',
    label: 'Multilingual (25 European languages)',
    languages: 'English and 24 other European languages',
    engine: 'transducer',
    url: `${BASE}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`,
    sha256: '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf',
    bytes: 487_170_055,
    kind: 'archive',
    dir: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
  },
};

/** Files needed for one ASR model plus the shared VAD and speaker models. */
export function requiredFiles(model: ModelId): ModelFile[] {
  return [...SUPPORT_FILES, ASR_MODELS[model]];
}

function installedMarker(root: string, f: ModelFile): string {
  return join(root, `.${f.id}.installed`);
}

export function isInstalled(root: string, f: ModelFile): boolean {
  const marker = installedMarker(root, f);
  if (!existsSync(marker)) return false;
  const target = f.kind === 'archive' ? join(root, f.dir!) : join(root, f.fileName!);
  return existsSync(target) && readFileSync(marker, 'utf8').trim() === f.sha256;
}

export function modelsReady(root: string, model: ModelId): boolean {
  return requiredFiles(model).every((f) => isInstalled(root, f));
}

export interface ModelPaths {
  vad: string;
  speaker: string;
  engine: 'moonshine' | 'transducer';
  asrDir: string;
}

export function modelPaths(root: string, model: ModelId): ModelPaths {
  const asr = ASR_MODELS[model];
  return {
    vad: join(root, 'silero_vad.onnx'),
    speaker: join(root, 'wespeaker_en_voxceleb_resnet34.onnx'),
    engine: asr.engine,
    asrDir: join(root, asr.dir!),
  };
}

export type Fetcher = (url: string, signal: AbortSignal) => Promise<Response>;

export class DownloadCancelled extends Error {
  constructor() {
    super('Download cancelled.');
    this.name = 'DownloadCancelled';
  }
}

/**
 * Download everything a model needs. Resumable at file granularity: files
 * that are already installed and verified are skipped.
 */
export interface DownloadOptions {
  root: string;
  fetcher: Fetcher;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
  tarCommand?: string;
}

export function downloadModel(opts: DownloadOptions & { model: ModelId }): Promise<void> {
  return downloadFiles({ ...opts, files: requiredFiles(opts.model) });
}

export async function downloadFiles(opts: DownloadOptions & { files: ModelFile[] }): Promise<void> {
  const { root, fetcher, signal, files } = opts;
  mkdirSync(root, { recursive: true });
  const total = files.reduce((n, f) => n + f.bytes, 0);
  let done = files.filter((f) => isInstalled(root, f)).reduce((n, f) => n + f.bytes, 0);
  opts.onProgress(done, total);

  for (const f of files) {
    if (isInstalled(root, f)) continue;
    if (signal.aborted) throw new DownloadCancelled();
    const tmp = join(root, `.${f.id}.part`);
    rmSync(tmp, { force: true });
    const res = await fetcher(f.url, signal);
    if (!res.ok || !res.body)
      throw new Error(`The download server answered ${res.status}. Try again later.`);
    const hash = createHash('sha256');
    const out = createWriteStream(tmp, { mode: 0o600 });
    const reader = res.body.getReader();
    let received = 0;
    try {
      for (;;) {
        if (signal.aborted) throw new DownloadCancelled();
        const { value, done: finished } = await reader.read();
        if (finished) break;
        hash.update(value);
        received += value.byteLength;
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        opts.onProgress(done + Math.min(received, f.bytes), total);
      }
      await new Promise<void>((resolve, reject) =>
        out.end((err?: Error | null) => (err ? reject(err) : resolve())),
      );
    } catch (err) {
      out.destroy();
      rmSync(tmp, { force: true });
      throw err;
    }
    const digest = hash.digest('hex');
    if (digest !== f.sha256) {
      rmSync(tmp, { force: true });
      throw new Error(
        'The downloaded speech model did not pass its integrity check, so it was deleted. Please try again.',
      );
    }
    if (f.kind === 'file') {
      renameSync(tmp, join(root, f.fileName!));
    } else {
      const staging = join(root, `.${f.id}.staging`);
      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true });
      await extractTarBz2(tmp, staging, opts.tarCommand ?? 'tar');
      rmSync(join(root, f.dir!), { recursive: true, force: true });
      renameSync(join(staging, f.dir!), join(root, f.dir!));
      rmSync(staging, { recursive: true, force: true });
      rmSync(tmp, { force: true });
    }
    writeFileSync(installedMarker(root, f), f.sha256);
    done += f.bytes;
    opts.onProgress(done, total);
  }
}

function extractTarBz2(archive: string, dest: string, tar: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ['-xjf', archive, '-C', dest], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', () =>
      reject(
        new Error('Could not unpack the speech model because the system "tar" tool is missing.'),
      ),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Could not unpack the speech model (${err.trim().slice(0, 200)}).`)),
    );
  });
}

export function emptyStatus(model: ModelId, root: string): ModelStatus {
  const ready = modelsReady(root, model);
  const total = requiredFiles(model).reduce((n, f) => n + f.bytes, 0);
  return {
    model,
    ready,
    downloading: false,
    progress: ready ? 1 : 0,
    totalBytes: total,
    error: null,
  };
}

export function diskUsage(root: string): number {
  let n = 0;
  for (const f of [...SUPPORT_FILES, ...Object.values(ASR_MODELS)]) {
    if (!isInstalled(root, f)) continue;
    n += f.kind === 'file' ? statSync(join(root, f.fileName!)).size : f.bytes;
  }
  return n;
}
