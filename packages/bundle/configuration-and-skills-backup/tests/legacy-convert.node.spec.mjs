/**
 * convert.test.mjs - synthetic, fully offline tests for the phase-2 converter.
 *
 * Every fixture is a literal string written in this file. Nothing here reads a
 * real configuration, a credentials store, or any path outside a throwaway
 * temporary directory, and nothing here writes a file: convert() is pure and
 * the tests only inspect what it returns.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { convert, STATUS } from '../tools/convert-legacy-config.mjs';

const OCR_SECRET = 'sk-ocr-9f8e7d6c5b4a-DO-NOT-LEAK';
const CONFLICT_SECRET = 'sk-conflict-0000-DO-NOT-LEAK';

/** Join YAML lines without a trailing-newline surprise. */
function yaml(...lines) {
  return `${lines.join('\n')}\n`;
}

function entryFor(result, id) {
  return result.patch.find((entry) => entry.id === id) ?? null;
}

function configFor(result, id) {
  return entryFor(result, id)?.config ?? null;
}

/**
 * The config of an emitted entry, or `{}` when no row was emitted. An id whose
 * every field was held back produces no row at all, so callers that only care
 * whether a field was applied read the config through this.
 */
function configOrEmpty(result, id) {
  return configFor(result, id) ?? {};
}

function reportFor(result, id, field) {
  return result.report.filter(
    (entry) => entry.id === id && (field === undefined || entry.field === field),
  );
}

function reasonsFor(result, id) {
  return result.report.filter((entry) => entry.id === id).map((entry) => entry.reason);
}

function statusFor(result, id, field) {
  const match = result.report.find(
    (entry) => entry.id === id && entry.field === field,
  );
  return match ? match.status : null;
}

function pendingFor(result, id, field) {
  return result.pending.find(
    (item) => item.id === id && item.field === field,
  );
}

const THEME_PATCH = yaml(
  '- id: ui-theme',
  '  name: ui-theme',
  '  config:',
  '    preference: dark',
  '    fontSize: 15',
);

const CHAT_PATCH = yaml(
  '- id: ui-chat',
  '  name: ui-chat',
  '  config:',
  '    transcriptView: standard',
  '    linkOpening: sidebar',
  '    performanceUsage: detailed',
);

const OFFICE_PATCH = yaml(
  '- id: file-recognizer-office',
  '  name: file-recognizer-office',
  '  config:',
  '    maxInputBytes: 16777216',
  '    maxUncompressedBytes: 134217728',
  '    maxZipEntries: 2000',
  '    maxExtractedChars: 150000',
  '    maxPdfPagePixels: 3000000',
  '    maxPdfRenderScale: 2.5',
);

const CREDENTIALS = yaml(
  'version: 1',
  'refs:',
  '  OFFICE_OCR_KEY: ' + OCR_SECRET,
  '  OFFICE_AUDIO_KEY: audio-secret-value',
  '  OFFICE_VIDEO_KEY: video-secret-value',
  'records:',
  '  provider/acme:',
  '    kind: apiKey',
  '    label: Acme',
);

