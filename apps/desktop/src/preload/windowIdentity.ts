import type { WindowRole } from '@three-studio/core';

/*
 * What a window is, worked out before the first render.
 *
 * The preload has to answer this without asking the main process: a round trip
 * would paint the launcher shell for a frame inside the editor window, and the
 * other way round. So it reads what it was handed — argv and the URL — and the
 * reading is the whole of the logic in that file.
 *
 * Here rather than in `preload/index.ts` because that file imports `electron`
 * and reads two globals, so nothing could run these rules without a window to
 * host them. They are two string operations and a default.
 */

/**
 * What a window may be. Total, so a role added to the union is refused here
 * until it is named.
 *
 * Asked with `Object.hasOwn` rather than `in`, and the test for that is not
 * theatre: `in` walks the prototype chain, so `--studio-role=toString` answered
 * yes and the window came up as an editor.
 */
const WINDOW_ROLES: Record<WindowRole, true> = { launcher: true, editor: true };

/**
 * A value the main process put in `additionalArguments`.
 *
 * **Only the first `=` separates**, because a value may contain one — a project
 * path can. The `=` in the prefix is also what keeps `--studio-projector=x`
 * from answering a question about `studio-project`.
 */
function argValue(argv: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  const found = argv.find((argument) => argument.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

/**
 * A value the main process put in the window's URL.
 *
 * The scene comes this way rather than through argv because argv is replayed
 * verbatim by `webContents.reload()`, and the scene is the one thing about a
 * window that changes. Role and project stay in argv: they are fixed for the
 * life of the window. See ADR-0008.
 */
function queryValue(search: string, name: string): string | null {
  return new URLSearchParams(search).get(name);
}

export interface WindowIdentity {
  windowRole: WindowRole;
  projectPath: string | null;
  sceneId: string | null;
}

/**
 * Which window this is, which project it holds, and which scene it opens on.
 *
 * **Anything that is not a role is the launcher**, which is the recoverable
 * half of getting this wrong: a window with no project showing the picker is a
 * click away from being useful, and one coming up in the editor with nothing to
 * edit is not. It used to be a cast, so only a *missing* role fell back — and
 * `Root.tsx` asks `=== 'launcher'`, which means every other string, typo
 * included, rendered the editor.
 */
export function windowIdentity(argv: readonly string[], search: string): WindowIdentity {
  const role = argValue(argv, 'studio-role');
  return {
    windowRole: role !== null && Object.hasOwn(WINDOW_ROLES, role) ? (role as WindowRole) : 'launcher',
    projectPath: argValue(argv, 'studio-project'),
    sceneId: queryValue(search, 'scene'),
  };
}
