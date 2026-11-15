/**
 * Photon "Protocol18" value deserializer — the format Albion Online uses inside Photon messages
 * (verified against captured traffic: compressed varints, little-endian numbers, 1-byte parameter counts).
 * Read-only: we never build or send game traffic.
 *
 * Type codes: Photon GpType (Protocol18). Values are normalised to simple JS values, and every parameter
 * also gets a short type tag ("f", "i", "l", "y:f", ...) used by calibration.
 */

export const P18 = {
  Unknown: 0,
  Boolean: 2,
  Byte: 3,
  Short: 4,
  Float: 5,
  Double: 6,
  String: 7,
  Null: 8,
  CompressedInt: 9,
  CompressedLong: 10,
  Int1: 11,
  Int1Neg: 12,
  Int2: 13,
  Int2Neg: 14,
  L1: 15,
  L1Neg: 16,
  L2: 17,
  L2Neg: 18,
  Custom: 19,
  Dictionary: 20,
  Hashtable: 21,
  ObjectArray: 23,
  OperationRequest: 24,
  OperationResponse: 25,
  EventData: 26,
  BooleanFalse: 27,
  BooleanTrue: 28,
  ShortZero: 29,
  IntZero: 30,
  LongZero: 31,
  FloatZero: 32,
  DoubleZero: 33,
  ByteZero: 34,
  Array: 0x40,
  BooleanArray: 0x42,
  ByteArray: 0x43,
  ShortArray: 0x44,
  FloatArray: 0x45,
  DoubleArray: 0x46,
  StringArray: 0x47,
  CompressedIntArray: 0x49,
  CompressedLongArray: 0x4a,
  CustomTypeArray: 0x53,
  DictionaryArray: 0x54,
  HashtableArray: 0x55,
  CustomTypeSlim: 0x80,
} as const;

export type PhotonValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | PhotonValue[]
  | { custom: number; data: Uint8Array }
  | { entries: [PhotonValue, PhotonValue][] }
  | PhotonParams;

/** Parameter table: key → value, plus a normalised type tag per key. */
export type PhotonParams = { params: Map<number, PhotonValue>; types: Map<number, string> };

export class ProtocolError extends Error {}

const MAX_COLLECTION = 1 << 20;

// BigInt constants (the project targets ES2017, which has no BigInt literal syntax).
const B0 = BigInt(0);
const B1 = BigInt(1);
const B7 = BigInt(7);
const U32_MASK = BigInt(0xffffffff);

/** Normalised tag vocabulary (independent of protocol version): f d i l k b s o * x c D h z y:<el>. */
export function typeTag(type: number): string {
  if (type >= P18.CustomTypeSlim) return "c";
  switch (type) {
    case P18.Boolean:
    case P18.BooleanFalse:
    case P18.BooleanTrue:
      return "o";
    case P18.Byte:
    case P18.ByteZero:
      return "b";
    case P18.Short:
    case P18.ShortZero:
      return "k";
    case P18.Float:
    case P18.FloatZero:
      return "f";
    case P18.Double:
    case P18.DoubleZero:
      return "d";
    case P18.String:
      return "s";
    case P18.Null:
    case P18.Unknown:
      return "*";
    case P18.CompressedInt:
    case P18.Int1:
    case P18.Int1Neg:
    case P18.Int2:
    case P18.Int2Neg:
    case P18.IntZero:
      return "i";
    case P18.CompressedLong:
    case P18.L1:
    case P18.L1Neg:
    case P18.L2:
    case P18.L2Neg:
    case P18.LongZero:
      return "l";
    case P18.Custom:
      return "c";
    case P18.Dictionary:
      return "D";
    case P18.Hashtable:
      return "h";
    case P18.ObjectArray:
      return "z";
    case P18.ByteArray:
      return "x";
    case P18.StringArray:
      return "y:s";
    case P18.BooleanArray:
      return "y:o";
    case P18.ShortArray:
      return "y:k";
    case P18.FloatArray:
      return "y:f";
    case P18.DoubleArray:
      return "y:d";
    case P18.CompressedIntArray:
      return "y:i";
    case P18.CompressedLongArray:
      return "y:l";
    default:
      if ((type & P18.Array) === P18.Array) return `y:${typeTag(type & ~P18.Array)}`;
      return `?${type}`;
  }
}

