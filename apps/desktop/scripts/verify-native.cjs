// electron-builder afterPack hook: fail the build if the speech engine's native
// binary for the target platform and architecture is not in the package.
// pnpm only installs the binary for the machine it runs on, so a cross-arch
// build (for example macOS x64 on an Apple silicon runner) needs it installed first.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' };

exports.default = async function verifyNative(context) {
  const os = context.electronPlatformName;
  const arch = ARCH[context.arch];
  const resources =
    os === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : join(context.appOutDir, 'resources');
  const binary = join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    `sherpa-onnx-${os === 'win32' ? 'win' : os}-${arch}`,
    'sherpa-onnx.node',
  );
  if (!existsSync(binary)) {
    throw new Error(
      `The speech engine binary for ${os}-${arch} is missing from the package (${binary}). ` +
        'Install it before packaging; see docs/deployment.md.',
    );
  }
  console.log(`  • speech engine binary present for ${os}-${arch}`);
};
