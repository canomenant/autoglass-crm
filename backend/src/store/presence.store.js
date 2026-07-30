let sessions = {};

const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

function ping(user, currentPage) {
  sessions[user.id] = {
    userId: user.id,
    userName: user.name,
    role: user.role,
    currentPage: currentPage || "",
    lastSeen: Date.now(),
  };
  return sessions[user.id];
}

function list() {
  const now = Date.now();
  return Object.values(sessions)
    .filter((s) => now - s.lastSeen <= ACTIVE_WINDOW_MS)
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

module.exports = { ping, list };
