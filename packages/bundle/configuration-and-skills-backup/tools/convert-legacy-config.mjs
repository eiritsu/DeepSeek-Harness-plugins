/**
 * convert.mjs - phase-2 pure converter for legacy DSH / Cordis configuration.
 *
 * WHAT THIS IS
 * ------------
 * A pure function. It reads three YAML documents as text, returns four
 * in-memory results and touches nothing else: no filesystem writes, no
 * installs, no network, no reads of any real configuration. The caller owns
 * persisting the output at 0600 and is responsible for the official schema
 * check that this phase deliberately does not perform.
 *
 *   convert({ patchText, legacyText, credentialsText })
 *     -> { patch, credentials, pending, report }
 *
 *   patchText       the current legacy cordis.patch.yml sequence
 *   legacyText      settings.yaml, `imported` mapping
 *   credentialsText the version-1 credentials document
 *
 * SOURCE PRIORITY
 * ---------------
 * For an id present in both inputs the whole patch config wins. The legacy
 * config may only supply an id the patch does not have at all. A field that
 * exists in the legacy config but not in the patch config of a shared id is
 * never carried over: resurrecting it would silently re-enable a setting the
 * user had already removed. Such a field goes to `pending` so the drop is
 * visible instead of silent.
 *
 * REPORT
 * ------
 * `report` entries are exactly { id, field, status, reason }: an id, a field
 * path, a status from a closed vocabulary, and a fixed reason slug. No value,
 * no endpoint, no model, no credential name and no parser text ever reaches it
 * - a parser `message` quotes the offending source line, so only the parser's
 * `code` is ever read, and codes are folded into fixed slugs.
 *
 * `pending` is the only place original material is kept, so a human can look
 * at one field locally. It is deliberately separate from the report.
 *
 * NOT DONE HERE
 * -------------
 * llm-pi-ai routes, the agent default model, the welcome acknowledgement, and
 * exact subagent model-selection fields are converted only where the current
 * schema accepts them. Unknown fields remain in `pending`. The old
 * `maxPdfOcrPages` is never mapped onto `maxPdfPages`: the two count different
 * things.
 * Permission and agent-preset selections also stay pending unless the caller
 * supplies an explicit `selectionContext` proving the old and current
 * selections have the same semantics.
 */

import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';

/**
 * The `yaml` package is not resolvable from the workspace root manifest under
 * pnpm's strict layout, but it is from this one.
 */
const requireFromHost = createRequire(import.meta.url);
const YAML = requireFromHost('yaml');

export const STATUS = Object.freeze({
  MIGRATED: 'migrated',
  NOT_RESTORED: 'not-restored',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  REJECTED: 'rejected',
  ERROR: 'error',
});

/** Fixed reason slugs. Nothing derived from a value is ever interpolated. */
const REASON = Object.freeze({
  MIGRATED_PATCH: 'value-migrated-from-patch',
  MIGRATED_LEGACY: 'value-migrated-from-legacy',
  RENAMED_PATCH: 'renamed-field-migrated-from-patch',
  RENAMED_LEGACY: 'renamed-field-migrated-from-legacy',
  REMAPPED_PATCH: 'legacy-value-remapped-from-patch',
  REMAPPED_LEGACY: 'legacy-value-remapped-from-legacy',
  REF_COPIED_PATCH: 'credential-ref-copied-to-new-reference-from-patch',
  REF_COPIED_LEGACY: 'credential-ref-copied-to-new-reference-from-legacy',
  PAIR_ON_PATCH: 'endpoint-pair-activated-from-patch',
  PAIR_ON_LEGACY: 'endpoint-pair-activated-from-legacy',
  NOT_RESTORED: 'legacy-field-not-restored-patch-config-is-authoritative',
  UNKNOWN_PLUGIN: 'unknown-plugin-awaits-official-schema-verification',
  UNKNOWN_FIELD: 'unknown-field-awaits-official-schema-verification',
  FIELD_NOT_MAPPED: 'field-outside-supported-conversion-set',
  BAD_ENUM: 'value-not-in-accepted-enum-not-applied',
  BAD_RANGE: 'value-outside-accepted-range-not-applied',
  LIMIT_UNMAPPED: 'legacy-limit-not-auto-mapped-semantics-differ',
  LIMIT_UNLISTED: 'limit-not-in-migrated-set-awaits-official-review',
  REF_MISSING: 'credential-ref-missing-endpoint-pair-not-activated',
  REF_ABSENT: 'credential-ref-field-absent-endpoint-pair-not-activated',
  REF_CONFLICT: 'credential-ref-conflict-not-overwritten-endpoint-pair-not-activated',
  DUP_ID_TEXT: 'duplicate-id-entries-preserved-legacy-resurrection-blocked',
  UNSUPPORTED_META:
    'unsupported-patch-metadata-row-held-back-legacy-resurrection-blocked',
  CREDENTIALS_REJECTED: 'credentials-document-rejected-no-endpoint-activated',
  REF_NOT_STRING: 'credential-reference-value-is-not-a-string-rejected',
  BAD_ENDPOINT: 'endpoint-url-not-http-or-https-held-back',
  COMPLEX_KEY: 'complex-map-key-rejected',
  OFFICE_UNKNOWN_POLICY:
    'endpoint-block-has-unrecognised-directive-held-back-whole-group',
  DOC_LIMITS: 'document-exceeds-conversion-limits-entries-not-activated',
  DOC_FAILED: 'document-conversion-failed-entries-not-activated',
  LARK_FORCED_OFF:
    'forced-disabled-for-isolation-test-connection-and-tool-not-enabled',
  LARK_RETIRED: 'retired-field-preserved-not-in-current-schema',
  LARK_ROSTER:
    'agent-preset-or-permission-not-migrated-awaits-official-roster-verification',
  LARK_IDENTITY: 'identity-field-missing-or-invalid-not-guessed',
  LARK_CREDENTIAL:
    'lark-credential-reference-missing-in-credentials-not-created',
  LARK_UNLISTED: 'lark-field-defined-but-not-in-migrated-set-awaits-official-review',
  BAD_SHAPE: 'unexpected-document-shape-rejected',
  DOC_REJECTED: 'document-rejected-preserved-verbatim',
  SELECTION_CONTEXT: 'selection-context-missing-or-incomplete-not-applied',
  SELECTION_TARGET: 'selection-target-already-present-not-overwritten',
  PERMISSION_NOT_FOUND: 'permission-preset-not-present-in-both-environments',
  PERMISSION_SEMANTICS: 'permission-policy-semantics-differ-not-applied',
  AGENT_NOT_FOUND: 'agent-preset-not-present-in-both-rosters',
  AGENT_SEMANTICS: 'agent-preset-semantics-differ-not-applied',
  AGENT_SELECTION_DISABLED: 'legacy-agent-selection-was-disabled-not-applied',
  SELECTION_CONFLICT: 'patch-selection-authoritative-legacy-value-conflicts',
  SELECTION_BLOCKED: 'blocked-patch-row-prevents-legacy-selection-resurrection',
});

/** Parser codes folded onto fixed slugs; a parser `message` quotes the source. */
const CODE_REASON = new Map([
  ['DUPLICATE_KEY', 'duplicate-key-rejected'],
  ['MULTIPLE_DOCS', 'multiple-documents-rejected'],
  ['TAG_RESOLVE_FAILED', 'unknown-tag-rejected'],
]);

const LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 100000,
  maxKeyLength: 120,
});

/**
 * Accepted values, transcribed from the schemas this build ships:
 *   ui-theme   packages/client/ui-theme/src/theme-settings.ts
 *   ui-chat    packages/client/ui-chat/src/chat-settings.ts
 *   office     packages/attachment/file-recognizer-office/src/index.ts
 * The legacy `normal` and `expanded` transcript modes are read as the modes the
 * Chat settings file names for them and are never written back.
 */
const THEME_FIELDS = Object.freeze({
  preference: { kind: 'enum', values: ['light', 'dark', 'system'] },
  fontSize: { kind: 'integer', min: 12, max: 17 },
});

const CHAT_FIELDS = Object.freeze({
  transcriptView: {
    kind: 'enum',
    values: ['compact', 'standard', 'detailed', 'verbose'],
    remap: { normal: 'standard', expanded: 'detailed' },
  },
  performanceUsage: { kind: 'enum', values: ['compact', 'detailed'] },
  linkOpening: { kind: 'enum', values: ['sidebar', 'new-tab'] },
});

/** Numeric resource limits that migrate under their own name, with bounds. */
const OFFICE_LIMITS = Object.freeze({
  maxInputBytes: { integer: true, min: 1, max: 268435456 },
  maxUncompressedBytes: { integer: true, min: 1, max: 1073741824 },
  maxZipEntries: { integer: true, min: 1, max: 10000 },
  maxExtractedChars: { integer: true, min: 1, max: 1000000 },
  maxPdfPagePixels: { integer: true, min: 1, max: 16000000 },
  maxPdfRenderScale: { integer: false, min: 0.1, max: 4 },
});

/**
 * Old grouped endpoint blocks and the flat fields plus credential references
 * that replace them. The reference names are the ones the plugin resolves at
 * runtime.
 */
