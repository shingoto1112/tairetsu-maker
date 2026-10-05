import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateSnapshot, snapshotProject } from '../src/legacyImport/validation';
import fixture from '../supabase/tests/fixtures/legacy-export-v1.json';

describe('11a legacy export v1 fixture for the 11b adapter', () => {
  it('preserves domain data after proving export completeness', () => {
    const project = snapshotProject(validateSnapshot(fixture, fixture.project.id), 'synthetic-fixed-target');
    expect(project.id).toBe('synthetic-fixed-target');
    expect(project.title).toBe(fixture.project.title);
    expect(project.stage.widthMeters).toBe(10);
    expect(project.frames[0].notes).toBe('Synthetic notes');
    expect(project.audio).toBeNull();
  });

  it('contains the fixed minimal envelope and no operational/account metadata', () => {
    expect(fixture.contractVersion).toBe(1);
    expect(Object.keys(fixture).sort()).toEqual(['contractVersion','project','resources','scenes']);
    expect(fixture.resources.map(r => r.resource_key)).toEqual(['audio','members','objects','sceneOrder','settings']);
    const text = readFileSync('supabase/tests/fixtures/legacy-export-v1.json','utf8');
    expect(text).not.toMatch(/lock_token|token_hash|invited_email|updated_by|created_by|actor_id|audit_logs|@/);
    // Fixture does not encode cutover time, JWT, digest or a moving export time:
    // 11b hashes stable content, and stores ledger/environment/account separately.
    expect(Object.keys(fixture.resources[0]).sort()).toEqual(['data','resource_key','schema_version','version']);
    expect(Object.keys(fixture.scenes[0]).sort()).toEqual(['data','scene_id','schema_version','version']);
  });
});
