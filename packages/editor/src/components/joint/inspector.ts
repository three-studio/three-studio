import { extendPane } from '../../inspector/fields';

/**
 * A joint's pane is derived from its fields — its kind's rows under Type —
 * and what it adds is that its rows tune the running game during Play.
 */
export const pane = extendPane('joint', { live: true });