const OFFICE_GROUPS = Object.freeze([
  Object.freeze({ old: 'ocr', prefix: 'ocr', ref: 'DSH_FILE_OFFICE_OCR_API_KEY' }),
  Object.freeze({
    old: 'audioTranscription',
    prefix: 'audio',
    ref: 'DSH_FILE_OFFICE_AUDIO_API_KEY',
  }),
  Object.freeze({
    old: 'videoUnderstanding',
    prefix: 'video',
    ref: 'DSH_FILE_OFFICE_VIDEO_API_KEY',
  }),
]);

/** A limit this phase migrates nowhere even though a similarly named field exists. */
const UNMAPPED_LIMITS = Object.freeze({ maxPdfOcrPages: true });

/* ------------------------------------------------------------------ *
 * Lark
* ------------------------------------------------------------------ */

/**
 * Fields the Lark integration accepts, transcribed from the schema the new
 * bundle re-exports: packages/bundle/lark-integration/src/host/lark/plugin.ts,
 * whose frozen lib/types/index.d.ts matches it exactly. Only the fields this
 * phase explicitly lists migrate, so httpTimeoutMs and cliGraceMs - defined by
 * the schema but unlisted - are held back rather than carried over on the
 * strength of merely existing.
 *
 * `to` marks the four renames. Bounds come from the same schema.
 */
const LARK_FIELDS = Object.freeze({
  appId: { kind: 'identity' },
  appSecretEnv: { kind: 'credential' },
  brand: { kind: 'enum', values: ['feishu', 'lark'] },
  conversationCwd: { kind: 'string' },
  cliTimeoutMs: { kind: 'integer', min: 1000, max: 300000 },
  registrationTimeoutMs: { kind: 'integer', min: 30000, max: 900000 },
  conversationUserOpenId: { kind: 'identity', to: 'authorizedUserOpenId' },
  conversationResponseTimeoutMs: {
    kind: 'integer',
    min: 1000,
    max: 1800000,
    to: 'responseTimeoutMs',
  },
  conversationHandshakeTimeoutMs: {
    kind: 'integer',
    min: 1000,
    max: 300000,
    to: 'handshakeTimeoutMs',
  },
  maxOutputBytes: { kind: 'integer', min: 1024, max: 4194304, to: 'cliMaxOutputBytes' },
});

/**
 * Every field the current Lark schema defines. Used only to tell a field nobody
 * recognised apart from one this phase chose not to migrate.
 */
const LARK_SCHEMA_FIELDS = new Set([
  'appId',
  'appSecretEnv',
  'brand',
  'authorizedUserOpenId',
  'enabled',
  'cliEnabled',
  'conversationCwd',
  'responseTimeoutMs',
  'handshakeTimeoutMs',
  'httpTimeoutMs',
  'cliTimeoutMs',
  'cliMaxOutputBytes',
  'cliGraceMs',
  'registrationTimeoutMs',
]);

/**
 * Written as false whatever the source said. The plugin opens a long-lived
 * connection and can hand the model a subprocess tool, so an imported true
 * would silently attach a production Lark app to this machine. The old value
 * is kept in pending so nothing is lost.
 */
const LARK_FORCED_OFF = Object.freeze(['enabled', 'cliEnabled']);

/** Retired settings: kept for review, never written to the new schema. */
const LARK_RETIRED = new Set(['credentialMode', 'cliConfigDir', 'conversationTimeZone']);

/** Agent presets and permissions need the official roster, not this phase. */
const LARK_ROSTER_KEY = /^(agents?|agentPreset|presets?|permission|permissions|roster)$/i;

/** Any field whose name marks it as a resource limit rather than a setting. */
function isLimitShaped(key) {
  return /^max[A-Z]/.test(key);
}

/**
 * Whether an endpoint may be carried into the converted config.
 *
 * HTTP and HTTPS are both accepted, which is what the old configuration
 * accepted: an endpoint that was already configured over plain HTTP keeps the
 * meaning it had, and this phase adds no rule of its own about which host is
 * reachable over it. The plugin's own validation is stricter about non-loopback
 * HTTP, and that check belongs to the official runtime at startup, not here.
 * This tool never calls the endpoint - it only decides whether the string is
 * worth carrying over.
 *
 * Two things are still refused, because they are not a question of transport:
 * any other scheme, and a URL carrying embedded credentials, which must not
 * reach a report or a pending value.
 */
function isAcceptableEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username !== '' || url.password !== '') return false;
  return true;
}

const OFFICE_GROUP_BY_OLD_KEY = new Map(
  OFFICE_GROUPS.map((group) => [group.old, group]),
);

const DEFAULT_MODEL_FIELDS = Object.freeze(['provider', 'model', 'reasoningEffort']);
const PI_AI_ROUTE_FIELDS = new Set([
  'apiKeyEnv', 'displayName', 'api', 'baseURL', 'models', 'modelOverrides',
  'defaultContextWindow', 'defaultMaxTokens', 'defaultInput', 'reasoning',
]);
const PI_AI_MODEL_FIELDS = new Set([
  'id', 'ownedBy', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts',
]);
const PI_AI_PROTOCOLS = new Set([
  'openai-completions', 'openai-responses', 'anthropic-messages',
]);
const PI_AI_MODALITIES = new Set(['text', 'image']);
const PI_AI_EFFORTS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/**
 * Entry names written for a converted id: the published package names, not the
 * short ids. An id absent from this table is never emitted, because a row with
 * a null name is worse than no row and would break the official profile.
 */
const ENTRY_NAMES = Object.freeze({
  'ui-theme': '@deepseek-ai/dsh-client-ui-theme',
  'ui-chat': '@deepseek-ai/dsh-client-ui-chat',
  'ui-settings-general': '@deepseek-ai/dsh-client-ui-settings-general',
  'ui-settings': '@deepseek-ai/dsh-client-ui-settings',
  'ui-settings-account': '@deepseek-ai/dsh-client-ui-settings-account',
  'file-recognizer-office': '@deepseek-ai/dsh-file-recognizer-office',
  'llm-pi-ai': '@deepseek-ai/dsh-llm-pi-ai',
  'agent-default-model': '@deepseek-ai/dsh-agent-default-model',
  'subagent-model-selection-settings': '@deepseek-ai/dsh-tool-subagent/model-selection-settings',
  permission: '@deepseek-ai/dsh-permission-presets',
  'agent-preset-registry': '@deepseek-ai/dsh-agent-preset-registry',
  lark: '@deepseek-ai/dsh-lark-integration',
});

/* ------------------------------------------------------------------ *
 * strict AST reading
 * ------------------------------------------------------------------ */

const CORE_TAGS = new Set([
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:seq',
]);

/**
 * Parse with the real YAML parser and refuse anything it will not vouch for.
 *
 * The parser reports duplicate keys and multi-document streams as errors and
 * unresolvable tags - `!!js/function` among them - as warnings, so both are
 * checked. Aliases and merge keys are legal YAML that this phase does not
 * accept, so the AST is walked for them rather than hand-scanning the text.
 * The walk also rejects any remaining tagged node, which covers a tag the
 * parser did resolve.
 *
 * Only the parser's `code` is ever read. Its `message` embeds the offending
 * lines, and those lines are configuration values and sometimes credentials.
 */
function parseStrict(text) {
  if (typeof text !== 'string') return { error: 'not-a-string' };
  let doc;
  try {
    doc = YAML.parseDocument(text, {
      schema: 'core',
      uniqueKeys: true,
      prettyErrors: false,
    });
  } catch {
    return { error: 'unparseable' };
  }
  if (doc.errors.length > 0) {
    const first = CODE_REASON.get(doc.errors[0].code) ?? 'yaml-parse-rejected';
    return { error: first };
  }
  for (const warning of doc.warnings) {
    if (warning.code === 'TAG_RESOLVE_FAILED') return { error: 'unknown-tag-rejected' };
  }
  let rejected = null;
  YAML.visit(doc, {
    Alias() {
      rejected ??= 'alias-rejected';
    },
    Scalar(_key, node) {
      if (node.tag !== undefined && !CORE_TAGS.has(node.tag)) {
        rejected ??= 'unknown-tag-rejected';
      }
    },
    Pair(_key, node) {
      // A key that is itself a collection has no faithful plain-value form, so
      // the document is refused and its text kept rather than losing the entry.
      if (!YAML.isScalar(node.key)) {
        rejected ??= REASON.COMPLEX_KEY;
        return;
      }
      if (YAML.isScalar(node.key) && node.key.value === '<<') {
        rejected ??= 'merge-key-rejected';
      }
    },
  });
  if (rejected !== null) return { error: rejected };
  return { doc };
}

function isMapping(node) {
  return node !== null && node !== undefined && YAML.isMap(node);
}

function isSequence(node) {
  return node !== null && node !== undefined && YAML.isSeq(node);
}

function isScalar(node) {
  return node !== null && node !== undefined && YAML.isScalar(node);
}

/**
 * A mapping key exactly as written, unbounded and uncleaned.
 *
 * This is the only form used to build a real object or Map, so a long key, a
 * key with control characters, or a record key that looks like anything at all
 * survives byte for byte. Truncation here would corrupt the data being carried
 * over, which is the opposite of what a display helper is for.
 */
function rawKey(node) {
  if (!isScalar(node)) return null;
  return String(node.value);
}

/**
 * A mapping key reduced to something safe to show in a report field path.
 *
 * Only ever used for a `field` string. It is deliberately lossy, because a
 * report is bounded in size and printable; the untouched original still lives
 * in the parsed data and in `pending`.
 */
