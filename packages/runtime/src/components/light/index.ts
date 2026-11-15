import { defineSystem } from '../../systems/ComponentSystem';
import { LightSystem } from './LightSystem';

export const lightSystem = defineSystem('light', () => new LightSystem());
