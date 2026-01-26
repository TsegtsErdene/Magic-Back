const axios = require('axios');

/**
 * Dynamics 365 Web API-д хандах OAuth 2.0 access token авах
 * Client Credentials flow ашиглана
 */
async function getDynamicsAccessToken() {
  const tenant = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const dynamicsUrl = process.env.DYNAMICS_INSTANCE_URL || 'https://magicgroup.crm5.dynamics.com';

  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('scope', `${dynamicsUrl}/.default`);
  params.append('grant_type', 'client_credentials');

  const { data } = await axios.post(url, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return data.access_token;
}

/**
 * Dynamics 365 Web API руу GET request илгээх
 */
async function dynamicsGet(endpoint, queryParams = {}) {
  const token = await getDynamicsAccessToken();
  const dynamicsUrl = process.env.DYNAMICS_INSTANCE_URL || 'https://magicgroup.crm5.dynamics.com';

  const url = new URL(`${dynamicsUrl}/api/data/v9.2/${endpoint}`);
  Object.entries(queryParams).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  try {
    const { data } = await axios.get(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'Prefer': 'odata.include-annotations="*"'
      }
    });
    return data;
  } catch (error) {
    console.error(`Dynamics GET error - endpoint: ${endpoint}`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Dynamics 365 Web API руу POST request илгээх
 */
async function dynamicsPost(endpoint, body) {
  const token = await getDynamicsAccessToken();
  const dynamicsUrl = process.env.DYNAMICS_INSTANCE_URL || 'https://magicgroup.crm5.dynamics.com';

  const url = `${dynamicsUrl}/api/data/v9.2/${endpoint}`;

  try {
    const response = await axios.post(url, body, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'Prefer': 'return=representation'
      }
    });
    return response.data || { activityid: response.headers['odata-entityid']?.match(/\(([^)]+)\)/)?.[1] };
  } catch (error) {
    console.error(`Dynamics POST error - endpoint: ${endpoint}`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Dynamics 365 Web API ру|у PATCH request илгээх
 */
async function dynamicsPatch(endpoint, body) {
  const token = await getDynamicsAccessToken();
  const dynamicsUrl = process.env.DYNAMICS_INSTANCE_URL || 'https://magicgroup.crm5.dynamics.com';

  const url = `${dynamicsUrl}/api/data/v9.2/${endpoint}`;

  const { data } = await axios.patch(url, body, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8'
    }
  });

  return data;
}

module.exports = {
  getDynamicsAccessToken,
  dynamicsGet,
  dynamicsPost,
  dynamicsPatch
};
