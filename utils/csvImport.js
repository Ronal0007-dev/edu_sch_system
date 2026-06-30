'use strict';
const { parse } = require('csv-parse');
const fs = require('fs');
const { Student, Class, Department } = require('../models');

/**
 * Expected CSV columns (case-insensitive, flexible headers):
 *   fullName | full_name | name
 *   gender   | sex                       (Male/Female, M/F)
 *   class    | class_name | className
 *   stream   | stream_name               (optional)
 *
 * Designed to comfortably handle 5,000+ rows in one import:
 *  - CSV is parsed as a stream (constant memory regardless of file size)
 *  - Existing students for the department are pre-loaded ONCE into an
 *    in-memory Set for O(1) duplicate checks (no per-row SELECT)
 *  - Valid rows are inserted with Sequelize bulkCreate in chunks of 500,
 *    so a 5,000-row import is ~10 INSERT statements instead of 5,000.
 */

const CHUNK_SIZE = 500;

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
  const dept = await Department.findByPk(departmentId);
  if (!dept) throw new Error('Invalid department selected');

  // Pre-load all classes + streams for this department into memory once.
  const classes = await Class.findAll({
    where: { departmentId },
    include: ['streams']
  });

  const classMap = {}; // normalised class name -> { id, streams: { name -> id } }
  classes.forEach(cls => {
    const key = cls.name.trim().toLowerCase();
    const streamMap = {};
    (cls.streams || []).forEach(s => { streamMap[s.name.trim().toLowerCase()] = s.id; });
    classMap[key] = { id: cls.id, streams: streamMap };
  });

  // Pre-load existing active students for these classes into a Set for O(1)
  // duplicate lookups instead of one SELECT per CSV row.
  const classIds = classes.map(c => c.id);
  const existingStudents = classIds.length
    ? await Student.findAll({
        where: { classId: classIds, isActive: true },
        attributes: ['fullName', 'classId']
      })
    : [];
  const existingSet = new Set(
    existingStudents.map(s => `${s.classId}::${s.fullName.trim().toLowerCase()}`)
  );

  return new Promise((resolve, reject) => {
    const results = { inserted: 0, skipped: 0, errors: [] };
    const toInsert = [];     // valid rows pending insertion
    let rowNum = 0;
    let pendingFlush = Promise.resolve(); // serialises bulk inserts so order/results stay consistent

    const parser = parse({
      columns: header => header.map(normaliseHeader),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true
    });

    function validateRow(row) {
      rowNum++;
      const fullName    = (row.fullName || '').trim();
      const gender      = normaliseGender(row.gender);
      const className   = (row.class || '').trim().toLowerCase();
      const streamName  = (row.stream || '').trim().toLowerCase();

      if (!fullName) { results.errors.push(`Row ${rowNum}: Missing student name`); return; }
      if (!gender)   { results.errors.push(`Row ${rowNum} (${fullName}): Invalid gender "${row.gender}" — use Male/Female or M/F`); return; }
      if (!className){ results.errors.push(`Row ${rowNum} (${fullName}): Missing class`); return; }

      const cls = classMap[className];
      if (!cls) { results.errors.push(`Row ${rowNum} (${fullName}): Class "${row.class}" not found in this department`); return; }

      let streamId = null;
      if (streamName) {
        streamId = cls.streams[streamName] || null;
        if (!streamId) {
          results.errors.push(`Row ${rowNum} (${fullName}): Stream "${row.stream}" not found in class "${row.class}" — added without stream`);
          // still proceed without a stream
        }
      }

      const dedupeKey = `${cls.id}::${fullName.toLowerCase()}`;
      if (existingSet.has(dedupeKey)) { results.skipped++; return; }
      existingSet.add(dedupeKey); // guard against dupes within the same CSV file too

      toInsert.push({ fullName, gender, classId: cls.id, streamId, isActive: true });
    }

    async function flushChunk() {
      if (toInsert.length === 0) return;
      const chunk = toInsert.splice(0, toInsert.length);
      try {
        await Student.bulkCreate(chunk, { validate: true });
        results.inserted += chunk.length;
      } catch (err) {
        results.errors.push(`Batch insert error: ${err.message}`);
      }
    }

    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        validateRow(record);
        if (toInsert.length >= CHUNK_SIZE) {
          // Serialise flushes so we never run two bulkCreate calls concurrently
          pendingFlush = pendingFlush.then(flushChunk);
        }
      }
    });

    parser.on('error', err => reject(new Error('CSV parse error: ' + err.message)));

    parser.on('end', async () => {
      try {
        await pendingFlush;   // wait for any in-flight chunk flush
        await flushChunk();   // flush whatever remains (< CHUNK_SIZE)
        try { fs.unlinkSync(filePath); } catch (e) {}
        resolve(results);
      } catch (err) {
        try { fs.unlinkSync(filePath); } catch (e) {}
        reject(err);
      }
    });

    fs.createReadStream(filePath).pipe(parser);
  });
}

module.exports = { importStudentsFromCSV };
