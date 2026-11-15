import { defineComponent } from '../registry';
import { playerControllerSchema } from './schema';

/** A character the player drives: see `playerControllerSchema`. */
export const playerControllerType = defineComponent({
  id: 'playerController',
  label: 'Player Controller',
  version: 1,
  schema: playerControllerSchema,
  runtime: true,
  addable: true,
});
