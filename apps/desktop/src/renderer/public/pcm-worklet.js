// Collects 16 kHz mono samples into 100 ms frames and hands them to the page.
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1600;
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const n = Math.min(this.size - this.filled, channel.length - offset);
        this.buffer.set(channel.subarray(offset, offset + n), this.filled);
        this.filled += n;
        offset += n;
        if (this.filled === this.size) {
          this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(this.size);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
