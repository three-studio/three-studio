import { registerSystem } from '../../systems/ComponentSystem';
import { WaterSystem } from './WaterSystem';

registerSystem('water', () => new WaterSystem());
