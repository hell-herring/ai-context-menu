import { z } from "zod";
import { EXTRACT_METHODS } from "../storage/schema";
import type { PageExtraction } from "./page";

/** 注入スクリプトの戻り値の検証（ページ側から届く値なので信頼しない） */
export const PageExtractionSchema = z.object({
  title: z.string(),
  url: z.string(),
  text: z.string(),
  method: z.enum(EXTRACT_METHODS),
  originalLength: z.int().nonnegative(),
}) satisfies z.ZodType<PageExtraction>;
