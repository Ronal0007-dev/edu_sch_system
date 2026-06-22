'use strict';
const { parse } = require('csv-parse');
const fs = require('fs');
const { Student, Class, Stream, Department } = require('../models');
const { Op } = require('sequelize');

/**
 * Expected CSV columns (case-insensitive, flexible headers):
 *   fullName | full_name | name
 *   gender   | sex                       (Male/Female, M/F)
 *   class    | class_name | className
 *   stream   | stream_name               (optional)
 *
 * Processes in batches of 50 rows to handle 500+ students without OOM.
 */

// Normalise a header to a canonical key
function normaliseHeader(h) {
  const map = {
    fullname: 'fullName', full_name: 'fullName', name: 'fullName', student_name: 'fullName', studentname: 'fullName',
    gender: 'gender', sex: 'gender',
    class: 'class', class_name: 'class', classname: 'class',
    stream: 'stream', stream_name: 'stream', streamname: 'stream'
  };
  return map[h.toLowerCase().replace(/\s+/g, '_')] || h.toLowerCase();
}

// Normalise gender value
function normaliseGender(v) {
  if (!v) return null;
  const u = v.toString().trim().toUpperCase();
  if (u === 'M' || u === 'MALE')   return 'Male';
  if (u === 'F' || u === 'FEMALE') return 'Female';
  return null;
}

async function importStudentsFromCSV(filePath, departmentId) {
  // Pre-load all classes and streams for the department into memory
  const dept = await Department.findByPk(departmentId);
  if (!dept) throw new Error('Invalid department selected');

  const classes = await Class.findAll({
    where: { departmentId },
    include: ['streams']
  });

  // Build fast lookup maps
  const classMap  = {}; // normalised name → { id, streams: { name → id } }
  classes.forEach(cls => {
    const key = cls.name.trim().toLowerCase();
    const streamMap = {};
    (cls.streams || []).forEach(s => {
      streamMap[s.name.trim().toLowerCase()] = s.id;
    });
    classMap[key] = { id: cls.id, streams: streamMap };
  });

  return new Promise((resolve, reject) => {
    const results = { inserted: 0, skipped: 0, errors: [] };
    const rows = [];

    const parser = parse({
      columns: header => header.map(normaliseHeader),
      skip_empty_lines: true,
      trim: true,
      bom: true,           // handle Excel BOM
      relax_column_count: true
    });

    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        rows.push(record);
      }
    });

    parser.on('error', err => reject(new Error('CSV parse error: ' + err.message)));

    parser.on('end', async () => {
      try {
        const BATCH = 50;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          await processBatch(batch, classMap, results);
        }
        // Clean up uploaded file
        try { fs.unlinkSync(filePath); } catch(e) {}
        resolve(results);
      } catch(err) {
        try { fs.unlinkSync(filePath); } catch(e) {}
        reject(err);
      }
    });

    fs.createReadStream(filePath).pipe(parser);
  });
}

async function processBatch(rows, classMap, results) {
  for (const row of rows) {
    const rowNum = results.inserted + results.skipped + results.errors.length + 1;
    try {
      const fullName = (row.fullName || '').trim();
      const gender   = normaliseGender(row.gender);
      const className = (row.class || '').trim().toLowerCase();
      const streamName = (row.stream || '').trim().toLowerCase();

      // Validate required fields
      if (!fullName) {
        results.errors.push(`Row ${rowNum}: Missing student name`);
        continue;
      }
      if (!gender) {
        results.errors.push(`Row ${rowNum} (${fullName}): Invalid gender "${row.gender}" — use Male/Female or M/F`);
        continue;
      }
      if (!className) {
        results.errors.push(`Row ${rowNum} (${fullName}): Missing class`);
        continue;
      }

      const cls = classMap[className];
      if (!cls) {
        results.errors.push(`Row ${rowNum} (${fullName}): Class "${row.class}" not found in this department`);
        continue;
      }

      let streamId = null;
      if (streamName) {
        streamId = cls.streams[streamName] || null;
        if (!streamId) {
          results.errors.push(`Row ${rowNum} (${fullName}): Stream "${row.stream}" not found in class "${row.class}" — student added without stream`);
          // Don't skip — still add the student without stream
        }
      }

      // Check for duplicate (same name + class)
      const existing = await Student.findOne({
        where: {
          fullName: { [Op.like]: fullName },
          classId: cls.id,
          isActive: true
        }
      });

      if (existing) {
        results.skipped++;
        continue;
      }

      await Student.create({ fullName, gender, classId: cls.id, streamId, isActive: true });
      results.inserted++;
    } catch(err) {
      results.errors.push(`Row ${rowNum}: ${err.message}`);
    }
  }
}

module.exports = { importStudentsFromCSV };
