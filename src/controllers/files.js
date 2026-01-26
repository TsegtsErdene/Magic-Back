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
  try {
    let { categories, filetypes } = req.body;
    const { userGUID, projectGUID } = req.user;
    const file = req.file;

    if (!projectGUID) {
      return res.status(400).json({ error: "Project not selected" });
    }

    if (!file) {
      return res.status(400).json({ error: "File required" });
    }

    const categoriesArr = Array.isArray(categories) ? categories : [categories];
    const filetypesArr = Array.isArray(filetypes) ? filetypes : [filetypes];

    const decodedName = Buffer.from(file.originalname, "latin1").toString("utf8");
    const originalName = decodedName;
    const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
    const blobName = `${projectGUID}/${timestamp}-${decodedName}`;
    if (Array.isArray(filetypes)) {
      // SQL-д хадгалах гэж нэг string болгоно
      // Харин SharePoint руу массив байдлаар өгнө
      // (доор массив хэлбэрээр явуулж байгаа)
    } else if (typeof filetypes === 'string') {
      // OK
    } else {
      return res.status(400).json({ error: 'filetypes is required' });
    }

    if (Array.isArray(categories)) {
      // SQL-д хадгалах гэж нэг string болгоно
      // Харин SharePoint руу массив байдлаар өгнө
      // (доор массив хэлбэрээр явуулж байгаа)
    } else if (typeof categories === 'string') {
      // OK
    } else {
      return res.status(400).json({ error: 'categories is required' });
    }

    if (!file ) {
      return res.status(400).json({ error: 'File required' });
    }

    // === 1) Azure Blob руу ===
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(file.buffer, {
      blobHTTPHeaders: { blobContentType: file.mimetype },
    });

    // // === 2) SharePoint руу ===
    // const accessToken = await getSharePointAccessToken();
    // // Эдгээрийг нэг удаа аваад .env-д хадгалж болно.
    // const siteId =
    //   process.env.SHAREPOINT_SITE_ID ||
    //   (await getSiteId(accessToken, process.env.SHAREPOINT_HOSTNAME, process.env.SHAREPOINT_SITE_PATH));
    // const driveId =
    //   process.env.SHAREPOINT_DRIVE_ID ||
    //   (await getDriveId(accessToken, siteId, process.env.SHAREPOINT_DRIVE_NAME || 'Shared Documents'));
    // // Хавтас (companyName/AUA_Uploads/soft гэх мэт өөрөө зохион байгуул)
    // const folder = process.env.SHAREPOINT_FOLDER
    //   ? `${process.env.SHAREPOINT_FOLDER}/${companyName}`
    //   : `AUA_Uploads/${companyName}`;

    // const spRes = await uploadToSharePoint(
    //   accessToken,
    //   siteId,
    //   driveId,
    //   folder,
    //   file.buffer,
    //   timestamp + originalName,
    //   Array.isArray(categories) ? categories : [categories]
    // );

    // === 3) SQL-д ===
    const categoriesString = Array.isArray(categories) ? categories.join(';') : categories;
    const filetypesting = Array.isArray(filetypes)  ? [...new Set(filetypes)].join(';') : filetypes;
    console.log(categoriesString)
    await sql.connect(sqlConfig);
    await sql.query`
      INSERT INTO ReceivedDocuments ( documentName, projectGUID, documentCategory, filename, blobPath, uploadedAt, status, username)
      VALUES (${categoriesString}, ${projectGUID}, ${filetypesting}, ${originalName}, ${blobName}, GETDATE(), N'Хүлээгдэж буй', ${userGUID})
    `;
    for (const cat of categoriesArr) {
      await sql.query`
        UPDATE RequestedDocuments
        SET status = N'Хүлээгдэж буй'
        WHERE projectGUID = ${projectGUID} AND documentName = ${cat};
    `;
  }

    res.json({
      message: 'Uploaded to Blob + SharePoint + SQL',
      blobPath: blobName
    });
  } catch (err) {
    console.error(err?.response?.data || err);
    res.status(500).json({ error: 'Upload failed', details: err.message || 'unknown error' });
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
