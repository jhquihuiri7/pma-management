ALTER TABLE "storage_cleanup_jobs"
  ADD COLUMN IF NOT EXISTS "is_directory" boolean DEFAULT false NOT NULL;
