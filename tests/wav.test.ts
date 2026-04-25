import { describe, it, expect } from "vitest";
import { encodeWav } from "../src/core/wav.js";

describe("encodeWav", () => {
  it("writes a valid RIFF/WAVE header", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const bytes = encodeWav(samples, 16000);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const ascii = (o: number, n: number) =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(ascii(36, 4)).toBe("data");

    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it("clamps samples and encodes endpoints as int16 extremes", () => {
    const samples = new Float32Array([-2, -1, 0, 1, 2]);
    const bytes = encodeWav(samples);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getInt16(44, true)).toBe(-0x8000);
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(0x7fff);
    expect(view.getInt16(52, true)).toBe(0x7fff);
  });

  it("total byte length is 44 + 2 * sample count", () => {
    const samples = new Float32Array(1000);
    const bytes = encodeWav(samples);
    expect(bytes.byteLength).toBe(44 + 2000);
  });
});
