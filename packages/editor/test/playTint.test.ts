import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchPlayTint } from '../src/shell/playTint';
import { useEditorStore } from '../src/state/editorStore';

/*
 * From the press of Play to Stop the whole editor is tinted, amber while
 * paused. The tint is `styles.css`'s; what turns it on is one attribute on the
 * document's root, and that attribute is all there is to test here: written
 * from the play state, there from the press — before the game's first frame
 * too — and gone at Stop.
 */

const play = () => useEditorStore.getState().play();
const togglePause = () => useEditorStore.getState().togglePause();
const stop = () => useEditorStore.getState().stop();

/** The document's root as the watcher writes it: its dataset alone. */
const fakeRoot = () => ({ dataset: {} as DOMStringMap });

const stops: Array<() => void> = [];

beforeEach(() => stop());

afterEach(() => {
  for (const unwatch of stops.splice(0)) unwatch();
  stop();
});

describe('the Play tint', () => {
  it('is off while stopped', () => {
    const root = fakeRoot();
    stops.push(watchPlayTint(root));
    // Absent, not empty: `[data-play]` matches an empty attribute too.
    expect(root.dataset).toStrictEqual({});
  });

  it('follows the play state from the press to Stop, paused included', () => {
    const root = fakeRoot();
    stops.push(watchPlayTint(root));

    play();
    expect(root.dataset).toStrictEqual({ play: 'playing' });
    togglePause();
    expect(root.dataset).toStrictEqual({ play: 'paused' });
    togglePause();
    expect(root.dataset).toStrictEqual({ play: 'playing' });
    stop();
    expect(root.dataset).toStrictEqual({});
  });

  it('says a pause at once when installed while paused', () => {
    play();
    togglePause();
    const root = fakeRoot();
    stops.push(watchPlayTint(root));
    expect(root.dataset).toStrictEqual({ play: 'paused' });
  });

  it('takes its attribute away when it stops watching, and writes nothing after', () => {
    const root = fakeRoot();
    const unwatch = watchPlayTint(root);
    play();
    unwatch();
    expect(root.dataset).toStrictEqual({});

    stop();
    play();
    expect(root.dataset).toStrictEqual({});
  });
});
