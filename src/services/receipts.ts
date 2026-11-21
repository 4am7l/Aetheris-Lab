import {
  createdReceiptSchema,
  type CreatedReceipt,
  type PublicReceipt,
} from "../domain";

const prefix = "aetheris.receipt.v1.";
const temporary = new Map<string, CreatedReceipt>();
const listeners = new Set<() => void>();

interface SavedReceipt extends PublicReceipt {
  persistent: boolean;
}

interface ReceiptSnapshot {
  receipts: SavedReceipt[];
  storageUnavailable: boolean;
}

let snapshot: ReceiptSnapshot | undefined;

function readStoredReceipt(id: string) {
  const raw = localStorage.getItem(prefix + id);
  if (!raw) return undefined;
  try {
    const parsed = createdReceiptSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.id === id) return parsed.data;
  } catch {
    // Ignore an unreadable entry without affecting other receipts.
  }
}

function metadata(receipt: CreatedReceipt, persistent: boolean): SavedReceipt {
  const { id, status, createdAt, updatedAt } = receipt;
  return { id, status, createdAt, updatedAt, persistent };
}

function readSnapshot(): ReceiptSnapshot {
  const receipts = new Map(
    [...temporary].map(([id, receipt]) => [id, metadata(receipt, false)]),
  );
  let storageUnavailable = false;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const receipt = readStoredReceipt(key.slice(prefix.length));
      if (receipt) receipts.set(receipt.id, metadata(receipt, true));
    }
  } catch {
    storageUnavailable = true;
  }
  return { receipts: [...receipts.values()], storageUnavailable };
}

function refresh() {
  snapshot = readSnapshot();
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key.startsWith(prefix)) refresh();
}

export function subscribeToReceipts(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}

export function getReceiptSnapshot() {
  return (snapshot ??= readSnapshot());
}

export function saveReceipt(receipt: CreatedReceipt) {
  try {
    localStorage.setItem(prefix + receipt.id, JSON.stringify(receipt));
  } catch {
    temporary.set(receipt.id, receipt);
  }
  refresh();
}

export function getTrackingToken(id: string) {
  if (temporary.has(id)) return temporary.get(id)?.trackingToken;
  try {
    return readStoredReceipt(id)?.trackingToken;
  } catch {
    return undefined;
  }
}

export function forgetReceipt(id: string) {
  if (!temporary.delete(id)) {
    try {
      localStorage.removeItem(prefix + id);
    } catch {
      return false;
    }
  }
  refresh();
  return true;
}
