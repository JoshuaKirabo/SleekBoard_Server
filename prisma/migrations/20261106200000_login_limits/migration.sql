-- CreateTable
CREATE TABLE "login_limits" (
    "key" VARCHAR(255) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "expire" BIGINT,

    CONSTRAINT "login_limits_pkey" PRIMARY KEY ("key")
);

