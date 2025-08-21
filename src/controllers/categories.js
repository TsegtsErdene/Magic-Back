const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const sql = require('mssql');

// SQL config-г import хийнэ
const sqlConfig = require('../config/sqlConfig'); // Жишээ, өөрийн config файлаас



exports.listCategories = async (req, res) => {
    const { companyName } = req.user;
    const availableOnly = req.query.availableOnly === '1'; // uploader-ийн сонголт
    if (!companyName) return res.status(400).json({ error: "companyName required" });
    // Жишээ: SQL-ээс уншина
    try {
        await sql.connect(sqlConfig);
        const result = await sql.query`
            SELECT id , CategoryName, status, comment FROM MaterialList WHERE companyName = ${companyName}
        `;

        let rows = result.recordset;

    if (availableOnly) {
      // uploader-ийн сонголтоос 'Хүлээгдэж буй' (already pending) категориудыг нуух
        rows = rows.filter(r => ['Илгээгээгүй', 'Цуцалсан'].includes(r.status || ''));
    }

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch categories', details: err.message });
  }
};