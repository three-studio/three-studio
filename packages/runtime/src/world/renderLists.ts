/**
 * Lets go of every render list `renderer` keeps, which it builds again at its
 * next draw. A world calls it when a scene leaves.
 *
 * three 0.185 never drops a bind group from the set a texture keeps of the
 * bind groups that sample it, unless that texture is disposed — and the
 * `DFG_LUT` every PBR material samples never is. Through those bind groups'
 * nodes it keeps the shadow camera of every light ever drawn, and through each
 * camera the render list keyed by it and the scene: every object that list
 * last drew, with its geometry, material and node graph. A world used to die
 * with its scene, and its `Scene` took those lists with it; a game's one world
 * keeps its `Scene` across every switch, and S6 grew 0.9 MB a switch — 22 MB
 * over thirty — until the lists were let go here.
 *
 * Private to three, so read rather than typed: a renderer not initialised yet
 * has no lists, and a three that renames the field leaks again rather than
 * throwing — which S6's `switch.heapBytes` says.
 */
export function forgetRenderLists(renderer: object | null | undefined): void {
  const lists: unknown = renderer ? Reflect.get(renderer, '_renderLists') : null;
  if (typeof lists !== 'object' || lists === null) return;
  const dispose: unknown = Reflect.get(lists, 'dispose');
  if (typeof dispose === 'function') Reflect.apply(dispose, lists, []);
}
