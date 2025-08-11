const axios = require('axios');

async function getSharePointAccessToken() {
  const tenant = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('grant_type', 'client_credentials');

  const { data } = await axios.post(url, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return data.access_token; // <-- access token
}

module.exports = { getSharePointAccessToken };