describe('shape and purity', () => {
  it('returns the four documented keys', () => {
    const result = convert({
      patchText: THEME_PATCH,
      legacyText: yaml('ui-chat:', '  transcriptView: compact'),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(Object.keys(result).sort(), [
      'credentials',
      'patch',
      'pending',
      'report',
    ]);
    assert.ok(Array.isArray(result.patch));
    assert.ok(Array.isArray(result.pending));
    assert.ok(Array.isArray(result.report));
  });

  it('tolerates missing documents and still returns a version-1 credential set', () => {
    const result = convert({});
    assert.deepEqual(result.patch, []);
    assert.equal(result.credentials.version, 1);
    assert.deepEqual(result.credentials.refs, {});
  });

  it('rejects non-string arguments', () => {
    assert.throws(() => convert({ patchText: 42 }), TypeError);
    assert.throws(() => convert(null), TypeError);
  });

  it('keeps report entries to id, field, status and reason', () => {
    const result = convert({
      patchText: `${OFFICE_PATCH}${
        yaml(
          '- id: llm-pi-ai',
          '  name: llm-pi-ai',
          '  config:',
          '    providers:',
          '      gw:',
          '        endpoint: https://gw.example/v1',
        )}`,
      legacyText: yaml('ui-theme:', '  preference: light'),
      credentialsText: CREDENTIALS,
    });
    assert.ok(result.report.length > 0);
    for (const entry of result.report) {
      assert.deepEqual(Object.keys(entry).sort(), ['field', 'id', 'reason', 'status']);
      assert.equal(typeof entry.id, 'string');
      assert.equal(typeof entry.status, 'string');
      assert.equal(typeof entry.reason, 'string');
    }
  });
});

describe('source priority', () => {
  it('takes the whole patch config for a shared id', () => {
    const result = convert({
      patchText: THEME_PATCH,
      legacyText: yaml('ui-theme:', '  preference: light', '  fontSize: 20'),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'ui-theme'), { preference: 'dark', fontSize: 15 });
  });

  it('fills an id the patch does not have from legacy', () => {
    const result = convert({
      patchText: THEME_PATCH,
      legacyText: yaml(
        'ui-chat:',
        '  transcriptView: detailed',
        '  performanceUsage: compact',
        '  linkOpening: new-tab',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'ui-chat'), {
      transcriptView: 'detailed',
      performanceUsage: 'compact',
      linkOpening: 'new-tab',
    });
    assert.ok(
      reasonsFor(result, 'ui-chat').includes('value-migrated-from-legacy'),
      'the report must record that the value came from legacy',
    );
  });

  it('records the source of every migrated value through its reason slug', () => {
    const result = convert({
      patchText: THEME_PATCH,
      legacyText: yaml('ui-chat:', '  transcriptView: compact'),
      credentialsText: CREDENTIALS,
    });
    const themeReasons = reasonsFor(result, 'ui-theme');
    assert.ok(themeReasons.every((reason) => reason.endsWith('from-patch')));
    assert.ok(reasonsFor(result, 'ui-chat').every((reason) => reason.endsWith('from-legacy')));
  });

  it('never merges a legacy value into a patch field of the same name', () => {
    const result = convert({
      patchText: yaml('- id: ui-chat', '  name: ui-chat', '  config:', '    transcriptView: standard'),
      legacyText: yaml('ui-chat:', '  transcriptView: detailed', '  linkOpening: new-tab'),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'ui-chat'), { transcriptView: 'standard' });
  });
});

describe('permission and agent-preset selection migration', () => {
  const sourceDefaults = yaml(
    '- id: permission',
    '  name: permission',
    '  config:',
    '    presets:',
    '      workspace-write:',
    '        sandbox: workspace-write',
    '        approval: ask',
    '        name: Old label',
    '      danger-full-access:',
    '        sandbox: danger-full-access',
    '        approval: never',
    '    defaultPreset: workspace-write',
    '- id: agent-presets',
    '  name: agent-presets',
    '  config:',
    '    default: standard',
    '    modeSelectionEnabled: true',
  );
  const sourceSelections = yaml(
    'permission:',
    '  defaultPreset: workspace-write',
    'agent-presets:',
    '  default: standard',
    '  modeSelectionEnabled: true',
  );
  const targetPermissionPresets = {
    'workspace-write': {
      sandbox: 'workspace-write',
      approval: 'ask',
      name: 'Current label',
      description: 'Current policy description',
    },
    'danger-full-access': {
      sandbox: 'danger-full-access',
      approval: 'never',
      name: 'Full access',
    },
  };

  it('keeps both selections pending by default without target semantics', () => {
    const result = convert({ patchText: sourceDefaults, legacyText: sourceSelections });
    assert.equal(configFor(result, 'permission'), null);
    assert.equal(configFor(result, 'agent-preset-registry'), null);
    assert.equal(statusFor(result, 'permission', '$'), null);
    assert.equal(statusFor(result, 'agent-presets', '$'), null);
    assert.deepEqual(pendingFor(result, 'permission', '$.presets').value, {
      'workspace-write': {
        sandbox: 'workspace-write',
        approval: 'ask',
        name: 'Old label',
      },
      'danger-full-access': {
        sandbox: 'danger-full-access',
        approval: 'never',
      },
    });
    assert.equal(pendingFor(result, 'permission', '$.defaultPreset').value, 'workspace-write');
    assert.equal(pendingFor(result, 'agent-presets', '$.default').value, 'standard');
    assert.equal(pendingFor(result, 'agent-presets', '$.modeSelectionEnabled').value, true);
    assert.equal(
      reportFor(result, 'permission', '$.presets')[0].reason,
      'field-outside-supported-conversion-set',
    );
    assert.equal(statusFor(result, 'permission', '$.defaultPreset'), STATUS.PENDING);
    assert.equal(statusFor(result, 'agent-presets', '$.default'), STATUS.PENDING);
  });

  it('migrates a permission default only when its old and current enforcement policy matches', () => {
    const result = convert({
      patchText: sourceDefaults,
      legacyText: sourceSelections,
      selectionContext: {
        permission: {
          complete: true,
          presets: targetPermissionPresets,
          defaultPreset: 'workspace-write',
        },
      },
    });
    assert.deepEqual(configFor(result, 'permission'), {
      presets: targetPermissionPresets,
      defaultPreset: 'workspace-write',
    });
    assert.deepEqual(
      [entryFor(result, 'permission').id, entryFor(result, 'permission').name],
      ['permission', '@deepseek-ai/dsh-permission-presets'],
    );
    assert.equal(
      configFor(result, 'permission').presets['workspace-write'].description,
      'Current policy description',
      'the output carries current policy definitions, not frozen policy definitions',
    );
    assert.equal(statusFor(result, 'permission', '$.defaultPreset'), STATUS.MIGRATED);
  });

  it('does not treat a matching permission name as matching policy semantics', () => {
    const changedPolicies = {
      ...targetPermissionPresets,
      'workspace-write': {
        ...targetPermissionPresets['workspace-write'],
        sandbox: 'read-only',
      },
    };
    const result = convert({
      patchText: sourceDefaults,
      legacyText: sourceSelections,
      selectionContext: {
        permission: { complete: true, presets: changedPolicies, defaultPreset: 'workspace-write' },
      },
    });
    assert.equal(configFor(result, 'permission'), null);
    assert.equal(pendingFor(result, 'permission', '$.defaultPreset').value, 'workspace-write');
    assert.equal(
      reportFor(result, 'permission', '$.defaultPreset')[0].reason,
      'permission-policy-semantics-differ-not-applied',
    );
  });

  it('does not treat a matching agent preset id as matching composition semantics', () => {
    const result = convert({
      patchText: sourceDefaults,
      legacyText: sourceSelections,
      selectionContext: {
        agentPresets: {
          complete: true,
          default: 'standard',
          roster: { standard: 'current-composition-digest' },
          legacyRoster: { standard: 'old-composition-digest' },
          semanticMatches: { standard: 'standard' },
        },
      },
    });
    assert.equal(configFor(result, 'agent-preset-registry'), null);
    assert.equal(pendingFor(result, 'agent-presets', '$.default').value, 'standard');
    assert.equal(
      reportFor(result, 'agent-presets', '$.default')[0].reason,
      'agent-preset-semantics-differ-not-applied',
    );
  });

  it('migrates a reviewed agent-preset mapping and preserves the current deployment default', () => {
    const result = convert({
      patchText: sourceDefaults,
      legacyText: sourceSelections,
      selectionContext: {
        agentPresets: {
          complete: true,
          default: 'standard',
          roster: {
            standard: 'sha256-current-standard',
            concise: 'sha256-current-concise',
          },
          legacyRoster: { standard: 'sha256-current-concise' },
          semanticMatches: { standard: 'concise' },
        },
      },
    });
    assert.deepEqual(configFor(result, 'agent-preset-registry'), {
      default: 'standard',
      selectedDefault: 'concise',
    });
    assert.deepEqual(
      [entryFor(result, 'agent-preset-registry').id, entryFor(result, 'agent-preset-registry').name],
      ['agent-preset-registry', '@deepseek-ai/dsh-agent-preset-registry'],
    );
    assert.equal(statusFor(result, 'agent-presets', '$.default'), STATUS.MIGRATED);
    assert.equal(statusFor(result, 'agent-presets', '$.modeSelectionEnabled'), STATUS.PENDING);
  });

  it('uses the patch default over a conflicting imported value', () => {
    const patch = yaml(
      '- id: permission',
      '  name: permission',
      '  config:',
      '    presets:',
      '      workspace-write: { sandbox: workspace-write, approval: ask }',
      '      danger-full-access: { sandbox: danger-full-access, approval: never }',
      '    defaultPreset: danger-full-access',
      '- id: agent-presets',
      '  name: agent-presets',
      '  config:',
      '    default: concise',
    );
    const legacy = yaml(
      'permission:',
      '  defaultPreset: workspace-write',
      'agent-presets:',
      '  default: standard',
      '  modeSelectionEnabled: true',
    );
    const result = convert({
      patchText: patch,
      legacyText: legacy,
      selectionContext: {
        permission: {
          complete: true,
          presets: {
            'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
            'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
          },
          defaultPreset: 'workspace-write',
        },
        agentPresets: {
          complete: true,
          default: 'standard',
          roster: { standard: 'std', concise: 'concise' },
          legacyRoster: { standard: 'std', concise: 'concise' },
          semanticMatches: { standard: 'standard', concise: 'concise' },
        },
      },
    });
    assert.equal(configFor(result, 'permission').defaultPreset, 'danger-full-access');
    assert.deepEqual(configFor(result, 'agent-preset-registry'), {
      default: 'standard',
      selectedDefault: 'concise',
    });
    assert.equal(
      reportFor(result, 'permission', '$.defaultPreset')[0].reason,
      'patch-selection-authoritative-legacy-value-conflicts',
    );
    assert.equal(
      reportFor(result, 'agent-presets', '$.default')[0].reason,
      'patch-selection-authoritative-legacy-value-conflicts',
    );
  });

  it('does not backfill a selection field omitted from a patch-present namespace', () => {
    const patch = yaml(
      '- id: permission',
      '  name: permission',
      '  config:',
      '    presets:',
      '      workspace-write: { sandbox: workspace-write, approval: ask }',
      '- id: agent-presets',
      '  name: agent-presets',
      '  config: {}',
    );
    const result = convert({
      patchText: patch,
      legacyText: sourceSelections,
      selectionContext: {
        permission: {
          complete: true,
          presets: { 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' } },
          defaultPreset: 'workspace-write',
        },
        agentPresets: {
          complete: true,
          default: 'standard',
          roster: { standard: 'same' },
          legacyRoster: { standard: 'same' },
          semanticMatches: { standard: 'standard' },
        },
      },
    });
    assert.equal(configFor(result, 'permission'), null);
    assert.equal(configFor(result, 'agent-preset-registry'), null);
    assert.equal(statusFor(result, 'permission', '$.defaultPreset'), STATUS.NOT_RESTORED);
    assert.equal(statusFor(result, 'agent-presets', '$.default'), STATUS.NOT_RESTORED);
  });

  it('does not resurrect choices when patch ids are duplicate or carry unsupported metadata', () => {
    const patch = yaml(
      '- id: permission',
      '  name: permission',
      '  config:',
      '    defaultPreset: workspace-write',
      '- id: permission',
      '  name: permission',
      '  config:',
      '    defaultPreset: danger-full-access',
      '- id: agent-presets',
      '  name: agent-presets',
      '  disabled: false',
      '  config:',
      '    default: standard',
    );
    const result = convert({
      patchText: patch,
      legacyText: sourceSelections,
      selectionContext: {
        permission: {
          complete: true,
          presets: { 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' } },
          defaultPreset: 'workspace-write',
        },
        agentPresets: {
          complete: true,
          default: 'standard',
          roster: { standard: 'same' },
          legacyRoster: { standard: 'same' },
          semanticMatches: { standard: 'standard' },
        },
      },
    });
    assert.equal(configFor(result, 'permission'), null);
    assert.equal(configFor(result, 'agent-preset-registry'), null);
    assert.equal(pendingFor(result, 'permission', '$.defaultPreset').value, 'workspace-write');
    assert.equal(pendingFor(result, 'agent-presets', '$.default').value, 'standard');
    assert.equal(
      reportFor(result, 'permission', '$.defaultPreset')[0].reason,
      'blocked-patch-row-prevents-legacy-selection-resurrection',
    );
    assert.equal(
      reportFor(result, 'agent-presets', '$.default')[0].reason,
      'blocked-patch-row-prevents-legacy-selection-resurrection',
    );
  });

  it('keeps a disabled legacy preset selection pending even when the roster matches', () => {
    const result = convert({
      patchText: sourceDefaults,
      legacyText: yaml('agent-presets:', '  default: standard', '  modeSelectionEnabled: false'),
      selectionContext: {
        agentPresets: {
          complete: true,
          default: 'standard',
          roster: { standard: 'same' },
          legacyRoster: { standard: 'same' },
          semanticMatches: { standard: 'standard' },
        },
      },
    });
    assert.equal(configFor(result, 'agent-preset-registry'), null);
    assert.equal(pendingFor(result, 'agent-presets', '$.default').value, 'standard');
    assert.equal(
      reportFor(result, 'agent-presets', '$.default')[0].reason,
      'legacy-agent-selection-was-disabled-not-applied',
    );
  });

  it('uses the old schema default when modeSelectionEnabled was not saved', () => {
    const result = convert({
      patchText: yaml(
        '- id: agent-presets',
        '  name: agent-presets',
        '  config:',
        '    default: standard',
      ),
      legacyText: yaml('agent-presets:', '  default: standard'),
      selectionContext: {
        agentPresets: {
          complete: true,
          default: 'standard',
          roster: { standard: 'composition-v1' },
          legacyRoster: { standard: 'composition-v1' },
          semanticMatches: { standard: 'standard' },
        },
      },
    });
    assert.deepEqual(configFor(result, 'agent-preset-registry'), {
      default: 'standard',
      selectedDefault: 'standard',
    });
    assert.equal(entryFor(result, 'agent-preset-registry').name, '@deepseek-ai/dsh-agent-preset-registry');
  });
});

describe('legacy fields are not silently resurrected', () => {
  it('never re-adds a field the patch config dropped', () => {
    const result = convert({
      patchText: yaml('- id: ui-chat', '  name: ui-chat', '  config:', '    transcriptView: standard'),
      legacyText: yaml(
        'ui-chat:',
        '  transcriptView: standard',
        '  linkOpening: new-tab',
        '  performanceUsage: detailed',
      ),
      credentialsText: CREDENTIALS,
    });
    const config = configFor(result, 'ui-chat');
    assert.equal(config.transcriptView, 'standard');
    assert.ok(!('linkOpening' in config), 'linkOpening must not come back');
    assert.ok(!('performanceUsage' in config), 'performanceUsage must not come back');
  });

  it('reports the drop instead of dropping it quietly', () => {
    const result = convert({
      patchText: yaml('- id: ui-theme', '  name: ui-theme', '  config:', '    preference: dark'),
      legacyText: yaml('ui-theme:', '  preference: dark', '  accent: neon'),
      credentialsText: CREDENTIALS,
    });
    assert.equal(statusFor(result, 'ui-theme', '$.accent'), STATUS.NOT_RESTORED);
    const finding = reportFor(result, 'ui-theme', '$.accent')[0];
    assert.equal(finding.reason, 'legacy-field-not-restored-patch-config-is-authoritative');
  });

  it('keeps the dropped value in pending for local review only', () => {
    const result = convert({
      patchText: yaml('- id: ui-theme', '  name: ui-theme', '  config:', '    preference: dark'),
      legacyText: yaml('ui-theme:', '  preference: dark', '  accent: neon'),
      credentialsText: CREDENTIALS,
    });
    assert.equal(pendingFor(result, 'ui-theme', '$.accent').value, 'neon');
    assert.ok(!JSON.stringify(result.report).includes('neon'));
  });

  it('does not resurrect a whole legacy id that the patch dropped', () => {
    const result = convert({
      patchText: THEME_PATCH,
      legacyText: yaml('ui-chat:', '  transcriptView: detailed'),
      credentialsText: CREDENTIALS,
    });
    assert.ok(entryFor(result, 'ui-chat') !== null, 'a missing id is filled from legacy');
    const result2 = convert({
      patchText: `${THEME_PATCH}${yaml('- id: ui-chat', '  name: ui-chat')}`,
      legacyText: yaml('ui-chat:', '  transcriptView: detailed', '  linkOpening: new-tab'),
      credentialsText: CREDENTIALS,
    });
    const config = configFor(result2, 'ui-chat');
    assert.equal(config, null, 'a patch entry with nothing to apply emits no row');
    assert.ok(
      reportFor(result2, 'ui-chat', '$.transcriptView').some(
        (entry) => entry.status === STATUS.NOT_RESTORED,
      ),
      'the legacy config of a patch-present id is still not restored',
    );
  });
});

describe('file-recognizer-office endpoints and credential references', () => {
  const officePatch = (group, ref) =>
    yaml(
      '- id: file-recognizer-office',
      '  name: file-recognizer-office',
      '  config:',
      `    ${group}:`,
      '      endpoint: https://service.example/v1',
      '      model: model-one',
      `      apiKeyEnv: ${ref}`,
    );

  it('flattens the ocr block and copies its reference', () => {
    const result = convert({
      patchText: officePatch('ocr', 'OFFICE_OCR_KEY'),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    const config = configOrEmpty(result, 'file-recognizer-office');
    assert.equal(config.ocrEndpoint, 'https://service.example/v1');
    assert.equal(config.ocrModel, 'model-one');
    assert.ok(!('ocr' in config), 'the old nested block must be gone');
    assert.equal(result.credentials.refs.DSH_FILE_OFFICE_OCR_API_KEY, OCR_SECRET);
    assert.equal(result.credentials.refs.OFFICE_OCR_KEY, OCR_SECRET, 'the old ref is kept');
    assert.equal(statusFor(result, 'file-recognizer-office', '$.ocr'), STATUS.MIGRATED);
  });

  it('flattens audio and video with their own references', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    audioTranscription:',
        '      endpoint: https://audio.example/v1',
        '      model: whisper-one',
        '      apiKeyEnv: OFFICE_AUDIO_KEY',
        '    videoUnderstanding:',
        '      endpoint: https://video.example/v1',
        '      model: video-one',
        '      apiKeyEnv: OFFICE_VIDEO_KEY',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    const config = configOrEmpty(result, 'file-recognizer-office');
    assert.equal(config.audioEndpoint, 'https://audio.example/v1');
    assert.equal(config.audioModel, 'whisper-one');
    assert.equal(config.videoEndpoint, 'https://video.example/v1');
    assert.equal(config.videoModel, 'video-one');
    assert.equal(result.credentials.refs.DSH_FILE_OFFICE_AUDIO_API_KEY, 'audio-secret-value');
    assert.equal(result.credentials.refs.DSH_FILE_OFFICE_VIDEO_API_KEY, 'video-secret-value');
  });

  it('does not activate a pair whose reference is missing from the document', () => {
    const result = convert({
      patchText: officePatch('ocr', 'NOT_STORED_KEY'),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    const config = configOrEmpty(result, 'file-recognizer-office');
    assert.ok(!('ocrEndpoint' in config), 'an unresolvable reference must not activate the pair');
    assert.ok(!('ocrModel' in config));
    assert.ok(!('DSH_FILE_OFFICE_OCR_API_KEY' in result.credentials.refs));
    const finding = reportFor(result, 'file-recognizer-office', '$.ocr.apiKeyEnv')[0];
    assert.equal(finding.status, STATUS.PENDING);
    assert.equal(finding.reason, 'credential-ref-missing-endpoint-pair-not-activated');
  });

  it('does not activate a pair with no reference field at all', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    ocr:',
        '      endpoint: https://service.example/v1',
        '      model: model-one',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.ok(!('ocrEndpoint' in configOrEmpty(result, 'file-recognizer-office')));
    assert.equal(
      reportFor(result, 'file-recognizer-office', '$.ocr.apiKeyEnv')[0].reason,
      'credential-ref-field-absent-endpoint-pair-not-activated',
    );
  });

  it('does not complete a half-configured pair with a guess', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    ocr:',
        '      endpoint: https://service.example/v1',
        '      apiKeyEnv: OFFICE_OCR_KEY',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    const config = configOrEmpty(result, 'file-recognizer-office');
    assert.ok(!('ocrEndpoint' in config) && !('ocrModel' in config));
  });
});

describe('credential reference conflicts are never resolved by overwriting', () => {
  const conflictCredentials = yaml(
    'version: 1',
    'refs:',
    '  OFFICE_OCR_KEY: ' + OCR_SECRET,
    '  DSH_FILE_OFFICE_OCR_API_KEY: ' + CONFLICT_SECRET,
  );

  it('reports a conflict and leaves the existing reference alone', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    ocr:',
        '      endpoint: https://service.example/v1',
        '      model: model-one',
        '      apiKeyEnv: OFFICE_OCR_KEY',
      ),
      legacyText: '',
      credentialsText: conflictCredentials,
    });
    assert.equal(
      result.credentials.refs.DSH_FILE_OFFICE_OCR_API_KEY,
      CONFLICT_SECRET,
      'the existing reference must not be overwritten',
    );
    const finding = reportFor(result, 'file-recognizer-office', '$.ocr.apiKeyEnv')[0];
    assert.equal(finding.status, STATUS.CONFLICT);
    assert.equal(finding.reason, 'credential-ref-conflict-not-overwritten-endpoint-pair-not-activated');
  });

  it('does not activate the endpoint pair behind a conflict', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    ocr:',
        '      endpoint: https://service.example/v1',
        '      model: model-one',
        '      apiKeyEnv: OFFICE_OCR_KEY',
      ),
      legacyText: '',
      credentialsText: conflictCredentials,
    });
    const config = configOrEmpty(result, 'file-recognizer-office');
    assert.ok(!('ocrEndpoint' in config), 'a conflicted pair must stay off');
    assert.ok(!('ocrModel' in config));
  });

  it('reuses an identical existing reference instead of reporting a conflict', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    ocr:',
        '      endpoint: https://service.example/v1',
        '      model: model-one',
        '      apiKeyEnv: NEW_OCR_KEY',
      ),
      legacyText: '',
      credentialsText: yaml(
        'version: 1',
        'refs:',
        '  NEW_OCR_KEY: ' + OCR_SECRET,
        '  DSH_FILE_OFFICE_OCR_API_KEY: ' + OCR_SECRET,
      ),
    });
    const config = configOrEmpty(result, 'file-recognizer-office');
    assert.equal(config.ocrEndpoint, 'https://service.example/v1');
    assert.equal(reportFor(result, 'file-recognizer-office', '$.ocr.apiKeyEnv').length, 0);
  });

  it('keeps every reference value out of the report', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    ocr:',
        '      endpoint: https://service.example/v1',
        '      model: model-one',
        '      apiKeyEnv: OFFICE_OCR_KEY',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    const serialised = JSON.stringify(result.report);
    assert.ok(!serialised.includes(OCR_SECRET));
    assert.ok(!serialised.includes('audio-secret-value'));
    assert.ok(!serialised.includes('OFFICE_OCR_KEY'), 'reference names stay out of the report too');
  });

  it('rejects a credentials document that is not version 1', () => {
    const result = convert({
      patchText: THEME_PATCH,
      legacyText: '',
      credentialsText: yaml('version: 2', 'refs:', '  A: b'),
    });
    assert.equal(statusFor(result, 'credentials', '$'), STATUS.REJECTED);
    assert.equal(result.credentials.refs.DSH_FILE_OFFICE_OCR_API_KEY, undefined);
  });
});