function displayKey(node) {
  const text = rawKey(node);
  if (text === null) return null;
  return displaySegment(text);
}

/** The lossy, printable form of a key, for a report field path only. */
function displaySegment(text) {
  const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, '~');
  return cleaned.length > LIMITS.maxKeyLength
    ? `${cleaned.slice(0, LIMITS.maxKeyLength)}~truncated`
    : cleaned;
}

/**
 * Build a field path from raw key segments.
 *
 * `fieldPath` is the display form and goes to a report; `rawFieldPath` is the
 * verbatim form and goes to pending, where a reviewer needs the key exactly as
 * it was written. Both are built from the same segment array, so a key that
 * contains a dot is never re-split and misread.
 */
function fieldPath(...keys) {
  return `$${keys.map((key) => `.${displaySegment(String(key))}`).join('')}`;
}

function rawFieldPath(...keys) {
  return `$${keys.map((key) => `.${String(key)}`).join('')}`;
}

function getKey(mapNode, wanted) {
  for (const pair of mapNode.items) {
    if (isScalar(pair.key) && pair.key.value === wanted) return pair.value;
  }
  return undefined;
}


/** Every key of a mapping as bounded strings, in document order. */
function mapKeys(mapNode) {
  const keys = [];
  for (const pair of mapNode.items) {
    const text = rawKey(pair.key);
    if (text !== null) keys.push(text);
  }
  return keys;
}

/**
 * Read an AST node into a plain value for copying through or for `pending`.
 * Scalars come straight from the node, so nothing resolves a tag; the strict
 * parse has already guaranteed the document carries only core tags. Bounded in
 * depth and node count so a pathological document cannot exhaust memory.
 */
