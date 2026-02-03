const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} = require('@azure/storage-blob');
const sql = require('mssql');
const { getSharePointAccessToken } = require('./msgraphAuth');
const { getSiteId, getDriveId } = require('./msgraphSites');
const { uploadToSharePoint } = require('./uploadToSharePoint');

// Blob
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = 'audit-files';
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);

// SQL
const sqlConfig = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  server: process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  options: { encrypt: true, trustServerCertificate: false },
};

exports.uploadFile = async (req, res) => {
  let pool;

  try {
    let { categories, filetypes } = req.body;
    const { userGUID, projectGUID } = req.user;
    const file = req.file;

    // =====================
    // Validation
    // =====================
    if (!projectGUID) {
      return res.status(400).json({ error: "Project not selected" });
    }

    if (!file) {
      return res.status(400).json({ error: "File required" });
    }

    if (!categories) {
      return res.status(400).json({ error: "categories is required" });
    }

    if (!filetypes) {
      return res.status(400).json({ error: "filetypes is required" });
    }

    const categoriesArr = Array.isArray(categories) ? categories : [categories];
    const filetypesArr = Array.isArray(filetypes) ? filetypes : [filetypes];

    // =====================
    // File name handling
    // =====================
    const decodedName = Buffer.from(file.originalname, "latin1").toString("utf8");
    const originalName = decodedName;
    const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
    const blobName = `${projectGUID}/${timestamp}-${decodedName}`;

    // =====================
    // 1) Upload to Azure Blob
    // =====================
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(file.buffer, {
      blobHTTPHeaders: { blobContentType: file.mimetype },
    });

    // =====================
    // 2) SQL INSERT (row by row)
    // =====================
pool = await sql.connect(sqlConfig);

for (let i = 0; i < categoriesArr.length; i++) {
  const category = categoriesArr[i];
  const filetype = filetypesArr[i] ?? filetypesArr[0] ?? "";

  // 1️⃣ RequestedDocuments-оос requestDocID авах
  const reqDocResult = await pool.request()
    .input("projectGUID", sql.UniqueIdentifier, projectGUID)
    .input("documentName", sql.NVarChar, category)
    .query(`
      SELECT TOP 1 requestDocID
      FROM RequestedDocuments
      WHERE projectGUID = @projectGUID
        AND documentName = @documentName
      ORDER BY createdAt DESC
    `);

  const requestDocumentID =
    reqDocResult.recordset.length > 0
      ? reqDocResult.recordset[0].requestDocID
      : null;

  // 2️⃣ ReceivedDocuments INSERT
  await pool.request()
    .input("documentName", sql.NVarChar, category)
    .input("projectGUID", sql.UniqueIdentifier, projectGUID)
    .input("documentCategory", sql.NVarChar, filetype)
    .input("filename", sql.NVarChar, originalName)
    .input("blobPath", sql.NVarChar, blobName)
    .input("username", sql.UniqueIdentifier, userGUID)
    .input("requestDocumentID", sql.Int, requestDocumentID)
    .query(`
      INSERT INTO ReceivedDocuments (
        documentName,
        projectGUID,
        documentCategory,
        filename,
        blobPath,
        uploadedAt,
        status,
        username,
        requestDocumentID
      )
      VALUES (
        @documentName,
        @projectGUID,
        @documentCategory,
        @filename,
        @blobPath,
        GETDATE(),
        N'Хүлээгдэж буй',
        @username,
        @requestDocumentID
      )
    `);

  // 3️⃣ RequestedDocuments статус update
  await pool.request()
    .input("projectGUID", sql.UniqueIdentifier, projectGUID)
    .input("documentName", sql.NVarChar, category)
    .query(`
      UPDATE RequestedDocuments
      SET status = N'Хүлээгдэж буй'
      WHERE projectGUID = @projectGUID
        AND documentName = @documentName
    `);
}


    // =====================
    // Response
    // =====================
    res.json({
      message: "Uploaded successfully",
      blobPath: blobName,
      insertedRows: categoriesArr.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Upload failed",
      details: err.message || "Unknown error"
    });
  } finally {
    if (pool) {
      pool.close(); // connection clean
    }
  }
};

exports.listFiles = async (req, res) => {
  try {
  const { projectGUID } = req.user;

  await sql.connect(sqlConfig);

  const result = await sql.query`
    SELECT
      receiveNo,
      documentName,
      documentCategory,
      projectGUID,
      filename,
      blobPath,
      uploadedAt,
      status,
      comment,
      username
    FROM ReceivedDocuments
    WHERE projectGUID = ${projectGUID}
    ORDER BY uploadedAt DESC
  `;
   res.json(result.recordset.map(p => ({
      id: p.receiveNo,
      category: p.documentName || '',
      filename: p.filename || '',
      status: p.status,
      blobPath: p.blobPath,
      uploadedAt: p.uploadedAt,
      comment: p.comment,
      username: p.username
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
};


exports.getFileUrl = async (req, res) => {
  try {
    const { blobPath } = req.query;
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blobClient = containerClient.getBlobClient(blobPath);

    const expiresOn = new Date(Date.now() + 60 * 60 * 1000);
    const sharedKeyCredential = new StorageSharedKeyCredential(
      process.env.AZURE_STORAGE_ACCOUNT_NAME,
      process.env.AZURE_STORAGE_ACCOUNT_KEY
    );
    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: CONTAINER_NAME,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse('r'),
        startsOn: new Date(),
        expiresOn,
        protocol: SASProtocol.Https,
      },
      sharedKeyCredential
    ).toString();

    const url = `${blobClient.url}?${sasToken}`;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Хуучин файлуудыг төсөлтэй холбох
exports.assignProjectToFiles = async (req, res) => {
  try {
    const { companyName } = req.user;
    const { projectId, fileIds } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    await sql.connect(sqlConfig);

    let result;
    if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      // Тодорхой файлуудыг шинэчлэх
      const idList = fileIds.join(',');
      result = await sql.query`
        UPDATE FileMetadata
        SET projectID = ${projectId}
        WHERE userId = ${companyName} AND id IN (${idList})
      `;
    } else {
      // projectID хоосон бүх файлыг шинэчлэх
      result = await sql.query`
        UPDATE FileMetadata
        SET projectID = ${projectId}
        WHERE userId = ${companyName} AND (projectID IS NULL OR projectID = '')
      `;
    }

    res.json({
      message: 'Files updated successfully',
      rowsAffected: result.rowsAffected[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