describe('numeric resource limits', () => {
  it('migrates the same-named limits unchanged', () => {
    const result = convert({
      patchText: OFFICE_PATCH,
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'file-recognizer-office'), {
      maxInputBytes: 16777216,
      maxUncompressedBytes: 134217728,
      maxZipEntries: 2000,
      maxExtractedChars: 150000,
      maxPdfPagePixels: 3000000,
      maxPdfRenderScale: 2.5,
    });
  });

  it('never maps the old ocr page limit onto maxPdfPages', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    maxPdfOcrPages: 5',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    const config = configOrEmpty(result, 'file-recognizer-office');
    assert.ok(!('maxPdfPages' in config), 'the two limits count different things');
    assert.ok(!('maxPdfOcrPages' in config));
    const finding = reportFor(result, 'file-recognizer-office', '$.maxPdfOcrPages')[0];
    assert.equal(finding.status, STATUS.PENDING);
    assert.equal(finding.reason, 'legacy-limit-not-auto-mapped-semantics-differ');
    assert.equal(pendingFor(result, 'file-recognizer-office', '$.maxPdfOcrPages').value, 5);
  });

  it('rejects an out-of-range limit instead of clamping it', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    maxZipEntries: 999999',
        '    maxPdfRenderScale: 9',
        '    maxInputBytes: 16.5',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.equal(configFor(result, 'file-recognizer-office'), null);
    for (const field of ['$.maxZipEntries', '$.maxPdfRenderScale', '$.maxInputBytes']) {
      assert.equal(statusFor(result, 'file-recognizer-office', field), STATUS.REJECTED);
    }
  });

  it('accepts the range boundaries themselves', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    maxZipEntries: 1',
        '    maxPdfRenderScale: 4',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'file-recognizer-office'), {
      maxZipEntries: 1,
      maxPdfRenderScale: 4,
    });
  });

  it('holds back a limit outside the migrated set under its own reason', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    maxPdfPages: 30',
        '    maxSomethingElse: 4',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.equal(configFor(result, 'file-recognizer-office'), null);
    for (const field of ['$.maxPdfPages', '$.maxSomethingElse']) {
      assert.equal(statusFor(result, 'file-recognizer-office', field), STATUS.PENDING);
      assert.equal(
        reportFor(result, 'file-recognizer-office', field)[0].reason,
        'limit-not-in-migrated-set-awaits-official-review',
      );
    }
  });
});

describe('ui-chat transcript and usage modes', () => {
  const chatWith = (config) =>
    convert({
      patchText: yaml('- id: ui-chat', '  name: ui-chat', '  config:', ...config),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });

  it('reads the saved normal mode as standard', () => {
    const result = chatWith(['    transcriptView: normal']);
    assert.equal(configFor(result, 'ui-chat').transcriptView, 'standard');
    const finding = reportFor(result, 'ui-chat', '$.transcriptView')[0];
    assert.equal(finding.reason, 'legacy-value-remapped-from-patch');
  });

  it('reads the saved expanded mode as detailed', () => {
    assert.equal(chatWith(['    transcriptView: expanded']).patch[0].config.transcriptView, 'detailed');
  });

  it('keeps compact, standard, detailed and verbose as they are', () => {
    for (const mode of ['compact', 'standard', 'detailed', 'verbose']) {
      const result = chatWith([`    transcriptView: ${mode}`]);
      assert.equal(configFor(result, 'ui-chat').transcriptView, mode);
    }
  });

  it('accepts only the two performanceUsage levels', () => {
    for (const mode of ['compact', 'detailed']) {
      const result = chatWith([`    performanceUsage: ${mode}`]);
      assert.equal(configFor(result, 'ui-chat').performanceUsage, mode);
    }
    const bad = chatWith(['    performanceUsage: verbose']);
    assert.ok(!('performanceUsage' in configOrEmpty(bad, 'ui-chat')));
    assert.equal(statusFor(bad, 'ui-chat', '$.performanceUsage'), STATUS.REJECTED);
  });

  it('accepts only sidebar and new-tab for linkOpening', () => {
    for (const mode of ['sidebar', 'new-tab']) {
      const result = chatWith([`    linkOpening: ${mode}`]);
      assert.equal(configFor(result, 'ui-chat').linkOpening, mode);
    }
    const bad = chatWith(['    linkOpening: popup']);
    assert.ok(!('linkOpening' in configOrEmpty(bad, 'ui-chat')));
    assert.equal(statusFor(bad, 'ui-chat', '$.linkOpening'), STATUS.REJECTED);
  });

  it('accepts the three theme preferences and the font size range', () => {
    for (const preference of ['light', 'dark', 'system']) {
      const result = convert({
        patchText: yaml('- id: ui-theme', '  name: ui-theme', '  config:', `    preference: ${preference}`),
        legacyText: '',
        credentialsText: CREDENTIALS,
      });
      assert.equal(configFor(result, 'ui-theme').preference, preference);
    }
    for (const size of [12, 17]) {
      const result = convert({
        patchText: yaml('- id: ui-theme', '  name: ui-theme', '  config:', `    fontSize: ${size}`),
        legacyText: '',
        credentialsText: CREDENTIALS,
      });
      assert.equal(configFor(result, 'ui-theme').fontSize, size);
    }
    for (const size of [11, 18]) {
      const result = convert({
        patchText: yaml('- id: ui-theme', '  name: ui-theme', '  config:', `    fontSize: ${size}`),
        legacyText: '',
        credentialsText: CREDENTIALS,
      });
      assert.ok(!('fontSize' in configOrEmpty(result, 'ui-theme')));
      assert.equal(statusFor(result, 'ui-theme', '$.fontSize'), STATUS.REJECTED);
    }
  });
});

