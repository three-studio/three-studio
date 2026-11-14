import { describe, expect, it } from 'vitest';
import { MeshSystem } from '../src/components/mesh/MeshSystem';
import { activateRuntime, createRuntimeRegistries } from '../src/registries';
import { defineSystem } from '../src/systems/ComponentSystem';

/*
 * Two definitions under one id used to be a silent replacement: the second
 * import to run won, and which one that was depended on the order a bundler
 * evaluated modules in. A registry refuses the second, so two modules claiming
 * one type fail at start-up, by name.
 */
describe('built-in registrations', () => {
  it('refuses to replace a registered behaviour', () => {
    const registries = createRuntimeRegistries();
    activateRuntime(registries);
    const script = registries.behaviours.get('script');
    if (!script) throw new Error('script behaviour is not registered');

    expect(() => registries.behaviours.register({ id: 'script', create: () => null })).toThrow(
      /already registered/,
    );
    expect(registries.behaviours.get('script')).toBe(script);
  });

  it('refuses to replace a registered component system', () => {
    const registries = createRuntimeRegistries();
    activateRuntime(registries);
    const mesh = registries.systems.get('mesh');
    expect(mesh?.create()).toBeInstanceOf(MeshSystem);

    expect(() => registries.systems.register(defineSystem('mesh', () => new MeshSystem()))).toThrow(
      /already registered/,
    );
    expect(registries.systems.get('mesh')).toBe(mesh);
  });

  it('leaves both registries empty once the activation is disposed', () => {
    const registries = createRuntimeRegistries();
    activateRuntime(registries).dispose();

    expect(registries.systems.values()).toEqual([]);
    expect(registries.behaviours.values()).toEqual([]);
  });
});
