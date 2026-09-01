ALTER TABLE "tours" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
-- Die Liste «Von anderen geteilt» filtert auf visibility='public'.
CREATE INDEX "tours_visibility_idx" ON "tours" ("visibility") WHERE "visibility" = 'public';
