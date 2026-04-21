import { pgTable, serial, timestamp, real, integer, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entriesTable = pgTable("entries", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  glucoseBefore: real("glucose_before").notNull(),
  glucoseAfter: real("glucose_after"),
  carbsGrams: real("carbs_grams").notNull(),
  insulinUnits: real("insulin_units").notNull(),
  mealType: text("meal_type").notNull(),
  mealDescription: text("meal_description"),
  timeDifferenceMinutes: real("time_difference_minutes"),
  delta: real("delta"),
  speed: real("speed"),
  evaluation: text("evaluation"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEntrySchema = createInsertSchema(entriesTable).omit({
  id: true,
  createdAt: true,
  delta: true,
  speed: true,
  evaluation: true,
});

export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type Entry = typeof entriesTable.$inferSelect;
