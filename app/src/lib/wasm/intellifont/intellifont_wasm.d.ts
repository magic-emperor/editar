/* tslint:disable */
/* eslint-disable */

/**
 * Identify a font from raw font-file bytes (TTF/OTF) against a GLYPHDB2 database.
 */
export function identify_from_buffer(font_bytes: Uint8Array, chars: string, db_bytes: Uint8Array, limit: number): string;

/**
 * Identify a font from browser Canvas pixel metrics (Canvas DNA) against GLYPHDB2.
 */
export function identify_from_pixel_metrics(metrics_json: string, db_bytes: Uint8Array, limit: number): string;

/**
 * Engine version string (sanity check that the wasm loaded).
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly identify_from_buffer: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly identify_from_pixel_metrics: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly version: () => [number, number];
    readonly BroccoliConcatFinish: (a: number, b: number, c: number) => number;
    readonly BroccoliConcatFinished: (a: number, b: number, c: number) => number;
    readonly BroccoliConcatStream: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly BroccoliConcatStreaming: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly BroccoliCreateInstance: (a: number) => void;
    readonly BroccoliCreateInstanceWithWindowSize: (a: number, b: number) => void;
    readonly BroccoliDestroyInstance: (a: number) => void;
    readonly BroccoliNewBrotliFile: (a: number) => void;
    readonly BrotliEncoderCompress: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly BrotliEncoderCompressMulti: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly BrotliEncoderCompressStream: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly BrotliEncoderCompressStreaming: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly BrotliEncoderCompressWorkPool: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => number;
    readonly BrotliEncoderCreateInstance: (a: number, b: number, c: number) => number;
    readonly BrotliEncoderCreateWorkPool: (a: number, b: number, c: number, d: number) => number;
    readonly BrotliEncoderDestroyInstance: (a: number) => void;
    readonly BrotliEncoderDestroyWorkPool: (a: number) => void;
    readonly BrotliEncoderFreeU8: (a: number, b: number, c: number) => void;
    readonly BrotliEncoderFreeUsize: (a: number, b: number, c: number) => void;
    readonly BrotliEncoderHasMoreOutput: (a: number) => number;
    readonly BrotliEncoderIsFinished: (a: number) => number;
    readonly BrotliEncoderMallocU8: (a: number, b: number) => number;
    readonly BrotliEncoderMallocUsize: (a: number, b: number) => number;
    readonly BrotliEncoderMaxCompressedSize: (a: number) => number;
    readonly BrotliEncoderMaxCompressedSizeMulti: (a: number, b: number) => number;
    readonly BrotliEncoderSetCustomDictionary: (a: number, b: number, c: number) => void;
    readonly BrotliEncoderSetParameter: (a: number, b: number, c: number) => number;
    readonly BrotliEncoderTakeOutput: (a: number, b: number) => number;
    readonly BrotliEncoderVersion: () => number;
    readonly CBrotliDecoderErrorString: (a: number) => number;
    readonly CBrotliDecoderGetErrorCode: (a: number) => number;
    readonly CBrotliDecoderGetErrorString: (a: number) => number;
    readonly CBrotliDecoderHasMoreOutput: (a: number) => number;
    readonly CBrotliDecoderIsFinished: (a: number) => number;
    readonly CBrotliDecoderIsUsed: (a: number) => number;
    readonly CBrotliDecoderTakeOutput: (a: number, b: number) => number;
    readonly BrotliDecoderErrorString: (a: number) => number;
    readonly BrotliDecoderGetErrorCode: (a: number) => number;
    readonly BrotliDecoderGetErrorString: (a: number) => number;
    readonly BrotliDecoderHasMoreOutput: (a: number) => number;
    readonly BrotliDecoderIsFinished: (a: number) => number;
    readonly BrotliDecoderIsUsed: (a: number) => number;
    readonly BrotliDecoderTakeOutput: (a: number, b: number) => number;
    readonly BrotliDecoderFreeU8: (a: number, b: number, c: number) => void;
    readonly BrotliDecoderVersion: () => number;
    readonly BrotliDecoderMallocU8: (a: number, b: number) => number;
    readonly BrotliDecoderFreeUsize: (a: number, b: number, c: number) => void;
    readonly BrotliDecoderDecompress: (a: number, b: number, c: number, d: number) => number;
    readonly BrotliDecoderMallocUsize: (a: number, b: number) => number;
    readonly BrotliDecoderSetParameter: (a: number, b: number, c: number) => void;
    readonly BrotliDecoderCreateInstance: (a: number, b: number, c: number) => number;
    readonly BrotliDecoderDestroyInstance: (a: number) => void;
    readonly BrotliDecoderDecompressStream: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly BrotliDecoderDecompressPrealloc: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly BrotliDecoderDecompressStreaming: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly BrotliDecoderDecompressWithReturnInfo: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
