import { useEffect } from 'react';
import { isMac } from '../platform';
import { useOverlayStore } from '../state/overlayStore';
import { useWindowUnsaved } from '../state/unsaved';
import { Floating } from '../ui/Floating';
import { StudioWordmark } from './StudioWordmark';
import { windowTitle } from './windowTitle';

/**
 * The bar's height: the traffic lights' own, as the system reports it.
 *
 * The main process turns the Window Controls Overlay on (`windowChrome`), and on
 * macOS `titlebar-area-height` is then the height of the box the lights are
 * centred in. A bar of exactly that height has its middle on theirs, whatever
 * size this macOS draws them. The variable is in CSS pixels, so that holds at
 * any page zoom. The fixed 36 px this replaces held neither: at a 0.91 page
 * zoom it came out 33 points tall, with the lights below its middle.
 *
 * The floor is for full screen, where the lights go away and the reported area
 * is empty: the title stays readable there.
 */
const HEIGHT = 'max(env(titlebar-area-height, 0px), 28px)';

/**
 * Where the title starts: past the lights, at the right edge of their box,
 * which the system puts one margin after the last button. 78 px, the inset this
 * bar used to hard-code, stands in should the variable be missing; the 12 px
 * floor is for full screen, where the box is empty and starts at the edge.
 */
const INSET = 'max(env(titlebar-area-x, 78px), 12px)';

interface TitleBarProps {
  project: string;
  scene: string;
}

/**
 * The window's title on macOS, and the one part of the window that moves it.
 *
 * Only this strip drags. Over a drag region the system takes a press before the
 * page sees it, so a menu cannot hear a press there and close. The menu bar and
 * the toolbar both used to drag the window, and a press on the toolbar left
 * the Window menu open. The menus now sit in a row that does not drag, like
 * everything else below this strip.
 *
 * Windows and Linux keep the frame the system draws, and that frame shows the
 * title already. There this draws nothing, and only names the window.
 */
export function TitleBar({ project, scene }: TitleBarProps) {
  const unsaved = useWindowUnsaved();
  /*
   * A press on this strip is the system's, so an open menu would not hear it.
   * While one is open, a box that does not drag covers the strip: the press
   * reaches the page, and the menu's own outside-press closes it. The window
   * stays where it is, as under a native title bar with a menu open.
   *
   * A box appearing, rather than this strip giving up its `app-drag`: Chromium
   * recomputes the drag region after a layout, and a class changing is not one.
   * `ui/Floating` tells that part.
   */
  const popoverOpen = useOverlayStore((s) => s.stack.some((overlay) => overlay.kind === 'popover'));

  useEffect(() => {
    document.title = windowTitle(project, scene, unsaved);
  }, [project, scene, unsaved]);

  if (!isMac) return null;

  return (
    <>
      <div
        // Not `data-selectable`: text that can be selected cannot also drag.
        className="app-drag flex shrink-0 items-center gap-1.5 bg-surface-0 pr-3 text-2xs text-ink-dim"
        style={{ height: HEIGHT, paddingLeft: INSET }}
      >
        <span className="min-w-0 truncate">{project}</span>
        <span>—</span>
        <span className="min-w-0 truncate">{scene}</span>
        {unsaved && <span className="-ml-0.5 text-warn">•</span>}
        <span>—</span>
        <StudioWordmark className="h-3 w-auto shrink-0" />
      </div>
      {popoverOpen && (
        <Floating layer="menu" aria-hidden className="inset-x-0 top-0" style={{ height: HEIGHT }} />
      )}
    </>
  );
}
