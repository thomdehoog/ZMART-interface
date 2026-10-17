/**
 * The drawing rules this page takes from the installed ZMART viewer
 * (`tools/the-installed-viewer.mjs`), as the type checker sees them. The
 * viewer owns them, in its package's `drawing` folder; this says only what
 * the page uses of them.
 */

declare module "zmart-viewer/drawing/programs.js" {
  /** A channel's window: the stored values drawn from black to full colour. */
  export interface DrawingWindow {
    low: number;
    high: number;
  }

  /** The shader program that draws one channel. */
  export function shaderFor(
    volumetric: boolean,
    lut?: string | null,
    opaque?: boolean,
    options?: { gamma?: boolean },
  ): string;

  /** The values for that program's controls, or undefined without a window. */
  export function shaderControlsFor(
    window_: DrawingWindow | null | undefined,
    volumetric: boolean,
    weight: number,
    colour: readonly [number, number, number],
    lut?: string | null,
    attenuation?: number,
    gamma?: number | null,
  ): Record<string, unknown> | undefined;
}
