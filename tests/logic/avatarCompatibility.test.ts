import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

// Run the actual registry with a bundled-image resolver, as Metro does, without
// asking Node/Jest to parse JPEG bytes as JavaScript.
const registryPath = path.resolve(__dirname, '../../src/data/avatars.ts');
const compiled = ts.transpileModule(fs.readFileSync(registryPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const registry: Record<string, any> = {};
vm.runInNewContext(compiled, {
  exports: registry,
  require: (asset: string) => path.resolve(path.dirname(registryPath), asset),
});

describe('illustrated avatar compatibility', () => {
  it('resolves every persisted legacy id to an existing local image', () => {
    for (let i = 1; i <= 24; i++) {
      const avatar = registry.getAvatarById(`a${String(i).padStart(2, '0')}`);
      expect(avatar).toBeDefined();
      expect(fs.existsSync(avatar.source)).toBe(true);
    }
  });

  it('offers all 36 approved images once with unique selectable ids', () => {
    expect(registry.AVATARS).toHaveLength(36);
    expect(new Set(registry.AVATARS.map((a: any) => a.id)).size).toBe(36);
    expect(new Set(registry.AVATARS.map((a: any) => a.source)).size).toBe(36);
  });

  it('maps legacy aliases to a selectable choice so the picker can highlight it', () => {
    for (const id of ['a10', 'a12', 'a14', 'a16', 'a18', 'a20']) {
      const resolved = registry.getAvatarById(id);
      expect(registry.AVATARS.some((a: any) => a.id === resolved.id)).toBe(true);
    }
  });

  it('keeps missing or unrecognized choices on a valid fallback', () => {
    for (const id of [undefined, null, '', 'unknown', '__proto__']) {
      expect(registry.getAvatarById(id)).toBeUndefined();
      expect(fs.existsSync(registry.getAvatarSource(id).source)).toBe(true);
    }
  });
});