export class Reader {
  private view: DataView;
  pos = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.byteLength - this.pos;
  }

  private need(n: number) {
    if (n < 0 || this.pos + n > this.bytes.byteLength) throw new ProtocolError(`Unexpected end of data (need ${n} at ${this.pos})`);
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  /** Big-endian helpers — used by the Photon packet/command headers, not by Protocol18 values. */
  beU16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  beI32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }
  beU32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  /** Little-endian values (Protocol18). */
  leI16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  leU16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  leF32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  leF64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  bytesN(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** Unsigned LEB128 varint (up to 64 bits) as bigint. */
  private varint(): bigint {
    let result = B0;
    let shift = B0;
    for (let i = 0; i < 10; i++) {
      const b = this.u8();
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += B7;
    }
    throw new ProtocolError("varint too long");
  }
  compressedUInt(): number {
    return Number(this.varint() & U32_MASK);
  }
  /** Zigzag-decoded varint. */
  compressedInt(): number {
    const v = this.varint();
    return Number((v >> B1) ^ -(v & B1));
  }

  private count(): number {
    const n = this.compressedUInt();
    if (n > MAX_COLLECTION) throw new ProtocolError(`Invalid collection size ${n}`);
    return n;
  }

  string(): string {
    const len = this.count();
    return new TextDecoder().decode(this.bytesN(len));
  }

  /** Reads one value of the given wire type (the type byte itself has already been consumed). */
  value(type: number): PhotonValue {
    if (type >= P18.CustomTypeSlim) {
      return { custom: type & 0x7f, data: this.bytesN(this.count()) };
    }
    switch (type) {
      case P18.Unknown:
      case P18.Null:
        return null;
      case P18.Boolean:
        return this.u8() !== 0;
      case P18.BooleanFalse:
        return false;
      case P18.BooleanTrue:
        return true;
      case P18.Byte:
        return this.u8();
      case P18.Short:
        return this.leI16();
      case P18.Float:
        return this.leF32();
      case P18.Double:
        return this.leF64();
      case P18.String:
        return this.string();
      case P18.CompressedInt:
      case P18.CompressedLong:
        return this.compressedInt();
      case P18.Int1:
      case P18.L1:
        return this.u8();
      case P18.Int1Neg:
      case P18.L1Neg:
        return -this.u8();
      case P18.Int2:
      case P18.L2:
        return this.leU16();
      case P18.Int2Neg:
      case P18.L2Neg:
        return -this.leU16();
      case P18.ShortZero:
      case P18.IntZero:
      case P18.LongZero:
      case P18.FloatZero:
      case P18.DoubleZero:
      case P18.ByteZero:
        return 0;
      case P18.Custom: {
        const custom = this.u8();
        return { custom, data: this.bytesN(this.count()) };
      }
      case P18.Dictionary: {
        const keyType = this.u8();
        const valueType = this.u8();
        const n = this.count();
        const entries: [PhotonValue, PhotonValue][] = [];
        for (let i = 0; i < n; i++) {
          const k = this.value(keyType === P18.Unknown ? this.u8() : keyType);
          entries.push([k, this.value(valueType === P18.Unknown ? this.u8() : valueType)]);
        }
        return { entries };
      }
      case P18.Hashtable:
        return this.hashtable();
      case P18.ObjectArray: {
        const n = this.count();
        return Array.from({ length: n }, () => this.value(this.u8()));
      }
      case P18.OperationRequest: {
        this.u8();
        return this.paramTable();
      }
      case P18.OperationResponse: {
        this.u8();
        this.leI16();
        this.value(this.u8());
        return this.paramTable();
      }
      case P18.EventData: {
        this.u8();
        return this.paramTable();
      }
      case P18.ByteArray:
        return this.bytesN(this.count());
      case P18.BooleanArray: {
        const n = this.count();
        const packed = this.bytesN(Math.ceil(n / 8));
        return Array.from({ length: n }, (_, i) => (packed[i >> 3] & (1 << (i & 7))) !== 0);
      }
      case P18.ShortArray: {
        const n = this.count();
        return Array.from({ length: n }, () => this.leI16());
      }
      case P18.FloatArray: {
        const n = this.count();
        return Array.from({ length: n }, () => this.leF32());
      }
      case P18.DoubleArray: {
        const n = this.count();
        return Array.from({ length: n }, () => this.leF64());
      }
      case P18.StringArray: {
        const n = this.count();
        return Array.from({ length: n }, () => this.string());
      }
      case P18.CompressedIntArray:
      case P18.CompressedLongArray: {
        const n = this.count();
        return Array.from({ length: n }, () => this.compressedInt());
      }
      case P18.CustomTypeArray: {
        const n = this.count();
        const custom = this.u8();
        return Array.from({ length: n }, () => ({ custom, data: this.bytesN(this.count()) }));
      }
      case P18.HashtableArray: {
        const n = this.count();
        return Array.from({ length: n }, () => this.hashtable());
      }
      case P18.Array: {
        // Array of arrays: every element carries its own type byte (verified on captured traffic:
        // "40 02 | 49 01 1e | 49 00" = two compressed-int arrays).
        const n = this.count();
        return Array.from({ length: n }, () => this.value(this.u8()));
      }
      default:
        if ((type & P18.Array) === P18.Array) {
          const n = this.count();
          const elementType = type & ~P18.Array;
          return Array.from({ length: n }, () => this.value(elementType));
        }
        throw new ProtocolError(`Unknown Protocol18 type ${type}`);
    }
  }

  private hashtable(): PhotonValue {
    const n = this.count();
    const entries: [PhotonValue, PhotonValue][] = [];
    for (let i = 0; i < n; i++) {
      const k = this.value(this.u8());
      entries.push([k, this.value(this.u8())]);
    }
    return { entries };
  }

  /** Parameter table: 1-byte count, then (key byte, type byte, value) per parameter. */
  paramTable(): PhotonParams {
    const n = this.u8();
    const params = new Map<number, PhotonValue>();
    const types = new Map<number, string>();
    for (let i = 0; i < n; i++) {
      const key = this.u8();
      const type = this.u8();
      params.set(key, this.value(type));
      types.set(key, typeTag(type));
    }
    return { params, types };
  }
}

export function isPhotonParams(v: PhotonValue): v is PhotonParams {
  return typeof v === "object" && v !== null && "params" in v && v.params instanceof Map;
}
