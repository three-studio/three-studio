import { assertDefined } from '@three-studio/core';
import type { RuntimeRegistries } from '@three-studio/runtime';
import { createContext, useContext } from 'react';

/**
 * The window's registries, as its composition root made them: the one object
 * it activated, so the value never changes and nothing re-renders for it.
 *
 * In a file of its own rather than beside `Root`, which then still exports
 * components only and stays a boundary Fast Refresh can update.
 */
export const RegistriesContext = createContext<RuntimeRegistries | null>(null);

/** The window's registries. Throws outside `Root`, which provides them to both windows. */
export function useRegistries(): RuntimeRegistries {
  return assertDefined(useContext(RegistriesContext), 'the registries Root provides');
}
