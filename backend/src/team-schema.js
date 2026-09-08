/** Department-scoped team metadata. Safe, idempotent migration for the legacy teams table. */
const { db } = require("./db");

let ready = null;

function ensureTeamSchema() {
  if (!ready) {
    ready = (async () => {
      await db.query(`
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS department TEXT DEFAULT '';
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS lead_user_id INT REFERENCES users(id);
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id);
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
        CREATE INDEX IF NOT EXISTS ix_teams_department ON teams(lower(trim(department)));
        CREATE INDEX IF NOT EXISTS ix_teams_lead_user ON teams(lead_user_id);
      `);

      // Preserve legacy teams and infer a department only when every current
      // member belongs to the same non-empty department. Ambiguous teams stay
      // unscoped until an administrator explicitly edits them.
      await db.query(`
        UPDATE teams t
           SET department = x.department,
               updated_at = now()
          FROM (
            SELECT team_id, MIN(department) AS department
              FROM users
             WHERE deleted_at IS NULL
               AND team_id IS NOT NULL
               AND trim(COALESCE(department,'')) <> ''
             GROUP BY team_id
            HAVING COUNT(DISTINCT lower(trim(department))) = 1
          ) x
         WHERE t.id = x.team_id
           AND trim(COALESCE(t.department,'')) = ''
      `);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

module.exports = { ensureTeamSchema };
