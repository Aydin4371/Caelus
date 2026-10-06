import type { FastRde2dRecording } from "./fast-rde-2d.ts";

export function pressureColor(fraction: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, fraction));
  return [Math.round(255 * t), Math.round(220 * Math.sin(Math.PI * t)), Math.round(255 * (1 - t))];
}

export function recordingPressureRange(recording: FastRde2dRecording): [number, number] {
  let low = Infinity, high = -Infinity;
  for (const frame of recording.frames) for (const p of frame.pressureBar) { low = Math.min(low, p); high = Math.max(high, p); }
  return [low, high];
}

/** A real frame sequence, no invented motion. Frequent clear codes keep GIF LZW at 9 bits. */
export function encodePressureGif(recording: FastRde2dRecording): Uint8Array {
  if (!recording.frames.length) throw new Error("No simulation frames to export.");
  const scale = 4, width = recording.nx * scale, height = recording.ny * scale;
  const bytes: number[] = [];
  const put = (...values: number[]) => { for (const value of values) bytes.push(value); };
  const word = (value: number) => put(value & 255, value >> 8 & 255);
  const text = (value: string) => { for (const c of value) put(c.charCodeAt(0)); };
  text("GIF89a"); word(width); word(height); put(0xf7, 0, 0);
  for (let i = 0; i < 256; i++) put(...pressureColor(i / 255));
  put(0x21, 0xff, 11); text("NETSCAPE2.0"); put(3, 1, 0, 0, 0);
  const [low, high] = recordingPressureRange(recording);
  const comment = `Kythros calculated pressure; not test footage; global scale ${low.toFixed(4)} to ${high.toFixed(4)} bar; ${recording.frames[0].timeMs} to ${recording.frames.at(-1)!.timeMs} ms; playback slowed.`;
  put(0x21, 0xfe, comment.length); text(comment); put(0);
  const duration = recording.frames.at(-1)!.timeMs - recording.frames[0].timeMs || 1;
  for (const [index, frame] of recording.frames.entries()) {
    const next = recording.frames[index + 1]?.timeMs ?? frame.timeMs + duration / recording.frames.length;
    put(0x21, 0xf9, 4, 4); word(Math.max(2, Math.round(600 * (next - frame.timeMs) / duration))); put(0, 0);
    put(0x2c); word(0); word(0); word(width); word(height); put(0, 8);
    const packed: number[] = [];
    let bits = 0, bitCount = 0, sinceClear = 0;
    const code = (value: number) => {
      bits |= value << bitCount; bitCount += 9;
      while (bitCount >= 8) { packed.push(bits & 255); bits >>>= 8; bitCount -= 8; }
    };
    code(256);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (sinceClear === 200) { code(256); sinceClear = 0; }
      const cell = (recording.ny - 1 - Math.floor(y / scale)) * recording.nx + Math.floor(x / scale);
      code(Math.round(255 * Math.max(0, Math.min(1, (frame.pressureBar[cell] - low) / (high - low || 1)))));
      sinceClear++;
    }
    code(257); if (bitCount) packed.push(bits & 255);
    for (let offset = 0; offset < packed.length; offset += 255) {
      const block = packed.slice(offset, offset + 255); put(block.length, ...block);
    }
    put(0);
  }
  put(0x3b);
  return new Uint8Array(bytes);
}
