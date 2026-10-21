/*
 * WebKit's pinch, as events of its own: on iOS, and with a trackpad in macOS
 * Safari. Refusing the first one is what stops the zoom on an iPhone, where
 * the viewport's `user-scalable=no` has been ignored since iOS 10.
 */
const GESTURES = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/*
 * Not passive, which a touch or wheel listener on the document is by default
 * in Safari and Chrome: a passive listener's `preventDefault` is ignored.
 * Objects rather than `true`, for the reason `audioGesture.ts` gives.
 */
const ACTIVE = { passive: false } as const;

/**
 * Keeps the page from being zoomed by a gesture. Returns the unsubscribe.
 *
 * The page's CSS asks first (`touch-action: none` in `index.html`), and that is
 * enough on Android. This is for the browsers that zoom anyway:
 * - WebKit's pinch events, refused outright;
 * - a move of two fingers or more, which is a pinch wherever `touch-action` was
 *   not honoured. One finger is left alone: that is the touch sticks, and the
 *   game's own drags;
 * - a wheel turned with Ctrl held, which is how Chromium and Firefox deliver a
 *   trackpad's pinch, and Ctrl + wheel itself. `Input` refuses it over the
 *   canvas already; this covers the Play screen too.
 *
 * Nothing on `touchstart` or `touchend`: refusing those would cancel the click
 * a tap makes, and the Play button is a tap.
 */
export function blockPageZoom(target: EventTarget): () => void {
  const refuse = (event: Event): void => event.preventDefault();
  const onTouchMove = (event: Event): void => {
    if (((event as TouchEvent).touches?.length ?? 0) > 1) event.preventDefault();
  };
  const onWheel = (event: Event): void => {
    if ((event as WheelEvent).ctrlKey) event.preventDefault();
  };

  for (const type of GESTURES) target.addEventListener(type, refuse, ACTIVE);
  target.addEventListener('touchmove', onTouchMove, ACTIVE);
  target.addEventListener('wheel', onWheel, ACTIVE);

  return () => {
    for (const type of GESTURES) target.removeEventListener(type, refuse);
    target.removeEventListener('touchmove', onTouchMove);
    target.removeEventListener('wheel', onWheel);
  };
}
