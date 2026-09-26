/* global window, document, navigator, Audio, setTimeout */
// Slides and audio for the fake meeting window (see main.cjs).
let data = null;
const meeting = new Audio();
const mic = new Audio();
const idle = new Audio();

function showSlide(lines) {
  const el = document.getElementById('slide');
  el.className = 'slide';
  el.replaceChildren(
    ...lines.map((text, i) => {
      const n = document.createElement(i === 0 ? 'h1' : 'p');
      n.textContent = text;
      return n;
    }),
  );
}

async function useMicSink(el) {
  if (!data.micSink || !el.setSinkId) return false;
  const outs = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === 'audiooutput' && d.label.toLowerCase().includes(data.micSink.toLowerCase()),
  );
  if (!outs[0]) return false;
  await el.setSinkId(outs[0].deviceId);
  return true;
}

window.setup = async (d) => {
  data = d;
  document.getElementById('people').replaceChildren(
    ...d.people.map((p) => {
      const n = document.createElement('div');
      n.className = 'tile';
      n.textContent = p;
      return n;
    }),
  );
  meeting.src = d.meeting;
  mic.src = d.mic;
  idle.src = d.micIdle;
  idle.loop = true;
  const ok = (await useMicSink(mic)) && (await useMicSink(idle));
  if (ok) await idle.play();
  return ok;
};

window.play = () =>
  new Promise((resolve) => {
    document.getElementById('status').textContent = 'In the meeting';
    for (const s of data.slides) {
      const at = data.lines[s.fromLine]?.startMs ?? 0;
      setTimeout(() => showSlide(s.lines), Math.max(0, at - 1000));
    }
    idle.pause();
    meeting.onended = () => {
      document.getElementById('status').textContent = 'The meeting has ended';
      idle.play().catch(() => undefined);
      resolve(true);
    };
    if (data.micSink) mic.play().catch(() => undefined);
    meeting.play().catch(() => resolve(false));
  });
