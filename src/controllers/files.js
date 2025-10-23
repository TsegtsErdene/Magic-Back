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
    let { categories, filetypes, projects } = req.body;
    const { companyName, username } = req.user;
    const file = req.file;
    const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const categoriesArr = Array.isArray(categories) ? categories : [categories];
    const originalName = decodedName;
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
    const blobName = `${companyName}/${timestamp}-${originalName}`;

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

    if (!file || !companyName) {
      return res.status(400).json({ error: 'File, companyName required' });
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
    const projectstring = Array.isArray(projects)  ? [...new Set(projects)].join(';') : projects;
    await sql.connect(sqlConfig);
    await sql.query`
      INSERT INTO FileMetadata (userId, category, projectID, filetype, filename, blobPath, uploadedAt, status, username)
      VALUES (${companyName}, ${categoriesString}, ${projectstring}, ${filetypesting}, ${originalName}, ${blobName}, GETDATE(), N'Хүлээгдэж буй', ${username})
    `;
    for (const cat of categoriesArr) {
      await sql.query`
        UPDATE MaterialList
        SET status = N'Хүлээгдэж буй'
        WHERE companyName = ${companyName} AND CategoryName = ${cat};
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
    const { companyName } = req.user;
    await sql.connect(sqlConfig);
    const result = await sql.query`
      SELECT id, category, filename, blobPath, uploadedAt, status, comment, username
      FROM FileMetadata
      WHERE userId = ${companyName}
    `;
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