describe('settings namespaces with current schemas', () => {
  it('migrates only the shared developer-tools boolean', () => {
    const result = convert({
      legacyText: yaml('ui-settings:', '  enabled: true', '  unrelated: keep'),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'ui-settings'), { enabled: true });
    assert.equal(statusFor(result, 'ui-settings', '$.unrelated'), STATUS.PENDING);

    const invalid = convert({
      legacyText: yaml('ui-settings:', '  enabled: yes'),
      credentialsText: CREDENTIALS,
    });
    assert.equal(statusFor(invalid, 'ui-settings', '$.enabled'), STATUS.REJECTED);
    assert.equal(configFor(invalid, 'ui-settings'), null);
  });

  it('migrates only the seven validated account onboarding fields', () => {
    const result = convert({
      legacyText: yaml(
        'ui-settings-account:',
        '  version: 1',
        '  step: process',
        '  purpose: development',
        '  process: detailed',
        '  completion: completed',
        '  usage: compact',
        '  developerTools: false',
        '  contactFormUrl: https://example.invalid',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'ui-settings-account'), {
      version: 1,
      step: 'process',
      purpose: 'development',
      process: 'detailed',
      completion: 'completed',
      usage: 'compact',
      developerTools: false,
    });
    assert.equal(statusFor(result, 'ui-settings-account', '$.contactFormUrl'), STATUS.PENDING);

    const nullable = convert({
      legacyText: yaml(
        'ui-settings-account:',
        '  version: 1',
        '  step: welcome',
        '  purpose: null',
        '  process: null',
        '  completion: null',
        '  usage: detailed',
        '  developerTools: true',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(nullable, 'ui-settings-account'), {
      version: 1,
      step: 'welcome',
      purpose: null,
      process: null,
      completion: null,
      usage: 'detailed',
      developerTools: true,
    });
  });

  it('rejects unsupported onboarding values and keeps patch rows authoritative', () => {
    const invalid = convert({
      legacyText: yaml(
        'ui-settings-account:',
        '  version: 2',
        '  step: unknown',
        '  purpose: both',
        '  process: compact',
        '  completion: skipped',
        '  usage: verbose',
        '  developerTools: false',
      ),
      credentialsText: CREDENTIALS,
    });
    for (const field of ['$.version', '$.step', '$.usage']) {
      assert.equal(statusFor(invalid, 'ui-settings-account', field), STATUS.REJECTED);
    }

    const patch = convert({
      patchText: yaml('- id: ui-settings', '  name: ui-settings', '  config:', '    enabled: false'),
      legacyText: yaml('ui-settings:', '  enabled: true'),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(patch, 'ui-settings'), { enabled: false });
  });
});

describe('unknown material is preserved for review, never applied', () => {
  it('converts supported pi-ai route and model fields while holding unsupported fields', () => {
    const result = convert({
      patchText: yaml(
        '- id: llm-pi-ai',
        "  name: '@deepseek-ai/dsh-llm-pi-ai'",
        '  config:',
        '    providers:',
        '      gw:',
        '        apiKeyEnv: GATEWAY_API_KEY',
        '        api: openai-completions',
        '        baseURL: https://gw.example/v1',
        '        defaultInput: [text, image]',
        '        models:',
        '          - id: vision-model',
        '            contextWindow: 64000',
        '            maxTokens: 8192',
        '            input: [text, image]',
        '        headers:',
        '          Authorization: secret-value',
        '        retryPolicy:',
        '          maxRetries: 8',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'llm-pi-ai'), {
      providers: {
        gw: {
          apiKeyEnv: 'GATEWAY_API_KEY',
          api: 'openai-completions',
          baseURL: 'https://gw.example/v1',
          defaultInput: ['text', 'image'],
          models: [{ id: 'vision-model', contextWindow: 64000, maxTokens: 8192, input: ['text', 'image'] }],
        },
      },
    });
    assert.equal(statusFor(result, 'llm-pi-ai', '$.providers.gw.headers'), STATUS.PENDING);
    assert.equal(statusFor(result, 'llm-pi-ai', '$.providers.gw.retryPolicy'), STATUS.PENDING);
    assert.equal(JSON.stringify(result.patch).includes('secret-value'), false);
    assert.deepEqual(result.credentials.refs.OFFICE_OCR_KEY, OCR_SECRET);
  });

  it('converts the official agent-default-model fields and leaves unknown fields pending', () => {
    const result = convert({
      patchText: yaml(
        '- id: agent-default-model',
        "  name: '@deepseek-ai/dsh-agent-default-model'",
        '  config:',
        '    provider: gw',
        '    model: vision-model',
        '    reasoningEffort: high',
        '    maxTokens: 99',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'agent-default-model'), {
      provider: 'gw', model: 'vision-model', reasoningEffort: 'high',
    });
    assert.equal(statusFor(result, 'agent-default-model', '$.maxTokens'), STATUS.PENDING);
  });

  it('does not backfill pi-ai routes or the default model from legacy settings when the patch owns the id', () => {
    const result = convert({
      patchText: yaml(
        '- id: llm-pi-ai',
        "  name: '@deepseek-ai/dsh-llm-pi-ai'",
        '  config:',
        '    providers:',
        '      patch-route:',
        '        api: openai-completions',
        '        baseURL: https://patch.example/v1',
        '- id: agent-default-model',
        "  name: '@deepseek-ai/dsh-agent-default-model'",
        '  config:',
        '    provider: patch-route',
        '    model: patch-model',
      ),
      legacyText: yaml(
        'llm-pi-ai:',
        '  providers:',
        '    legacy-route:',
        '      api: openai-completions',
        '      baseURL: https://legacy.example/v1',
        'agent-default-model:',
        '  provider: legacy-route',
        '  model: legacy-model',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'llm-pi-ai').providers, {
      'patch-route': { api: 'openai-completions', baseURL: 'https://patch.example/v1' },
    });
    assert.deepEqual(configFor(result, 'agent-default-model'), {
      provider: 'patch-route', model: 'patch-model',
    });
    assert.equal(result.pending.some((item) => item.value?.providers?.['legacy-route']), false);
    assert.equal(result.pending.some((item) => item.value?.provider === 'legacy-route'), false);
  });

  it('imports supported pi-ai routes and agent default selection from legacy settings when absent from patch', () => {
    const result = convert({
      patchText: '',
      legacyText: yaml(
        'llm-pi-ai:',
        '  providers:',
        '    gw:',
        '      apiKeyEnv: GATEWAY_API_KEY',
        '      api: anthropic-messages',
        '      baseURL: https://gateway.example/v1',
        '      defaultMaxTokens: 12000',
        '      models:',
        '        - id: model-a',
        '          reasoningEfforts:',
        '            high: high',
        '      timeoutMs: 30000',
        'agent-default-model:',
        '  provider: gw',
        '  model: model-a',
        '  reasoningEffort: high',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'llm-pi-ai'), {
      providers: {
        gw: {
          apiKeyEnv: 'GATEWAY_API_KEY',
          api: 'anthropic-messages',
          baseURL: 'https://gateway.example/v1',
          defaultMaxTokens: 12000,
          models: [{ id: 'model-a', reasoningEfforts: { high: 'high' } }],
        },
      },
    });
    assert.deepEqual(configFor(result, 'agent-default-model'), {
      provider: 'gw', model: 'model-a', reasoningEffort: 'high',
    });
    assert.equal(statusFor(result, 'llm-pi-ai', '$.providers.gw.timeoutMs'), STATUS.PENDING);
    assert.ok(reasonsFor(result, 'llm-pi-ai').includes('value-migrated-from-legacy'));
    assert.ok(reasonsFor(result, 'agent-default-model').includes('value-migrated-from-legacy'));
  });

  it('keeps incomplete default model selections pending instead of emitting an unusable partial row', () => {
    const result = convert({
      patchText: yaml(
        '- id: agent-default-model',
        "  name: '@deepseek-ai/dsh-agent-default-model'",
        '  config:',
        '    provider: gw',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.equal(configFor(result, 'agent-default-model'), null);
    assert.equal(statusFor(result, 'agent-default-model', '$'), STATUS.REJECTED);
    assert.equal(reasonsFor(result, 'agent-default-model').includes('value-migrated-from-patch'), false);
  });

  it('does not migrate reasoning declarations that the current pi-ai resolver cannot serve', () => {
    for (const declaration of ['{}', '{ off: null }', '{ high: null }']) {
      const result = convert({
        patchText: yaml(
          '- id: llm-pi-ai',
          "  name: '@deepseek-ai/dsh-llm-pi-ai'",
          '  config:',
          '    providers:',
          '      gw:',
          '        models:',
          '          - id: model-a',
          `            reasoningEfforts: ${declaration}`,
        ),
        credentialsText: CREDENTIALS,
      });
      assert.equal(configFor(result, 'llm-pi-ai').providers.gw.models[0].reasoningEfforts, undefined);
      assert.equal(statusFor(result, 'llm-pi-ai', '$.providers.gw.models.0.reasoningEfforts'), STATUS.REJECTED);
    }
  });

  it('holds back an unknown plugin whole', () => {
    const result = convert({
      patchText: yaml(
        '- id: mystery-plugin',
        '  name: mystery',
        '  config:',
        '    a: 1',
        '    b: 2',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.equal(entryFor(result, 'mystery-plugin'), null, 'an unknown plugin emits no row');
    assert.equal(statusFor(result, 'mystery-plugin', '$'), STATUS.PENDING);
    assert.equal(
      reportFor(result, 'mystery-plugin', '$')[0].reason,
      'unknown-plugin-awaits-official-schema-verification',
    );
  });

  it('holds back an unknown field of a known plugin', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: dark',
        '    accent: neon',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configOrEmpty(result, 'ui-theme'), { preference: 'dark' });
    assert.equal(statusFor(result, 'ui-theme', '$.accent'), STATUS.PENDING);
    assert.equal(pendingFor(result, 'ui-theme', '$.accent').value, 'neon');
  });

  it('refuses a duplicated id rather than guessing which one wins', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: dark',
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: light',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.equal(entryFor(result, 'ui-theme'), null, 'an ambiguous id is not converted');
    assert.equal(
      reportFor(result, 'ui-theme', '$')[0].reason,
      'duplicate-id-entries-preserved-legacy-resurrection-blocked',
    );
  });

  it('reports an unknown top-level credentials key without touching it', () => {
    const result = convert({
      patchText: THEME_PATCH,
      legacyText: '',
      credentialsText: yaml('version: 1', 'refs: {}', 'extra: value'),
    });
    assert.equal(statusFor(result, 'credentials', '$.extra'), STATUS.PENDING);
  });
});

const HOSTILE_CASES = [
  {
    label: 'duplicate key',
    reason: 'duplicate-key-rejected',
    text: yaml('- id: ui-theme', '  name: ui-theme', '  config:', '    preference: dark', '    preference: light'),
  },
  {
    label: 'unknown tag',
    reason: 'unknown-tag-rejected',
    text: yaml('- id: ui-theme', '  name: ui-theme', '  config:', '    preference: !mytheme dark'),
  },
  {
    label: 'alias',
    reason: 'alias-rejected',
    text: yaml('- id: ui-theme', '  name: ui-theme', '  config:', '    preference: &p dark', '    other: *p'),
  },
  {
    label: 'js function tag',
    reason: 'unknown-tag-rejected',
    text: yaml('- id: ui-theme', '  name: ui-theme', '  config:', '    preference: !!js/function "x"'),
  },
  {
    label: 'merge key',
    reason: 'merge-key-rejected',
    text: yaml('- id: ui-theme', '  name: ui-theme', '  config:', '    base: &b', '      a: 1', '    more:', '      <<: { b: 2 }'),
  },
  {
    label: 'bad indentation',
    reason: 'yaml-parse-rejected',
    text: yaml('- id: ui-theme', '  name: ui-theme', '  config:', '   preference: dark', '     fontSize: 3'),
  },
  {
    label: 'not a sequence',
    reason: 'patch-not-a-sequence',
    text: yaml('id: ui-theme', 'name: ui-theme'),
  },
];

describe('hostile and malformed documents leak nothing', () => {
  for (const scenario of HOSTILE_CASES) {
    it(`rejects a patch with a ${scenario.label} and keeps its values out of the report`, () => {
      const result = convert({
        patchText: scenario.text,
        legacyText: '',
        credentialsText: CREDENTIALS,
      });
      const finding = result.pending.find((item) => item.id === 'patch');
      assert.ok(finding, 'the rejected document is preserved verbatim in pending');
      assert.equal(finding.reason, scenario.reason);
      assert.equal(statusFor(result, 'patch', '$'), STATUS.REJECTED);
      assert.deepEqual(result.patch, [], 'a rejected patch produces no entries');
      const report = JSON.stringify(result.report);
      for (const fragment of ['dark', 'light', 'mytheme', 'js/function', 'fontSize']) {
        assert.ok(!report.includes(fragment), `report leaked ${fragment}`);
      }
    });
  }

  it('rejects a legacy document that is not a mapping', () => {
    const result = convert({
      patchText: THEME_PATCH,
      legacyText: yaml('- just', '- a list'),
      credentialsText: CREDENTIALS,
    });
    assert.equal(statusFor(result, 'legacy', '$'), STATUS.REJECTED);
    assert.deepEqual(configFor(result, 'ui-theme'), { preference: 'dark', fontSize: 15 });
  });

  it('never executes a js tag', () => {
    delete globalThis.__CONVERT_PWNED__;
    const result = convert({
      patchText: yaml(
        '- id: mystery',
        '  name: mystery',
        '  config:',
        '    a: !!js/function "(()=>{globalThis.__CONVERT_PWNED__=1})()"',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.equal(globalThis.__CONVERT_PWNED__, undefined);
    assert.equal(statusFor(result, 'patch', '$'), STATUS.REJECTED);
  });

  it('keeps a prototype-polluting key as inert data', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: dark',
        '    __proto__:',
        '      polluted: yes',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.equal({}.polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
  });
});

describe('audit 1: entry names and rows the official profile can use', () => {
  it('writes the published package name for every converted id', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: dark',
        '- id: ui-chat',
        '  name: ui-chat',
        '  config:',
        '    transcriptView: compact',
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    maxZipEntries: 10',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(
      result.patch.map((entry) => [entry.id, entry.name]),
      [
        ['ui-theme', '@deepseek-ai/dsh-client-ui-theme'],
        ['ui-chat', '@deepseek-ai/dsh-client-ui-chat'],
        ['file-recognizer-office', '@deepseek-ai/dsh-file-recognizer-office'],
      ],
    );
  });

  it('emits no row at all for an unknown plugin', () => {
    const result = convert({
      patchText: yaml('- id: mystery-plugin', '  name: mystery', '  config:', '    a: 1'),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(result.patch, []);
    assert.ok(!JSON.stringify(result.patch).includes('null'));
  });

  it('emits no row when every field of a known plugin was held back', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-chat',
        '  name: ui-chat',
        '  config:',
        '    somethingElse: 1',
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    maxZipEntries: 999999',
      ),
      legacyText: '',
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(result.patch, [], 'no empty-config rows survive');
  });

  it('emits no row with a null name under any circumstances', () => {
    const result = convert({
      patchText: yaml('- id: ui-theme', '  name: ui-theme', '  config:', '    preference: dark'),
      legacyText: yaml('ui-theme:', '  preference: light', '  fontSize: 13'),
      credentialsText: CREDENTIALS,
    });
    for (const entry of result.patch) {
      assert.equal(typeof entry.name, 'string');
      assert.notEqual(entry.name, null);
    }
  });
});

describe('audit 2: keys are kept verbatim and only sanitised for display', () => {
  const longKey = `key-${'x'.repeat(400)}`;

  it('keeps a long record key byte for byte', () => {
    const result = convert({
      credentialsText: yaml(
        'version: 1',
        'refs: {}',
        'records:',
        `  "${longKey}":`,
        '    kind: apiKey',
      ),
    });
    assert.deepEqual(Object.keys(result.credentials.records), [longKey]);
  });

  it('keeps a long config key verbatim in the pending path', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: dark',
        `    "${longKey}": 1`,
      ),
      credentialsText: CREDENTIALS,
    });
    const held = result.pending.find((item) => item.id === 'ui-theme');
    assert.ok(held.field.includes(longKey), 'pending keeps the original key');
    assert.ok(held.field.length > longKey.length, 'nothing was truncated away');
  });

  it('truncates the key only in the report field path', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        `    "${longKey}": 1`,
      ),
      credentialsText: CREDENTIALS,
    });
    const finding = result.report.find((entry) => entry.field.length > 100);
    assert.ok(finding, 'the long key is still reported');
    assert.ok(finding.field.length < longKey.length, 'the report field path is bounded');
    assert.match(finding.field, /~truncated$/);
  });

  it('keeps a key with control characters intact in the data', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: dark',
        '    "with\\u0007bell": 1',
      ),
      credentialsText: CREDENTIALS,
    });
    const held = result.pending.find((item) => item.id === 'ui-theme');
    assert.equal(held.field, '$.withbell');
  });

  it('rejects a complex mapping key and keeps the original text', () => {
    const result = convert({
      credentialsText: yaml(
        'version: 1',
        'refs: {}',
        'records:',
        '  ? [a, b]',
        '  : value',
      ),
    });
    assert.equal(statusFor(result, 'credentials', '$'), STATUS.REJECTED);
    const held = result.pending.find((item) => item.id === 'credentials');
    assert.equal(held.reason, 'complex-map-key-rejected');
    assert.ok(held.value.includes('[a, b]'), 'the original text is preserved');
  });
});

