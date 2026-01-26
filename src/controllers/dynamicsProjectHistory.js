const { dynamicsGet } = require('./dynamicsAuth');

/**
 * GUID формат шалгах
 */
function isValidGuid(str) {
  if (!str || typeof str !== 'string') return false;
  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return guidRegex.test(str);
}

/**
 * Компанитай холбоотой Project History бичлэгүүдийг татах
 * go_clientcompany-ийн Related -> Project History-ээс татна
 * @param {string|number} companyId - Манай системийн companyId
 * @returns {Promise<Array>} - Project History жагсаалт
 */
async function getProjectHistoryByCompany(companyId) {
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
      console.log('Company not found for companyId:', companyIdStr);
      return [];
    }

    const companyGuid = companyResult.value[0].go_clientcompanyid;

    // go_projecthistories entity-ээс тухайн компанитай холбоотой бичлэгүүдийг татах
    const historyResult = await dynamicsGet('go_projecthistories', {
      '$filter': `_go_company_value eq ${companyGuid}`,
      '$orderby': 'createdon desc',
      '$top': '100'
    });

    if (historyResult.value && historyResult.value.length > 0) {
      return historyResult.value.map(record => formatProjectHistoryRecord(record));
    }

    return [];
  } catch (err) {
    console.error('Error fetching project history:', err.response?.data || err.message);
    return [];
  }
}

/**
 * Project History record-ийг форматлах
 * Sample fields:
 * - go_projecthistoryid: ID
 * - go_stepname: "Хянагдаж байна"
 * - _go_schemecode_value@...FormattedValue: "00.0."
 * - _go_resultschemecode_value@...FormattedValue: "04.2."
 * - go_outcomestatus@...FormattedValue: "Completed"
 * - go_startdate, go_enddate
 * - _go_requestno_value@...FormattedValue: "REQ-251127-0228"
 * - go_isclientresponsibility, go_istimeline
 */
function formatProjectHistoryRecord(record) {
  return {
    id: record.go_projecthistoryid || 'unknown',
    projectId: record['_go_requestno_value'] || '',
    projectName: record.go_stepname || record['_go_requestno_value@OData.Community.Display.V1.FormattedValue'] || '-',
    description: record['go_outcomestatus@OData.Community.Display.V1.FormattedValue'] || record.go_outcomedetail || '-',
    changeType: record['_go_schemecode_value@OData.Community.Display.V1.FormattedValue'] || '-',
    oldValue: record['_go_resultschemecode_value@OData.Community.Display.V1.FormattedValue'] || '-',
    newValue: formatDateRange(record.go_startdate, record.go_enddate),
    createdOn: record.createdon || '',
    modifiedOn: record.modifiedon || '',
    createdBy: record['_createdby_value@OData.Community.Display.V1.FormattedValue'] || ''
  };
}

/**
 * Огнооны хүрээ форматлах
 */
function formatDateRange(startDate, endDate) {
  const parts = [];
  if (startDate) {
    parts.push(new Date(startDate).toLocaleDateString('mn-MN'));
  }
  if (endDate) {
    parts.push(new Date(endDate).toLocaleDateString('mn-MN'));
  }
  return parts.length > 0 ? parts.join(' - ') : '-';
}

module.exports = {
  getProjectHistoryByCompany
};
