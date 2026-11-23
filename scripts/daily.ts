/**
 * Tâche quotidienne autonome : `npm run daily` (ex. via crontab à 7h : 0 7 * * * cd /app && npm run daily).
 * Alternative hébergée : appeler GET /api/cron/daily avec l'en-tête Authorization: Bearer $CRON_SECRET (voir vercel.json).
 */
import { runDailyForAllUsers } from "../src/lib/engine";
import { db } from "../src/lib/db";

const force = process.argv.includes("--force");
runDailyForAllUsers(force)
  .then((r) => { console.log(JSON.stringify(r, null, 2)); })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
