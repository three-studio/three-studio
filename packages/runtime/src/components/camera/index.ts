import { defineSystem } from '../../systems/ComponentSystem';
import { CameraSystem } from './CameraSystem';

export const cameraSystem = defineSystem('camera', () => new CameraSystem());
