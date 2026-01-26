const { dynamicsGet, dynamicsPost } = require('./dynamicsAuth');

/**
 * Account/Contact-тай холбоотой имэйлүүдийг татах
 * @param {string} entityType - 'account' эсвэл 'contact'
 * @param {string} entityId - Entity GUID
 * @param {object} options - Pagination, filter options
 */
async function getEmailsByEntity(entityType, entityId, options = {}) {
  const { top = 50, orderBy = 'createdon desc' } = options;

  // Filter: regardingobjectid-аар
  const filter = `_regardingobjectid_value eq '${entityId}'`;

  const queryParams = {
    '$select': 'activityid,subject,description,createdon,modifiedon,statuscode,statecode,directioncode',
    '$filter': filter,
    '$orderby': orderBy,
    '$top': top.toString(),
    '$expand': 'email_activity_parties($select=participationtypemask,addressused)'
  };

  const result = await dynamicsGet('emails', queryParams);

  return {
    emails: result.value.map(formatEmail),
    totalCount: result.value.length,
    hasMore: result.value.length === top
  };
}

/**
 * Нэг имэйлийн дэлгэрэнгүй мэдээлэл
 */
async function getEmailById(emailId) {
  console.log(`getEmailById called - emailId: ${emailId}`);

  const queryParams = {
    '$select': 'activityid,subject,description,createdon,modifiedon,statuscode,statecode,directioncode,_regardingobjectid_value',
    '$expand': 'email_activity_parties($select=participationtypemask,addressused)'
  };

  let result;
  try {
    result = await dynamicsGet(`emails(${emailId})`, queryParams);
  } catch (err) {
    console.error(`getEmailById failed for ${emailId}:`, err.response?.status, err.response?.data || err.message);
    throw new Error(`Email not found or access denied: ${emailId}`);
  }

  // Attachment-уудыг тусад нь татах
  let attachments = [];
  try {
    const attachmentResult = await dynamicsGet(`activitymimeattachments`, {
      '$select': 'activitymimeattachmentid,filename,filesize,mimetype',
      '$filter': `_objectid_value eq ${emailId}`
    });
    attachments = attachmentResult.value || [];
  } catch (err) {
    // Attachment байхгүй бол алдаа гаргахгүй
  }

  return formatEmail({ ...result, attachments });
}

/**
 * Accounts жагсаалт (dropdown-д)
 */
