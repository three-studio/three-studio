import { useEditorStore, type PlayState } from '../state/editorStore';

/**
 * Tints the whole editor from the press of Play to Stop, amber while paused:
 * `data-play` on the document's root, `playing` or `paused`, absent while
 * stopped. What the attribute does is `styles.css`'s, beside the greys it mixes.
 *
 * On the root, because that is where every token is declared — Tailwind's theme
 * and Tweakpane's variables alike — and a custom property's `var()` is resolved
 * on the element that declares it, its descendants inheriting the result. On
 * `body` or the app's own root the attribute would change the tint's variables
 * there, and not one grey would move.
 *
 * Read from the play state rather than from the view's: the tint is on from the
 * press, while the game starts as much as once it shows, and a pause pressed
 * before its first frame is a pause.
 *
 * Written once when installed, then whenever the play state moves. The root is
 * a parameter so that a test can hand it a stand-in.
 *
 * @returns How to stop, which takes the attribute away.
 */
export function watchPlayTint(root: { readonly dataset: DOMStringMap } = document.documentElement): () => void {
  const write = (playState: PlayState): void => {
    // Deleted rather than emptied: `[data-play]` matches an empty attribute.
    if (playState === 'stopped') delete root.dataset.play;
    else root.dataset.play = playState;
  };

  write(useEditorStore.getState().playState);
  const unsubscribe = useEditorStore.subscribe((state, previous) => {
    if (state.playState !== previous.playState) write(state.playState);
  });

  return () => {
    unsubscribe();
    delete root.dataset.play;
  };
}
