"use strict";

module.exports = async function addTeacherCustomPermissionsColumn(sequelize) {
  const [columns] = await sequelize.query(
    "SHOW COLUMNS FROM `teachers` LIKE 'customPermissions'",
  );
  if (columns.length) return;

  await sequelize.query(
    "ALTER TABLE `teachers` ADD COLUMN `customPermissions` TEXT NULL",
  );
  console.log("Added teacher customPermissions column");
};
