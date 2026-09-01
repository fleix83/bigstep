-- Neon-Auth-User-System: tours und settings gehören einem User (JWT `sub`).
-- Bestandsdaten werden dem ersten Konto (Felix) zugeordnet.
ALTER TABLE "tours" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "tours" SET "user_id" = 'b82c7149-6c09-462e-8614-2ce197abdbbc' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "tours" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "tours_user_id_idx" ON "tours" ("user_id");--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "settings" SET "user_id" = 'b82c7149-6c09-462e-8614-2ce197abdbbc' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_pkey";--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_key_pk" PRIMARY KEY("user_id","key");