function readPlain(node, state = { nodes: 0 }, depth = 0) {
  if (node === null || node === undefined) return null;
  state.nodes += 1;
  if (state.nodes > LIMITS.maxNodes || depth > LIMITS.maxDepth) {
    throw new RangeError('document exceeds the conversion limits');
  }
  if (YAML.isScalar(node)) return node.value;
  if (YAML.isSeq(node)) {
    return node.items.map((item) => readPlain(item, state, depth + 1));
  }
  if (YAML.isMap(node)) {
    const out = {};
    for (const pair of node.items) {
      const key = rawKey(pair.key);
      // The strict parse already refuses a non-scalar key; throwing here keeps
      // that guarantee local instead of silently dropping the entry.
      if (key === null) throw new RangeError('complex mapping key');
      // defineProperty keeps a literal __proto__ key an own data property that
      // cannot reach a prototype.
      Object.defineProperty(out, key, {
        value: readPlain(pair.value, state, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return null;
}

function isIdentifier(text) {
  return typeof text === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(text);
}

/**
 * An entry id. Wider than a credential reference, which follows the
 * credentials package's own REF_PATTERN, because Cordis entry ids carry
 * hyphens and dots.
 */
function isEntryId(text) {
  return typeof text === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(text);
}

/* ------------------------------------------------------------------ *
 * document readers
 * ------------------------------------------------------------------ */

/**
 * Read the patch sequence into id -> { id, name, configNode, order }.
 *
 * Two things are refused outright, and both make the id unusable rather than
 * merely unconverted:
 *
 *   - An id that appears more than once. Picking the first or the last would be
 *     a guess about which row the user meant, so the whole id is blocked and
 *     every one of its rows keeps its source text in pending.
 *   - A row carrying a key other than id, name or config. Cordis patch entries
 *     can be switched off, filtered or grouped, and this phase does not
 *     understand those directives. Emitting the row and dropping the
 *     directive would turn a disabled entry into an enabled one, so the whole
 *     row is held back and the id is blocked from the legacy document too.
 */
function readPatch(text) {
  const parsed = parseStrict(text);
  if (parsed.error !== undefined) return { error: parsed.error };
  const root = parsed.doc.contents;
  // An empty document is an empty sequence, not a malformed one.
  if (root === null || root === undefined) {
    return { entries: [], duplicateIds: [], blockedIds: [], blocked: [], malformed: [] };
  }
  if (!isSequence(root)) return { error: 'patch-not-a-sequence' };

  const byId = new Map();
  const duplicateIds = new Set();
  const blocked = [];
  const malformed = [];
  let order = 0;
  root.items.forEach((item, index) => {
    order += 1;
    if (!isMapping(item)) {
      malformed.push({ field: `$[${index}]`, source: sourceSlice(text, item) });
      return;
    }
    const idNode = getKey(item, 'id');
    const nameNode = getKey(item, 'name');
    const id = isScalar(idNode) ? rawKey(idNode) : null;
    if (id === null || id === '' || !isEntryId(id)) {
      malformed.push({ field: `$[${index}].id`, source: sourceSlice(text, item) });
      return;
    }
    if (nameNode !== undefined && !isScalar(nameNode)) {
      malformed.push({ field: `$[${index}].name`, source: sourceSlice(text, item) });
      return;
    }
    const unsupported = mapKeys(item).filter((key) => !SUPPORTED_ENTRY_KEYS.has(key));
    if (unsupported.length > 0) {
      blocked.push({ id, reason: REASON.UNSUPPORTED_META, source: sourceSlice(text, item) });
      return;
    }
    if (byId.has(id)) {
      duplicateIds.add(id);
      // Keep the row that was already read as well as this one: a duplicated id
      // is only reviewable if both readings of it survive somewhere.
      blocked.push({
        id,
        reason: REASON.DUP_ID_TEXT,
        source: byId.get(id).source,
      });
      blocked.push({ id, reason: REASON.DUP_ID_TEXT, source: sourceSlice(text, item) });
      return;
    }
    byId.set(id, {
      id,
      name: nameNode === undefined ? null : rawKey(nameNode),
      configNode: getKey(item, 'config') ?? null,
      source: sourceSlice(text, item),
      order,
    });
  });
  for (const id of duplicateIds) byId.delete(id);
  for (const id of new Set(blocked.map((item) => item.id))) byId.delete(id);
  return {
    entries: [...byId.values()],
    duplicateIds: [...duplicateIds],
    blockedIds: [...new Set(blocked.map((item) => item.id))],
    blocked,
    malformed,
  };
}

/** Read the legacy `imported` mapping into id -> configNode, in document order. */
function readLegacy(text) {
  const parsed = parseStrict(text);
  if (parsed.error !== undefined) return { error: parsed.error };
  const root = parsed.doc.contents;
  if (root === null || root === undefined) return { entries: new Map() };
  if (!isMapping(root)) return { error: 'legacy-not-a-mapping' };
  const entries = new Map();
  for (const pair of root.items) {
    const id = rawKey(pair.key);
    if (id === null) continue;
    entries.set(id, pair.value);
  }
  return { entries };
}

/**
 * Read the version-1 credentials document structurally.
 *
 * `refs` values are secrets, so they are carried as opaque strings and are
 * never rendered, logged or reported. Only the shape is validated here: the
 * layout this build reads accepts `version`, `refs` and `records` and nothing
 * else, and `version` must be exactly 1.
 */
function readCredentials(text) {
  const parsed = parseStrict(text);
  if (parsed.error !== undefined) return { error: parsed.error };
  const root = parsed.doc.contents;
  if (root === null || root === undefined) {
    return { version: 1, refs: new Map(), hasRecords: false, unknownKeys: [] };
  }
  if (!isMapping(root)) return { error: 'credentials-not-a-mapping' };
  const unknownKeys = [];
  for (const key of mapKeys(root)) {
    if (key !== 'version' && key !== 'refs' && key !== 'records') unknownKeys.push(key);
  }
  const versionNode = getKey(root, 'version');
  if (!isScalar(versionNode) || versionNode.value !== 1) {
    return { error: 'credentials-version-not-1' };
  }
  const refs = new Map();
  const refsNode = getKey(root, 'refs');
  if (refsNode !== undefined && refsNode !== null) {
    if (!isMapping(refsNode)) return { error: 'credentials-refs-not-a-mapping' };
    for (const pair of refsNode.items) {
      const key = rawKey(pair.key);
      if (key === null) continue;
      // A reference holds a secret string. A non-string value is a document
      // this phase will not reinterpret, so the whole document is refused
      // rather than coerced into something that looks addressable.
      if (!isScalar(pair.value) || typeof pair.value.value !== 'string') {
        return { error: REASON.REF_NOT_STRING };
      }
      refs.set(key, pair.value.value);
    }
  }
  const recordsNode = getKey(root, 'records');
  return {
    version: 1,
    refs,
    hasRecords: recordsNode !== undefined,
    records: recordsNode === undefined ? null : readPlain(recordsNode),
    unknownKeys,
  };
}

/* ------------------------------------------------------------------ *
 * field converters
 * ------------------------------------------------------------------ */

/**
 * The running state one conversion shares: where findings go, and which input
 * an id is being converted from. The source reaches the report only through
 * the reason slug, because a report entry carries nothing else.
 */
function createRun(credentials, credentialsRejected) {
  return {
    credentials,
    credentialsRejected,
    report: [],
    pending: [],
    patch: [],
    from: 'patch',
  };
}

const MIGRATION_REASONS = Object.freeze({
  plain: { patch: REASON.MIGRATED_PATCH, legacy: REASON.MIGRATED_LEGACY },
  renamed: { patch: REASON.RENAMED_PATCH, legacy: REASON.RENAMED_LEGACY },
  remapped: { patch: REASON.REMAPPED_PATCH, legacy: REASON.REMAPPED_LEGACY },
});

function migrated(run, id, field, kind) {
  run.report.push({
    id,
    field,
    status: STATUS.MIGRATED,
    reason: MIGRATION_REASONS[kind][run.from],
  });
}

function hold(run, id, keys, status, reason, value) {
  run.report.push({ id, field: fieldPath(...keys), status, reason });
  if (value !== undefined) {
    run.pending.push({ id, field: rawFieldPath(...keys), reason, value });
  }
}

/**
 * Read one enum or bounded-number field, remapping a legacy value in place.
 *
 * The remap lookup goes through Object.hasOwn: a plain property read would
 * answer for `toString`, `constructor` or any other inherited name, and a
 * document value of `toString` would then be reported as a legitimate
 * remap of a saved legacy mode.
 */
function convertScalarField(run, id, key, spec, value, migrationKind = 'plain') {
  const keys = [key];
  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      hold(run, id, keys, STATUS.REJECTED, REASON.BAD_SHAPE, value);
      return { ok: false };
    }
    migrated(run, id, fieldPath(...keys), migrationKind);
    return { ok: true, value };
  }
  if (spec.kind === 'string') {
    if (typeof value !== 'string') {
      hold(run, id, keys, STATUS.REJECTED, REASON.BAD_SHAPE, value);
      return { ok: false };
    }
    migrated(run, id, fieldPath(...keys), migrationKind);
    return { ok: true, value };
  }
  if (spec.kind === 'enum') {
    if (value === null && spec.nullable === true) {
      migrated(run, id, fieldPath(...keys), migrationKind);
      return { ok: true, value };
    }
    if (typeof value !== 'string') {
      hold(run, id, keys, STATUS.REJECTED, REASON.BAD_ENUM, value);
      return { ok: false };
    }
    const remapped =
      spec.remap !== undefined && Object.hasOwn(spec.remap, value)
        ? spec.remap[value]
        : undefined;
    if (remapped !== undefined) {
      migrated(run, id, fieldPath(...keys), 'remapped');
      return { ok: true, value: remapped };
    }
    if (!spec.values.includes(value)) {
      hold(run, id, keys, STATUS.REJECTED, REASON.BAD_ENUM, value);
      return { ok: false };
    }
    migrated(run, id, fieldPath(...keys), migrationKind);
    return { ok: true, value };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    hold(run, id, keys, STATUS.REJECTED, REASON.BAD_RANGE, value);
    return { ok: false };
  }
  // Integrality comes from the field's own kind, not from a separate flag that
  // a spec could forget to set: fontSize must be an integer, full stop.
  if (spec.kind === 'integer' && !Number.isInteger(value)) {
    hold(run, id, keys, STATUS.REJECTED, REASON.BAD_RANGE, value);
    return { ok: false };
  }
  if (value < spec.min || value > spec.max) {
    hold(run, id, keys, STATUS.REJECTED, REASON.BAD_RANGE, value);
    return { ok: false };
  }
  migrated(run, id, fieldPath(...keys), migrationKind);
  return { ok: true, value };
}

/** Convert a settings namespace whose fields are all enums or bounded numbers. */
function convertSettingsNamespace(run, id, configNode, table) {
  const out = {};
  if (configNode === null) return out;
  if (!isMapping(configNode)) {
    hold(run, id, [], STATUS.REJECTED, REASON.BAD_SHAPE, null);
    return out;
  }
  for (const pair of configNode.items) {
    const key = rawKey(pair.key);
    if (key === null) continue;
    const spec = Object.hasOwn(table, key) ? table[key] : undefined;
    if (spec === undefined) {
      hold(run, id, [key], STATUS.PENDING, REASON.UNKNOWN_FIELD, readPlain(pair.value));
      continue;
    }
    const result = convertScalarField(run, id, key, spec, readPlain(pair.value));
    if (result.ok) out[key] = result.value;
  }
  return out;
}

/**
 * Copy one old reference onto the reference name the plugin resolves today.
 *
 * Returns true only when the endpoint pair may be activated. A reference that
 * is not in the document, or a new reference that already holds a different
 * secret, leaves the pair switched off: activating it would send requests with
 * the wrong key, which is worse than leaving the feature unconfigured.
 *
 * Every refusal is reported through `holdBlock` so the whole old block lands in
 * pending. Reporting only the reference name would lose the endpoint and model
 * the block was carrying, which is exactly what a reviewer needs to see.
 */
function adoptCredentialRef(run, id, group, oldRef, block, holdBlock) {
  if (!isIdentifier(oldRef)) {
    holdBlock(REASON.REF_ABSENT);
    return false;
  }
  const refs = run.credentials.refs;
  if (run.credentialsRejected) {
    holdBlock(REASON.CREDENTIALS_REJECTED);
    return false;
  }
  if (!refs.has(oldRef)) {
    holdBlock(REASON.REF_MISSING);
    return false;
  }
  const secret = refs.get(oldRef);
  if (refs.has(group.ref)) {
    if (refs.get(group.ref) === secret) {
      run.report.push({
        id,
        field: fieldPath(group.old),
        status: STATUS.MIGRATED,
        reason:
          run.from === 'patch' ? REASON.REF_COPIED_PATCH : REASON.REF_COPIED_LEGACY,
      });
      return true;
    }
    // The new reference already belongs to something else. Report the conflict
    // and leave both the reference and the endpoint pair untouched.
    holdBlock(REASON.REF_CONFLICT, STATUS.CONFLICT);
    return false;
  }
  refs.set(group.ref, secret);
  run.report.push({
    id,
    field: fieldPath(group.old),
    status: STATUS.MIGRATED,
    reason: run.from === 'patch' ? REASON.REF_COPIED_PATCH : REASON.REF_COPIED_LEGACY,
  });
  return true;
}

/** The only keys an old endpoint block may carry for this phase to read it. */
const OFFICE_BLOCK_KEYS = new Set(['endpoint', 'model', 'apiKeyEnv']);

function convertOfficeGroup(run, id, group, blockNode) {
  const out = {};
  /**
   * Hold the entire old block, endpoint and model included. Reporting only the
   * reference name would drop the two values that make the block reviewable.
   */
  const holdBlock = (reason, status = STATUS.PENDING) => {
    let value = null;
    try {
      value = readPlain(blockNode);
    } catch {
      value = null;
    }
    hold(run, id, [group.old, 'apiKeyEnv'], status, reason, value);
  };
  if (!isMapping(blockNode)) {
    hold(run, id, [group.old], STATUS.REJECTED, REASON.BAD_SHAPE, null);
    return out;
  }
  const old = readPlain(blockNode);

  // A block carrying a key this phase does not interpret - `disabled`, a filter,
  // anything - is held back whole before a single value is read out of it.
  // Reading the endpoint and model while dropping the directive would switch on
  // a pair the configuration had switched off, and copying the reference would
  // put a credential in the document for a feature that must stay off.
  const unrecognised = Object.keys(old).filter((key) => !OFFICE_BLOCK_KEYS.has(key));
  if (unrecognised.length > 0) {
    holdBlock(REASON.OFFICE_UNKNOWN_POLICY);
    return out;
  }

  const endpoint = old.endpoint;
  const model = old.model;
  const usable =
    typeof endpoint === 'string' &&
    endpoint.trim() !== '' &&
    typeof model === 'string' &&
    model.trim() !== '';

  if (!usable) {
    // A half-configured pair is not completed with a guess.
    holdBlock(REASON.REF_ABSENT);
    return out;
  }
  if (!isAcceptableEndpoint(endpoint)) {
    holdBlock(REASON.BAD_ENDPOINT);
    return out;
  }
  const oldRef = old.apiKeyEnv;
  if (oldRef === undefined || oldRef === null) {
    holdBlock(REASON.REF_ABSENT);
    return out;
  }
  if (!adoptCredentialRef(run, id, group, oldRef, old, holdBlock)) return out;
  out[`${group.prefix}Endpoint`] = endpoint;
  out[`${group.prefix}Model`] = model;
  run.report.push({
    id,
    field: fieldPath(group.old),
    status: STATUS.MIGRATED,
    reason: run.from === 'patch' ? REASON.PAIR_ON_PATCH : REASON.PAIR_ON_LEGACY,
  });
  return out;
}

function convertOffice(run, id, configNode) {
  const out = {};
  if (configNode === null) return out;
  if (!isMapping(configNode)) {
    hold(run, id, [], STATUS.REJECTED, REASON.BAD_SHAPE, null);
    return out;
  }
  for (const pair of configNode.items) {
    const key = rawKey(pair.key);
    if (key === null) continue;
    const group = OFFICE_GROUP_BY_OLD_KEY.get(key);
    if (group !== undefined) {
      Object.assign(out, convertOfficeGroup(run, id, group, pair.value));
      continue;
    }
    if (Object.hasOwn(UNMAPPED_LIMITS, key)) {
      hold(run, id, [key], STATUS.PENDING, REASON.LIMIT_UNMAPPED, readPlain(pair.value));
      continue;
    }
    if (Object.hasOwn(OFFICE_LIMITS, key)) {
      const spec = OFFICE_LIMITS[key];
      const result = convertScalarField(
        run,
        id,
        key,
        {
          kind: spec.integer === true ? 'integer' : 'number',
          min: spec.min,
          max: spec.max,
        },
        readPlain(pair.value),
      );
      if (result.ok) out[key] = result.value;
      continue;
    }
    // A limit this phase does not migrate is held back under its own reason so
    // a reviewer can tell it apart from a field nobody recognised.
    if (isLimitShaped(key)) {
      hold(run, id, [key], STATUS.PENDING, REASON.LIMIT_UNLISTED, readPlain(pair.value));
      continue;
    }
    hold(run, id, [key], STATUS.PENDING, REASON.UNKNOWN_FIELD, readPlain(pair.value));
  }
  return out;
}

/**
 * Convert the Lark entry.
 *
 * Two things are unconditional. The connection and the CLI tool are forced off,
 * so an imported Lark app cannot attach to this machine and the model cannot
 * reach a Lark subprocess, whatever the source file said. And the credential
 * reference is kept by name rather than renamed: the schema accepts any
 * credential ref, so renaming it would point at a reference that does not exist.
 * A reference the document does not hold is reported as the missing credential
 * state it is, and no secret is invented for it.
 */
function convertLark(run, id, configNode) {
  const out = { enabled: false, cliEnabled: false };
  const source = isMapping(configNode) ? configNode : null;

  for (const key of LARK_FORCED_OFF) {
    const old = source === null ? undefined : readPlain(getKey(source, key));
    run.report.push({
      id,
      field: fieldPath(key),
      status: STATUS.MIGRATED,
      reason: REASON.LARK_FORCED_OFF,
    });
    if (old !== undefined) {
      run.pending.push({
        id,
        field: rawFieldPath(key),
        reason: REASON.LARK_FORCED_OFF,
        value: old,
      });
    }
  }

  if (configNode === null) return out;
  if (source === null) {
    hold(run, id, [], STATUS.REJECTED, REASON.BAD_SHAPE, null);
    return out;
  }

  for (const pair of source.items) {
    const key = rawKey(pair.key);
    if (key === null) continue;
    const value = readPlain(pair.value);
    if (LARK_FORCED_OFF.includes(key)) continue;

    if (LARK_RETIRED.has(key)) {
      hold(run, id, [key], STATUS.PENDING, REASON.LARK_RETIRED, value);
      continue;
    }
    if (LARK_ROSTER_KEY.test(key)) {
      hold(run, id, [key], STATUS.PENDING, REASON.LARK_ROSTER, value);
      continue;
    }
    const spec = Object.hasOwn(LARK_FIELDS, key) ? LARK_FIELDS[key] : undefined;
    if (spec === undefined) {
      // A field the current schema defines but this phase does not migrate is
      // reported apart from one nobody recognised.
      const reason = LARK_SCHEMA_FIELDS.has(key) ? REASON.LARK_UNLISTED : REASON.UNKNOWN_FIELD;
      hold(run, id, [key], STATUS.PENDING, reason, value);
      continue;
    }
    const target = spec.to ?? key;
    const renamed = spec.to === undefined ? 'plain' : 'renamed';

    if (spec.kind === 'identity') {
      // The plugin itself refuses to start without a non-empty appId and
      // allowlist id, so neither value is invented here.
      if (typeof value !== 'string' || value.trim() === '') {
        hold(run, id, [key], STATUS.REJECTED, REASON.LARK_IDENTITY, value);
        continue;
      }
      out[target] = value;
      migrated(run, id, fieldPath(key), renamed);
      continue;
    }

    if (spec.kind === 'credential') {
      if (!isIdentifier(value)) {
        hold(run, id, [key], STATUS.REJECTED, REASON.LARK_CREDENTIAL, value);
        continue;
      }
      if (run.credentialsRejected || !run.credentials.refs.has(value)) {
        // The reference is reported by name and left out of the converted
        // config, so nothing can resolve it and no secret is made up for it.
        hold(run, id, [key], STATUS.PENDING, REASON.LARK_CREDENTIAL, value);
        continue;
      }
      out[target] = value;
      migrated(run, id, fieldPath(key), renamed);
      continue;
    }

    if (spec.kind === 'string') {
      if (typeof value !== 'string') {
        hold(run, id, [key], STATUS.REJECTED, REASON.BAD_ENUM, value);
        continue;
      }
      out[target] = value;
      migrated(run, id, fieldPath(key), renamed);
      continue;
    }

    const result = convertScalarField(run, id, key, spec, value, renamed);
    if (result.ok) out[target] = result.value;
  }
  return out;
}

/**
 * A config that is only a default-model selection. No official schema
 * verification has been done for model selection, so it is held back whole
 * rather than rewritten.
 */
function setOwn(record, key, value) {
  Object.defineProperty(record, key, {
    value, enumerable: true, writable: true, configurable: true,
  });
}

function readSupportedValue(run, id, path, node, validate) {
  const value = readPlain(node);
  if (!validate(value)) {
    hold(run, id, path, STATUS.REJECTED, REASON.BAD_SHAPE, value);
    return { ok: false };
  }
    migrated(run, id, fieldPath(...path), 'plain');
  return { ok: true, value };
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isString(value) {
  return typeof value === 'string';
}

function isStringArray(value, accepted) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && accepted.has(item));
}

function isReasoningEfforts(value) {
  if (value === false) return true;
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.some(([key]) => key !== 'off') && entries.every(([key, item]) =>
    PI_AI_EFFORTS.has(key) &&
    (typeof item === 'string' && item.length > 0 || key === 'off' && item === null));
}

function convertPiAiModels(run, id, path, node, overrides = false) {
  if (!isMapping(node)) {
    hold(run, id, path, STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(node));
    return null;
  }
  const out = {};
  for (const pair of node.items) {
    const key = rawKey(pair.key);
    if (key === null) continue;
    const modelPath = [...path, key];
    const result = convertPiAiModel(run, id, modelPath, pair.value, overrides);
    if (result !== null) setOwn(out, key, result);
  }
  return out;
}

function convertPiAiModel(run, id, path, node, override = false) {
  if (!isMapping(node)) {
    hold(run, id, path, STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(node));
    return null;
  }
  if (!override) {
    const idNode = getKey(node, 'id');
    if (!isScalar(idNode) || typeof idNode.value !== 'string') {
      hold(run, id, path, STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(node));
      return null;
    }
  }
  const out = {};
  let hasId = override;
  for (const pair of node.items) {
    const key = rawKey(pair.key);
    if (key === null) continue;
    const fieldPath = [...path, key];
    if (!PI_AI_MODEL_FIELDS.has(key) || (override && key === 'id')) {
      hold(run, id, fieldPath, STATUS.PENDING, REASON.FIELD_NOT_MAPPED, readPlain(pair.value));
      continue;
    }
    const validators = {
      id: isString,
      ownedBy: isString,
      name: isString,
      contextWindow: isPositiveInteger,
      maxTokens: isPositiveInteger,
      input: (value) => isStringArray(value, PI_AI_MODALITIES),
      reasoningEfforts: isReasoningEfforts,
    };
    const converted = readSupportedValue(run, id, fieldPath, pair.value, validators[key]);
    if (!converted.ok) continue;
    setOwn(out, key, converted.value);
    if (key === 'id') hasId = true;
  }
  if (!hasId) {
    hold(run, id, path, STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(node));
    return null;
  }
  return out;
}

function convertPiAiRoute(run, id, route, node) {
  if (!isMapping(node)) {
    hold(run, id, ['providers', route], STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(node));
    return null;
  }
  const out = {};
  for (const pair of node.items) {
    const key = rawKey(pair.key);
    if (key === null) continue;
    const path = ['providers', route, key];
    if (!PI_AI_ROUTE_FIELDS.has(key)) {
      hold(run, id, path, STATUS.PENDING, REASON.FIELD_NOT_MAPPED, readPlain(pair.value));
      continue;
    }
    if (key === 'models' || key === 'modelOverrides') {
      if (key === 'models' && !isSequence(pair.value)) {
        hold(run, id, path, STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(pair.value));
        continue;
      }
      if (key === 'models') {
        const models = [];
        pair.value.items.forEach((item, index) => {
          const model = convertPiAiModel(run, id, [...path, String(index)], item);
          if (model !== null) models.push(model);
        });
        setOwn(out, key, models);
      } else {
        const overrides = convertPiAiModels(run, id, path, pair.value, true);
        if (overrides !== null) setOwn(out, key, overrides);
      }
      continue;
    }
    const validators = {
      apiKeyEnv: isIdentifier,
      displayName: isString,
      api: (value) => typeof value === 'string' && PI_AI_PROTOCOLS.has(value),
      baseURL: (value) => typeof value === 'string' && isAcceptableEndpoint(value),
      defaultContextWindow: isPositiveInteger,
      defaultMaxTokens: isPositiveInteger,
      defaultInput: (value) => isStringArray(value, PI_AI_MODALITIES) && value.length > 0,
      reasoning: (value) => typeof value === 'string' && PI_AI_EFFORTS.has(value),
    };
    const converted = readSupportedValue(run, id, path, pair.value, validators[key]);
    if (converted.ok) setOwn(out, key, converted.value);
  }
  return out;
}

function convertPiAi(run, id, configNode) {
  const out = {};
  if (!isMapping(configNode)) {
    hold(run, id, [], STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(configNode));
    return out;
  }
  for (const pair of configNode.items) {
    const key = rawKey(pair.key);
    if (key === null) continue;
    if (key !== 'providers') {
      hold(run, id, [key], STATUS.PENDING, REASON.FIELD_NOT_MAPPED, readPlain(pair.value));
      continue;
    }
    if (!isMapping(pair.value)) {
      hold(run, id, [key], STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(pair.value));
      continue;
    }
    const providers = {};
    for (const routePair of pair.value.items) {
      const route = rawKey(routePair.key);
      if (route === null) continue;
      if (route.length === 0) {
        hold(run, id, ['providers', route], STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(routePair.value));
        continue;
      }
      const converted = convertPiAiRoute(run, id, route, routePair.value);
      if (converted !== null) setOwn(providers, route, converted);
    }
    setOwn(out, key, providers);
  }
  return out;
}

function convertAgentDefaultModel(run, id, configNode) {
  const out = {};
  if (!isMapping(configNode)) {
    hold(run, id, [], STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(configNode));
    return out;
  }
  const providerNode = getKey(configNode, 'provider');
  const modelNode = getKey(configNode, 'model');
  if (
    !isScalar(providerNode) || typeof providerNode.value !== 'string' ||
    !isScalar(modelNode) || typeof modelNode.value !== 'string'
  ) {
    hold(run, id, [], STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(configNode));
    return out;
  }
  for (const pair of configNode.items) {
    const key = rawKey(pair.key);
    if (key === null) continue;
    if (!DEFAULT_MODEL_FIELDS.includes(key)) {
      hold(run, id, [key], STATUS.PENDING, REASON.FIELD_NOT_MAPPED, readPlain(pair.value));
      continue;
    }
    const converted = readSupportedValue(run, id, [key], pair.value, isString);
    if (converted.ok) setOwn(out, key, converted.value);
  }
  return out;
}

/** Keep only unsupported fields from legacy selection namespaces for review. */
function convertSelectionNamespace(run, id, configNode) {
  if (!isMapping(configNode)) {
    hold(run, id, [], STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(configNode));
    return {};
  }
  const known = id === 'permission'
    ? new Set(['defaultPreset'])
    : new Set(['default', 'modeSelectionEnabled']);
  for (const pair of configNode.items) {
    const key = rawKey(pair.key);
    if (key === null || known.has(key)) continue;
    hold(run, id, [key], STATUS.PENDING, REASON.FIELD_NOT_MAPPED, readPlain(pair.value));
  }
  return {};
}

/** Convert the old onboarding acknowledgement into its current settings owner. */
function convertWelcomeNotice(run, configNode) {
  const id = 'ui-onboarding';
  if (!isMapping(configNode)) {
    hold(run, id, [], STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(configNode));
    return {};
  }
  const out = {};
  for (const pair of configNode.items) {
    const key = rawKey(pair.key);
    if (key === null) continue;
    const value = readPlain(pair.value);
    if (key !== 'welcomeNoticeVersion') {
      hold(run, id, [key], STATUS.PENDING, REASON.UNKNOWN_FIELD, value);
    } else if (typeof value !== 'string') {
      hold(run, id, [key], STATUS.REJECTED, REASON.BAD_SHAPE, value);
    } else {
      out[key] = value;
      migrated(run, id, fieldPath(key), 'renamed');
    }
  }
  return out;
}

/** Convert exact model routes without widening the configured selection. */
function convertSubagentModelSelection(run, id, configNode) {
  if (!isMapping(configNode)) {
    hold(run, id, [], STATUS.REJECTED, REASON.BAD_SHAPE, readPlain(configNode));
    return {};
  }
  const out = {};
  let enabled;
  let allowedModels;
  let allowedModelsValid = false;
  for (const pair of configNode.items) {
    const key = rawKey(pair.key);
    if (key === null) continue;
    const value = readPlain(pair.value);
    if (key === 'enabled') {
      if (typeof value !== 'boolean') {
        hold(run, id, [key], STATUS.REJECTED, REASON.BAD_SHAPE, value);
      } else {
        enabled = value;
      }
      continue;
    }
    if (key === 'allowedModels') {
      if (!Array.isArray(value) || value.some((route) =>
        route === null || typeof route !== 'object' || Array.isArray(route) ||
        Object.keys(route).length !== 2 ||
        typeof route.provider !== 'string' || route.provider.length === 0 ||
        typeof route.model !== 'string' || route.model.length === 0
      )) {
        hold(run, id, [key], STATUS.REJECTED, REASON.BAD_SHAPE, value);
        continue;
      }
      const keys = value.map((route) => `${route.provider}\0${route.model}`);
      if (new Set(keys).size !== keys.length) {
        hold(run, id, [key], STATUS.REJECTED, REASON.BAD_SHAPE, value);
        continue;
      }
      allowedModels = value;
      allowedModelsValid = true;
      continue;
    }
    hold(run, id, [key], STATUS.PENDING, REASON.UNKNOWN_FIELD, value);
  }
  if (enabled === true && (!allowedModelsValid || allowedModels.length === 0)) {
    delete out.enabled;
    const enabledPair = configNode.items.find((pair) => rawKey(pair.key) === 'enabled');
    if (enabledPair) {
      const value = readPlain(enabledPair.value);
      hold(run, id, ['enabled'], STATUS.REJECTED, REASON.BAD_SHAPE, value);
    }
    if (allowedModelsValid) {
      hold(run, id, ['allowedModels'], STATUS.REJECTED, REASON.BAD_SHAPE, allowedModels);
      allowedModelsValid = false;
    }
  }
  if (enabled !== undefined && !(enabled === true && !allowedModelsValid)) out.enabled = enabled;
  if (allowedModelsValid) out.allowedModels = allowedModels;
  if (Object.hasOwn(out, 'enabled')) migrated(run, id, '$.enabled', 'plain');
  if (Object.hasOwn(out, 'allowedModels')) migrated(run, id, '$.allowedModels', 'plain');
  return out;
}

function holdWholeConfig(run, id, configNode, reason) {
  let value = null;
  try {
    value = configNode === null ? null : readPlain(configNode);
  } catch {
    value = null;
  }
  hold(run, id, [], STATUS.PENDING, reason, value);
  return {};
}

function convertId(run, id, configNode) {
  if (id === 'subagent-model-selection-settings') {
    return convertSubagentModelSelection(run, id, configNode);
  }
  if (id === 'llm-pi-ai') return convertPiAi(run, id, configNode);
  if (id === 'agent-default-model') return convertAgentDefaultModel(run, id, configNode);
  if (id === 'permission' || id === 'agent-presets') {
    return convertSelectionNamespace(run, id, configNode);
  }
  if (id === 'lark') {
    return convertLark(run, id, configNode);
  }
  if (id === 'ui-theme') {
    return convertSettingsNamespace(run, id, configNode, THEME_FIELDS);
  }
  if (id === 'ui-settings-general') {
    return convertSettingsNamespace(run, id, configNode, {
      welcomeNoticeVersion: { kind: 'string' },
    });
  }
  if (id === 'ui-settings') {
    return convertSettingsNamespace(run, id, configNode, {
      enabled: { kind: 'boolean' },
    });
  }
  if (id === 'ui-settings-account') {
    return convertSettingsNamespace(run, id, configNode, {
      version: { kind: 'integer', min: 1, max: 1 },
      step: { kind: 'enum', values: ['welcome', 'credit', 'purpose', 'process', 'done'] },
      purpose: { kind: 'enum', values: ['office', 'development', 'both'], nullable: true },
      process: { kind: 'enum', values: ['compact', 'standard', 'detailed'], nullable: true },
      completion: { kind: 'enum', values: ['completed', 'skipped', 'api-key'], nullable: true },
      usage: { kind: 'enum', values: ['compact', 'detailed'] },
      developerTools: { kind: 'boolean' },
    });
  }
  if (id === 'ui-chat') {
    return convertSettingsNamespace(run, id, configNode, CHAT_FIELDS);
  }
  if (id === 'file-recognizer-office') {
    return convertOffice(run, id, configNode);
  }
  holdWholeConfig(run, id, configNode, REASON.UNKNOWN_PLUGIN);
  return {};
}

const SANDBOX_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const APPROVAL_POLICIES = new Set(['ask', 'never']);

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Validate and copy the complete current permission table without old policy data. */
function currentPermissionTable(value) {
  if (!isRecord(value) || Object.keys(value).length === 0) return null;
  const copied = {};
  for (const [id, preset] of Object.entries(value)) {
    if (id === 'custom' || id === 'auto' || !isRecord(preset)) return null;
    if (!SANDBOX_MODES.has(preset.sandbox) || !APPROVAL_POLICIES.has(preset.approval)) return null;
    for (const key of Object.keys(preset)) {
      if (!['sandbox', 'approval', 'name', 'description'].includes(key)) return null;
      if ((key === 'name' || key === 'description') && typeof preset[key] !== 'string') return null;
    }
    Object.defineProperty(copied, id, {
      value: { ...preset },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copied;
}

function permissionSemantics(preset) {
  if (!isRecord(preset) || !SANDBOX_MODES.has(preset.sandbox) || !APPROVAL_POLICIES.has(preset.approval)) {
    return null;
  }
  return { sandbox: preset.sandbox, approval: preset.approval };
}

function selectionNode(entries, id, field) {
  const configNode = entries.get(id);
  return configNode === undefined || !isMapping(configNode) ? undefined : getKey(configNode, field);
}

function selectionValue(entries, id, field) {
  const node = selectionNode(entries, id, field);
  return node === undefined ? undefined : readPlain(node);
}

function holdSelection(run, sourceId, field, value, reason, status = STATUS.PENDING) {
  hold(run, sourceId, [field], status, reason, value);
}

function appendSelectionEntry(run, id, config) {
  if (!isRecord(config) || !emittable(id, config) || run.patch.some((entry) => entry.id === id)) return false;
  run.patch.push(entryFor(id, config));
  return true;
}

/** Resolve one setting with the converter's patch-first, no-field-backfill rule. */
function authoritativeSelection(run, patchById, blockedIds, legacyEntries, id, field) {
  const legacyValue = selectionValue(legacyEntries, id, field);
  if (blockedIds.has(id)) {
    if (legacyValue !== undefined) {
      holdSelection(run, id, field, legacyValue, REASON.SELECTION_BLOCKED);
    }
    return null;
  }
  const patchEntry = patchById.get(id);
  if (patchEntry === undefined) {
    return legacyValue === undefined ? null : { value: legacyValue, from: SOURCE_LABELS.legacy };
  }
  const patchField = isMapping(patchEntry.configNode)
    ? getKey(patchEntry.configNode, field)
    : undefined;
  if (patchField === undefined) {
    if (
      legacyValue !== undefined &&
      !run.pending.some((item) => item.id === id && item.field === rawFieldPath(field))
    ) {
      holdSelection(run, id, field, legacyValue, REASON.NOT_RESTORED, STATUS.NOT_RESTORED);
    }
    return null;
  }
  const patchValue = readPlain(patchField);
  if (legacyValue !== undefined && !isDeepStrictEqual(patchValue, legacyValue)) {
    holdSelection(run, id, field, legacyValue, REASON.SELECTION_CONFLICT, STATUS.CONFLICT);
  }
  return { value: patchValue, from: SOURCE_LABELS.patch };
}

/**
 * Migrate only user-selected defaults whose current behavior is explicitly
 * verified. The optional context describes the current deployment; absent or
 * incomplete context leaves source values in `pending`.
 * @param run - conversion output and credential state.
 * @param patchEntries - parsed source profile patch entries.
 * @param legacyEntries - parsed legacy settings namespaces.
 * @param selectionContext - caller-supplied current preset policy and roster.
 */
function migrateSelections(run, patchEntries, blockedIds, legacyEntries, selectionContext) {
  const patchById = new Map(patchEntries.map((entry) => [entry.id, entry]));
  const agentDefault = authoritativeSelection(
    run, patchById, blockedIds, legacyEntries, 'agent-presets', 'default',
  );
  const permissionDefault = authoritativeSelection(
    run, patchById, blockedIds, legacyEntries, 'permission', 'defaultPreset',
  );

  if (permissionDefault !== null) {
    run.from = permissionDefault.from;
    const selected = permissionDefault.value;
    const current = selectionContext?.permission;
    const targetPresets = currentPermissionTable(current?.presets);
    const currentDefault = current?.defaultPreset;
    if (typeof selected !== 'string' || selected.length === 0) {
      holdSelection(run, 'permission', 'defaultPreset', selected, REASON.BAD_ENUM, STATUS.REJECTED);
    } else if (
      current?.complete !== true ||
      targetPresets === null ||
      typeof currentDefault !== 'string' ||
      !Object.hasOwn(targetPresets, currentDefault)
    ) {
      holdSelection(run, 'permission', 'defaultPreset', selected, REASON.SELECTION_CONTEXT);
    } else {
      const sourceEntry = patchById.get('permission');
      const sourceTableNode = !isMapping(sourceEntry?.configNode)
        ? undefined
        : getKey(sourceEntry.configNode, 'presets');
      let sourceTable = null;
      try {
        sourceTable = sourceTableNode === undefined ? null : readPlain(sourceTableNode);
      } catch {
        sourceTable = null;
      }
      const sourcePresets = sourceTable ?? current?.legacyPresets;
      const sourceSemantics = isRecord(sourcePresets) && Object.hasOwn(sourcePresets, selected)
        ? permissionSemantics(sourcePresets[selected])
        : null;
      const targetSemantics = Object.hasOwn(targetPresets, selected)
        ? permissionSemantics(targetPresets[selected])
        : null;
      if (sourceSemantics === null || targetSemantics === null) {
        holdSelection(run, 'permission', 'defaultPreset', selected, REASON.PERMISSION_NOT_FOUND);
      } else if (!isDeepStrictEqual(sourceSemantics, targetSemantics)) {
        holdSelection(run, 'permission', 'defaultPreset', selected, REASON.PERMISSION_SEMANTICS);
      } else if (appendSelectionEntry(run, 'permission', {
        presets: targetPresets,
        defaultPreset: selected,
      })) {
        migrated(run, 'permission', '$.defaultPreset', 'plain');
      } else {
        holdSelection(run, 'permission', 'defaultPreset', selected, REASON.SELECTION_TARGET);
      }
    }
  }

  if (agentDefault !== null) {
    run.from = agentDefault.from;
    const selected = agentDefault.value;
    const savedSelectionEnabled = selectionValue(legacyEntries, 'agent-presets', 'modeSelectionEnabled');
    const selectionEnabled = savedSelectionEnabled ?? true;
    const current = selectionContext?.agentPresets;
    const currentRoster = current?.roster;
    const legacyRoster = current?.legacyRoster;
    const currentDefault = current?.default;
    if (typeof selected !== 'string' || selected.length === 0) {
      holdSelection(run, 'agent-presets', 'default', selected, REASON.BAD_ENUM, STATUS.REJECTED);
    } else if (selectionEnabled !== true) {
      const reason = selectionEnabled === false ? REASON.AGENT_SELECTION_DISABLED : REASON.SELECTION_CONTEXT;
      holdSelection(run, 'agent-presets', 'default', selected, reason);
    } else if (
      current?.complete !== true ||
      !isRecord(currentRoster) ||
      !isRecord(legacyRoster) ||
      typeof currentDefault !== 'string' ||
      !Object.hasOwn(currentRoster, currentDefault)
    ) {
      holdSelection(run, 'agent-presets', 'default', selected, REASON.SELECTION_CONTEXT);
    } else if (patchById.has('agent-preset-registry') || blockedIds.has('agent-preset-registry')) {
      holdSelection(run, 'agent-presets', 'default', selected, REASON.SELECTION_TARGET);
    } else {
      const targetId = current?.semanticMatches?.[selected];
      const sourceFingerprint = legacyRoster[selected];
      const targetFingerprint = typeof targetId === 'string' ? currentRoster[targetId] : undefined;
      if (
        typeof targetId !== 'string' ||
        targetId.length === 0 ||
        !Object.hasOwn(currentRoster, targetId) ||
        typeof sourceFingerprint !== 'string' ||
        sourceFingerprint.length === 0 ||
        typeof targetFingerprint !== 'string' ||
        targetFingerprint.length === 0
      ) {
        holdSelection(run, 'agent-presets', 'default', selected, REASON.AGENT_NOT_FOUND);
      } else if (sourceFingerprint !== targetFingerprint) {
        holdSelection(run, 'agent-presets', 'default', selected, REASON.AGENT_SEMANTICS);
      } else if (appendSelectionEntry(run, 'agent-preset-registry', {
        default: currentDefault,
        selectedDefault: targetId,
      })) {
        migrated(run, 'agent-presets', '$.default', 'plain');
      } else {
        holdSelection(run, 'agent-presets', 'default', selected, REASON.SELECTION_TARGET);
      }
    }
  }
  const savedSelectionEnabled = selectionValue(legacyEntries, 'agent-presets', 'modeSelectionEnabled');
  if (savedSelectionEnabled !== undefined) {
    holdSelection(
      run,
      'agent-presets',
      'modeSelectionEnabled',
      savedSelectionEnabled,
      'legacy-picker-policy-has-no-current-equivalent',
    );
  }
}

/**
 * Fields the legacy config has and the patch config of the same id does not.
 * They are reported as deliberately not restored and copied to `pending`, so
 * the drop is reviewable rather than silent. Nothing here re-adds them.
 */
function reportUnrestoredLegacyFields(run, id, legacyNode, patchNode) {
  if (!isMapping(legacyNode)) return;
  const legacyKeys = mapKeys(legacyNode);
  const patchKeys = patchNode === null ? [] : mapKeys(patchNode);
  for (const key of legacyKeys) {
    if (patchKeys.includes(key)) continue;
    let value = null;
    try {
      value = readPlain(getKey(legacyNode, key));
    } catch {
      value = null;
    }
    hold(run, id, [key], STATUS.NOT_RESTORED, REASON.NOT_RESTORED, value);
  }
}

function entryFor(id, config) {
  return { id, name: ENTRY_NAMES[id] ?? null, config };
}

/**
 * Whether a converted entry may be written to the patch.
 *
 * Both conditions matter. An id with no known package name would need a
 * `name: null` row, and an entry whose every field was held back or refused
 * would carry an empty config; either one on its own is a row the official
 * profile cannot use, so neither is emitted and the material stays in pending.
 */
function emittable(id, config) {
  return Object.hasOwn(ENTRY_NAMES, id) && Object.keys(config).length > 0;
}

/**
 * The original text of one top-level credentials section, sliced out of the
 * source document. A dropped section that cannot be shown verbatim is worse
 * than useless, so this reads the source rather than re-serialising the value.
 */
function unknownCredentialsSection(text, key) {
  const parsed = parseStrict(text);
  if (parsed.error !== undefined) return null;
  const root = parsed.doc.contents;
  if (!isMapping(root)) return null;
  const node = getKey(root, key);
  if (node === undefined || node.range === undefined) return null;
  return text.slice(node.range[0], node.range[1]);
}

/**
 * Run one document's conversion, keeping a failure from taking the report with
 * it.
 *
 * A document deep or wide enough to pass the conversion limits raises a
 * RangeError part way through. Letting that escape would mean no report at all,
 * which is the worst possible outcome: the caller could not even see which
 * document was refused. So the entries and credential references that document
 * produced are rolled back, the document is reported as refused, and its
 * original text is kept in pending for a person to look at.
 *
 * @param {object} run - the running conversion state
 * @param {string} label - which document is being converted
 * @param {string} text - that document's original text
 * @param {() => void} body - the conversion to run
 */
function runDocument(run, label, text, body) {
  const patchLength = run.patch.length;
  const refsBefore = new Map(run.credentials.refs);
  try {
    body();
  } catch (error) {
    const overLimit = error instanceof RangeError;
    run.patch.length = patchLength;
    run.credentials.refs.clear();
    for (const [key, value] of refsBefore) run.credentials.refs.set(key, value);
    run.report.push({
      id: label,
      field: '$',
      status: STATUS.REJECTED,
      reason: overLimit ? REASON.DOC_LIMITS : REASON.DOC_FAILED,
    });
    run.pending.push({
      id: label,
      field: '$',
      reason: overLimit ? REASON.DOC_LIMITS : REASON.DOC_FAILED,
      value: text,
    });
  }
}

const SOURCE_LABELS = Object.freeze({ patch: 'patch', legacy: 'legacy' });

/** The only patch-entry keys this phase knows how to honour. */
const SUPPORTED_ENTRY_KEYS = new Set(['id', 'name', 'config']);

/**
 * The source text of one AST node, sliced out of the document it came from.
 * A row that is held back whole is kept as written rather than re-serialised,
 * so nothing about it is quietly normalised on the way to pending.
 */
function sourceSlice(text, node) {
  if (node === null || node === undefined || node.range === undefined) return null;
  return text.slice(node.range[0], node.range[1]);
}

function readArgument(value, name) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new TypeError(`convert(options): "${name}" must be a string`);
  }
  return value;
}

/**
 * Convert the three legacy documents.
 *
 * Pure: the result is four in-memory values and nothing is read or written
 * outside the arguments. A document that cannot be parsed is not guessed at -
 * its text is kept verbatim in `pending` and the run reports a rejection.
 *
 * @param {object} options - input documents and optional reviewed target context.
 * @param {string} [options.patchText] - legacy Cordis patch YAML.
 * @param {string} [options.legacyText] - legacy imported settings YAML.
 * @param {string} [options.credentialsText] - version-1 credentials YAML.
 * @param {object} [options.selectionContext] - complete current permission table and preset roster.
 * @returns {{patch: object[], credentials: object, pending: object[], report: object[]}}
 */
export function convert(options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('convert(options): options must be an object');
  }
  const patchText = readArgument(options.patchText, 'patchText');
  const legacyText = readArgument(options.legacyText, 'legacyText');
  const credentialsText = readArgument(options.credentialsText, 'credentialsText');

  // The credentials document is read before the run state exists, so its own
  // limit failure is contained here rather than by runDocument().
  let parsedCredentials;
  try {
    parsedCredentials = readCredentials(credentialsText);
  } catch (error) {
    const overLimit = error instanceof RangeError;
    parsedCredentials = { error: overLimit ? REASON.DOC_LIMITS : REASON.DOC_FAILED };
  }
  const credentialsRejected = parsedCredentials.error !== undefined;
  const credentials =
    parsedCredentials.error === undefined
      ? {
          version: 1,
          refs: new Map(parsedCredentials.refs),
          hasRecords: parsedCredentials.hasRecords,
          records: parsedCredentials.records,
        }
      : { version: 1, refs: new Map(), hasRecords: false, records: null };

  const run = createRun(credentials, credentialsRejected);
  const documents = { patch: readPatch(patchText), legacy: readLegacy(legacyText) };

  for (const [label, parsed] of Object.entries(documents)) {
    if (parsed.error === undefined) continue;
    run.report.push({ id: label, field: '$', status: STATUS.REJECTED, reason: REASON.DOC_REJECTED });
    run.pending.push({
      id: label,
      field: '$',
      reason: parsed.error,
      value: label === 'patch' ? patchText : legacyText,
    });
  }
  if (parsedCredentials.error !== undefined) {
    run.report.push({
      id: 'credentials',
      field: '$',
      status: STATUS.REJECTED,
      reason: REASON.DOC_REJECTED,
    });
    run.pending.push({ id: 'credentials', field: '$', reason: parsedCredentials.error, value: credentialsText });
  }
  for (const key of parsedCredentials.unknownKeys ?? []) {
    // Reported *and* kept: an unknown top-level section is dropped from the
    // converted document, so its original text has to survive somewhere.
    run.report.push({
      id: 'credentials',
      field: fieldPath(key),
      status: STATUS.PENDING,
      reason: REASON.UNKNOWN_FIELD,
    });
    run.pending.push({
      id: 'credentials',
      field: rawFieldPath(key),
      reason: REASON.UNKNOWN_FIELD,
      value: unknownCredentialsSection(credentialsText, key),
    });
  }

  const patchEntries = documents.patch.entries ?? [];
  const patchById = new Map(patchEntries.map((entry) => [entry.id, entry]));
  const legacyEntries = documents.legacy.entries ?? new Map();

  for (const item of documents.patch.malformed ?? []) {
    run.report.push({
      id: 'patch',
      field: item.field,
      status: STATUS.REJECTED,
      reason: REASON.BAD_SHAPE,
    });
    // A row that cannot be read is kept as written, so the reader can see what
    // was there rather than only that something was not.
    run.pending.push({
      id: 'patch',
      field: item.field,
      reason: REASON.BAD_SHAPE,
      value: item.source,
    });
  }
  const blockedIds = new Set(documents.patch.blockedIds ?? []);
  for (const item of documents.patch.blocked ?? []) {
    run.report.push({
      id: item.id,
      field: '$',
      status: STATUS.PENDING,
      reason: item.reason,
    });
    run.pending.push({ id: item.id, field: '$', reason: item.reason, value: item.source });
  }

  // The patch is authoritative for every id it carries: the whole config is
  // converted from it and nothing is merged in from the legacy document.
  runDocument(run, 'patch', patchText, () => {
    for (const entry of patchEntries) {
      run.from = SOURCE_LABELS.patch;
      const config = convertId(run, entry.id, entry.configNode);
      if (emittable(entry.id, config)) run.patch.push(entryFor(entry.id, config));
      if (legacyEntries.has(entry.id)) {
        run.from = SOURCE_LABELS.patch;
        reportUnrestoredLegacyFields(run, entry.id, legacyEntries.get(entry.id), entry.configNode);
      }
    }
  });

  // Legacy may only supply an id the patch does not have at all.
  runDocument(run, 'legacy', legacyText, () => {
  for (const [id, configNode] of legacyEntries) {
      // A blocked id is not an absent id. Deleting a duplicate or a row with
      // unsupported metadata leaves the id ambiguous, and letting the legacy
      // document fill it would silently pick one of the readings.
      if (patchById.has(id) || blockedIds.has(id)) continue;
      if (id === 'ui-onboarding') {
        const targetId = 'ui-settings-general';
        if (patchById.has(targetId) || blockedIds.has(targetId) || legacyEntries.has(targetId)) {
          holdWholeConfig(run, id, configNode, REASON.SELECTION_TARGET);
          continue;
        }
        run.from = SOURCE_LABELS.legacy;
        const config = convertWelcomeNotice(run, configNode);
        if (emittable(targetId, config)) run.patch.push(entryFor(targetId, config));
        continue;
      }
      run.from = SOURCE_LABELS.legacy;
      const config = convertId(run, id, configNode);
      if (emittable(id, config)) run.patch.push(entryFor(id, config));
    }
  });

  migrateSelections(run, patchEntries, blockedIds, legacyEntries, options.selectionContext);

  return {
    patch: run.patch,
    credentials: credentialsOutput(credentials),
    pending: run.pending,
    report: run.report,
  };
}

/**
 * The converted credentials document.
 *
 * `records` is omitted entirely when the source had none: the official reader
 * rejects an explicit null, so writing one would produce a document it refuses
 * to load. Reference names and their values are carried through untouched, and
 * a reference this phase did not add is still there for the next one to use.
 */
function credentialsOutput(credentials) {
  const out = { version: 1, refs: Object.fromEntries(credentials.refs) };
  if (credentials.hasRecords) out.records = credentials.records;
  return out;
}

export default convert;
