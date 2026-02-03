const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const sql = require('mssql');

// SQL config-г import хийнэ
const sqlConfig = require('../config/sqlConfig'); // Жишээ, өөрийн config файлаас



exports.listCategories = async (req, res) => {
    const { projectGUID } = req.user;
    const availableOnly = req.query.availableOnly === '1'; // uploader-ийн сонголт
    if (!projectGUID) {
      return res.status(400).json({ error: 'projectGUID required in token' });
    }
    // Жишээ: SQL-ээс уншина
    try {
        await sql.connect(sqlConfig);
        const result = await sql.query`
            SELECT requestDocID ,documentName, documentCategory, projectGUID, status, comment FROM RequestedDocuments WHERE projectGUID = ${projectGUID}
        `;

        let rows = result.recordset;

    if (availableOnly) {
      // uploader-ийн сонголтоос 'Хүлээгдэж буй' (already pending) категориудыг нуух
        rows = rows.filter(r => ['Илгээгээгүй', 'Хүлээгдэж буй','Дутуу','Шаардлага хангаагүй'].includes(r.status || ''));
    }
    res.json(rows.map(p => ({
      id: p.requestDocID,
      filetype: p.documentCategory || '',
      CategoryName: p.documentName || '',
      projectID: p.projectGUID,
      status: p.status,
      comment: p.comment
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch categories', details: err.message });
  }
};