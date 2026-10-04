import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildProjectFromCloudParts } from '../src/cloud/projectParts';
import type { CloudProjectParts } from '../src/cloud/types';
import fixture from '../supabase/tests/fixtures/legacy-export-v1.json';

describe('11a legacy export v1 fixture for the 11b adapter', () => {
  it('preserves domain data usable by the existing Project mapper', () => {
    const parts: CloudProjectParts = {
      id: 'synthetic-fixed-target',
      createdAt: fixture.project.created_at,
      updatedAt: fixture.project.updated_at,
      project: {
        title: fixture.project.title, mode: 'stage',
        schemaVersion: fixture.project.schema_version,
        legacyProjectId: fixture.project.legacy_project_id,
      },
      resources: Object.fromEntries(fixture.resources.map(r => [r.resource_key, {
        resourceKey: r.resource_key, data: r.data, version: r.version, schemaVersion: r.schema_version,
      }])) as CloudProjectParts['resources'],
      scenes: fixture.scenes.map(s => ({
        sceneId: s.scene_id, data: s.data, version: s.version, schemaVersion: s.schema_version,
      })),
    };
    const project = buildProjectFromCloudParts(parts);
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
