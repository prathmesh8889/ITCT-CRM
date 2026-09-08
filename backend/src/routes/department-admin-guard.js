/** Custom department metadata is company-level administration.
 * Only L1/L2 may create, rename, disable or delete departments. Membership and
 * role management inside an existing department uses separate scoped routes.
 */
const express = require("express");
const { HttpError } = require("../core");
const { requireAuth } = require("../security");
const { isGlobalAdmin } = require("../workforce-scope");

const router = express.Router();
const globalOnly = (req, _res, next) => isGlobalAdmin(req)
  ? next()
  : next(new HttpError(403, "Only Super Admin/Admin can change department definitions"));

router.post("/departments", requireAuth, globalOnly, (_req, _res, next) => next());
router.patch("/departments/:id", requireAuth, globalOnly, (_req, _res, next) => next());
router.delete("/departments/:id", requireAuth, globalOnly, (_req, _res, next) => next());

module.exports = router;
