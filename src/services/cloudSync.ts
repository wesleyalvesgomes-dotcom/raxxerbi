type LocalMapping = { key: string; collection: string; shape: 'array' | 'object'; idField?: string };
type LocalRecord = { id: string; data: unknown };
type VersionMap = Record<string, Record<string, string>>;
type SyncConflict = { key: string; collection: string; id: string; detectedAt: string };

export const CLOUD_SYNC_ENABLED_KEY = 'raxxer_cloud_sync_enabled_v1';
export const CLOUD_SYNC_PENDING_ACTIVATION_KEY = 'raxxer_cloud_sync_pending_activation_v1';
export const CLOUD_SYNC_VERSIONS_KEY = 'raxxer_cloud_sync_versions_v1';
export const CLOUD_SYNC_ERROR_KEY = 'raxxer_cloud_sync_last_error_v1';
export const CLOUD_SYNC_CONFLICTS_KEY = 'raxxer_cloud_sync_conflicts_v1';
export const CLOUD_SYNC_STATUS_EVENT = 'raxxer_cloud_sync_status';

export const CLOUD_STORAGE_MAPPINGS: LocalMapping[] = [
  { key: 'sb_profile', collection: 'profile', shape: 'object' },
  { key: 'sb_tasks', collection: 'tasks', shape: 'array' },
  { key: 'sb_goals', collection: 'goals', shape: 'array' },
  { key: 'sb_memories', collection: 'memories', shape: 'array' },
  { key: 'sb_projects', collection: 'projects', shape: 'array' },
  { key: 'sb_daily_history', collection: 'daily_history', shape: 'array', idField: 'data' },
  { key: 'sb_reviews', collection: 'weekly_reviews', shape: 'array' },
  { key: 'raxxer_com_leads', collection: 'commercial_leads', shape: 'array' },
  { key: 'raxxer_com_lead_history', collection: 'commercial_lead_history', shape: 'array' },
  { key: 'raxxer_com_interactions', collection: 'commercial_interactions', shape: 'array' },
  { key: 'raxxer_com_visits', collection: 'commercial_visits', shape: 'array' },
  { key: 'raxxer_com_proposals', collection: 'commercial_proposals', shape: 'array' },
  { key: 'raxxer_com_sales', collection: 'commercial_sales', shape: 'array' },
  { key: 'raxxer_com_goals', collection: 'commercial_goals', shape: 'array' },
];

function readRecords(mapping: LocalMapping): LocalRecord[] {
  const raw = localStorage.getItem(mapping.key);
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (mapping.shape === 'object') {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? [{ id: 'profile', data: value }]
      : [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    if (!item || typeof item !== 'object') return [];
    const id = mapping.idField ? item[mapping.idField] : item.id;
    if (typeof id !== 'string' || !id.trim()) return [];
    if (/^(task|goal|proj|mem|review)-\d+$/.test(id)) return [];
    return [{ id, data: item }];
  });
}

function serializeRecords(mapping: LocalMapping): Map<string, string> {
  return new Map(readRecords(mapping).map((record) => [record.id, JSON.stringify(record.data)]));
}

function readVersions(): VersionMap {
  try {
    return JSON.parse(localStorage.getItem(CLOUD_SYNC_VERSIONS_KEY) || '{}') as VersionMap;
  } catch {
    return {};
  }
}

function writeVersions(versions: VersionMap): void {
  localStorage.setItem(CLOUD_SYNC_VERSIONS_KEY, JSON.stringify(versions));
}

function recordConflict(conflict: SyncConflict): void {
  let conflicts: SyncConflict[] = [];
  try { conflicts = JSON.parse(localStorage.getItem(CLOUD_SYNC_CONFLICTS_KEY) || '[]'); } catch { conflicts = []; }
  if (!conflicts.some((item) => item.collection === conflict.collection && item.id === conflict.id)) {
    conflicts.unshift(conflict);
    localStorage.setItem(CLOUD_SYNC_CONFLICTS_KEY, JSON.stringify(conflicts.slice(0, 100)));
  }
  window.dispatchEvent(new CustomEvent(CLOUD_SYNC_STATUS_EVENT));
}

async function apiRequest(path: string, init: RequestInit): Promise<any> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof body.error === 'string' ? body.error : 'Falha ao sincronizar dados.');
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return body;
}

const previous = new Map<string, Map<string, string>>();
let listenerAttached = false;
let syncInFlight = false;
let syncQueued = false;

function dispatchStatus(): void {
  window.dispatchEvent(new CustomEvent(CLOUD_SYNC_STATUS_EVENT));
}

