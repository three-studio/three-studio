import { defineSystem } from '../../systems/ComponentSystem';
import { WaterSystem } from './WaterSystem';

export const waterSystem = defineSystem('water', () => new WaterSystem());
