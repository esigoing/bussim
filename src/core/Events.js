// Minimaler Pub/Sub-Bus. Systeme kommunizieren entkoppelt:
// 'doorChanged', 'stopRequested', 'weatherChanged', 'ticketSold', ...

const listeners = new Map();

export const Events = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  },
  emit(type, payload) {
    const set = listeners.get(type);
    if (set) for (const fn of set) fn(payload);
  },
  clear() {
    listeners.clear();
  },
};
