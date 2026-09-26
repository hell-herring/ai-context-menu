import { z } from "zod";
import type { PageExtraction } from "./page";
import type { SelectionExtraction } from "./selection";

// 注入スクリプトの戻り値の検証（ページ側から届く値なので信頼しない）

export const PageExtractionSchema = z.object({
  title: z.string(),
  url: z.string(),
  text: z.string(),
  method: z.enum(["readability", "text"]),
  originalLength: z.int().nonnegative(),
}) satisfies z.ZodType<PageExtraction>;

export const SelectionExtractionSchema = z.object({
  title: z.string(),
  url: z.string(),
  text: z.string(),
  originalLength: z.int().nonnegative(),
  editable: z.boolean(),
}) satisfies z.ZodType<SelectionExtraction>;
