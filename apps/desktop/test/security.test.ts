import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/main/security';

/** The sources a policy allows for one of its directives. */
function sourcesOf(policy: string, directive: string): string[] {
  const entry = policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive);
  return entry?.slice(1) ?? [];
}

describe('the production content security policy', () => {
  it('lets WebAssembly compile, and nothing else that evaluates code', () => {
    // Rapier and meshopt's decoder are WebAssembly. Refused, a packaged build
    // started no game and loaded no compressed model, while development, whose
    // policy allows `'unsafe-eval'` for Vite, showed nothing wrong.
    const scripts = sourcesOf(contentSecurityPolicy(false), 'script-src');

    expect(scripts).toContain("'wasm-unsafe-eval'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });
});
