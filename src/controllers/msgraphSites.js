const axios = require('axios');

async function getSiteId(accessToken, hostname, sitePath) {
  // GET /sites/{hostname}:/sites/{site-path}
  const url = `https://graph.microsoft.com/v1.0/sites/${hostname}:/sites/${sitePath}`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data.id; // siteId
}

async function getDriveId(accessToken, siteId, driveName = 'Documents') {
  // GET /sites/{siteId}/drives
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // ихэнхдээ 'Documents' (Shared Documents) гэж нэртэй байдаг
  const drive = data.value.find(d => d.name === driveName || d.name === 'Shared Documents');
  if (!drive) throw new Error('Drive not found');
  return drive.id;
}

module.exports = { getSiteId, getDriveId };
