export const UEX_DEFAULT_BASE = "https://api.uexcorp.uk/2.0";

/** How often the scheduled poller ingests prices (UEX cache TTL is 30 min). */
export const INGEST_INTERVAL_MINUTES = 30;

/** Location types, most general → most specific. Terminals link to the most specific one present. */
export const LOCATION_TYPES = [
  "star_system",
  "planet",
  "moon",
  "city",
  "space_station",
  "outpost",
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
