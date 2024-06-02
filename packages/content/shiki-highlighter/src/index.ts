import { withHighlighter } from '@analogjs/content';
import { Provider } from '@angular/core';
import {
  SHIKI_CONTAINER_OPTION,
  SHIKI_HIGHLIGHT_OPTIONS,
  SHIKI_HIGHLIGHTER_THEMES,
  ShikiHighlighter,
  ShikiHighlightOptions,
} from './lib/shiki-highlighter';

export { ShikiHighlighter };

export type WithShikiHighlighterOptions = ShikiHighlightOptions & {
  container?: string;
};

export function withShikiHighlighter({
  container = '%s',
  ...highlight
}: WithShikiHighlighterOptions = {}): Provider {
  const highlighterThemes = [];

  if (!highlight.theme && !highlight.themes) {
    highlight.themes = { dark: 'github-dark', light: 'github-light' };
  }

  if (highlight.theme) {
    highlighterThemes.push(highlight.theme);
  } else if (highlight.themes) {
    highlighterThemes.push(...Object.values(highlight.themes));
  }

  return [
    { provide: SHIKI_HIGHLIGHTER_THEMES, useValue: highlighterThemes },
    { provide: SHIKI_HIGHLIGHT_OPTIONS, useValue: highlight },
    { provide: SHIKI_CONTAINER_OPTION, useValue: container },
    withHighlighter({ useClass: ShikiHighlighter }),
  ];
}
