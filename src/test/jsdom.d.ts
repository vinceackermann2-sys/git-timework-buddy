// jsdom ships without type declarations; the consent test only needs JSDOM and its window.
declare module "jsdom" {
  export class JSDOM {
    constructor(
      html?: string,
      options?: { url?: string; runScripts?: "dangerously" | "outside-only" },
    );
    readonly window: Window & typeof globalThis;
  }
}
