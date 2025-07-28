const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const sql = require('mssql');

// SQL config-г import хийнэ
const sqlConfig = require('../config/sqlConfig'); // Жишээ, өөрийн config файлаас



exports.listCategories = async (req, res) => {
    const { companyName } = req.user;
    if (!companyName) return res.status(400).json({ error: "companyName required" });
    // Жишээ: SQL-ээс уншина
    try {
        await sql.connect(sqlConfig);
        const result = await sql.query`
            SELECT id , categoryName, categoryValue FROM Categories WHERE companyName = ${companyName}
        `;
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch categories', details: err.message });
    }
};