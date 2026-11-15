/**
 * Photon UDP packet layer: packet header → commands → (reassembled) messages → Protocol18 parameters.
 * Packet and command headers are big-endian; message contents are Protocol18 (little-endian, varints).
 * Albion puts its own event code in parameter 252 and operation codes in parameter 253.
 */
import { ProtocolError, Reader, type PhotonParams } from "./protocol18";

export type MessageKind = "request" | "response" | "event";

export type PhotonMessage = PhotonParams & {
  kind: MessageKind;
  /** Albion code: param 252 for events, 253 for operations; falls back to the Photon byte code. */
  code: number;
  /** Epoch ms when the packet was captured. */
  at: number;
};

const PACKET_HEADER = 12;
const COMMAND_HEADER = 12;
const CMD_RELIABLE = 6;
const CMD_UNRELIABLE = 7;
const CMD_FRAGMENT = 8;
const SIGNAL = 0xf3;
const FRAGMENT_TTL_MS = 10_000;
const MAX_PENDING_FRAGMENTS = 256;

export const EVENT_CODE_KEY = 252;
export const OPERATION_CODE_KEY = 253;

type Pending = { total: number; count: number; parts: Map<number, { offset: number; data: Uint8Array }>; firstAt: number };

export type DecodeStats = { packets: number; messages: number; encrypted: number; errors: number; lastError: string | null };

export class PhotonDecoder {
  private pending = new Map<number, Pending>();
  readonly stats: DecodeStats = { packets: 0, messages: 0, encrypted: 0, errors: 0, lastError: null };

  /** Decodes one UDP payload; malformed input is counted and skipped, never thrown. */
  decodePacket(payload: Uint8Array, at: number): PhotonMessage[] {
    this.stats.packets++;
    const out: PhotonMessage[] = [];
    try {
      const r = new Reader(payload);
      r.beU16(); // peer id
      r.u8(); // crc enabled
      const commandCount = r.u8();
      r.beU32(); // timestamp
      r.beI32(); // challenge
      if (r.pos !== PACKET_HEADER) throw new ProtocolError("bad header");

      for (let i = 0; i < commandCount && r.remaining >= COMMAND_HEADER; i++) {
        const type = r.u8();
        r.u8(); // channel
        r.u8(); // flags
        r.u8(); // reserved
        const length = r.beI32();
        r.beI32(); // reliable sequence number
        const dataLength = length - COMMAND_HEADER;
        if (dataLength < 0 || dataLength > r.remaining) throw new ProtocolError(`bad command length ${length}`);
        const data = r.bytesN(dataLength);

        if (type === CMD_RELIABLE) this.pushMessage(data, at, out);
        else if (type === CMD_UNRELIABLE && data.byteLength > 4) this.pushMessage(data.subarray(4), at, out);
        else if (type === CMD_FRAGMENT) this.pushFragment(data, at, out);
      }
    } catch (err) {
      this.stats.errors++;
      this.stats.lastError = err instanceof Error ? err.message : String(err);
    }
    this.expireFragments(at);
    return out;
  }

  private pushFragment(data: Uint8Array, at: number, out: PhotonMessage[]) {
    const r = new Reader(data);
    const start = r.beI32();
    const count = r.beI32();
    const number = r.beI32();
    const total = r.beI32();
    const offset = r.beI32();
    const chunk = r.bytesN(r.remaining);
    if (count <= 0 || count > 4096 || total <= 0 || total > 1 << 22 || offset < 0 || offset + chunk.byteLength > total) {
      throw new ProtocolError("bad fragment header");
    }
    let p = this.pending.get(start);
    if (!p) {
      if (this.pending.size >= MAX_PENDING_FRAGMENTS) this.pending.delete(this.pending.keys().next().value!);
      p = { total, count, parts: new Map(), firstAt: at };
      this.pending.set(start, p);
    }
    p.parts.set(number, { offset, data: chunk });
    if (p.parts.size < p.count) return;

    this.pending.delete(start);
    const full = new Uint8Array(p.total);
    for (const part of p.parts.values()) full.set(part.data, part.offset);
    this.pushMessage(full, at, out);
  }

  private expireFragments(now: number) {
    for (const [k, p] of this.pending) if (now - p.firstAt > FRAGMENT_TTL_MS) this.pending.delete(k);
  }

  private pushMessage(data: Uint8Array, at: number, out: PhotonMessage[]) {
    if (data.byteLength < 3 || data[0] !== SIGNAL) return;
    const msgType = data[1];
    if (msgType & 0x80) {
      this.stats.encrypted++;
      return;
    }
    const r = new Reader(data.subarray(2));
    let kind: MessageKind;
    let byteCode: number;
    if (msgType === 2) {
      kind = "request";
      byteCode = r.u8();
    } else if (msgType === 3 || msgType === 7) {
      kind = "response";
      byteCode = r.u8();
      r.leI16(); // return code
      r.value(r.u8()); // debug message
    } else if (msgType === 4) {
      kind = "event";
      byteCode = r.u8();
    } else {
      return; // internal / ping messages
    }
    const table = r.paramTable();
    const albionCode = table.params.get(kind === "event" ? EVENT_CODE_KEY : OPERATION_CODE_KEY);
    out.push({ ...table, kind, code: typeof albionCode === "number" ? albionCode : byteCode, at });
    this.stats.messages++;
  }
}

/** "event:6", "response:2" — identifies a message type independent of its contents. */
export function messageSignature(m: Pick<PhotonMessage, "kind" | "code">): string {
  return `${m.kind}:${m.code}`;
}
