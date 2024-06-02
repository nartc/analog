/// <reference types="vite/client" />

import {
  MarkedContentHighlighter,
  MERMAID_IMPORT_TOKEN,
} from '@analogjs/content';
import {
  inject,
  Injectable,
  InjectionToken,
  makeStateKey,
  TransferState,
} from '@angular/core';
import markedShiki from 'marked-shiki';
import type {
  BundledLanguage,
  BundledTheme,
  CodeOptionsMeta,
  CodeOptionsMultipleThemes,
  CodeOptionsSingleTheme,
  CodeToHastOptionsCommon,
  HighlighterCore,
} from 'shiki';
import { getHighlighterCore } from 'shiki/core';
import getWasm from 'shiki/wasm';

export type ShikiHighlightOptions = Partial<
  Omit<CodeToHastOptionsCommon<BundledLanguage>, 'lang'>
> &
  CodeOptionsMeta &
  Partial<CodeOptionsSingleTheme<BundledTheme>> &
  Partial<CodeOptionsMultipleThemes<BundledTheme>>;

export const [
  SHIKI_HIGHLIGHTER_THEMES,
  SHIKI_HIGHLIGHT_OPTIONS,
  SHIKI_CONTAINER_OPTION,
] = [
  new InjectionToken<string[]>('SHIKI_HIGHLIGHTER_THEMES'),
  new InjectionToken<ShikiHighlightOptions>('SHIKI_HIGHLIGHT_OPTIONS'),
  new InjectionToken<string>('SHIKI_CONTAINER_OPTION'),
];

@Injectable()
export class ShikiHighlighter extends MarkedContentHighlighter {
  private readonly transferState = inject(TransferState);
  private count = 0;

  private readonly highlighterThemes = inject(SHIKI_HIGHLIGHTER_THEMES);
  private readonly highlightOptions = inject(SHIKI_HIGHLIGHT_OPTIONS);
  private readonly highlighterContainer = inject(SHIKI_CONTAINER_OPTION);
  private readonly hasLoadMermaid = inject(MERMAID_IMPORT_TOKEN, {
    optional: true,
  });

  private highlighterCore?: HighlighterCore;

  override getHighlightExtension() {
    return markedShiki({
      container: this.highlighterContainer,
      highlight: async (code, lang, props) => {
        if (this.hasLoadMermaid && lang === 'mermaid') {
          return `<pre class="mermaid">${code}</pre>`;
        }

        const key = makeStateKey<string>(`shiki-${lang}-${this.count++}`);
        if (import.meta.env.SSR === true) {
          const { codeToHtml } = await this.initHighlighter(lang);

          const html = codeToHtml(
            code,
            Object.assign(
              {
                lang,
                // required by `transformerMeta*`
                meta: { __raw: props.join(' ') },
              } as any,
              this.highlightOptions
            )
          );
          this.transferState.set(key, html);
          return html;
        }

        return this.transferState.get(key, code);
      },
    });
  }

  private async initHighlighter(lang: string) {
    if (!this.highlighterCore) {
      this.highlighterCore = await getHighlighterCore({ loadWasm: getWasm });

      for (const theme of this.highlighterThemes) {
        if (this.highlighterCore.getLoadedThemes().includes(theme as string))
          continue;
        const themeModule = await import(`shiki/themes/${theme}.mjs`);
        await this.highlighterCore.loadTheme(themeModule);
      }
    }

    if (!this.highlighterCore.getLoadedLanguages().includes(lang)) {
      const langModule = await import(`shiki/langs/${lang}.mjs`);
      await this.highlighterCore.loadLanguage(langModule);
    }

    return this.highlighterCore;
  }
}
