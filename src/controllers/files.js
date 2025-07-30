const { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions, SASProtocol } = require('@azure/storage-blob');
const sql = require('mssql');

const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = 'audit-files';
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);

// SQL config
const sqlConfig = {
    user: process.env.AZURE_SQL_USER,
    password: process.env.AZURE_SQL_PASSWORD,
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    options: {
        encrypt: true,
        trustServerCertificate: false,
    },
};



exports.uploadFile = async (req, res) => {
    try {
        // categories[] олон байгаа бол string болгоно!
        let { categories } = req.body;
        const { companyName } = req.user;
        const file = req.file;
        const decodedName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

        // Front-оос FormData ашиглаж явуулахад categories[] нь массив эсвэл string байж болно
        if (Array.isArray(categories)) {
            categories = categories.join(','); // "cat1,cat4,cat5"
        }
        // Хэрэв ганц категори сонгосон бол string хэвээр байна

        if (!file || !companyName || !categories) {
            return res.status(400).json({ error: 'File, companyName, category required' });
        }

        const originalName = decodedName;
        const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
        const blobName = `${companyName}/${timestamp}-${originalName}`;

        const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        await blockBlobClient.uploadData(file.buffer, {
            blobHTTPHeaders: { blobContentType: file.mimetype },
        });

        await sql.connect(sqlConfig);

        // !!! VALUES болон баганы тоог зөв тааруулсан эсэхээ шалгаарай !!!
        await sql.query`
            INSERT INTO FileMetadata (userId, category, filename, blobPath, uploadedAt, status)
            VALUES (${companyName}, ${categories}, ${originalName}, ${blobName}, GETDATE(),  N'Хүлээгдэж буй')
        `;

        res.json({ message: 'File uploaded', blobPath: blobName });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Upload failed', details: err.message });
    }
};

exports.listFiles = async (req, res) => {
    try {
        const { companyName } = req.user;
        await sql.connect(sqlConfig);
        const result = await sql.query`
            SELECT id, category, filename, blobPath, uploadedAt, status, comment FROM FileMetadata
            WHERE userId = ${companyName}
        `;
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getFileUrl = async (req, res) => {
    try {
        console.log(req.user)
        const { blobPath } = req.query;
        const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
        const blobClient = containerClient.getBlobClient(blobPath);

        // SAS URL
        const expiresOn = new Date(new Date().valueOf() + 60 * 60 * 1000); // 1 hour
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
