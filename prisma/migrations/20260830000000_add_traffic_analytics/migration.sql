-- AlterTable
ALTER TABLE `order` ADD COLUMN `visitCampaign` VARCHAR(120) NULL,
    ADD COLUMN `visitMedium` VARCHAR(24) NULL,
    ADD COLUMN `visitSessionId` VARCHAR(32) NULL,
    ADD COLUMN `visitSource` VARCHAR(120) NULL;

-- CreateTable
CREATE TABLE `Visit` (
    `id` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(32) NOT NULL,
    `visitorId` VARCHAR(32) NOT NULL,
    `day` DATE NOT NULL,
    `source` VARCHAR(120) NOT NULL,
    `medium` VARCHAR(24) NOT NULL,
    `campaign` VARCHAR(120) NULL,
    `referrerHost` VARCHAR(190) NULL,
    `landingPath` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Visit_storeId_day_source_idx`(`storeId`, `day`, `source`),
    UNIQUE INDEX `Visit_storeId_sessionId_key`(`storeId`, `sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Visit` ADD CONSTRAINT `Visit_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

