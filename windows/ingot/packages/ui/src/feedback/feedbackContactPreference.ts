const FEEDBACK_CONTACT_STORAGE_KEY = "cf.feedback.contact";

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readFeedbackContactPreference(
  storage: Storage | null = getStorage(),
): string {
  if (!storage) return "";
  try {
    return storage.getItem(FEEDBACK_CONTACT_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function clearFeedbackContactPreference(
  storage: Storage | null = getStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(FEEDBACK_CONTACT_STORAGE_KEY);
  } catch {
  }
}

export function persistFeedbackContactPreference(
  contact: string,
  storage: Storage | null = getStorage(),
): void {
  const normalized = contact.trim();
  if (!normalized) {
    clearFeedbackContactPreference(storage);
    return;
  }
  if (!storage) return;
  try {
    storage.setItem(FEEDBACK_CONTACT_STORAGE_KEY, normalized);
  } catch {
  }
}

export function rememberFeedbackContactInput(
  contact: string,
  storage: Storage | null = getStorage(),
): string {
  persistFeedbackContactPreference(contact, storage);
  return contact;
}
