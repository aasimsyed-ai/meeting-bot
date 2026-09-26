import type {
  CaptureChannelName,
  CaptureWindowCommand,
  CaptureWindowEvent,
} from '../../shared/channels';

interface CaptureBridge {
  audio(channel: CaptureChannelName, buffer: ArrayBuffer): void;
  event(evt: CaptureWindowEvent): void;
}

declare global {
  interface Window {
    captureBridge: CaptureBridge;
    __capture: { run(cmd: CaptureWindowCommand): Promise<void> };
  }
}

const bridge = window.captureBridge;
let ctx: AudioContext | null = null;
let sink: AudioNode | null = null;
let streams: { channel: CaptureChannelName; stream: MediaStream }[] = [];

const VOICE = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

function failed(channel: CaptureChannelName, err: unknown) {
  const name = err instanceof DOMException ? err.name : '';
  const reason =
    name === 'NotAllowedError' || name === 'SecurityError'
      ? 'denied'
      : name === 'NotFoundError'
        ? 'not_found'
        : name === 'NotSupportedError'
          ? 'unsupported'
          : 'error';
  bridge.event({ type: 'failed', channel, reason, detail: name || String(err) });
}

function tap(stream: MediaStream, channel: CaptureChannelName, sink: AudioNode) {
  if (!ctx) return;
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-tap', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
  });
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => bridge.audio(channel, e.data);
  source.connect(node);
  node.connect(sink);
  for (const track of stream.getAudioTracks())
    track.addEventListener('ended', () => bridge.event({ type: 'ended', channel }));
  streams.push({ channel, stream });
  bridge.event({
    type: 'started',
    channel,
    label: stream.getAudioTracks()[0]?.label ?? '',
    sampleRate: ctx.sampleRate,
  });
}

async function startMic(deviceId: string | null, sink: AudioNode) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { ...VOICE, deviceId: { exact: deviceId } } : VOICE,
    });
    tap(stream, 'mic', sink);
  } catch (err) {
    // The chosen microphone may have been unplugged: fall back to the default one.
    if (deviceId) return startMic(null, sink);
    failed('mic', err);
  }
}

async function startSystem(sink: AudioNode) {
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({
      // Meeting audio is already clean. Chromium turns voice processing on by default, and on
      // this stream it is harmful: echo cancellation removes the meeting audio itself (it is
      // the "echo" of what the speakers play), and gain control turns down the system's
      // output-monitor volume, which some systems remember (see docs/bug-log.md).
      audio: RAW,
      video: { width: 16, height: 16, frameRate: 1 },
    });
    for (const t of display.getVideoTracks()) t.stop();
    const audio = display.getAudioTracks();
    if (audio.length === 0) {
      bridge.event({
        type: 'failed',
        channel: 'system',
        reason: 'unsupported',
        detail: 'no audio track',
      });
      return;
    }
    tap(new MediaStream(audio), 'system', sink);
  } catch (err) {
    failed('system', err);
  }
}

function stopChannel(channel: CaptureChannelName | null) {
  for (const s of streams)
    if (channel === null || s.channel === channel) for (const t of s.stream.getTracks()) t.stop();
  streams = streams.filter((s) => channel !== null && s.channel !== channel);
}

async function stopAll() {
  stopChannel(null);
  if (ctx) await ctx.close().catch(() => undefined);
  ctx = null;
  sink = null;
}

async function run(cmd: CaptureWindowCommand) {
  if (cmd.type === 'start') {
    await stopAll();
    ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule(new URL('./pcm-worklet.js', location.href).href);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    sink = gain;
    if (cmd.mic) await startMic(cmd.micDeviceId, gain);
    if (cmd.system) await startSystem(gain);
  } else if (cmd.type === 'restart') {
    if (!ctx || !sink) return;
    stopChannel(cmd.channel);
    if (cmd.channel === 'mic') await startMic(cmd.micDeviceId, sink);
    else await startSystem(sink);
  } else if (cmd.type === 'pause') {
    await ctx?.suspend();
  } else if (cmd.type === 'resume') {
    await ctx?.resume();
  } else if (cmd.type === 'stop') {
    await stopAll();
  }
}

navigator.mediaDevices?.addEventListener('devicechange', () =>
  bridge.event({ type: 'devices-changed' }),
);
window.__capture = { run };
