// zstd-compat.mjs — compress strings with the `zstd` binary via stdin.
// (macOS: `brew install zstd`; most Linux CI images and the DSH runtime
// environment already ship it — DSH itself shell-outs to zstd for its own
// session logs.)
import { execFileSync } from 'node:child_process';

export function zstdSync(text) {
  return execFileSync('zstd', ['-3', '-T0', '-q', '-'], {
    input: text,
    maxBuffer: 1 << 28,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

// DSH session logs require the first zstd frame to hold exactly the header
// line (assertZstdHeaderFrame); events must be in separate frames.
export function zstdFramesSync(...texts) {
  return Buffer.concat(texts.map((t) => zstdSync(t)));
}
