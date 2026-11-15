import { extendPane } from '../../inspector/fields';

/**
 * A rigid body's pane is derived from its fields; what it adds is that its rows
 * tune the running game during Play, where every other row is locked.
 */
export const pane = extendPane('rigidbody', { live: true });
