/** Workforce directory views scoped by organizational hierarchy.
 * This router is mounted before the legacy admin router so GET /users and
 * GET /teams cannot expose cross-department directories to non-admin roles.
 */
const express = require("express");
const { db } = require("../db");
const { requirePerm } = require("../security");
const { isGlobalAdmin, scopedUserIds } = require("../workforce-scope");
const { ensureWorkforceRoleSchema } = require("../workforce-role-schema");

const router = express.Router();
const safeUser = (u) => { const { password_hash, ...rest } = u; return rest; };

router.get("/users", requirePerm("employees", "view"), async (req, res, next) => {
  try {
    await ensureWorkforceRoleSchema();
    if (isGlobalAdmin(req)) {
      const rows = await db.all("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name");
      return res.json(rows.map(safeUser));
    }
    const ids = await scopedUserIds(req);
    if (!ids?.length) return res.json([]);
    const rows = await db.all(
      "SELECT * FROM users WHERE deleted_at IS NULL AND id = ANY($1::int[]) ORDER BY access_level, name",
      [ids],
    );
    res.json(rows.map(safeUser));
  } catch (e) { next(e); }
});

router.get("/teams", requirePerm("employees", "view"), async (req, res, next) => {
  try {
    await ensureWorkforceRoleSchema();
    let teams;
    if (isGlobalAdmin(req)) {
      teams = await db.all("SELECT * FROM teams ORDER BY id");
    } else {
      const ids = await scopedUserIds(req);
      if (!ids?.length) return res.json([]);
      teams = await db.all(
        `SELECT DISTINCT t.*
           FROM teams t JOIN users u ON u.team_id = t.id
          WHERE u.deleted_at IS NULL AND u.id = ANY($1::int[])
          ORDER BY t.id`,
        [ids],
      );
    }
    const out = [];
    for (const t of teams) {
      let members;
      if (isGlobalAdmin(req)) {
        members = await db.all("SELECT id FROM users WHERE team_id = $1 AND deleted_at IS NULL", [t.id]);
      } else {
        const ids = await scopedUserIds(req);
        members = await db.all(
          "SELECT id FROM users WHERE team_id = $1 AND deleted_at IS NULL AND id = ANY($2::int[])",
          [t.id, ids || []],
        );
      }
      out.push({ ...t, member_ids: members.map((m) => m.id) });
    }
    res.json(out);
  } catch (e) { next(e); }
});

module.exports = router;
