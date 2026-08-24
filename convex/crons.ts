import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "purge-expired-coordinates",
  { hourUTC: 2, minuteUTC: 0 },
  internal.logs.purgeExpiredCoords
);

export default crons;
