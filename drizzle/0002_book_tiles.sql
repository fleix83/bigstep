ALTER TABLE "cards" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "caption" text;--> statement-breakpoint
-- Bestehende Cards mit Bildern werden zu Bilder-Kacheln.
UPDATE "cards" SET "kind" = 'images' WHERE id IN (SELECT DISTINCT card_id FROM images);
