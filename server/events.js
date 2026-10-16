// One live channel per board. A client is { playerId, send(event, data) }; routes.js wires
// each Server-Sent Events stream to one.

export function createHub() {
  const rooms = new Map(); // boardId -> Set<client>

  function online(boardId) {
    const ids = new Set();
    for (const c of rooms.get(boardId) ?? []) if (c.playerId) ids.add(c.playerId);
    return [...ids];
  }

  return {
    online,

    add(boardId, client) {
      if (!rooms.has(boardId)) rooms.set(boardId, new Set());
      rooms.get(boardId).add(client);
    },

    remove(boardId, client) {
      const room = rooms.get(boardId);
      if (!room) return;
      room.delete(client);
      if (room.size === 0) rooms.delete(boardId);
    },

    /** data may be a function, evaluated once and only when someone is listening. */
    publish(boardId, event, data) {
      const room = rooms.get(boardId);
      if (!room?.size) return;
      let payload = typeof data === 'function' ? data() : data;
      if (payload == null) return;
      if (event === 'state') payload = { ...payload, online: online(boardId) };
      for (const c of room) c.send(event, payload);
    },

    connections: () => [...rooms.values()].reduce((n, r) => n + r.size, 0),
  };
}
