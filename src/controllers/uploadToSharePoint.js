const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');

function getGraphClient(accessToken) {
  return Client.init({
    authProvider: done => done(null, accessToken),
  });
}

function toValueObjects(categories) {
  return (Array.isArray(categories) ? categories : [categories])
    .filter(v => typeof v === "string" && v.trim().length)
    .map(v => ({ Value: v.trim() }));
}
// 4MB-аас жижиг файлд тохиромжтой
async function uploadSmallFile(client, siteId, driveId, folder, fileBuffer, fileName) {
  return client
    .api(`/sites/${siteId}/drives/${driveId}/root:/${folder}/${fileName}:/content`)
    .put(fileBuffer);
}


// Том файлд (>4MB) таслаж upload хийх
async function uploadLargeFile(client, siteId, driveId, folder, fileBuffer, fileName) {
  const session = await client
    .api(`/sites/${siteId}/drives/${driveId}/root:/${folder}/${fileName}:/createUploadSession`)
    .post({
      item: { '@microsoft.graph.conflictBehavior': 'replace', name: fileName },
    });

  const chunkSize = 1024 * 1024 * 8; // 8MB
  let start = 0;
  let uploadUrl = session.uploadUrl;

  while (start < fileBuffer.length) {
    const end = Math.min(start + chunkSize, fileBuffer.length);
    const chunk = fileBuffer.slice(start, end);
    const contentRange = `bytes ${start}-${end - 1}/${fileBuffer.length}`;

    await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': chunk.length,
        'Content-Range': contentRange,
      },
      body: chunk,
    });

    start = end;
  }

  // Upload дуусахад session GET хийхэд DriveItem буцна:
  const driveItem = await client
    .api(`/sites/${siteId}/drives/${driveId}/root:/${folder}/${fileName}`)
    .get();

  return driveItem;
}

async function uploadToSharePoint(accessToken, siteId, driveId, folder, fileBuffer, fileName, categories) {
  const client = getGraphClient(accessToken);

  const isSmall = fileBuffer.length < 4 * 1024 * 1024; // 4MB
  const uploadRes = isSmall
    ? await uploadSmallFile(client, siteId, driveId, folder, fileBuffer, fileName)
    : await uploadLargeFile(client, siteId, driveId, folder, fileBuffer, fileName);

  // Choice column update (SharePoint талд баганын нэр яг таарч байх ёстой)

  if (categories && categories.length) {
    await client
      .api(`/sites/${siteId}/drives/${driveId}/items/${uploadRes.id}/listitem/fields`)
      .patch({
        Categories: Array.isArray(categories) ? categories : [categories],
        "Categories@odata.type": "Collection(Edm.String)"
      });
      
  }

  return uploadRes;
}

module.exports = { uploadToSharePoint };
