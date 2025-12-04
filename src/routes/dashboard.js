const express = require('express');
const sql = require('mssql');
const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();

const dbConfig = {
    user: process.env.AZURE_SQL_USER,
    password: process.env.AZURE_SQL_PASSWORD,
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    port: parseInt(process.env.AZURE_SQL_PORT) || 1433,
    options: {
        encrypt: true,
        trustServerCertificate: false
    }
};

router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const companyName = req.user ? req.user.companyName : null;

        if (!companyName) {
            return res.status(401).json({ error: "Company not identified. Please login." });
        }

        const pool = await sql.connect(dbConfig);

        const scorecardQuery = `
            SELECT
                COUNT(CASE WHEN status <> N'Хэрэггүй' THEN 1 END) AS TotalRequired,
                COUNT(CASE WHEN status = N'Илгээгээгүй' THEN 1 END) AS CountMissing,
                COUNT(CASE WHEN status = N'Хүлээгдэж буй' THEN 1 END) AS CountPending,
                COUNT(CASE WHEN status = N'Баталсан' THEN 1 END) AS CountApproved,
                COUNT(CASE WHEN status IN (N'Шаардлага хангаагүй', N'Дутуу') THEN 1 END) AS CountActionNeeded
            FROM MaterialList
            WHERE companyName = @companyName
        `;

        const missingQuery = `
            SELECT CategoryName, DueDate, comment
            FROM MaterialList
            WHERE status = N'Илгээгээгүй' AND companyName = @companyName
            ORDER BY DueDate ASC
        `;

        const resultScorecard = await pool.request()
            .input('companyName', sql.NVarChar, companyName)
            .query(scorecardQuery);

        const resultMissing = await pool.request()
            .input('companyName', sql.NVarChar, companyName)
            .query(missingQuery);

        res.json({
            stats: resultScorecard.recordset[0],
            missingFiles: resultMissing.recordset
        });

        await pool.close();

    } catch (err) {
        console.error("SQL Error", err);
        res.status(500).json({ error: "Server Error", details: err.message });
    }
});

module.exports = router;