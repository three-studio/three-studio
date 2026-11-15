import { defineSystem } from '../../systems/ComponentSystem';
import { MeshSystem } from './MeshSystem';

export const meshSystem = defineSystem('mesh', () => new MeshSystem());
