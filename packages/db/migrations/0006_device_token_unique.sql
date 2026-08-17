-- D16: device auth (Phase 4). token_hash unique so verifyDeviceToken's
-- lookup-by-hash is a point lookup and two devices can never collide.
ALTER TABLE "device" ADD CONSTRAINT "device_token_hash_unique" UNIQUE("token_hash");