const AUDIT3_OFFICE = yaml(
  '- id: file-recognizer-office',
  '  name: file-recognizer-office',
  '  config:',
  '    ocr:',
  '      endpoint: https://service.example/v1',
  '      model: model-one',
  '      apiKeyEnv: OLD_KEY',
);

describe('audit 3: credentials document handling', () => {
  it('omits records entirely when the source had none', () => {
    const result = convert({ credentialsText: yaml('version: 1', 'refs: {}') });
    assert.deepEqual(Object.keys(result.credentials).sort(), ['refs', 'version']);
    assert.ok(!('records' in result.credentials), 'an explicit null is rejected officially');
  });

  it('keeps records when the source had them', () => {
    const result = convert({
      credentialsText: yaml(
        'version: 1',
        'refs: {}',
        'records:',
        '  provider/acme:',
        '    kind: apiKey',
      ),
    });
    assert.deepEqual(result.credentials.records, { 'provider/acme': { kind: 'apiKey' } });
  });

  it('rejects a reference whose value is not a string', () => {
    const result = convert({
      patchText: AUDIT3_OFFICE,
      credentialsText: yaml('version: 1', 'refs:', '  OLD_KEY:', '    nested: value'),
    });
    assert.equal(statusFor(result, 'credentials', '$'), STATUS.REJECTED);
    assert.equal(
      result.pending.find((item) => item.id === 'credentials').reason,
      'credential-reference-value-is-not-a-string-rejected',
    );
  });

  it('activates no endpoint at all when the credentials document is rejected', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    ocr:',
        '      endpoint: https://service.example/v1',
        '      model: model-one',
        '      apiKeyEnv: OLD_KEY',
        '    audioTranscription:',
        '      endpoint: https://audio.example/v1',
        '      model: whisper-one',
        '      apiKeyEnv: OLD_KEY',
      ),
      credentialsText: yaml('version: 1', 'refs:', '  OLD_KEY: 12345'),
    });
    assert.equal(result.patch.length, 0, 'nothing is emitted from a rejected document');
    for (const field of ['$.ocr.apiKeyEnv', '$.audioTranscription.apiKeyEnv']) {
      const finding = reportFor(result, 'file-recognizer-office', field)[0];
      assert.equal(finding.reason, 'credentials-document-rejected-no-endpoint-activated');
    }
  });

  it('preserves the original text of an unknown top-level section', () => {
    const result = convert({
      credentialsText: yaml(
        'version: 1',
        'refs: {}',
        'legacyBlock:',
        '  alpha: 1',
        '  beta: 2',
      ),
    });
    assert.equal(statusFor(result, 'credentials', '$.legacyBlock'), STATUS.PENDING);
    const held = result.pending.find((item) => item.id === 'credentials');
    assert.ok(held.value.includes('alpha: 1'), 'the dropped section keeps its text');
    assert.ok(held.value.includes('beta: 2'));
  });
});

describe('audit 4: unusable patch rows block the id entirely', () => {
  const LEGACY_THEME = yaml('ui-theme:', '  preference: system', '  fontSize: 13');

  it('blocks a duplicated id and keeps every row that carried it', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: dark',
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: light',
      ),
      legacyText: LEGACY_THEME,
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(result.patch, [], 'a duplicated id emits nothing');
    const held = result.pending.filter((item) => item.id === 'ui-theme');
    assert.equal(held.length, 2, 'both readings of the id survive');
    assert.ok(held[0].value.includes('preference: dark'));
    assert.ok(held[1].value.includes('preference: light'));
  });

  it('does not let the legacy document resurrect a duplicated id', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: dark',
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: light',
      ),
      legacyText: LEGACY_THEME,
      credentialsText: CREDENTIALS,
    });
    assert.ok(!JSON.stringify(result.patch).includes('@deepseek-ai/dsh-client-ui-theme'));
    assert.equal(
      result.pending.find((item) => item.id === 'ui-theme').reason,
      'duplicate-id-entries-preserved-legacy-resurrection-blocked',
    );
  });

  for (const directive of ['disabled: true', 'filter: someGroup', 'group: extra']) {
    it(`holds back a row carrying unsupported metadata (${directive.split(':')[0]})`, () => {
      const result = convert({
        patchText: yaml(
          '- id: ui-theme',
          '  name: ui-theme',
          `  ${directive}`,
          '  config:',
          '    preference: dark',
        ),
        legacyText: LEGACY_THEME,
        credentialsText: CREDENTIALS,
      });
      assert.deepEqual(result.patch, [], 'a row this phase cannot interpret is not enabled');
      const finding = result.pending.find((item) => item.id === 'ui-theme');
      assert.equal(
        finding.reason,
        'unsupported-patch-metadata-row-held-back-legacy-resurrection-blocked',
      );
      assert.ok(finding.value.includes('preference: dark'), 'the row source is kept');
    });
  }

  it('does not let the legacy document resurrect a metadata-bearing id', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  disabled: true',
        '  config:',
        '    preference: dark',
      ),
      legacyText: LEGACY_THEME,
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(result.patch, []);
    assert.ok(
      !result.report.some((entry) => entry.status === STATUS.MIGRATED),
      'nothing from the legacy document was applied',
    );
  });

  it('still converts a row with only the supported keys', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-theme',
        '  name: ui-theme',
        '  config:',
        '    preference: dark',
      ),
      legacyText: LEGACY_THEME,
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(result.patch, [
      { id: 'ui-theme', name: '@deepseek-ai/dsh-client-ui-theme', config: { preference: 'dark' } },
    ]);
  });
});

