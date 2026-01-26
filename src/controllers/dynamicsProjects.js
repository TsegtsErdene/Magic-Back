const { dynamicsGet } = require('./dynamicsAuth');

/**
 * Компанитай холбоотой проектуудыг татах
 * @param {string|number} companyId - Манай системийн companyId
 * @returns {Promise<Array>} - Проектуудын жагсаалт
 */
async function getProjectsByCompany(companyId) {
  if (!companyId) {
    return [];
  }

  const companyIdStr = String(companyId);

  try {
    // Эхлээд companyId-аар go_clientcompany-ийн GUID олох
    const companyResult = await dynamicsGet('go_clientcompanies', {
      '$select': 'go_clientcompanyid,go_companyid,go_companynamemn',
      '$filter': `go_companyid eq '${companyIdStr}'`,
      '$top': '1'
    });

    if (!companyResult.value || companyResult.value.length === 0) {
      return [];
    }

    const companyGuid = companyResult.value[0].go_clientcompanyid;

    // msdyn_projects entity-ээс _go_companyid_value lookup field-ээр шүүнэ
    const projectsResult = await dynamicsGet('msdyn_projects', {
      '$select': 'msdyn_projectid,msdyn_subject,go_company_name,createdon,statuscode,statecode',
      '$filter': `_go_companyid_value eq ${companyGuid}`,
      '$orderby': 'createdon desc',
      '$top': '50'
    });

    if (!projectsResult.value) {
      return [];
    }

    return projectsResult.value.map(project => ({
      id: project.msdyn_projectid,
      name: project.msdyn_subject || 'Нэргүй проект',
      code: project.go_company_name || '',
      createdOn: project.createdon,
      statusCode: project.statuscode,
      stateCode: project.statecode
    }));
  } catch (err) {
    console.error('Error fetching projects:', err.response?.data || err.message);
    return [];
  }
}

module.exports = {
  getProjectsByCompany
};
