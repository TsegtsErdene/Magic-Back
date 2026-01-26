const { dynamicsGet } = require('./dynamicsAuth');

/**
 * Activity type codes in Dynamics 365
 */
const ACTIVITY_TYPE_CODES = {
  email: 'email',
  task: 'task',
  phonecall: 'phonecall',
  appointment: 'appointment'
};

/**
 * Activity endpoint-үүд (тус тусдаа татах)
 */
const ACTIVITY_ENDPOINTS = {
  email: 'emails',
  task: 'tasks',
  phonecall: 'phonecalls',
  appointment: 'appointments'
};

/**
 * CompanyId (integer) -> Dynamics go_clientcompany GUID mapping cache
 */
const companyGuidCache = new Map();

/**
 * Манай системийн companyId (integer)-г Dynamics 365 go_clientcompany GUID руу хөрвүүлэх
 * @param {string|number} companyId - Манай системийн companyId
 * @returns {Promise<string|null>} - Dynamics GUID эсвэл null
 */
async function getCompanyGuid(companyId) {
  if (!companyId) return null;

  const companyIdStr = String(companyId);

  // Аль хэдийн GUID формат бол шууд буцаах
  if (isValidGuid(companyIdStr)) {
    return companyIdStr;
  }

  // Cache-д байвал буцаах
  if (companyGuidCache.has(companyIdStr)) {
    return companyGuidCache.get(companyIdStr);
  }

  try {
    // go_companyid талбараар шүүж хайх
    const filterResult = await dynamicsGet('go_clientcompanies', {
      '$select': 'go_clientcompanyid,go_companyid,go_companynamemn',
      '$filter': `go_companyid eq '${companyIdStr}'`,
      '$top': '1'
    });

    if (filterResult.value && filterResult.value.length > 0) {
      const company = filterResult.value[0];
      const guid = company.go_clientcompanyid;
      companyGuidCache.set(companyIdStr, guid);
      return guid;
    }

    companyGuidCache.set(companyIdStr, null);
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Нэвтэрсэн хэрэглэгчийн бүх activities татах
 * @param {string} userEmail - Хэрэглэгчийн email хаяг (JWT-ээс)
 * @param {object} options - Pagination, filter options
 */
async function getMyActivities(userEmail, options = {}) {
  const { top = 100, activityType = null, companyId = null, projectId = null } = options;

  // ProjectId GUID формат эсэхийг шалгах - projectId заавал байх ёстой
  const validProjectId = isValidGuid(projectId) ? projectId : null;

  // ProjectId байхгүй бол хоосон буцаах
  if (!validProjectId) {
    return {
      activities: [],
      totalCount: 0,
      hasMore: false
    };
  }

  // CompanyId (integer)-г Dynamics GUID руу хөрвүүлэх
  const dynamicsCompanyGuid = await getCompanyGuid(companyId);

  let allActivities = [];

  // Тодорхой төрөл сонгосон бол зөвхөн түүнийг татах
  if (activityType && ACTIVITY_ENDPOINTS[activityType]) {
    const activities = await fetchActivitiesByType(activityType, userEmail, dynamicsCompanyGuid, projectId, top);
    allActivities = activities;
  } else {
    // Бүх төрлийг зэрэг татах
    const promises = Object.keys(ACTIVITY_ENDPOINTS).map(type =>
      fetchActivitiesByType(type, userEmail, dynamicsCompanyGuid, projectId, Math.ceil(top / 4))
        .catch(err => {
          console.error(`Error fetching ${type}:`, err.message);
          return []; // Алдаа гарвал хоосон array буцаана
        })
    );

    const results = await Promise.all(promises);
    allActivities = results.flat();
  }

  // Огноогоор эрэмбэлэх (шинэ нь эхэнд)
  allActivities.sort((a, b) => new Date(b.createdon) - new Date(a.createdon));

  // Top-оор хязгаарлах
  const limitedActivities = allActivities.slice(0, top);

  return {
    activities: limitedActivities.map(formatActivity),
    totalCount: allActivities.length,
    hasMore: allActivities.length > top
  };
}

/**
 * GUID формат шалгах
 */
function isValidGuid(str) {
  if (!str || typeof str !== 'string') return false;
  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return guidRegex.test(str);
}

/**
 * Тодорхой төрлийн activities татах
 * @param {string} activityType - Activity төрөл
 * @param {string} userEmail - Хэрэглэгчийн email
 * @param {string|null} companyId - Холбогдсон компани ID (regardingobjectid) - GUID байх ёстой
 * @param {string|null} projectId - Сонгосон проектийн ID (Dynamics GUID)
 * @param {number} top - Хэдэн бичлэг авах
 */
async function fetchActivitiesByType(activityType, userEmail, companyId, projectId, top) {
  const endpoint = ACTIVITY_ENDPOINTS[activityType];
  if (!endpoint) return [];

  // CompanyId GUID формат эсэхийг шалгах
  const validCompanyId = isValidGuid(companyId) ? companyId : null;
  // ProjectId GUID формат эсэхийг шалгах
  const validProjectId = isValidGuid(projectId) ? projectId : null;

  const queryParams = {
    '$select': 'activityid,subject,description,createdon,modifiedon,statuscode,statecode,scheduledstart,scheduledend,actualdurationminutes,_regardingobjectid_value',
    '$orderby': 'createdon desc',
    '$top': (top * 3).toString(),
    '$expand': 'email_activity_parties($select=participationtypemask,addressused)'
  };

  // Task болон appointment-д өөр expand хэрэгтэй
  if (activityType === 'task') {
    queryParams['$expand'] = 'task_activity_parties($select=participationtypemask,addressused)';
  } else if (activityType === 'phonecall') {
    queryParams['$expand'] = 'phonecall_activity_parties($select=participationtypemask,addressused)';
  } else if (activityType === 'appointment') {
    queryParams['$expand'] = 'appointment_activity_parties($select=participationtypemask,addressused)';
  }

  // OData filter нэмэх
  const filters = [];

  // CompanyId-аар шүүх (regardingobjectid)
  if (validCompanyId) {
    filters.push(`_regardingobjectid_value eq ${validCompanyId}`);
  }

  // ProjectId-аар шүүх (regardingobjectid нь project байж болно)
  if (validProjectId) {
    filters.push(`_regardingobjectid_value eq ${validProjectId}`);
  }

  if (filters.length > 0) {
    queryParams['$filter'] = filters.join(' or ');
  }

  let result;
  try {
    result = await dynamicsGet(endpoint, queryParams);
  } catch (err) {
    console.error(`Error fetching ${activityType}:`, err.response?.data || err.message);
    return [];
  }

  // Шүүлт: email хаягаар ЭСВЭЛ companyId/projectId-аар
  const filtered = result.value.filter(activity => {
    // ValidCompanyId эсвэл validProjectId (GUID) өгөгдсөн бол OData filter аль хэдийн хийсэн
    if (validCompanyId || validProjectId) {
      return true; // OData filter хийгдсэн тул бүгдийг авах
    }

    // CompanyId/ProjectId өгөөгүй эсвэл GUID биш бол email хаягаар шүүх
    const partiesKey = `${activityType}_activity_parties`;
    const parties = activity[partiesKey] || [];
    return parties.some(p =>
      p.addressused && p.addressused.toLowerCase().includes(userEmail.toLowerCase())
    );
  }).map(activity => ({
    ...activity,
    activitytypecode: activityType,
    _parties: activity[`${activityType}_activity_parties`] || []
  }));

  return filtered.slice(0, top);
}

/**
 * Нэг activity-ийн дэлгэрэнгүй мэдээлэл
 */
async function getActivityById(activityId) {
  const queryParams = {
    '$select': 'activityid,subject,description,activitytypecode,createdon,modifiedon,statuscode,statecode,scheduledstart,scheduledend,actualdurationminutes,_regardingobjectid_value',
    '$expand': 'activitypointer_activity_parties($select=participationtypemask,addressused)'
  };

  let result;
  try {
    result = await dynamicsGet(`activitypointers(${activityId})`, queryParams);
  } catch (err) {
    console.error(`getActivityById failed for ${activityId}:`, err.response?.status, err.response?.data || err.message);
    throw new Error(`Activity not found or access denied: ${activityId}`);
  }

  return formatActivity(result);
}

/**
 * Activity өгөгдлийг форматлах
 */
function formatActivity(activity) {
  // _parties нь fetchActivitiesByType-аас ирнэ
  const parties = activity._parties || [];

  // Activity party types:
  // 1 = From/Owner, 2 = To, 3 = CC, 4 = BCC, 5 = Required, 6 = Optional, 7 = Organizer, 8 = Regarding, 9 = Customer
  const from = parties.filter(p => p.participationtypemask === 1);
  const to = parties.filter(p => p.participationtypemask === 2);

  return {
    id: activity.activityid,
    type: activity.activitytypecode,
    subject: activity.subject || '(No Subject)',
    description: activity.description || '',
    createdOn: activity.createdon,
    modifiedOn: activity.modifiedon,
    scheduledStart: activity.scheduledstart,
    scheduledEnd: activity.scheduledend,
    duration: activity.actualdurationminutes,
    status: getActivityStatusLabel(activity.activitytypecode, activity.statuscode),
    statusCode: activity.statuscode,
    stateCode: activity.statecode,
    regardingObjectId: activity._regardingobjectid_value,
    parties: {
      from: from.map(p => p.addressused).filter(Boolean),
      to: to.map(p => p.addressused).filter(Boolean)
    }
  };
}

/**
 * Activity status label авах
 */
function getActivityStatusLabel(activityType, statusCode) {
  // Email statuses
  if (activityType === 'email') {
    const emailStatuses = {
      1: 'Draft',
      2: 'Completed',
      3: 'Sent',
      4: 'Received',
      5: 'Canceled',
      6: 'Pending Send',
      7: 'Sending',
      8: 'Failed'
    };
    return emailStatuses[statusCode] || 'Unknown';
  }

  // Task statuses
  if (activityType === 'task') {
    const taskStatuses = {
      2: 'Not Started',
      3: 'In Progress',
      4: 'Waiting',
      5: 'Completed',
      6: 'Canceled',
      7: 'Deferred'
    };
    return taskStatuses[statusCode] || 'Unknown';
  }

  // Phone call statuses
  if (activityType === 'phonecall') {
    const phoneStatuses = {
      1: 'Open',
      2: 'Made',
      3: 'Canceled',
      4: 'Received'
    };
    return phoneStatuses[statusCode] || 'Unknown';
  }

  // Appointment statuses
  if (activityType === 'appointment') {
    const appointmentStatuses = {
      1: 'Free',
      2: 'Tentative',
      3: 'Completed',
      4: 'Canceled',
      5: 'Busy',
      6: 'Out of Office'
    };
    return appointmentStatuses[statusCode] || 'Unknown';
  }

  // Generic statuses
  const genericStatuses = {
    1: 'Open',
    2: 'Completed',
    3: 'Canceled'
  };
  return genericStatuses[statusCode] || 'Unknown';
}

module.exports = {
  getMyActivities,
  getActivityById,
  ACTIVITY_TYPE_CODES
};
