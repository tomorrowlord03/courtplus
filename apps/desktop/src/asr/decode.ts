export const sampleRate = 16_000;
const maxSamples = 3 * 3600 * sampleRate;
const transferSize = 256 * 1024;

/** Decode only the bytes supplied by main, in a sandbox with no preload or application UI. */
export async function decodeHearingAudio(bytes: Uint8Array): Promise<Float32Array> {
  const { BrowserWindow } = await import('electron');
  const window = new BrowserWindow({
    show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-frame-navigate', event => event.preventDefault());
  const run = (code: string) => contents.executeJavaScriptInIsolatedWorld(1001, [{ code }]);
  try {
    await window.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27">');
    await run(`globalThis.source = new Uint8Array(${bytes.length}); true`);
    for (let offset = 0; offset < bytes.length; offset += transferSize) {
      const base64 = Buffer.from(bytes.subarray(offset, offset + transferSize)).toString('base64');
      await run(`source.set(Uint8Array.from(atob('${base64}'), c => c.charCodeAt(0)), ${offset})`);
    }
    const length: number = await run(`(async () => {
      const audio = await new OfflineAudioContext(1, 1, ${sampleRate}).decodeAudioData(source.buffer);
      globalThis.decoded = audio;
      return audio.length;
    })()`);
    if (length > maxSamples) throw new Error('Only hearings up to three hours can be transcribed.');
    const samples = new Float32Array(length);
    for (let offset = 0; offset < length; offset += transferSize) {
      const part: Float32Array = await run(`(() => {
        const samples = new Float32Array(Math.min(${transferSize}, decoded.length - ${offset}));
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const data = decoded.getChannelData(channel);
          for (let i = 0; i < samples.length; i++) samples[i] += data[${offset} + i] / decoded.numberOfChannels;
        }
        return samples;
      })()`);
      samples.set(part, offset);
    }
    return samples;
  } finally {
    window.destroy();
  }
}
