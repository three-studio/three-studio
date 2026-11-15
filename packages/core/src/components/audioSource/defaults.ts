import type { AssetId } from '../../ids';
import { createEntity, type EntityTemplate } from '../../scene/entity';
import { audioSourceType } from './index';

/**
 * An entity whose whole job is to make a noise somewhere.
 *
 * Named after the clip when there is one, because the alternative — six entities
 * called "Audio Source" in the hierarchy — is what a designer has to rename by
 * hand every single time. The same reason a dropped model is named after its
 * file.
 */
export function createAudioSourceEntity(assetId: AssetId | null = null, name = 'Audio Source'): EntityTemplate {
  return createEntity(name, [{ ...audioSourceType.create(), assetId }]);
}