async function getAccounts(options = {}) {
  const { top = 100, search = '' } = options;

  const queryParams = {
    '$select': 'accountid,name,emailaddress1',
    '$orderby': 'name asc',
    '$top': top.toString()
  };

  if (search) {
    queryParams['$filter'] = `contains(name,'${search}')`;
  }

  const result = await dynamicsGet('accounts', queryParams);

  return result.value.map(account => ({
    id: account.accountid,
    name: account.name,
    email: account.emailaddress1
  }));
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
 * Email хаягаар имэйлүүдийг хайх
 * @param {string} emailAddress - Хайх email хаяг
 * @param {object} options - Pagination options
 */
async function getEmailsByEmailAddress(emailAddress, options = {}) {
  const { top = 50, orderBy = 'createdon desc' } = options;

  // activity_parties дотор хайх
  const queryParams = {
    '$select': 'activityid,subject,description,createdon,modifiedon,statuscode,statecode,directioncode,_regardingobjectid_value',
    '$orderby': orderBy,
    '$top': (top * 2).toString(),
    '$expand': 'email_activity_parties($select=participationtypemask,addressused)'
  };

  const result = await dynamicsGet('emails', queryParams);

  // Email хаягаар шүүх
  const filteredEmails = result.value.filter(email => {
    const parties = email.email_activity_parties || [];
    return parties.some(p =>
      p.addressused && p.addressused.toLowerCase().includes(emailAddress.toLowerCase())
    );
  });

  // Top-оор хязгаарлах
  const limitedEmails = filteredEmails.slice(0, top);

  return {
    emails: limitedEmails.map(formatEmail),
    totalCount: filteredEmails.length,
    hasMore: filteredEmails.length > top
  };
}

/**
 * Contacts жагсаалт (dropdown-д)
 */
async function getContacts(options = {}) {
  const { top = 100, search = '', accountId = '' } = options;

  const queryParams = {
    '$select': 'contactid,fullname,emailaddress1,_parentcustomerid_value',
    '$orderby': 'fullname asc',
    '$top': top.toString()
  };

  const filters = [];
  if (search) {
    filters.push(`contains(fullname,'${search}')`);
  }
  if (accountId) {
    filters.push(`_parentcustomerid_value eq '${accountId}'`);
  }
  if (filters.length > 0) {
    queryParams['$filter'] = filters.join(' and ');
  }

  const result = await dynamicsGet('contacts', queryParams);

  return result.value.map(contact => ({
    id: contact.contactid,
    name: contact.fullname,
    email: contact.emailaddress1,
    accountId: contact._parentcustomerid_value
  }));
}

/**
 * Имэйлд хариулах (Reply)
 */
async function replyToEmail(originalEmailId, replyBody, fromUserId) {
  console.log(`replyToEmail called - emailId: ${originalEmailId}, fromUserId: ${fromUserId}`);

  // Эхлээд анхны имэйлийг авах
  let original;
  try {
    original = await getEmailById(originalEmailId);
    console.log('Original email fetched:', original.subject, 'sender:', original.sender);
  } catch (err) {
    console.error('Failed to fetch original email:', err.message);
    throw new Error(`Cannot fetch original email: ${err.message}`);
  }

  // Хариу авагчийн имэйл хаяг олох
  const replyToAddress = original.sender ||
    (original.parties?.from?.[0]?.address) ||
    '';

  if (!replyToAddress) {
    throw new Error('Cannot determine reply address - original sender not found');
  }

  // Шинэ имэйл үүсгэх
  const emailData = {
    'subject': `RE: ${original.subject}`,
    'description': replyBody,
    'directioncode': true // Outgoing
  };

  // regardingObjectId байвал нэмэх
  if (original.regardingObjectId) {
    emailData['regardingobjectid_account@odata.bind'] = `/accounts(${original.regardingObjectId})`;
  }

  // Activity parties - to, from
  const parties = [
    {
      'participationtypemask': 2, // To
      'addressused': replyToAddress
    }
  ];

  // fromUserId байвал systemuser-ээр, байхгүй бол email хаягаар
  if (fromUserId) {
    parties.push({
      'participationtypemask': 1, // From
      'partyid_systemuser@odata.bind': `/systemusers(${fromUserId})`
    });
  }

  emailData['email_activity_parties'] = parties;

  console.log('Creating reply email:', JSON.stringify(emailData, null, 2));

  const result = await dynamicsPost('emails', emailData);

  // Имэйл илгээх
  if (result.activityid) {
    try {
      await sendEmail(result.activityid);
    } catch (sendError) {
      console.error('Failed to send email, but email was created:', sendError.message);
      // Имэйл үүссэн ч илгээж чадаагүй - Draft төлөвт үлдэнэ
    }
  }

  return result;
}

/**
 * Имэйл дамжуулах (Forward)
 */
async function forwardEmail(originalEmailId, toAddress, forwardBody, fromUserId) {
  const original = await getEmailById(originalEmailId);

  const emailData = {
    'subject': `FW: ${original.subject}`,
    'description': `${forwardBody}\n\n--- Original Message ---\n${original.body || ''}`,
    'directioncode': true
  };

  // regardingObjectId байвал нэмэх
  if (original.regardingObjectId) {
    emailData['regardingobjectid_account@odata.bind'] = `/accounts(${original.regardingObjectId})`;
  }

  // Activity parties
  const parties = [
    {
      'participationtypemask': 2, // To
      'addressused': toAddress
    }
  ];

  // fromUserId байвал systemuser-ээр
  if (fromUserId) {
    parties.push({
      'participationtypemask': 1, // From
      'partyid_systemuser@odata.bind': `/systemusers(${fromUserId})`
    });
  }

  emailData['email_activity_parties'] = parties;

  console.log('Creating forward email:', JSON.stringify(emailData, null, 2));

  const result = await dynamicsPost('emails', emailData);

  if (result.activityid) {
    try {
      await sendEmail(result.activityid);
    } catch (sendError) {
      console.error('Failed to send forwarded email, but email was created:', sendError.message);
    }
  }

  return result;
}

/**
 * Имэйл илгээх action
 */
async function sendEmail(emailId) {
  const endpoint = `emails(${emailId})/Microsoft.Dynamics.CRM.SendEmail`;
  return await dynamicsPost(endpoint, {
    'IssueSend': true
  });
}

/**
 * Имэйл өгөгдлийг форматлах
 */
function formatEmail(email) {
  const parties = email.email_activity_parties || [];

  // Activity party types:
  // 1 = From, 2 = To, 3 = CC, 4 = BCC
  const from = parties.filter(p => p.participationtypemask === 1);
  const to = parties.filter(p => p.participationtypemask === 2);
  const cc = parties.filter(p => p.participationtypemask === 3);

  return {
    id: email.activityid,
    subject: email.subject || '(No Subject)',
    body: email.description || '',
    sender: email.sender || (from[0]?.addressused) || '',
    toRecipients: email.torecipients || to.map(p => p.addressused).filter(Boolean).join('; '),
    ccRecipients: email.ccrecipients || cc.map(p => p.addressused).filter(Boolean).join('; '),
    createdOn: email.createdon,
    modifiedOn: email.modifiedon,
    status: getStatusLabel(email.statuscode),
    statusCode: email.statuscode,
    direction: email.directioncode ? 'Outgoing' : 'Incoming',
    regardingObjectId: email._regardingobjectid_value,
    attachments: (email.attachments || []).map(att => ({
      id: att.activitymimeattachmentid || att.attachmentid,
      filename: att.filename,
      filesize: att.filesize,
      mimetype: att.mimetype
    })),
    parties: {
      from: from.map(formatParty),
      to: to.map(formatParty),
      cc: cc.map(formatParty)
    }
  };
}

function formatParty(party) {
  return {
    address: party.addressused,
    type: party.participationtypemask
  };
}

function getStatusLabel(statusCode) {
  const statuses = {
    1: 'Draft',
    2: 'Completed',
    3: 'Sent',
    4: 'Received',
    5: 'Canceled',
    6: 'Pending Send',
    7: 'Sending',
    8: 'Failed'
  };
  return statuses[statusCode] || 'Unknown';
}

module.exports = {
  getEmailsByEntity,
  getEmailsByEmailAddress,
  getEmailById,
  getAccounts,
  getContacts,
  replyToEmail,
  forwardEmail,
  sendEmail
};