describe('audit 5: enum lookups and integer checks are strict', () => {
  for (const inherited of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
    it(`does not remap an inherited name (${inherited})`, () => {
      const result = convert({
        patchText: yaml(
          '- id: ui-chat',
          '  name: ui-chat',
          '  config:',
          `    transcriptView: ${inherited}`,
        ),
        credentialsText: CREDENTIALS,
      });
      assert.equal(statusFor(result, 'ui-chat', '$.transcriptView'), STATUS.REJECTED);
      assert.equal(result.patch.length, 0);
    });
  }

  for (const value of ['14.5', '13.0000001', '"14"', 'true']) {
    it(`refuses a non-integer fontSize (${value})`, () => {
      const result = convert({
        patchText: yaml(
          '- id: ui-theme',
          '  name: ui-theme',
          '  config:',
          `    fontSize: ${value}`,
        ),
        credentialsText: CREDENTIALS,
      });
      assert.equal(statusFor(result, 'ui-theme', '$.fontSize'), STATUS.REJECTED);
      assert.equal(result.patch.length, 0);
    });
  }

  for (const value of ['12', '14', '17']) {
    it(`accepts the integer fontSize ${value}`, () => {
      const result = convert({
        patchText: yaml(
          '- id: ui-theme',
          '  name: ui-theme',
          '  config:',
          `    fontSize: ${value}`,
        ),
        credentialsText: CREDENTIALS,
      });
      assert.deepEqual(configOrEmpty(result, 'ui-theme'), { fontSize: Number(value) });
    });
  }

  it('refuses a non-integer numeric limit too', () => {
    const result = convert({
      patchText: yaml(
        '- id: file-recognizer-office',
        '  name: file-recognizer-office',
        '  config:',
        '    maxInputBytes: 16.5',
        '    maxPdfRenderScale: 2.5',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.equal(statusFor(result, 'file-recognizer-office', '$.maxInputBytes'), STATUS.REJECTED);
    assert.deepEqual(configOrEmpty(result, 'file-recognizer-office'), { maxPdfRenderScale: 2.5 });
  });
});

describe('audit 6: a held-back endpoint keeps its whole block', () => {
  const officeBlock = (group, endpoint, ref) =>
    yaml(
      '- id: file-recognizer-office',
      '  name: file-recognizer-office',
      '  config:',
      `    ${group}:`,
      `      endpoint: ${endpoint}`,
      '      model: model-one',
      `      apiKeyEnv: ${ref}`,
    );

  it('keeps endpoint and model when the reference is missing', () => {
    const result = convert({
      patchText: officeBlock('ocr', 'https://service.example/v1', 'ABSENT_KEY'),
      credentialsText: CREDENTIALS,
    });
    const held = result.pending.find((item) => item.id === 'file-recognizer-office');
    assert.equal(held.value.endpoint, 'https://service.example/v1');
    assert.equal(held.value.model, 'model-one');
    assert.equal(held.value.apiKeyEnv, 'ABSENT_KEY');
  });

  it('keeps endpoint and model when the reference conflicts', () => {
    const result = convert({
      patchText: officeBlock('audioTranscription', 'https://audio.example/v1', 'OFFICE_AUDIO_KEY'),
      credentialsText: yaml(
        'version: 1',
        'refs:',
        '  OFFICE_AUDIO_KEY: original',
        '  DSH_FILE_OFFICE_AUDIO_API_KEY: other',
      ),
    });
    const held = result.pending.find((item) => item.id === 'file-recognizer-office');
    assert.equal(held.value.endpoint, 'https://audio.example/v1');
    assert.equal(held.value.model, 'model-one');
    assert.equal(statusFor(result, 'file-recognizer-office', '$.audioTranscription.apiKeyEnv'), STATUS.CONFLICT);
  });

  for (const endpoint of [
    'ftp://service.example/v1',
    'file:///etc/passwd',
    'https://user:password@service.example/v1',
    'not-a-url',
  ]) {
    it(`refuses the endpoint ${endpoint} and keeps the block`, () => {
      const result = convert({
        patchText: officeBlock('videoUnderstanding', endpoint, 'OFFICE_VIDEO_KEY'),
        credentialsText: CREDENTIALS,
      });
      assert.equal(result.patch.length, 0, 'no row is emitted for a refused endpoint');
      const finding = reportFor(result, 'file-recognizer-office', '$.videoUnderstanding.apiKeyEnv')[0];
      assert.equal(finding.reason, 'endpoint-url-not-http-or-https-held-back');
      const held = result.pending.find((item) => item.id === 'file-recognizer-office');
      assert.equal(held.value.model, 'model-one');
    });
  }

  it('accepts https and loopback http', () => {
    for (const endpoint of ['https://service.example/v1', 'http://localhost:8080/v1']) {
      const result = convert({
        patchText: officeBlock('ocr', endpoint, 'OFFICE_OCR_KEY'),
        credentialsText: CREDENTIALS,
      });
      assert.equal(configOrEmpty(result, 'file-recognizer-office').ocrEndpoint, endpoint);
    }
  });

  it('keeps a userinfo endpoint out of the report', () => {
    const result = convert({
      patchText: officeBlock('ocr', 'https://user:password@service.example/v1', 'OFFICE_OCR_KEY'),
      credentialsText: CREDENTIALS,
    });
    const report = JSON.stringify(result.report);
    assert.ok(!report.includes('password'));
    assert.ok(!report.includes('user:'));
  });
});

describe('reviewed legacy settings mappings', () => {
  it('maps only the welcome acknowledgement into the current general-settings entry', () => {
    const result = convert({
      legacyText: yaml(
        'ui-onboarding:',
        '  welcomeNoticeVersion: "2026-09"',
        '  retiredFlag: true',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(result.patch, [{
      id: 'ui-settings-general',
      name: '@deepseek-ai/dsh-client-ui-settings-general',
      config: { welcomeNoticeVersion: '2026-09' },
    }]);
    assert.equal(statusFor(result, 'ui-onboarding', '$.welcomeNoticeVersion'), STATUS.MIGRATED);
    assert.equal(statusFor(result, 'ui-onboarding', '$.retiredFlag'), STATUS.PENDING);
    assert.equal(pendingFor(result, 'ui-onboarding', '$.retiredFlag').value, true);
  });

  it('does not backfill the welcome acknowledgement over the current patch entry', () => {
    const result = convert({
      patchText: yaml(
        '- id: ui-settings-general',
        '  name: "@deepseek-ai/dsh-client-ui-settings-general"',
        '  config:',
        '    welcomeNoticeVersion: current',
      ),
      legacyText: yaml('ui-onboarding:', '  welcomeNoticeVersion: old'),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'ui-settings-general'), { welcomeNoticeVersion: 'current' });
    assert.equal(result.patch.length, 1);
    assert.equal(pendingFor(result, 'ui-onboarding', '$').value.welcomeNoticeVersion, 'old');
  });

  it('rejects a welcome acknowledgement with a non-string value', () => {
    const result = convert({
      legacyText: yaml('ui-onboarding:', '  welcomeNoticeVersion: 2026'),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(result.patch, []);
    assert.equal(statusFor(result, 'ui-onboarding', '$.welcomeNoticeVersion'), STATUS.REJECTED);
  });

  it('maps exact subagent routes and keeps unknown fields pending', () => {
    const result = convert({
      patchText: yaml(
        '- id: subagent-model-selection-settings',
        '  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"',
        '  config:',
        '    enabled: true',
        '    allowedModels:',
        '      - provider: testchiyun',
        '        model: glm-5.3-flash',
        '    retiredOption: true',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(result.patch, [{
      id: 'subagent-model-selection-settings',
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings',
      config: {
        enabled: true,
        allowedModels: [{ provider: 'testchiyun', model: 'glm-5.3-flash' }],
      },
    }]);
    assert.equal(statusFor(result, 'subagent-model-selection-settings', '$.enabled'), STATUS.MIGRATED);
    assert.equal(statusFor(result, 'subagent-model-selection-settings', '$.allowedModels'), STATUS.MIGRATED);
    assert.equal(statusFor(result, 'subagent-model-selection-settings', '$.retiredOption'), STATUS.PENDING);
  });

  it('refuses invalid subagent routes and enabled settings without an allowed route', () => {
    const invalidRoute = convert({
      patchText: yaml(
        '- id: subagent-model-selection-settings',
        '  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"',
        '  config:',
        '    enabled: false',
        '    allowedModels:',
        '      - provider: testchiyun',
        '        model: glm-5.3-flash',
        '        reasoningEffort: high',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(invalidRoute, 'subagent-model-selection-settings'), { enabled: false });
    assert.equal(statusFor(invalidRoute, 'subagent-model-selection-settings', '$.allowedModels'), STATUS.REJECTED);

    const emptyEnabled = convert({
      patchText: yaml(
        '- id: subagent-model-selection-settings',
        '  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"',
        '  config:',
        '    enabled: true',
        '    allowedModels: []',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.equal(configFor(emptyEnabled, 'subagent-model-selection-settings'), null);
    assert.equal(statusFor(emptyEnabled, 'subagent-model-selection-settings', '$.enabled'), STATUS.REJECTED);
    assert.equal(statusFor(emptyEnabled, 'subagent-model-selection-settings', '$.allowedModels'), STATUS.REJECTED);

    const duplicateRoutes = convert({
      patchText: yaml(
        '- id: subagent-model-selection-settings',
        '  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"',
        '  config:',
        '    allowedModels:',
        '      - provider: testchiyun',
        '        model: glm-5.3-flash',
        '      - provider: testchiyun',
        '        model: glm-5.3-flash',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.equal(configFor(duplicateRoutes, 'subagent-model-selection-settings'), null);
    assert.equal(statusFor(duplicateRoutes, 'subagent-model-selection-settings', '$.allowedModels'), STATUS.REJECTED);
  });

  it('does not backfill omitted subagent settings from the legacy document', () => {
    const result = convert({
      patchText: yaml(
        '- id: subagent-model-selection-settings',
        '  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"',
        '  config:',
        '    enabled: false',
      ),
      legacyText: yaml(
        'subagent-model-selection-settings:',
        '  enabled: true',
        '  allowedModels:',
        '    - provider: testchiyun',
        '      model: glm-5.3-flash',
      ),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configFor(result, 'subagent-model-selection-settings'), { enabled: false });
    assert.equal(result.patch.length, 1);
    assert.equal(statusFor(result, 'subagent-model-selection-settings', '$.allowedModels'), STATUS.NOT_RESTORED);
  });
});

const LARK_SECRET = 'lark-app-secret-9f8e7d6c-DO-NOT-LEAK';
const LARK_CREDENTIALS = yaml(
  'version: 1',
  'refs:',
  '  LARK_APP_SECRET: ' + LARK_SECRET,
);

const LARK_FULL_PATCH = yaml(
  '- id: lark',
  '  name: lark',
  '  config:',
  '    appId: cli_abc123',
  '    appSecretEnv: LARK_APP_SECRET',
  '    brand: lark',
  '    conversationUserOpenId: ou_999',
  '    conversationCwd: /tmp/lark-work',
  '    conversationResponseTimeoutMs: 900000',
  '    conversationHandshakeTimeoutMs: 45000',
  '    maxOutputBytes: 524288',
  '    cliTimeoutMs: 60000',
  '    registrationTimeoutMs: 300000',
);

describe('lark: field mapping', () => {
  it('writes the new bundle name', () => {
    const result = convert({
      patchText: LARK_FULL_PATCH,
      credentialsText: LARK_CREDENTIALS,
    });
    assert.deepEqual(result.patch.map((entry) => [entry.id, entry.name]), [
      ['lark', '@deepseek-ai/dsh-lark-integration'],
    ]);
  });

  it('keeps the same-named fields and applies the four renames', () => {
    const result = convert({
      patchText: LARK_FULL_PATCH,
      credentialsText: LARK_CREDENTIALS,
    });
    assert.deepEqual(configOrEmpty(result, 'lark'), {
      enabled: false,
      cliEnabled: false,
      appId: 'cli_abc123',
      appSecretEnv: 'LARK_APP_SECRET',
      brand: 'lark',
      authorizedUserOpenId: 'ou_999',
      conversationCwd: '/tmp/lark-work',
      responseTimeoutMs: 900000,
      handshakeTimeoutMs: 45000,
      cliMaxOutputBytes: 524288,
      cliTimeoutMs: 60000,
      registrationTimeoutMs: 300000,
    });
  });

  it('leaves no legacy field name in the output', () => {
    const config = configOrEmpty(
      convert({ patchText: LARK_FULL_PATCH, credentialsText: LARK_CREDENTIALS }),
      'lark',
    );
    for (const legacy of [
      'conversationUserOpenId',
      'conversationResponseTimeoutMs',
      'conversationHandshakeTimeoutMs',
      'maxOutputBytes',
    ]) {
      assert.ok(!(legacy in config), `${legacy} must not survive under its old name`);
    }
  });

  it('reports each rename as a renamed field', () => {
    const result = convert({
      patchText: LARK_FULL_PATCH,
      credentialsText: LARK_CREDENTIALS,
    });
    const renamed = result.report
      .filter((entry) => entry.reason === 'renamed-field-migrated-from-patch')
      .map((entry) => entry.field)
      .sort();
    assert.deepEqual(renamed, [
      '$.conversationHandshakeTimeoutMs',
      '$.conversationResponseTimeoutMs',
      '$.conversationUserOpenId',
      '$.maxOutputBytes',
    ]);
  });

  it('accepts both brands and refuses anything else', () => {
    for (const brand of ['feishu', 'lark']) {
      const result = convert({
        patchText: yaml('- id: lark', '  name: lark', '  config:', `    brand: ${brand}`),
        credentialsText: LARK_CREDENTIALS,
      });
      assert.equal(configOrEmpty(result, 'lark').brand, brand);
    }
    const bad = convert({
      patchText: yaml('- id: lark', '  name: lark', '  config:', '    brand: slack'),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.ok(!('brand' in configOrEmpty(bad, 'lark')));
    assert.equal(statusFor(bad, 'lark', '$.brand'), STATUS.REJECTED);
  });

  it('enforces the schema bounds on the numeric fields', () => {
    const result = convert({
      patchText: yaml(
        '- id: lark',
        '  name: lark',
        '  config:',
        '    maxOutputBytes: 1024',
        '    conversationHandshakeTimeoutMs: 300000',
        '    registrationTimeoutMs: 900000',
        '    conversationResponseTimeoutMs: 1800000',
        '    cliTimeoutMs: 300000',
      ),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.deepEqual(configOrEmpty(result, 'lark'), {
      enabled: false,
      cliEnabled: false,
      cliMaxOutputBytes: 1024,
      handshakeTimeoutMs: 300000,
      registrationTimeoutMs: 900000,
      responseTimeoutMs: 1800000,
      cliTimeoutMs: 300000,
    });
  });

  it('rejects an out-of-range timeout instead of clamping it', () => {
    const result = convert({
      patchText: yaml(
        '- id: lark',
        '  name: lark',
        '  config:',
        '    registrationTimeoutMs: 1000',
        '    conversationResponseTimeoutMs: 5000000',
      ),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.ok(!('registrationTimeoutMs' in configOrEmpty(result, 'lark')));
    assert.ok(!('responseTimeoutMs' in configOrEmpty(result, 'lark')));
    assert.equal(statusFor(result, 'lark', '$.registrationTimeoutMs'), STATUS.REJECTED);
  });
});

describe('lark: the connection and the tool are always off', () => {
  for (const old of ['true', 'false']) {
    it(`forces both off when the source said ${old}`, () => {
      const result = convert({
        patchText: yaml(
          '- id: lark',
          '  name: lark',
          '  config:',
          `    enabled: ${old}`,
          `    cliEnabled: ${old}`,
        ),
        credentialsText: LARK_CREDENTIALS,
      });
      const config = configOrEmpty(result, 'lark');
      assert.equal(config.enabled, false);
      assert.equal(config.cliEnabled, false);
    });
  }

  it('forces both off even with no config at all', () => {
    const result = convert({
      patchText: yaml('- id: lark', '  name: lark'),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.deepEqual(configOrEmpty(result, 'lark'), { enabled: false, cliEnabled: false });
  });

  it('states in the report that this is an isolation test', () => {
    const result = convert({
      patchText: yaml('- id: lark', '  name: lark', '  config:', '    enabled: true', '    cliEnabled: true'),
      credentialsText: LARK_CREDENTIALS,
    });
    for (const field of ['$.enabled', '$.cliEnabled']) {
      const finding = reportFor(result, 'lark', field)[0];
      assert.equal(finding.reason, 'forced-disabled-for-isolation-test-connection-and-tool-not-enabled');
    }
  });

  it('keeps the old enabled values in pending', () => {
    const result = convert({
      patchText: yaml('- id: lark', '  name: lark', '  config:', '    enabled: true', '    cliEnabled: true'),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.equal(pendingFor(result, 'lark', '$.enabled').value, true);
    assert.equal(pendingFor(result, 'lark', '$.cliEnabled').value, true);
  });

  it('never writes a true anywhere in the converted config', () => {
    const result = convert({
      patchText: LARK_FULL_PATCH + yaml('- id: lark', '  name: lark'),
      legacyText: yaml('lark:', '  enabled: true', '  cliEnabled: true', '  appId: cli_from_legacy'),
      credentialsText: LARK_CREDENTIALS,
    });
    for (const entry of result.patch) {
      if (entry.id !== 'lark') continue;
      assert.equal(entry.config.enabled, false);
      assert.equal(entry.config.cliEnabled, false);
      assert.ok(!Object.values(entry.config).includes(true));
    }
  });
});

describe('lark: identity and credential are never guessed', () => {
  it('refuses a missing or empty identity field', () => {
    for (const line of ['    appId: ""', '    conversationUserOpenId: ""', '    conversationUserOpenId: 12345']) {
      const result = convert({
        patchText: yaml('- id: lark', '  name: lark', '  config:', line),
        credentialsText: LARK_CREDENTIALS,
      });
      const field = line.trim().split(':')[0];
      const config = configOrEmpty(result, 'lark');
      assert.ok(!('appId' in config) || !line.includes('appId'), 'appId must not be invented');
      assert.equal(
        reportFor(result, 'lark', `$.${field}`).some(
          (entry) => entry.reason === 'identity-field-missing-or-invalid-not-guessed',
        ),
        true,
        `${field} must be reported as not guessed`,
      );
    }
  });

  it('does not default an absent appId or allowlist id', () => {
    const result = convert({
      patchText: yaml('- id: lark', '  name: lark', '  config:', '    brand: lark'),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.deepEqual(configOrEmpty(result, 'lark'), {
      enabled: false,
      cliEnabled: false,
      brand: 'lark',
    });
  });

  it('preserves the credential reference by name', () => {
    const result = convert({
      patchText: yaml(
        '- id: lark',
        '  name: lark',
        '  config:',
        '    appSecretEnv: LARK_APP_SECRET',
      ),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.equal(configOrEmpty(result, 'lark').appSecretEnv, 'LARK_APP_SECRET');
    assert.equal(result.credentials.refs.LARK_APP_SECRET, LARK_SECRET);
  });

  it('keeps an arbitrary reference name rather than renaming it', () => {
    const result = convert({
      patchText: yaml('- id: lark', '  name: lark', '  config:', '    appSecretEnv: MY_OWN_LARK_REF'),
      credentialsText: yaml('version: 1', 'refs:', '  MY_OWN_LARK_REF: ' + LARK_SECRET),
    });
    assert.equal(configOrEmpty(result, 'lark').appSecretEnv, 'MY_OWN_LARK_REF');
  });

  it('reports a reference the document does not hold and invents nothing', () => {
    const result = convert({
      patchText: yaml('- id: lark', '  name: lark', '  config:', '    appSecretEnv: ABSENT_REF'),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.ok(!('appSecretEnv' in configOrEmpty(result, 'lark')));
    assert.equal(
      reportFor(result, 'lark', '$.appSecretEnv')[0].reason,
      'lark-credential-reference-missing-in-credentials-not-created',
    );
    assert.deepEqual(result.credentials.refs, { LARK_APP_SECRET: LARK_SECRET });
    assert.ok(!JSON.stringify(result.credentials).includes('ABSENT_REF'));
  });

  it('refuses a reference name outside the credentials grammar', () => {
    const result = convert({
      patchText: yaml('- id: lark', '  name: lark', '  config:', '    appSecretEnv: "not a ref"'),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.ok(!('appSecretEnv' in configOrEmpty(result, 'lark')));
    assert.equal(statusFor(result, 'lark', '$.appSecretEnv'), STATUS.REJECTED);
  });

  it('reports a missing credential when the document itself was rejected', () => {
    const result = convert({
      patchText: yaml('- id: lark', '  name: lark', '  config:', '    appSecretEnv: LARK_APP_SECRET'),
      credentialsText: yaml('version: 2', 'refs:', '  LARK_APP_SECRET: ' + LARK_SECRET),
    });
    assert.ok(!('appSecretEnv' in configOrEmpty(result, 'lark')));
    assert.equal(
      reportFor(result, 'lark', '$.appSecretEnv')[0].reason,
      'lark-credential-reference-missing-in-credentials-not-created',
    );
  });
});

describe('lark: unknown, retired and roster material is preserved only', () => {
  it('keeps retired fields out of the config and in pending', () => {
    const result = convert({
      patchText: yaml(
        '- id: lark',
        '  name: lark',
        '  config:',
        '    appId: cli_abc',
        '    credentialMode: legacy',
        '    cliConfigDir: /tmp/old-config',
        '    conversationTimeZone: Asia/Shanghai',
      ),
      credentialsText: LARK_CREDENTIALS,
    });
    const config = configOrEmpty(result, 'lark');
    for (const retired of ['credentialMode', 'cliConfigDir', 'conversationTimeZone']) {
      assert.ok(!(retired in config), `${retired} is not in the current schema`);
      const finding = reportFor(result, 'lark', `$.${retired}`)[0];
      assert.equal(finding.status, STATUS.PENDING);
      assert.equal(finding.reason, 'retired-field-preserved-not-in-current-schema');
    }
    assert.equal(pendingFor(result, 'lark', '$.credentialMode').value, 'legacy');
    assert.equal(pendingFor(result, 'lark', '$.conversationTimeZone').value, 'Asia/Shanghai');
  });

  it('does not migrate agent presets or permissions', () => {
    const result = convert({
      patchText: yaml(
        '- id: lark',
        '  name: lark',
        '  config:',
        '    appId: cli_abc',
        '    agents:',
        '      - id: bot-a',
        '        model: m1',
        '    agentPreset: nightly',
        '    presets:',
        '      - name: p1',
        '    permission:',
        '      mode: all',
        '    permissions:',
        '      tools: [all]',
        '    roster:',
        '      - ou_1',
      ),
      credentialsText: LARK_CREDENTIALS,
    });
    const config = configOrEmpty(result, 'lark');
    for (const key of ['agents', 'agentPreset', 'presets', 'permission', 'permissions', 'roster']) {
      assert.ok(!(key in config), `${key} must not be migrated`);
      const finding = reportFor(result, 'lark', `$.${key}`)[0];
      assert.equal(finding.status, STATUS.PENDING);
      assert.equal(
        finding.reason,
        'agent-preset-or-permission-not-migrated-awaits-official-roster-verification',
      );
    }
    assert.deepEqual(pendingFor(result, 'lark', '$.agents').value, [{ id: 'bot-a', model: 'm1' }]);
  });

  it('distinguishes a schema field it chose not to migrate from an unknown one', () => {
    const result = convert({
      patchText: yaml(
        '- id: lark',
        '  name: lark',
        '  config:',
        '    appId: cli_abc',
        '    httpTimeoutMs: 30000',
        '    cliGraceMs: 2000',
        '    totallyMadeUp: 1',
      ),
      credentialsText: LARK_CREDENTIALS,
    });
    for (const key of ['httpTimeoutMs', 'cliGraceMs']) {
      assert.equal(
        reportFor(result, 'lark', `$.${key}`)[0].reason,
        'lark-field-defined-but-not-in-migrated-set-awaits-official-review',
      );
      assert.ok(!(key in configOrEmpty(result, 'lark')));
    }
    assert.equal(
      reportFor(result, 'lark', '$.totallyMadeUp')[0].reason,
      'unknown-field-awaits-official-schema-verification',
    );
  });

  it('still emits the entry when only the forced-off fields are known', () => {
    const result = convert({
      patchText: yaml('- id: lark', '  name: lark', '  config:', '    mystery: 1'),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.deepEqual(configOrEmpty(result, 'lark'), { enabled: false, cliEnabled: false });
  });
});

describe('lark: no secret or value reaches the report', () => {
  it('keeps the application secret and the reference name out of the report', () => {
    const result = convert({
      patchText: LARK_FULL_PATCH,
      credentialsText: LARK_CREDENTIALS,
    });
    const report = JSON.stringify(result.report);
    // The field name is what a report is for, so `$.appSecretEnv` is expected.
    assert.ok(report.includes('$.appSecretEnv'));
    for (const value of [LARK_SECRET, 'LARK_APP_SECRET', 'cli_abc123', 'ou_999', '/tmp/lark-work']) {
      assert.ok(!report.includes(value), `report leaked ${value}`);
    }
  });

  it('keeps the reference name out of the report when it is missing', () => {
    const result = convert({
      patchText: yaml('- id: lark', '  name: lark', '  config:', '    appSecretEnv: ABSENT_REF'),
      credentialsText: LARK_CREDENTIALS,
    });
    assert.ok(!JSON.stringify(result.report).includes('ABSENT_REF'));
    assert.equal(pendingFor(result, 'lark', '$.appSecretEnv').value, 'ABSENT_REF');
  });

  it('keeps every report entry to id, field, status and reason', () => {
    const result = convert({
      patchText: LARK_FULL_PATCH,
      credentialsText: LARK_CREDENTIALS,
    });
    for (const entry of result.report) {
      assert.deepEqual(Object.keys(entry).sort(), ['field', 'id', 'reason', 'status']);
    }
  });
});

/** A nested value deep enough to pass the parser and pass the conversion limits. */
function nestedBeyondLimit(levels, indent) {
  const lines = ['deep:'];
  for (let level = 1; level <= levels; level += 1) {
    lines.push(`${' '.repeat(level * 2)}k${level}:`);
  }
  lines.push(`${' '.repeat((levels + 1) * 2)}leaf: x`);
  const pad = ' '.repeat(indent);
  return `${lines.map((line) => pad + line).join('\n')}\n`;
}

describe('final round: an unrecognised directive blocks a whole office group', () => {
  const officeWith = (extra) =>
    yaml(
      '- id: file-recognizer-office',
      '  name: file-recognizer-office',
      '  config:',
      '    maxZipEntries: 10',
      '    ocr:',
      '      endpoint: https://service.example/v1',
      '      model: model-one',
      '      apiKeyEnv: OFFICE_OCR_KEY',
      extra,
    );

  for (const directive of ['disabled: true', 'enabled: false', 'filter: group-a', 'group: extra']) {
    it(`holds the whole group back for ${directive.split(':')[0]}`, () => {
      const result = convert({
        patchText: officeWith(`      ${directive}`),
        credentialsText: CREDENTIALS,
      });
      const config = configOrEmpty(result, 'file-recognizer-office');
      assert.ok(!('ocrEndpoint' in config), 'the recognised endpoint must not be activated');
      assert.ok(!('ocrModel' in config), 'the recognised model must not be activated');
      assert.equal(
        reportFor(result, 'file-recognizer-office', '$.ocr.apiKeyEnv')[0].reason,
        'endpoint-block-has-unrecognised-directive-held-back-whole-group',
      );
    });
  }

  it('copies no credential reference for a blocked group', () => {
    const result = convert({
      patchText: officeWith('      disabled: true'),
      credentialsText: CREDENTIALS,
    });
    assert.ok(
      !('DSH_FILE_OFFICE_OCR_API_KEY' in result.credentials.refs),
      'a blocked group must not put a credential in the document',
    );
    assert.equal(result.credentials.refs.OFFICE_OCR_KEY, OCR_SECRET);
  });

  it('keeps the whole block in pending, endpoint and model included', () => {
    const result = convert({
      patchText: officeWith('      disabled: true'),
      credentialsText: CREDENTIALS,
    });
    const held = pendingFor(result, 'file-recognizer-office', '$.ocr.apiKeyEnv');
    assert.equal(held.value.endpoint, 'https://service.example/v1');
    assert.equal(held.value.model, 'model-one');
    assert.equal(held.value.disabled, true);
  });

  it('leaves the other limits of the same entry convertible', () => {
    const result = convert({
      patchText: officeWith('      disabled: true'),
      credentialsText: CREDENTIALS,
    });
    assert.deepEqual(configOrEmpty(result, 'file-recognizer-office'), { maxZipEntries: 10 });
  });

  it('still converts a block carrying only the three known keys', () => {
    const result = convert({ patchText: officeWith(''), credentialsText: CREDENTIALS });
    const config = configOrEmpty(result, 'file-recognizer-office');
    assert.equal(config.ocrEndpoint, 'https://service.example/v1');
    assert.equal(config.ocrModel, 'model-one');
    assert.equal(result.credentials.refs.DSH_FILE_OFFICE_OCR_API_KEY, OCR_SECRET);
  });
});

describe('final round: a document that cannot be finished is reported, not thrown', () => {
  const DEEP_PATCH =
    '- id: ui-theme\n  name: ui-theme\n  config:\n    preference: dark\n    mystery:\n' +
    nestedBeyondLimit(80, 6);

  it('does not throw when a patch node passes the conversion limits', () => {
    let result = null;
    assert.doesNotThrow(() => {
      result = convert({ patchText: DEEP_PATCH, credentialsText: CREDENTIALS });
    });
    assert.ok(result !== null);
  });

  it('reports the document as refused and keeps its original text', () => {
    const result = convert({ patchText: DEEP_PATCH, credentialsText: CREDENTIALS });
    const finding = reportFor(result, 'patch', '$').find(
      (entry) => entry.reason === 'document-exceeds-conversion-limits-entries-not-activated',
    );
    assert.ok(finding, 'the document must be reported, not silently dropped');
    assert.equal(finding.status, STATUS.REJECTED);
    const held = result.pending.find(
      (item) => item.reason === 'document-exceeds-conversion-limits-entries-not-activated',
    );
    assert.equal(held.value, DEEP_PATCH, 'the exact original text is kept');
  });

  it('activates no entry from a document that hit the limits', () => {
    const result = convert({ patchText: DEEP_PATCH, credentialsText: CREDENTIALS });
    assert.deepEqual(result.patch, []);
  });

  it('still returns a report when the legacy document hits the limits', () => {
    const legacyText = 'ui-chat:\n  transcriptView: standard\n  deep:\n' + nestedBeyondLimit(80, 4);
    const result = convert({
      patchText: '- id: ui-theme\n  name: ui-theme\n  config:\n    preference: dark\n',
      legacyText,
      credentialsText: CREDENTIALS,
    });
    assert.ok(Array.isArray(result.report));
    assert.equal(
      statusFor(result, 'ui-theme', '$.preference'),
      STATUS.MIGRATED,
      'the patch document is unaffected',
    );
    assert.equal(
      reportFor(result, 'legacy', '$')[0].reason,
      'document-exceeds-conversion-limits-entries-not-activated',
    );
    assert.deepEqual(result.patch.map((entry) => entry.id), ['ui-theme']);
  });

  it('rolls back credential copies made before the limit was reached', () => {
    const patchText =
      '- id: file-recognizer-office\n  name: file-recognizer-office\n  config:\n' +
      '    maxZipEntries: 10\n' +
      '    ocr:\n      endpoint: https://service.example/v1\n      model: m1\n      apiKeyEnv: OFFICE_OCR_KEY\n' +
      '    mystery:\n' +
      nestedBeyondLimit(80, 4);
    const result = convert({ patchText, credentialsText: CREDENTIALS });
    assert.ok(
      !('DSH_FILE_OFFICE_OCR_API_KEY' in result.credentials.refs),
      'a half-converted document must not leave a credential behind',
    );
    assert.equal(result.credentials.refs.OFFICE_OCR_KEY, OCR_SECRET);
  });

  it('keeps a value out of the report when it refuses a document', () => {
    const result = convert({ patchText: DEEP_PATCH, credentialsText: CREDENTIALS });
    const report = JSON.stringify(result.report);
    assert.ok(!report.includes('mystery'));
    assert.ok(!report.includes('leaf'));
    for (const entry of result.report) {
      assert.deepEqual(Object.keys(entry).sort(), ['field', 'id', 'reason', 'status']);
    }
  });

  it('keeps the source fragment of a malformed patch row', () => {
    const result = convert({
      patchText: '- a bare string row\n- id: ui-theme\n  name: ui-theme\n  config:\n    preference: dark\n',
      credentialsText: CREDENTIALS,
    });
    const held = result.pending.find((item) => item.id === 'patch');
    assert.ok(held, 'a malformed row must be kept, not only reported');
    assert.equal(held.value, 'a bare string row');
    assert.equal(statusFor(result, 'patch', '$[0]'), STATUS.REJECTED);
    assert.deepEqual(result.patch.map((entry) => entry.id), ['ui-theme']);
  });

  it('keeps the source fragment of a row with an unusable id', () => {
    const result = convert({
      patchText: '- id: "not a valid id"\n  name: t\n  config:\n    a: 1\n',
      credentialsText: CREDENTIALS,
    });
    const held = result.pending.find((item) => item.id === 'patch');
    assert.ok(held.value.includes('not a valid id'), 'the row is kept as written');
    assert.deepEqual(result.patch, []);
  });
});
