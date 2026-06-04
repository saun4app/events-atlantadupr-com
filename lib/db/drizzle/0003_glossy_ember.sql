ALTER TABLE "app_settings" ADD COLUMN "home_title" text DEFAULT 'Upcoming Events' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "home_subtitle" text DEFAULT 'Atlanta DUPR Pickleball — competitive round robins for serious players' NOT NULL;
