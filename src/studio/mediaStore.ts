// Video files kept in this browser's IndexedDB. Playlists on the server refer to them by id;
// only the browser that stored a file can play it (through the switcher).

const DB_NAME = 'ggtv-media'
const STORE = 'files'

export type StoredFile = { id: string; name: string; type: string; size: number; addedAt: string; blob: Blob }

let opening: Promise<IDBDatabase> | null = null

function openDb() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      opening = null
      reject(request.error ?? new Error('IndexedDB is unavailable'))
    }
  })
  return opening
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = action(transaction.objectStore(STORE))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error ?? new Error('Storage failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Storage was cancelled (the disk may be full)'))
  })
}

export async function saveFile(file: File) {
  // Ask the browser not to evict our files when space runs low.
  await navigator.storage?.persist?.().catch(() => false)
  const record: StoredFile = {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    type: file.type,
    size: file.size,
    addedAt: new Date().toISOString(),
    blob: file,
  }
  await run('readwrite', (store) => store.put(record))
  return record
}

export async function getFile(id: string) {
  return (await run<StoredFile | undefined>('readonly', (store) => store.get(id))) ?? null
}

export async function hasFiles(ids: string[]) {
  const keys = new Set((await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())).map(String))
  return new Set(ids.filter((id) => keys.has(id)))
}

export async function deleteFile(id: string) {
  await run('readwrite', (store) => store.delete(id))
}

export async function storageUsage() {
  const estimate = await navigator.storage?.estimate?.()
  return estimate ? { used: estimate.usage ?? 0, quota: estimate.quota ?? 0 } : null
}

// Reads a video's length from its metadata, in minutes (0 when the browser can't tell).
export function videoMinutes(blob: Blob) {
  return new Promise<number>((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(blob)
    const done = (minutes: number) => {
      URL.revokeObjectURL(url)
      resolve(minutes)
    }
    video.preload = 'metadata'
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? Math.round((video.duration / 60) * 100) / 100 : 0)
    video.onerror = () => done(0)
    video.src = url
  })
}

export function formatBytes(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}
