import { api } from "./api";
import { mutate } from "./db";

type ApiTeam = {
  id: number | string;
  name: string;
  focus?: string | null;
  member_ids?: Array<number | string>;
};

function isTeam(value: unknown): value is ApiTeam {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ApiTeam>;
  return row.id !== undefined && typeof row.name === "string";
}

function syncRow(row: ApiTeam): void {
  const id = String(row.id);
  const memberIds = (row.member_ids || []).map(String);
  mutate((db) => {
    const mapped = { id, name: row.name, focus: row.focus || "", memberIds };
    const index = db.teams.findIndex((team) => String(team.id) === id);
    if (index < 0) db.teams.push(mapped);
    else db.teams[index] = mapped;

    // Keep the hydrated employee directory consistent with the real team
    // membership returned by PostgreSQL. The backend remains source of truth.
    for (const user of db.users) {
      if (memberIds.includes(String(user.id))) user.teamId = id;
      else if (String(user.teamId || "") === id) user.teamId = undefined;
    }
  });
}

// Team pages use the generic axios client directly. Synchronize successful team
// responses so a newly created/edited team appears immediately in Employee
// Management without requiring a full browser refresh.
api.interceptors.response.use((response) => {
  const method = String(response.config.method || "get").toLowerCase();
  const url = String(response.config.url || "").split("?")[0];
  const isTeamsRequest = url === "/teams" || /^\/teams\/\d+$/.test(url);
  if (!isTeamsRequest) return response;

  if (method === "get" && Array.isArray(response.data)) {
    for (const row of response.data) if (isTeam(row)) syncRow(row);
  } else if (["post", "patch", "put"].includes(method) && isTeam(response.data)) {
    syncRow(response.data);
  }
  return response;
});
