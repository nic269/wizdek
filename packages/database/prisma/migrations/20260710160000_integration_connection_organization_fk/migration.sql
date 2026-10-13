DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "integration_connection" AS connection
    LEFT JOIN "organization" AS organization
      ON organization."id" = connection."organizationId"
    WHERE connection."organizationId" IS NOT NULL
      AND organization."id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot add integration_connection organization foreign key: orphaned organizationId values exist';
  END IF;
END $$;

ALTER TABLE "integration_connection"
ADD CONSTRAINT "integration_connection_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
