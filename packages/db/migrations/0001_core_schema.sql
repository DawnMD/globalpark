CREATE TYPE "public"."spot_status" AS ENUM('AVAILABLE', 'OCCUPIED', 'BLOCKED', 'OUT_OF_SERVICE');--> statement-breakpoint
CREATE TYPE "public"."device_kind" AS ENUM('TERMINAL', 'SENSOR', 'GATE');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('HELD', 'EXPIRED', 'CANCELLED', 'CONVERTED');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('ACTIVE', 'ENDED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operator" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "facility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location" geography(Point,4326),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "floor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parking_zone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"held_count" integer DEFAULT 0 NOT NULL,
	"occupied_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_not_exceeded" CHECK ("parking_zone"."held_count" + "parking_zone"."occupied_count" <= "parking_zone"."capacity"),
	CONSTRAINT "counts_not_negative" CHECK ("parking_zone"."held_count" >= 0 AND "parking_zone"."occupied_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parking_spot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"label" text NOT NULL,
	"status" "spot_status" DEFAULT 'AVAILABLE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_plate" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_license_plate_unique" UNIQUE("license_plate")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"kind" "device_kind" NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"status" "reservation_status" DEFAULT 'HELD' NOT NULL,
	"held_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parking_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spot_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"reservation_id" uuid,
	"status" "session_status" DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parking_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"device_id" uuid,
	"local_seq" bigint,
	"response_body" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facility" ADD CONSTRAINT "facility_operator_id_operator_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operator"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "floor" ADD CONSTRAINT "floor_facility_id_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parking_zone" ADD CONSTRAINT "parking_zone_floor_id_floor_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floor"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parking_spot" ADD CONSTRAINT "parking_spot_zone_id_parking_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."parking_zone"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device" ADD CONSTRAINT "device_facility_id_facility_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservation" ADD CONSTRAINT "reservation_zone_id_parking_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."parking_zone"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservation" ADD CONSTRAINT "reservation_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parking_session" ADD CONSTRAINT "parking_session_spot_id_parking_spot_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."parking_spot"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parking_session" ADD CONSTRAINT "parking_session_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parking_session" ADD CONSTRAINT "parking_session_reservation_id_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservation"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "parking_event" ADD CONSTRAINT "parking_event_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "one_active_session_per_spot" ON "parking_session" USING btree ("spot_id") WHERE "parking_session"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "one_active_session_per_vehicle" ON "parking_session" USING btree ("vehicle_id") WHERE "parking_session"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_local_seq_idempotency" ON "parking_event" USING btree ("device_id","local_seq") WHERE "parking_event"."device_id" IS NOT NULL;