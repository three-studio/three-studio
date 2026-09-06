import type { Command } from './command';
import { EDIT_COMMANDS } from './editCommands';
import { SCENE_FILE_COMMANDS } from './sceneFileCommands';

export { contextFor, currentContext } from './command';
export type { Command, EditorContext } from './command';

/*
 * Every gesture the editor offers, in one table, and the ids come from it.
 *
 * `CommandId` used to be a union of seven strings written by hand beside a table
 * of seven entries — the same list twice, and a list is what this refactor is
 * removing everywhere else. It is now `keyof typeof COMMANDS`: the key a command
 * is filed under *is* its id, written once, and a gesture cannot be declared
 * under one name and looked up under another.
 *
 * **The families live in their own modules, and the earlier objection to that no
 * longer holds.** This file used to say that a registry filled by an import has
 * one silent failure mode — "a module nobody imports registers nothing, and the
 * command simply goes missing" — and that was right about a registry filled by
 * *side effect*, which is what it was. A table composed by value has no such
 * mode: a family that is not spread below is absent from `CommandId`, and every
 * caller naming one of its ids stops compiling. That is stricter than the throw
 * `core`'s component registry falls back on, and `core` only falls back to it
 * because `COMPONENT_TYPES` is a canonical union it can check against. Commands
 * have no such union — which is precisely why theirs has to come from the table.
 *
 * **What is not here**, and deliberately: opening a panel and changing the
 * layout. Neither is a gesture on the document and neither has a `can()` to
 * state.
 */
export const COMMANDS = {
  ...EDIT_COMMANDS,
  ...SCENE_FILE_COMMANDS,
};

export type CommandId = keyof typeof COMMANDS;

/**
 * The command filed under this id.
 *
 * Total, where it used to return `Command | undefined` and leave five callers
 * writing `command?.can(ctx)` against a case the type system had already ruled
 * out: the argument is a `CommandId`, and a `CommandId` is a key of the table by
 * construction.
 */
export function commandById(id: CommandId): Command {
  return COMMANDS[id];
}
