import { desktopCapturer, systemPreferences } from 'electron';
import { dirname, join } from 'node:path';
import type { ScreenSource } from './screen';
import { SIG_H, SIG_W, signatureFromBgra } from './screen';

type Worker = {
  recognize(image: Buffer): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

/** Where the bundled English text-reading data lives (unpacked from the app archive). */
function langPath(): string {
  const pkg = require.resolve('@tesseract.js-data/eng/package.json');
  return join(dirname(pkg), '4.0.0_best_int').replace('app.asar', 'app.asar.unpacked');
}

/**
 * Screen access through Electron's supported API (desktopCapturer), which the OS
 * permission governs. Only single still pictures of the meeting window are taken.
 */
export function electronScreenSource(denied: () => boolean = () => false): ScreenSource {
  let worker: Promise<Worker> | null = null;
  const reader = () => {
    worker ??= import('tesseract.js').then(
      (t) =>
        t.createWorker('eng', 1, {
          langPath: langPath(),
          gzip: true,
          cacheMethod: 'none',
        }) as Promise<Worker>,
    );
    return worker;
  };
  const windows = (size: { width: number; height: number }) =>
    desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false });
  return {
    async listWindows() {
      if (
        denied() ||
        (process.platform === 'darwin' &&
          systemPreferences.getMediaAccessStatus('screen') !== 'granted')
      )
        return 'denied';
      return (await windows({ width: 0, height: 0 })).map((s) => ({ id: s.id, title: s.name }));
    },
    async grab(id) {
      const small = (await windows({ width: SIG_W * 2, height: SIG_H * 2 })).find(
        (s) => s.id === id,
      );
      if (!small || small.thumbnail.isEmpty()) return null;
      const bitmap = small.thumbnail.resize({ width: SIG_W, height: SIG_H }).toBitmap();
      return {
        signature: signatureFromBgra(bitmap),
        png: async () => {
          const big = (await windows({ width: 1920, height: 1200 })).find((s) => s.id === id);
          return big && !big.thumbnail.isEmpty() ? big.thumbnail.toPNG() : null;
        },
      };
    },
    async readText(png) {
      const { data } = await (await reader()).recognize(png);
      return data.text;
    },
    async release() {
      const w = worker;
      worker = null;
      if (w) await (await w).terminate();
    },
  };
}
