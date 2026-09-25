/**
 * Transcription utility process. Runs the speech engine off the main
 * process so capture and the UI never stall while speech is recognized.
 */
import { SpeechEngine } from './engine';
import type { FromWorker, ToWorker } from './protocol';

interface ParentPort {
  on(event: 'message', listener: (e: { data: ToWorker }) => void): void;
  postMessage(msg: FromWorker): void;
}

const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
let engine: SpeechEngine | null = null;
let failed = false;

function send(msg: FromWorker) {
  port?.postMessage(msg);
}

port?.on('message', ({ data }) => {
  void handle(data);
});

async function handle(msg: ToWorker): Promise<void> {
  try {
    if (msg.type === 'init') {
      engine = await SpeechEngine.create(msg.paths, { numThreads: msg.numThreads });
      send({ type: 'ready' });
      return;
    }
    if (!engine || failed) {
      if (msg.type === 'flush') send({ type: 'flushed', id: msg.id });
      if (msg.type === 'finalize') send({ type: 'finalized', id: msg.id, labels: [] });
      return;
    }
    if (msg.type === 'audio') {
      for (const segment of engine.push(msg.channel, new Float32Array(msg.samples)))
        send({ type: 'segment', segment });
    } else if (msg.type === 'flush') {
      for (const segment of engine.flush()) send({ type: 'segment', segment });
      send({ type: 'flushed', id: msg.id });
    } else if (msg.type === 'finalize') {
      send({ type: 'finalized', id: msg.id, labels: engine.finalizeSpeakers() });
    }
  } catch (err) {
    failed = true;
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    if (msg.type === 'flush') send({ type: 'flushed', id: msg.id });
    if (msg.type === 'finalize') send({ type: 'finalized', id: msg.id, labels: [] });
  }
}
