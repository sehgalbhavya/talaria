// Records the microphone as a mono 16 kHz WAV (a format Gemini accepts directly, in every browser).

export class WavRecorder {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: ScriptProcessorNode;
  private chunks: Float32Array[] = [];

  async start(onLevel?: (level: number) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    try {
      this.ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      this.ctx = new AudioContext(); // some browsers won't resample; the WAV then uses their rate
    }
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = e => {
      const data = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      if (onLevel) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        onLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
      }
    };
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  async stop(): Promise<Blob> {
    this.node?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    const rate = this.ctx?.sampleRate || 16000;
    await this.ctx?.close().catch(() => {});
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Int16Array(length);
    let at = 0;
    for (const c of this.chunks) for (let i = 0; i < c.length; i++) pcm[at++] = Math.max(-1, Math.min(1, c[i])) * 0x7fff;
    this.chunks = [];
    return wav(pcm, rate);
  }
}

function wav(pcm: Int16Array, rate: number) {
  const header = new DataView(new ArrayBuffer(44));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => header.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  header.setUint32(4, 36 + pcm.byteLength, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  str(36, 'data');
  header.setUint32(40, pcm.byteLength, true);
  return new Blob([header.buffer as ArrayBuffer, pcm.buffer as ArrayBuffer], { type: 'audio/wav' });
}
