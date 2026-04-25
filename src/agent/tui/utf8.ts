/**
 * utf8.ts — stateful UTF-8 byte decoder used by the raw-mode reader.
 *
 * Spec §5.2 / §18.2 — every printable byte in the reader must flow through
 * a stateful UTF-8 decoder. A 2-byte Greek letter, 3-byte CJK character,
 * or 4-byte emoji can arrive split across two `data` chunks; a naïve
 * `String.fromCharCode(b)` mangles each byte into Latin-1 mojibake.
 *
 * `node:string_decoder.StringDecoder` already does the right thing — this
 * file is a thin typed wrapper so tests can drive a fresh decoder in
 * isolation and the production reader has a single import point.
 */

import { StringDecoder } from 'node:string_decoder';

export interface Utf8Decoder {
  /**
   * Push a single byte into the decoder. Returns either the decoded code
   * point(s) ready to render, or the empty string when the byte is part
   * of an in-flight multi-byte sequence and more bytes are needed.
   */
  write(byte: number): string;

  /**
   * Flush any partial sequence — used at end-of-input. Returns whatever
   * the decoder thinks the trailing bytes resolve to (typically a
   * U+FFFD replacement for ill-formed input). The reader does not call
   * this in normal operation; it exists for completeness.
   */
  end(): string;
}

export function createUtf8Decoder(): Utf8Decoder {
  const decoder = new StringDecoder('utf8');
  // Reuse a single 1-byte buffer for the per-byte path. Allocating a fresh
  // Buffer on every keystroke is wasteful and StringDecoder copies internally.
  const single = Buffer.alloc(1);
  return {
    write(byte: number): string {
      single[0] = byte;
      return decoder.write(single);
    },
    end(): string {
      return decoder.end();
    },
  };
}
