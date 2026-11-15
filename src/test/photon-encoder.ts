/**
 * Minimal Photon/Protocol18 ENCODER used only by tests and the local pipeline simulator to build
 * synthetic packets. It is never used against the game.
 */
import { P18 } from "@/lib/damage/protocol18";

export type Typed =
  | { t: "b" | "k" | "i" | "l" | "f" | "d"; v: number }
  | { t: "s"; v: string }
  | { t: "o"; v: boolean }
  | { t: "*" }
  | { t: "x"; v: Uint8Array }
  | { t: "n"; v: number[] }
  | { t: "y"; el: "f" | "i" | "l" | "k" | "s"; v: (number | string)[] };

const B0 = BigInt(0);
const B1 = BigInt(1);
const B7 = BigInt(7);
const B7F = BigInt(0x7f);

class Writer {
  private bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  raw(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i]);
  }
  private dv(n: number, f: (d: DataView) => void) {
    const b = new Uint8Array(n);
    f(new DataView(b.buffer));
    this.raw(b);
  }
  /** Big-endian, for packet/command headers. */
  beI16(v: number) {
    this.dv(2, (d) => d.setInt16(0, v));
  }
  beI32(v: number) {
    this.dv(4, (d) => d.setInt32(0, v));
  }
  leI16(v: number) {
    this.dv(2, (d) => d.setInt16(0, v, true));
  }
  leF32(v: number) {
    this.dv(4, (d) => d.setFloat32(0, v, true));
  }
  leF64(v: number) {
    this.dv(8, (d) => d.setFloat64(0, v, true));
  }
  varint(v: bigint) {
    let x = v;
    do {
      let b = Number(x & B7F);
      x >>= B7;
      if (x > B0) b |= 0x80;
      this.u8(b);
    } while (x > B0);
  }
  zigzag(v: number) {
    const b = BigInt(v);
    this.varint(b >= B0 ? b << B1 : (-b << B1) - B1);
  }
  str(v: string) {
    const b = new TextEncoder().encode(v);
    this.varint(BigInt(b.length));
    this.raw(b);
  }
  scalar(t: string, v: number | string) {
    switch (t) {
      case "b":
        return this.u8(v as number);
      case "k":
        return this.leI16(v as number);
      case "i":
      case "l":
        return this.zigzag(v as number);
      case "f":
        return this.leF32(v as number);
      case "d":
        return this.leF64(v as number);
      case "s":
        return this.str(v as string);
    }
    throw new Error(`unsupported ${t}`);
  }
  typed(x: Typed) {
    const code: Record<string, number> = {
      b: P18.Byte,
      k: P18.Short,
      i: P18.CompressedInt,
      l: P18.CompressedLong,
      f: P18.Float,
      d: P18.Double,
      s: P18.String,
      o: P18.Boolean,
      "*": P18.Null,
      x: P18.ByteArray,
      n: P18.CompressedIntArray,
    };
    const arrayCode: Record<string, number> = {
      f: P18.FloatArray,
      i: P18.CompressedIntArray,
      l: P18.CompressedLongArray,
      k: P18.ShortArray,
      s: P18.StringArray,
    };
    this.u8(x.t === "y" ? arrayCode[x.el] : code[x.t]);
    switch (x.t) {
      case "*":
        return;
      case "o":
        return this.u8(x.v ? 1 : 0);
      case "x":
        this.varint(BigInt(x.v.length));
        return this.raw(x.v);
      case "n":
        this.varint(BigInt(x.v.length));
        return x.v.forEach((n) => this.zigzag(n));
      case "y":
        this.varint(BigInt(x.v.length));
        return x.v.forEach((n) => this.scalar(x.el, n));
      default:
        return this.scalar(x.t, x.v);
    }
  }
  /** Protocol18 parameter table: 1-byte count, then key + typed value. */
  params(p: Record<number, Typed>) {
    const keys = Object.keys(p).map(Number);
    this.u8(keys.length);
    for (const k of keys) {
      this.u8(k);
      this.typed(p[k]);
    }
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export const f = (v: number): Typed => ({ t: "f", v });
export const i = (v: number): Typed => ({ t: "i", v });
export const l = (v: number): Typed => ({ t: "l", v });
export const k = (v: number): Typed => ({ t: "k", v });
export const s = (v: string): Typed => ({ t: "s", v });

/** Albion-style event: Photon byte code 1, real code in parameter 252. */
export function eventMessage(code: number, params: Record<number, Typed>): Uint8Array {
  const w = new Writer();
  w.u8(0xf3);
  w.u8(4);
  w.u8(1);
  w.params({ ...params, 252: k(code) });
  return w.done();
}

export function responseMessage(opCode: number, params: Record<number, Typed>): Uint8Array {
  const w = new Writer();
  w.u8(0xf3);
  w.u8(3);
  w.u8(1);
  w.leI16(0);
  w.u8(P18.Null);
  w.params({ ...params, 253: k(opCode) });
  return w.done();
}

type Command = { type: number; data: Uint8Array };

export function reliable(message: Uint8Array): Command {
  return { type: 6, data: message };
}

export function unreliable(message: Uint8Array): Command {
  return { type: 7, data: Uint8Array.from([0, 0, 0, 1, ...message]) };
}

/** Splits a message into reliable-fragment commands of at most `size` bytes each. */
export function fragments(message: Uint8Array, size: number, startSeq = 100): Command[] {
  const count = Math.ceil(message.length / size);
  return Array.from({ length: count }, (_, n) => {
    const w = new Writer();
    w.beI32(startSeq);
    w.beI32(count);
    w.beI32(n);
    w.beI32(message.length);
    w.beI32(n * size);
    w.raw(message.subarray(n * size, (n + 1) * size));
    return { type: 8, data: w.done() };
  });
}

export function packet(commands: Command[]): Uint8Array {
  const w = new Writer();
  w.beI16(1); // peer id
  w.u8(0); // crc
  w.u8(commands.length);
  w.beI32(0); // timestamp
  w.beI32(0); // challenge
  for (const c of commands) {
    w.u8(c.type);
    w.u8(0);
    w.u8(0);
    w.u8(0);
    w.beI32(c.data.length + 12);
    w.beI32(1);
    w.raw(c.data);
  }
  return w.done();
}
