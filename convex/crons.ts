import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "purge-expired-coordinates",
  { hourUTC: 2, minuteUTC: 0 },
  internal.logs.purgeExpiredCoords
);

crons.daily(
  "purge-stale-demo-reviewers",
  { hourUTC: 3, minuteUTC: 0 },
  internal.demo.purgeStaleReviewers
);

crons.daily(
  "archive-stale-master-temps",
  { hourUTC: 4, minuteUTC: 0 },
  internal.users.archiveStaleMasterTemps
);

crons.daily(
  "purge-expired-messages",
  { hourUTC: 5, minuteUTC: 0 },
  internal.messages.purgeExpiredMessages
);

export default crons;
