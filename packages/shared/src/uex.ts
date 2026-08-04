import { z } from "zod";

/**
 * Tolerant schemas for UEX API 2.0 responses (https://uexcorp.space/api/documentation/).
 *
 * Design rule: require only the fields we genuinely depend on; everything else is optional
 * and nullable. Unknown fields are ignored (zod strips them), and each ingest stores the
 * verbatim payload separately, so schema drift upstream degrades gracefully instead of
 * breaking the pipeline.
 */

/** UEX booleans arrive as 0/1 integers. */
const uexBool = z
  .union([z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) => v === 1 || v === true);

const nullableNumber = z.number().nullable().optional();
const nullableString = z.string().nullable().optional();

/** Every UEX endpoint wraps its payload in { status, data }. */
export const uexEnvelope = z.object({
  status: z.string().optional(),
  data: z.array(z.unknown()).nullable().optional(),
});

export const uexCommodity = z.object({
  id: z.number(),
  id_parent: nullableNumber,
  id_item: nullableNumber,
  uuid: nullableString,
  name: z.string(),
  code: z.string(),
  slug: nullableString,
  kind: nullableString,
  weight_scu: nullableNumber,
  price_buy: nullableNumber,
  price_sell: nullableNumber,
  is_available: uexBool,
  is_available_live: uexBool,
  is_illegal: uexBool,
  is_raw: uexBool,
  is_refined: uexBool,
  is_mineral: uexBool,
  is_harvestable: uexBool,
  is_buyable: uexBool,
  is_sellable: uexBool,
  is_temporary: uexBool,
  is_visible: uexBool,
  wiki: nullableString,
});
export type UexCommodity = z.infer<typeof uexCommodity>;

/** Shared shape for star_systems / planets / moons / cities / space_stations / outposts. */
export const uexLocation = z.object({
  id: z.number(),
  name: z.string(),
  nickname: nullableString,
  code: nullableString,
  id_star_system: nullableNumber,
  id_planet: nullableNumber,
  id_moon: nullableNumber,
  id_city: nullableNumber,
  is_available: uexBool,
});
export type UexLocation = z.infer<typeof uexLocation>;

export const uexTerminal = z.object({
  id: z.number(),
  name: z.string(),
  nickname: nullableString,
  code: nullableString,
  type: nullableString,
  id_star_system: nullableNumber,
  id_planet: nullableNumber,
  id_moon: nullableNumber,
  id_city: nullableNumber,
  id_space_station: nullableNumber,
  id_outpost: nullableNumber,
  is_available: uexBool,
});
export type UexTerminal = z.infer<typeof uexTerminal>;

export const uexPriceRow = z.object({
  id_commodity: z.number(),
  id_terminal: z.number(),
  price_buy: nullableNumber,
  price_buy_min: nullableNumber,
  price_buy_max: nullableNumber,
  price_buy_avg: nullableNumber,
  price_sell: nullableNumber,
  price_sell_min: nullableNumber,
  price_sell_max: nullableNumber,
  price_sell_avg: nullableNumber,
  scu_buy: nullableNumber,
  scu_sell: nullableNumber,
  scu_sell_stock: nullableNumber,
  status_buy: nullableNumber,
  status_sell: nullableNumber,
  volatility_price_buy: nullableNumber,
  volatility_price_sell: nullableNumber,
  quality: nullableNumber,
  game_version: nullableString,
  /** Unix epoch seconds. */
  date_modified: nullableNumber,
});
export type UexPriceRow = z.infer<typeof uexPriceRow>;
