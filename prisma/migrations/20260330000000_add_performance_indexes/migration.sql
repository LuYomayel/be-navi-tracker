-- Performance indexes migration
-- Fixes slow queries causing 70s response times on /api/day-score

-- Activity: index for queries filtering by userId + archived + createdAt
CREATE INDEX `activities_userId_idx` ON `activities`(`userId`);
CREATE INDEX `activities_userId_archived_idx` ON `activities`(`userId`, `archived`);

-- NutritionAnalysis: index for queries filtering by userId + date
CREATE INDEX `nutrition_analyses_userId_date_idx` ON `nutrition_analyses`(`userId`, `date`);

-- PhysicalActivity: index for queries filtering by userId + date
CREATE INDEX `physical_activities_userId_date_idx` ON `physical_activities`(`userId`, `date`);

-- Note: index for queries filtering by userId + date
CREATE INDEX `notes_userId_date_idx` ON `notes`(`userId`, `date`);

-- XpLog: indexes for deduplication queries (userId + date + action)
CREATE INDEX `xp_logs_userId_date_idx` ON `xp_logs`(`userId`, `date`);
CREATE INDEX `xp_logs_userId_action_date_idx` ON `xp_logs`(`userId`, `action`, `date`);
