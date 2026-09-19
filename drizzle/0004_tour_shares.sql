-- Freigaben an bestimmte User (per E-Mail → Neon-Auth-User-ID) mit Schreibrecht,
-- plus «alle dürfen bearbeiten» für öffentlich geteilte Touren.
CREATE TABLE "tour_shares" (
	"tour_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"can_write" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tour_shares_tour_id_user_id_pk" PRIMARY KEY("tour_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "tours" ADD COLUMN "public_can_write" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tour_shares" ADD CONSTRAINT "tour_shares_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tour_shares_user_idx" ON "tour_shares" USING btree ("user_id");