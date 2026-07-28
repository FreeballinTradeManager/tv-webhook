// Base44 → Railway API shim.
// Every page imports { Account, Trade, Strategy, Alert, User } from here
// and calls .list()/.create()/.update()/.delete() exactly as they did on
// Base44. Under the hood we hit our FastAPI on Railway.
//
// The `sort` string arg (e.g. "-created_date") is currently ignored — the
// API returns rows in its own default order. We can wire sorting in later.

import { api } from '../lib/api'

function makeEntity(basePath) {
  return {
    list: async (_sort, _limit) => {
      const data = await api(basePath)
      return Array.isArray(data) ? data : (data.items ?? [])
    },
    get: (id) => api(`${basePath}/${id}`),
    create: (payload) => api(basePath, { method: 'POST', body: payload }),
    update: (id, payload) => api(`${basePath}/${id}`, { method: 'PATCH', body: payload }),
    delete: (id) => api(`${basePath}/${id}`, { method: 'DELETE' }),
  }
}

export const Account = makeEntity('/api/accounts')
export const Group = {
  ...makeEntity('/api/groups'),
  addMember: (groupId, payload) => api(`/api/groups/${groupId}/members`, { method: 'POST', body: payload }),
  updateMember: (groupId, memberId, payload) => api(`/api/groups/${groupId}/members/${memberId}`, { method: 'PATCH', body: payload }),
  deleteMember: (groupId, memberId) => api(`/api/groups/${groupId}/members/${memberId}`, { method: 'DELETE' }),
}
export const Trade = makeEntity('/api/trades')
export const Strategy = {
  ...makeEntity('/api/strategies'),
  alertTemplates: (id) => api(`/api/strategies/${id}/alert-templates`),
}
export const Alert = makeEntity('/api/alerts')
export const Goal = makeEntity('/api/goals')
export const Vault = {
  ...makeEntity('/api/vault'),
  reveal: (id) => api(`/api/vault/${id}/reveal`),  // returns { ..., password: "..." }
}

// User is a singleton (current user) — different shape than the CRUD entities.
export const User = {
  me: () => api('/api/user/me'),
  updateMyUserData: (payload) => api('/api/user/me', { method: 'PATCH', body: payload }),
}

// Global Kill Switch — task #43
export const KillSwitch = {
  status: () => api('/api/kill-switch'),
  set: (on, reason = 'manual', flatten_all = false) =>
    api('/api/kill-switch', { method: 'POST', body: { on, reason, flatten_all } }),
}

// Task #107 — Live Position controls (modify SL/TP, close)
export const PositionControl = {
  modify: (positionId, changes) =>
    api(`/api/positions/${positionId}/modify`, { method: 'PATCH', body: changes }),
  close: (positionId, qty = null, reason = 'manual_close') =>
    api(`/api/positions/${positionId}/close`, { method: 'POST', body: { qty, reason } }),
  brokerSync: (positionId) =>
    api(`/api/positions/${positionId}/broker-sync`),
}
