import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron(
  "purge-expired-coordinates",
  "0 2 * * *",
  internal.logs.purgeExpiredCoords
);

crons.cron(
  "archive-stale-master-temps",
  "0 4 * * *",
  internal.users.archiveStaleMasterTemps
);

crons.cron(
  "purge-expired-messages",
  "0 5 * * *",
  internal.messages.purgeExpiredMessages
);

export default crons;
