/** Ensures auth-related columns exist on both existing and fresh PostgreSQL databases. */
const { db } = require("./db");

let ready = null;
function ensureAuthSchema() {
  if (!ready) {
    ready = db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE
    `).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

module.exports = { ensureAuthSchema };