async function syncMapping(mapping: LocalMapping): Promise<void> {
  const before = previous.get(mapping.key) || new Map<string, string>();
  let current: Map<string, string>;
  try {
    current = serializeRecords(mapping);
  } catch {
    localStorage.setItem(CLOUD_SYNC_ERROR_KEY, 'O armazenamento local contém JSON inválido em ' + mapping.key + '.');
    dispatchStatus();
    return;
  }
  const nextSnapshot = new Map(before);
  const versions = readVersions();
  const collectionVersions = versions[mapping.collection] || {};

  for (const [id, serialized] of current) {
    if (before.get(id) === serialized) continue;
    try {
      const result = await apiRequest('/api/data/' + mapping.collection + '/' + encodeURIComponent(id), {
        method: 'PUT',
        body: JSON.stringify({
          data: JSON.parse(serialized),
          expectedUpdatedAt: collectionVersions[id] || null,
        }),
      });
      if (result.updatedAt) collectionVersions[id] = result.updatedAt;
      else delete collectionVersions[id];
      nextSnapshot.set(id, serialized);
    } catch (error) {
      if ((error as Error & { status?: number }).status === 409) {
        recordConflict({ key: mapping.key, collection: mapping.collection, id, detectedAt: new Date().toISOString() });
      } else {
        localStorage.setItem(CLOUD_SYNC_ERROR_KEY, error instanceof Error ? error.message : 'Falha ao enviar dados para D1.');
      }
    }
  }

  for (const id of before.keys()) {
    if (current.has(id)) continue;
    if (!collectionVersions[id]) {
      nextSnapshot.delete(id);
      continue;
    }
    try {
      await apiRequest('/api/data/' + mapping.collection + '/' + encodeURIComponent(id), {
        method: 'DELETE',
        body: JSON.stringify({ expectedUpdatedAt: collectionVersions[id] }),
      });
      delete collectionVersions[id];
      nextSnapshot.delete(id);
    } catch (error) {
      if ((error as Error & { status?: number }).status === 409) {
        recordConflict({ key: mapping.key, collection: mapping.collection, id, detectedAt: new Date().toISOString() });
      } else if ((error as Error & { status?: number }).status === 404) {
        delete collectionVersions[id];
        nextSnapshot.delete(id);
      } else {
        localStorage.setItem(CLOUD_SYNC_ERROR_KEY, error instanceof Error ? error.message : 'Falha ao remover dados de D1.');
      }
    }
  }

  previous.set(mapping.key, nextSnapshot);
  versions[mapping.collection] = collectionVersions;
  writeVersions(versions);
  dispatchStatus();
}

async function flushChanges(key?: string): Promise<void> {
  if (localStorage.getItem(CLOUD_SYNC_ENABLED_KEY) !== 'true') return;
  if (syncInFlight) {
    syncQueued = true;
    return;
  }
  syncInFlight = true;
  let nextKey = key;
  try {
    localStorage.removeItem(CLOUD_SYNC_ERROR_KEY);
    do {
      syncQueued = false;
      const mappings = nextKey ? CLOUD_STORAGE_MAPPINGS.filter((mapping) => mapping.key === nextKey) : CLOUD_STORAGE_MAPPINGS;
      for (const mapping of mappings) await syncMapping(mapping);
      // If another collection changes while requests are in flight, reconcile all
      // collections on the next pass so the queued event cannot be lost.
      nextKey = undefined;
      dispatchStatus();
    } while (syncQueued);
  } catch (error) {
    localStorage.setItem(CLOUD_SYNC_ERROR_KEY, error instanceof Error ? error.message : 'Falha de sincronização.');
    dispatchStatus();
  } finally {
    syncInFlight = false;
  }
}

/** Call once after initial localStorage hydration. Later local writes sync with optimistic concurrency. */
export function initializeCloudSync(): () => void {
  if (typeof window === 'undefined' || listenerAttached) return () => undefined;
  if (localStorage.getItem(CLOUD_SYNC_PENDING_ACTIVATION_KEY) === 'true') {
    localStorage.setItem(CLOUD_SYNC_ENABLED_KEY, 'true');
    localStorage.removeItem(CLOUD_SYNC_PENDING_ACTIVATION_KEY);
  }
  for (const mapping of CLOUD_STORAGE_MAPPINGS) {
    try { previous.set(mapping.key, serializeRecords(mapping)); }
    catch { previous.set(mapping.key, new Map()); }
  }
  const handleStorageChange = (event: Event) => {
    const detail = (event as CustomEvent<{ key?: string }>).detail;
    if (detail?.key) void flushChanges(detail.key);
  };
  window.addEventListener('raxxer_storage_change', handleStorageChange);
  window.addEventListener('raxxer_commercial_storage_update', handleStorageChange);
  listenerAttached = true;
  return () => {
    window.removeEventListener('raxxer_storage_change', handleStorageChange);
    window.removeEventListener('raxxer_commercial_storage_update', handleStorageChange);
    listenerAttached = false;
  };
}
