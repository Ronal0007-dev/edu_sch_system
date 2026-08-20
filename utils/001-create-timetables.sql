-- Create timetables table (idempotent)
CREATE TABLE IF NOT EXISTS `timetables` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `teacherId` INT NOT NULL,
  `subjectId` INT NOT NULL,
  `day` VARCHAR(20) NOT NULL,
  `startTime` TIME NOT NULL,
  `endTime` TIME NOT NULL,
  `location` VARCHAR(150) DEFAULT NULL,
  `term` VARCHAR(20) NOT NULL,
  `academicYear` VARCHAR(9) NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_timetables_teacher` (`teacherId`),
  INDEX `idx_timetables_subject` (`subjectId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;