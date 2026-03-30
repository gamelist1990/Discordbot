import { CoreFeatureModule } from '../registry.js';
import { DebateFeature } from './DebateFeature.js';

export function createDebateFeature(): CoreFeatureModule {
    return new DebateFeature();
}
